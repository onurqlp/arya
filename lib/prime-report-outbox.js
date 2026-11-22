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

function validateBody(value, maxLength = 3000) {
  if (typeof value !== "string") throw fail("invalid_report_body");
  const body = value.trim();
  if (!body || body.length > maxLength) throw fail("invalid_report_body");
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

export async function createPrimeReportBatchDraft(db, input) {
  if (!input || typeof input.idempotency_key !== "string" || !UUID_RE.test(input.idempotency_key) ||
      input.data_reviewed !== true || !Array.isArray(input.parts) || input.parts.length !== 3) {
    throw fail("invalid_report_batch");
  }
  const parts = input.parts.map((value, index) => {
    const body = validateBody(value, 1200);
    if (!new RegExp("^" + (index + 1) + "\\/3(?:\\s|[•—:.-])", "u").test(body)) {
      throw fail("invalid_report_part_heading");
    }
    return body;
  });
  const hashes = parts.map(digest);
  await db.query(
    "INSERT INTO arya_prime_report_outbox " +
    "(idempotency_key, target_chat, body, content_sha256, data_reviewed_at) VALUES " +
    "($1 || ':1', $2, $3, $4, NOW()), ($1 || ':2', $2, $5, $6, NOW()), " +
    "($1 || ':3', $2, $7, $8, NOW()) ON CONFLICT (idempotency_key) DO NOTHING",
    [input.idempotency_key, TARGET_CHAT, parts[0], hashes[0], parts[1], hashes[1], parts[2], hashes[2]]
  );
  const rows = await db.query(
    "SELECT id::text AS id, idempotency_key, target_chat, body, content_sha256, status, created_at " +
    "FROM arya_prime_report_outbox WHERE idempotency_key LIKE $1 || ':%' " +
    "ORDER BY split_part(idempotency_key, ':', 2)::int",
    [input.idempotency_key]
  );
  if (rows.length !== 3 || rows.some((row, index) =>
      row.idempotency_key !== input.idempotency_key + ":" + (index + 1) ||
      row.body !== parts[index] || row.content_sha256 !== hashes[index])) {
    throw fail("idempotency_key_conflict", 409);
  }
  return {
    batch_id: input.idempotency_key,
    target_chat: TARGET_CHAT,
    status: rows.every(row => row.status === "draft") ? "draft" : rows.find(row => row.status !== "sent_verified")?.status || "sent_verified",
    content_hashes: hashes,
    parts: rows.map((row, index) => ({ ...row, part_index: index + 1, part_count: 3 })),
    duplicate: rows.some(row => row.status !== "draft")
  };
}

export async function listPrimeReports(db, limit = 30) {
  const rows = await db.query(
    "SELECT id::text AS id, idempotency_key, target_chat, body, content_sha256, status, approved_at, " +
    "attempt_started_at, finished_at, outcome_code, created_at, " +
    "CASE WHEN position(':' in idempotency_key) > 0 THEN split_part(idempotency_key, ':', 1) ELSE NULL END AS batch_id, " +
    "CASE WHEN idempotency_key ~ '^[0-9a-f-]{36}:[123]
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

export async function approvePrimeReportBatch(db, batchId, contentHashes) {
  if (!UUID_RE.test(batchId || "") || !Array.isArray(contentHashes) || contentHashes.length !== 3 ||
      contentHashes.some(value => !/^[a-f0-9]{64}$/.test(value || ""))) {
    throw fail("invalid_report_batch_approval");
  }
  const current = await db.query(
    "SELECT id::text AS id, idempotency_key, target_chat, body, content_sha256, status, created_at " +
    "FROM arya_prime_report_outbox WHERE idempotency_key LIKE $1 || ':%' " +
    "ORDER BY split_part(idempotency_key, ':', 2)::int",
    [batchId]
  );
  if (current.length !== 3 || current.some((row, index) =>
      row.target_chat !== TARGET_CHAT || row.idempotency_key !== batchId + ":" + (index + 1) ||
      row.content_sha256 !== contentHashes[index])) throw fail("report_batch_not_approvable", 409);
  if (current.every(row => row.status === "approved")) {
    return { batch_id: batchId, target_chat: TARGET_CHAT, status: "approved", content_hashes: contentHashes,
      parts: current.map((row, index) => ({ ...row, part_index: index + 1, part_count: 3 })), duplicate: true };
  }
  if (current.some(row => row.status !== "draft")) throw fail("report_batch_not_approvable", 409);
  const rows = await db.query(
    "UPDATE arya_prime_report_outbox SET status = 'approved', approved_sha256 = content_sha256, " +
    "approved_at = NOW(), updated_at = NOW() WHERE idempotency_key LIKE $1 || ':%' AND status = 'draft' " +
    "RETURNING id::text AS id, idempotency_key, target_chat, body, content_sha256, status, approved_at, created_at",
    [batchId]
  );
  if (rows.length !== 3) throw fail("report_batch_not_approvable", 409);
  rows.sort((a, b) => a.idempotency_key.localeCompare(b.idempotency_key));
  return { batch_id: batchId, target_chat: TARGET_CHAT, status: "approved", content_hashes: contentHashes,
    parts: rows.map((row, index) => ({ ...row, part_index: index + 1, part_count: 3 })), duplicate: false };
}

export async function cancelPrimeReportBatch(db, batchId) {
  if (!UUID_RE.test(batchId || "")) throw fail("invalid_report_batch");
  const rows = await db.query(
    "UPDATE arya_prime_report_outbox SET status = 'cancelled', updated_at = NOW(), finished_at = NOW() " +
    "WHERE idempotency_key LIKE $1 || ':%' AND status IN ('draft','approved') " +
    "RETURNING id::text AS id, idempotency_key, status",
    [batchId]
  );
  if (!rows.length) throw fail("report_batch_not_cancellable", 409);
  return { batch_id: batchId, status: "cancelled", cancelled_parts: rows.length };
}

export async function claimPrimeReport(db, agentId) {
  if (!AGENT_RE.test(agentId || "")) throw fail("invalid_agent_id");
  const rows = await db.query(
    "WITH queued AS (" +
      "SELECT report.*, CASE WHEN position(':' in idempotency_key) > 0 " +
        "THEN split_part(idempotency_key, ':', 1) ELSE idempotency_key END AS batch_key, " +
        "CASE WHEN idempotency_key ~ '^[0-9a-f-]{36}:[123]
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
 THEN split_part(idempotency_key, ':', 2)::int ELSE NULL END AS part_index " +
    "FROM arya_prime_report_outbox ORDER BY created_at DESC, idempotency_key DESC LIMIT $1",
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
 " +
        "THEN split_part(idempotency_key, ':', 2)::int ELSE 0 END AS part_index " +
      "FROM arya_prime_report_outbox report WHERE status = 'approved' AND target_chat = $2" +
    "), oldest_batch AS (" +
      "SELECT batch_key FROM queued ORDER BY created_at, batch_key LIMIT 1" +
    "), candidate AS (" +
      "SELECT queued.id FROM queued JOIN oldest_batch USING (batch_key) " +
      "WHERE part_index IN (0,1) OR EXISTS (" +
        "SELECT 1 FROM arya_prime_report_outbox previous " +
        "WHERE previous.idempotency_key = queued.batch_key || ':' || (queued.part_index - 1)::text " +
        "AND previous.status = 'sent_verified'" +
      ") ORDER BY part_index, created_at LIMIT 1 FOR UPDATE SKIP LOCKED" +
    ") " +
    "UPDATE arya_prime_report_outbox AS report SET status = 'sending', worker_agent_id = $1, " +
      "attempt_started_at = NOW(), updated_at = NOW() " +
    "FROM candidate WHERE report.id = candidate.id " +
    "RETURNING report.id::text AS id, report.idempotency_key, report.target_chat AS chat_name, report.body, " +
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
 THEN split_part(idempotency_key, ':', 2)::int ELSE NULL END AS part_index " +
    "FROM arya_prime_report_outbox ORDER BY created_at DESC, idempotency_key DESC LIMIT $1",
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
