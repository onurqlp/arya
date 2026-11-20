import { requireAdmin, sameOrigin } from "../../lib/auth.js";
import { getCoordinatorDb } from "../../lib/coordinator-db.js";
import { buildLocalWhatsAppDayPreview, listLocalWhatsAppSchedules, saveLocalWhatsAppSchedule, updateLocalWhatsAppSettings } from "../../lib/local-whatsapp-schedule.js";
import { resolveLocalWhatsAppOutbox } from "../../lib/local-whatsapp-outbox.js";
import { localWhatsAppAgentConfigured } from "../../lib/whatsapp-transport.js";

function readBody(req) {
  if (req.body && typeof req.body === "object" && !Array.isArray(req.body)) return req.body;
  if (typeof req.body === "string" && req.body.length <= 12000) {
    try { const parsed = JSON.parse(req.body); return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null; }
    catch { return null; }
  }
  return null;
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  if (!requireAdmin(req, res)) return;
  if (req.method === "GET") {
    try { return res.status(200).json(await listLocalWhatsAppSchedules(getCoordinatorDb())); }
    catch (error) { return res.status(error.status || 503).json({ error: error.code || "whatsapp_schedule_storage_unavailable" }); }
  }
  if (req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "method_not_allowed" });
  }
  if (!sameOrigin(req)) return res.status(403).json({ error: "origin_rejected" });
  const body = readBody(req);
  if (!body || typeof body.action !== "string") return res.status(400).json({ error: "invalid_whatsapp_schedule_action" });
  try {
    const db = getCoordinatorDb();
    let allowedChats = [];
    try {
      const parsed = JSON.parse(process.env.ARYA_LOCAL_WHATSAPP_ALLOWED_CHATS || "[]");
      if (Array.isArray(parsed)) allowedChats = parsed.filter((item) => typeof item === "string");
    } catch {}
    if (body.action === "arm-live-send" && !localWhatsAppAgentConfigured()) {
      return res.status(409).json({ error: "whatsapp_local_agent_not_configured" });
    }
    const result = body.action === "save-schedule"
      ? await saveLocalWhatsAppSchedule(db, body.schedule)
      : body.action === "preview-day"
        ? await (async () => {
          const current = await listLocalWhatsAppSchedules(db);
          return { date: body.date, settings: current.settings, preview: buildLocalWhatsAppDayPreview(current.schedules, body.date, current.settings.approval_chat_name) };
        })()
        : body.action === "resolve-outbox"
          ? await resolveLocalWhatsAppOutbox(db, body)
          : await updateLocalWhatsAppSettings(db, body, allowedChats);
    return res.status(200).json(result);
  } catch (error) {
    return res.status(error.status || 503).json({ error: error.code || "whatsapp_schedule_storage_unavailable" });
  }
}
