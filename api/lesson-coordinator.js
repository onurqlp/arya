import { requireAdmin, sameOrigin } from "../lib/auth.js";
import { getCoordinatorDb } from "../lib/coordinator-db.js";
import { loadCoordinatorDashboard, runCoordinatorAction } from "../lib/coordinator-store.js";

function readBody(req) {
  if (req.body && typeof req.body === "object" && !Array.isArray(req.body)) return req.body;
  if (typeof req.body === "string" && req.body.length <= 12000) {
    try {
      const parsed = JSON.parse(req.body);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
    } catch { return null; }
  }
  return null;
}

function validBody(body) {
  if (!body || typeof body.action !== "string") return false;
  const fields = {
    "enable-demo": ["action"],
    "update-schedule": ["action","rule_id","weekday","start_time","enabled","group_name","teacher_name"],
    generate: ["action","class_date"],
    "simulate-confirm": ["action","occurrence_id"],
    "simulate-reschedule": ["action","occurrence_id","start_time"],
    "simulate-cancel": ["action","occurrence_id"],
    "simulate-holiday": ["action","occurrence_id"],
    "simulate-uncertain": ["action","occurrence_id"],
    "simulate-late": ["action","occurrence_id"],
    pause: ["action"],
    resume: ["action"],
    retry: ["action","job_id"]
  }[body.action];
  return Boolean(fields) && Object.keys(body).every((key) => fields.includes(key)) &&
    fields.every((key) => Object.hasOwn(body, key));
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  if (!["GET","POST"].includes(req.method)) {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "method_not_allowed" });
  }
  if (!requireAdmin(req, res)) return;
  if (req.method === "GET") {
    try {
      const data = await loadCoordinatorDashboard(getCoordinatorDb());
      return res.status(200).json(data);
    } catch (error) {
      return res.status(503).json({ error: error.code || "coordinator_storage_unavailable" });
    }
  }
  if (!sameOrigin(req)) return res.status(403).json({ error: "origin_rejected" });
  const body = readBody(req);
  if (!validBody(body)) return res.status(400).json({ error: "invalid_coordinator_action" });
  try {
    const result = await runCoordinatorAction(getCoordinatorDb(), body);
    return res.status(200).json({ ...result, sending_enabled: false });
  } catch (error) {
    return res.status(error.status || 503).json({ error: error.code || "coordinator_storage_unavailable" });
  }
}
