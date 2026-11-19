import { getCoordinatorDb } from "../lib/coordinator-db.js";
import { ensureAgentSchedule } from "../lib/coordinator-store.js";
import { acknowledge, claimJob } from "../lib/lesson-agent-queue.js";
import { agentApiEnabled, agentTokenConfigured, authorizedAgentRequest } from "../lib/lesson-agent-auth.js";

const AGENT_ID_RE = /^[a-zA-Z0-9._-]{3,64}$/;

function readBody(req) {
  if (req.body && typeof req.body === "object" && !Array.isArray(req.body)) return req.body;
  if (typeof req.body === "string" && req.body.length <= 8000) {
    try {
      const parsed = JSON.parse(req.body);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
    } catch { return null; }
  }
  return null;
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  if (!agentApiEnabled()) return res.status(404).json({ error: "not_found" });
  if (!agentTokenConfigured()) return res.status(503).json({ error: "agent_auth_not_configured" });
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "method_not_allowed" });
  }
  if (!authorizedAgentRequest(req.headers.authorization)) return res.status(401).json({ error: "unauthorized" });
  const body = readBody(req);
  if (!body || typeof body.action !== "string" || !AGENT_ID_RE.test(body.agent_id || "")) {
    return res.status(400).json({ error: "invalid_agent_request" });
  }
  const allowedFields = {
    heartbeat: ["action","agent_id","build_label"],
    pull: ["action","agent_id"],
    ack: ["action","agent_id","job_id","outcome","error_code"]
  }[body.action];
  if (!allowedFields || Object.keys(body).some((key) => !allowedFields.includes(key))) {
    return res.status(400).json({ error: "invalid_agent_request" });
  }
  try {
    const db = getCoordinatorDb();
    if (body.action === "heartbeat") {
      const label = typeof body.build_label === "string" && /^[a-zA-Z0-9 ._-]{1,50}$/.test(body.build_label)
        ? body.build_label : "GO3 fake client";
      await db.query(
        "INSERT INTO coord_agent_heartbeats (agent_id, status, last_seen, build_label) VALUES ($1, 'preview_simulated', NOW(), $2) " +
        "ON CONFLICT (agent_id) DO UPDATE SET status = 'preview_simulated', last_seen = NOW(), build_label = EXCLUDED.build_label",
        [body.agent_id, label]
      );
      return res.status(200).json({ online: true, mode: "preview_simulated", sent: false, sending_enabled: false });
    }
    if (body.action === "pull") {
      await db.query(
        "INSERT INTO coord_agent_heartbeats (agent_id, status, last_seen) VALUES ($1, 'preview_simulated', NOW()) " +
        "ON CONFLICT (agent_id) DO UPDATE SET status = 'preview_simulated', last_seen = NOW()",
        [body.agent_id]
      );
      await ensureAgentSchedule(db);
      const job = await claimJob(db, body.agent_id);
      return res.status(200).json({ job, mode: "preview_simulated", sent: false, sending_enabled: false });
    }
    if (body.action === "ack") {
      if (body.error_code !== undefined && typeof body.error_code !== "string") {
        return res.status(400).json({ error: "invalid_agent_ack" });
      }
      return res.status(200).json(await acknowledge(db, body.agent_id, body));
    }
    return res.status(400).json({ error: "invalid_agent_request" });
  } catch (error) {
    return res.status(error.status || 503).json({ error: error.code || "coordinator_storage_unavailable" });
  }
}
