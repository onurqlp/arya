import { createHmac, timingSafeEqual } from "node:crypto";
import { getCoordinatorDb } from "../lib/coordinator-db.js";
import { localWhatsAppAgentConfigured, whatsappTransport } from "../lib/whatsapp-transport.js";
import { acknowledgeLocalWhatsAppJob, claimLocalWhatsAppJob, enqueueDueLocalWhatsAppJobs, ensureLocalWhatsAppOutboxSchema, processLocalWhatsAppTeacherDecision } from "../lib/local-whatsapp-outbox.js";
import { acknowledgePrimeReport, claimPrimeReport } from "../lib/prime-report-outbox.js";

const SOURCE = "arya-whatsapp-web-local-agent";
const AGENT_RE = /^arya-local-[a-z0-9-]{6,40}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function readBody(req) {
  if (req.body && typeof req.body === "object" && !Array.isArray(req.body)) return req.body;
  if (typeof req.body === "string" && req.body.length <= 5000) {
    try { const value = JSON.parse(req.body); return value && typeof value === "object" && !Array.isArray(value) ? value : null; }
    catch { return null; }
  }
  return null;
}

function normalized(value) {
  return String(value || "").normalize("NFC").replace(/\s+/g, " ").trim().toLocaleLowerCase("tr-TR");
}

function validSignature(req, body, secret) {
  const timestamp = String(req.headers["x-arya-timestamp"] || "");
  const signature = String(req.headers["x-arya-signature"] || "");
  if (!/^\d{10}$/.test(timestamp) || !/^[a-f0-9]{64}$/i.test(signature) || Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false;
  const expected = createHmac("sha256", secret).update(timestamp + "." + JSON.stringify(body)).digest();
  const supplied = Buffer.from(signature, "hex");
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "method_not_allowed" });
  }
  if (whatsappTransport() !== "web" || !localWhatsAppAgentConfigured()) return res.status(404).json({ error: "not_found" });
  const secret = process.env.ARYA_LOCAL_WHATSAPP_INGEST_SECRET;
  const body = readBody(req);
  if (!body || !validSignature(req, body, secret)) return res.status(401).json({ error: "invalid_agent_signature" });
  const invalidPull = body.action === "pull" && (Object.keys(body).some((key) => !["source", "agent_id", "action", "whatsapp_tab_open"].includes(key)) ||
    typeof body.whatsapp_tab_open !== "boolean");
  const invalidAck = body.action === "ack" && (
    Object.keys(body).some((key) => !["source", "agent_id", "action", "job_id", "outcome", "error_code"].includes(key)) ||
    !UUID_RE.test(body.job_id || "") || !["sent", "uncertain", "blocked"].includes(body.outcome) ||
    (body.error_code !== undefined && (typeof body.error_code !== "string" || !/^[a-z0-9_-]{1,60}$/.test(body.error_code)))
  );
  const invalidReportPull = body.action === "report-pull" && (Object.keys(body).some((key) => !["source", "agent_id", "action", "whatsapp_tab_open"].includes(key)) ||
    typeof body.whatsapp_tab_open !== "boolean");
  const invalidReportAck = body.action === "report-ack" && (
    Object.keys(body).some((key) => !["source", "agent_id", "action", "job_id", "outcome", "error_code"].includes(key)) ||
    !UUID_RE.test(body.job_id || "") || !["sent", "uncertain", "blocked"].includes(body.outcome) ||
    (body.error_code !== undefined && (typeof body.error_code !== "string" || !/^[a-z0-9_-]{1,60}$/.test(body.error_code)))
  );
  const decisionReasons = ["explicit_confirmation", "non_explicit_reply", "teacher_chat_or_sender_mismatch"];
  const invalidDecision = body.action === "teacher-decision" && (
    Object.keys(body).some((key) => !["source", "agent_id", "action", "scheduleId", "messageId", "messageTime", "decision", "reason"].includes(key)) ||
    !/^[0-9a-f-]{36}$/i.test(body.scheduleId || "") || !/^waweb:[a-f0-9]{64}$/i.test(body.messageId || "") ||
    !Number.isFinite(Date.parse(body.messageTime || "")) ||
    !["confirmed", "needs_human_review"].includes(body.decision) || !decisionReasons.includes(body.reason)
  );
  if (body.source !== SOURCE || !AGENT_RE.test(body.agent_id || "") ||
      !["pull", "ack", "teacher-decision", "report-pull", "report-ack"].includes(body.action) || invalidPull || invalidAck || invalidDecision || invalidReportPull || invalidReportAck) {
    return res.status(400).json({ error: "invalid_agent_request" });
  }

  try {
    const db = getCoordinatorDb();
    await ensureLocalWhatsAppOutboxSchema(db);
    if (body.action === "teacher-decision") {
      await db.query("INSERT INTO arya_web_agent_heartbeats (agent_id, last_seen, whatsapp_tab_open) VALUES ($1, NOW(), true) " +
        "ON CONFLICT (agent_id) DO UPDATE SET last_seen = NOW(), whatsapp_tab_open = true", [body.agent_id]);
      const result = await processLocalWhatsAppTeacherDecision(db, body);
      return res.status(200).json({ accepted: true, decision: result.decision || (result.ignored ? "ignored" : "recorded"), duplicate: Boolean(result.duplicate) });
    }
    if (body.action === "ack") {
      const acknowledged = await acknowledgeLocalWhatsAppJob(db, body.agent_id, body);
      return res.status(200).json(acknowledged);
    }
    if (body.action === "report-ack") {
      return res.status(200).json(await acknowledgePrimeReport(db, body.agent_id, body));
    }
    if (body.action === "report-pull") {
      await db.query("INSERT INTO arya_web_agent_heartbeats (agent_id, last_seen, whatsapp_tab_open) VALUES ($1, NOW(), $2) " +
        "ON CONFLICT (agent_id) DO UPDATE SET last_seen = NOW(), whatsapp_tab_open = EXCLUDED.whatsapp_tab_open", [body.agent_id, body.whatsapp_tab_open]);
      if (!body.whatsapp_tab_open) return res.status(200).json({ job: null, target: "ARYA ONAY", reason: "whatsapp_tab_closed" });
      const result = await claimPrimeReport(db, body.agent_id);
      return res.status(200).json({ ...result, target: "ARYA ONAY", send_once: true });
    }
    await db.query("INSERT INTO arya_web_agent_heartbeats (agent_id, last_seen, whatsapp_tab_open) VALUES ($1, NOW(), $2) " +
      "ON CONFLICT (agent_id) DO UPDATE SET last_seen = NOW(), whatsapp_tab_open = EXCLUDED.whatsapp_tab_open", [body.agent_id, body.whatsapp_tab_open]);
    const settings = (await db.query("SELECT paused, dry_run, send_enabled FROM arya_web_agent_settings WHERE id = 1"))[0];
    const schedules = await db.query("SELECT id::text AS id, group_name, teacher_name, teacher_chat_name, weekday, " +
      "to_char(checkin_time, 'HH24:MI') AS checkin_time, to_char(response_deadline, 'HH24:MI') AS response_deadline, " +
      "to_char(class_time, 'HH24:MI') AS class_time, enabled FROM arya_web_schedules WHERE enabled = true");
    if (!settings) return res.status(200).json({ job: null, schedules, sending_enabled: false });
    await enqueueDueLocalWhatsAppJobs(db);
    const result = await claimLocalWhatsAppJob(db, body.agent_id, settings);
    result.schedules = schedules;
    if (result.job) {
      let allowlist = [];
      try { allowlist = JSON.parse(process.env.ARYA_LOCAL_WHATSAPP_ALLOWED_CHATS || "[]"); } catch {}
      const allowed = new Set(Array.isArray(allowlist) ? allowlist.map(normalized) : []);
      if (!allowed.has("*") && !allowed.has(normalized(result.job.chat_name))) {
        await acknowledgeLocalWhatsAppJob(db, body.agent_id, { job_id: result.job.id, outcome: "blocked", error_code: "chat_not_allowlisted" });
        return res.status(200).json({ job: null, schedules, sending_enabled: result.sending_enabled, blocked: "chat_not_allowlisted" });
      }
    }
    return res.status(200).json(result);
  } catch (error) {
    return res.status(error.status || 503).json({ error: error.code || "local_agent_storage_unavailable" });
  }
}
