import { createHash, randomUUID } from "node:crypto";

const TARGET_CHAT = "ARYA ONAY";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const AGENT_RE = /^arya-local-[a-z0-9-]{6,40}$/;

function fail(code, status = 400) {
  return Object.assign(new Error(code), { code, status });
}

function digest(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function validateBody(value) {
  if (typeof value !== "string") throw fail("invalid_report_body");
  const body = value.trim();
  if (!body || body.length > 3000) throw fail("invalid_report_body");
  if (/(?:^|\D)\d{11}(?!\d)/u.test(body) ||
      /(?:\+?90[\s().-]*|0)5\d{2}[\s().-]*\d{3}[\s().-]*\d{2}[\s().-]*\d{2}/u.test(body) ||
      /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/iu.test(body)) {
    throw fail("report_contains_sensitive_identifier", 422);
  }
  return body;
}

export async function createPrimeReportDraft(db, input) {
  if (!input || typeof input.idempotency_key !== "string" || !UUID_RE.test(input.idempotency_key) ||
      input.data_reviewed !== true) throw fail("invalid_report_draft");
  const body = validateBody(input.body);
  const contentHash = digest(body);
  const rows = await db.query(
    "INSERT INTO arya_prime_report_outbox " +
    "(idempotency_key, target_chat, body, content_sha256, data_reviewed_at) " +
    "VALUES ($1, $2, $3, $4, NOW()) ON CONFLICT (idempotency_key) DO NOTHING " +
    "RETURNING id::text AS id, idempotency_key, target_chat, body, content_sha256, status, created_at",
    [input.idempotency_key, TARGET_CHAT, body, contentHash]
  );
  if (rows[0]) return { ...rows[0], duplicate: false };
  const existing = (await db.query(
    "SELECT id::text AS id, idempotency_key, target_chat, body, content_sha256, status, created_at " +
    "FROM arya_prime_report_outbox WHERE idempotency_key = $1",
    [input.idempotency_key]
  ))[0];
  if (!existing) throw fail("report_draft_storage_unavailable", 503);
  if (existing.content_sha256 !== contentHash) throw fail("idempotency_key_conflict", 409);
  return { ...existing, duplicate: true };
}

export async function listPrimeReports(db, limit = 10) {
  const rows = await db.query(
    "SELECT id::text AS id, target_chat, body, content_sha256, status, approved_at, " +
    "attempt_started_at, finished_at, outcome_code, created_at " +
    "FROM arya_prime_report_outbox ORDER BY created_at DESC LIMIT $1",
    [Math.max(1, Math.min(20, Number(limit) || 10))]
  );
  return rows;
}

export async function getPrimeReportSendingSetting(db) {
  const row = (await db.query(
    "SELECT sending_enabled, updated_at FROM arya_prime_report_settings WHERE id = 1"
  ))[0];
  if (!row) throw fail("prime_report_settings_missing", 503);
  return { sending_enabled: Boolean(row.sending_enabled), updated_at: row.updated_at };
}

export async function setPrimeReportSendingSetting(db, enabled) {
  if (typeof enabled !== "boolean") throw fail("invalid_sending_setting");
  if (enabled) {
    const pending = (await db.query(
      "SELECT id FROM arya_prime_report_outbox WHERE status IN ('approved','sending') LIMIT 1"
    ))[0];
    if (pending) throw fail("pending_prime_reports", 409);
  }
  const rows = await db.query(
    "UPDATE arya_prime_report_settings SET sending_enabled = $1, updated_at = NOW() " +
    "WHERE id = 1 RETURNING sending_enabled, updated_at",
    [enabled]
  );
  if (!rows[0]) throw fail("prime_report_settings_missing", 503);
  return { sending_enabled: Boolean(rows[0].sending_enabled), updated_at: rows[0].updated_at };
}

export async function approvePrimeReport(db, id, contentHash) {
  if (!UUID_RE.test(id || "") || !/^[a-f0-9]{64}$/.test(contentHash || "")) {
    throw fail("invalid_report_approval");
  }
  const rows = await db.query(
    "UPDATE arya_prime_report_outbox SET status = 'approved', approved_sha256 = $2, " +
    "approved_at = NOW(), updated_at = NOW() " +
    "WHERE id = $1::uuid AND status = 'draft' AND target_chat = $3 AND content_sha256 = $2 " +
    "RETURNING id::text AS id, target_chat, body, content_sha256, status, approved_at",
    [id, contentHash, TARGET_CHAT]
  );
  if (rows[0]) return { ...rows[0], duplicate: false };
  const current = (await db.query(
    "SELECT id::text AS id, target_chat, body, content_sha256, status, approved_at " +
    "FROM arya_prime_report_outbox WHERE id = $1::uuid",
    [id]
  ))[0];
  if (current?.status === "approved" && current.content_sha256 === contentHash &&
      current.target_chat === TARGET_CHAT) return { ...current, duplicate: true };
  throw fail("report_not_approvable", 409);
}

export async function cancelPrimeReport(db, id) {
  if (!UUID_RE.test(id || "")) throw fail("invalid_report_id");
  const rows = await db.query(
    "UPDATE arya_prime_report_outbox SET status = 'cancelled', updated_at = NOW(), finished_at = NOW() " +
    "WHERE id = $1::uuid AND status IN ('draft','approved') RETURNING id::text AS id, status",
    [id]
  );
  if (rows[0]) return { ...rows[0], cancelled: true };
  const current = (await db.query(
    "SELECT id::text AS id, status FROM arya_prime_report_outbox WHERE id = $1::uuid", [id]
  ))[0];
  if (!current) throw fail("report_not_found", 404);
  return { ...current, cancelled: false };
}

export async function claimPrimeReport(db, agentId) {
  if (!AGENT_RE.test(agentId || "")) throw fail("invalid_agent_id");
  const rows = await db.query(
    "WITH candidate AS (" +
      "SELECT id FROM arya_prime_report_outbox " +
      "WHERE status = 'approved' AND target_chat = $2 " +
      "ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED" +
    ") " +
    "UPDATE arya_prime_report_outbox AS report SET status = 'sending', worker_agent_id = $1, " +
      "attempt_started_at = NOW(), updated_at = NOW() " +
    "FROM candidate WHERE report.id = candidate.id " +
    "RETURNING report.id::text AS id, report.target_chat AS chat_name, report.body, " +
      "report.content_sha256, report.status",
    [agentId, TARGET_CHAT]
  );
  if (!rows[0]) return { job: null };
  return { job: { ...rows[0], job_type: "prime_report" } };
}

export async function acknowledgePrimeReport(db, agentId, payload) {
  if (!AGENT_RE.test(agentId || "") || !UUID_RE.test(payload?.job_id || "") ||
      !["sent", "uncertain", "blocked"].includes(payload?.outcome) ||
      (payload.error_code !== undefined &&
        (typeof payload.error_code !== "string" || !/^[a-z0-9_-]{1,60}$/.test(payload.error_code)))) {
    throw fail("invalid_prime_report_ack");
  }
  const nextStatus = payload.outcome === "sent" ? "sent_verified" : payload.outcome;
  const code = payload.error_code || null;
  const rows = await db.query(
    "UPDATE arya_prime_report_outbox SET status = $3, outcome_code = $4, finished_at = NOW(), updated_at = NOW() " +
    "WHERE id = $1::uuid AND worker_agent_id = $2 AND status = 'sending' " +
    "RETURNING id::text AS id, status, outcome_code, finished_at",
    [payload.job_id, agentId, nextStatus, code]
  );
  if (rows[0]) return { ...rows[0], accepted: true, duplicate: false };
  const existing = (await db.query(
    "SELECT id::text AS id, status, outcome_code, finished_at " +
    "FROM arya_prime_report_outbox WHERE id = $1::uuid AND worker_agent_id = $2",
    [payload.job_id, agentId]
  ))[0];
  if (existing && ["sent_verified", "uncertain", "blocked"].includes(existing.status)) {
    return { ...existing, accepted: true, duplicate: true };
  }
  throw fail("prime_report_ack_not_accepted", 409);
}

export { TARGET_CHAT };
