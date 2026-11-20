import { ensureSchema } from "../../lib/db.js";
import { requireAdmin, sameOrigin } from "../../lib/auth.js";
import { getCoordinatorDb } from "../../lib/coordinator-db.js";
import { enqueueLocalWhatsAppJob, ensureLocalWhatsAppOutboxSchema } from "../../lib/local-whatsapp-outbox.js";
import { localWhatsAppIngestConfigured, whatsappTransport } from "../../lib/whatsapp-transport.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function allowedChat(chatName) {
  try {
    const values = JSON.parse(process.env.ARYA_LOCAL_WHATSAPP_ALLOWED_CHATS || "[]");
    const allowed = new Set(Array.isArray(values) ? values.filter((item) => typeof item === "string").map((item) => item.normalize("NFC").replace(/\s+/g, " ").trim().toLocaleLowerCase("tr-TR")) : []);
    return allowed.has("*") || allowed.has(chatName.normalize("NFC").replace(/\s+/g, " ").trim().toLocaleLowerCase("tr-TR"));
  } catch { return false; }
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    res.status(405).json({ error: "method_not_allowed" });
    return;
  }
  if (!sameOrigin(req)) {
    res.status(403).json({ error: "origin_not_allowed" });
    return;
  }
  if (!requireAdmin(req, res)) return;

  const { conversationId, text, requestId } = req.body || {};
  try {
    const db = await ensureSchema();
    if (whatsappTransport() === "web") {
      if (typeof text !== "string" || !text.trim() || text.trim().length > 4096 || /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(text)) {
        return res.status(400).json({ error: "invalid_reply_text" });
      }
      if (typeof requestId !== "string" || !UUID_RE.test(requestId)) return res.status(400).json({ error: "invalid_reply_request_id" });
      const rawName = typeof conversationId === "string" && conversationId.startsWith("waweb:") ? conversationId.slice(6) : "";
      let chatName = "";
      try { chatName = decodeURIComponent(rawName).normalize("NFC").replace(/\s+/g, " ").trim(); } catch {}
      if (!chatName || chatName.length > 100 || /[\u0000-\u001f]/.test(chatName) || !allowedChat(chatName)) {
        return res.status(409).json({ error: "individual_conversation_required" });
      }
      const inbound = await db.query("SELECT 1 FROM arya_messages WHERE conversation_id = $1 AND message_id LIKE 'waweb:%' LIMIT 1", [conversationId]);
      if (!inbound.length) return res.status(404).json({ error: "conversation_not_found" });
      const coordinatorDb = getCoordinatorDb();
      await ensureLocalWhatsAppOutboxSchema(coordinatorDb);
      const settings = (await coordinatorDb.query("SELECT paused, dry_run, send_enabled FROM arya_web_agent_settings WHERE id = 1"))[0];
      if (!localWhatsAppIngestConfigured() || !settings || settings.paused || settings.dry_run || !settings.send_enabled) {
        return res.status(409).json({ error: "whatsapp_web_send_paused", retryable: false });
      }
      const result = await enqueueLocalWhatsAppJob(coordinatorDb, {
        idempotency_key: "manual-reply:" + requestId,
        job_type: "manual_reply",
        chat_name: chatName,
        body: text.trim(),
        run_at: new Date().toISOString(),
      });
      if (!result.queued) return res.status(409).json({ error: "reply_request_reused", retryable: false });
      return res.status(200).json({ status: "queued", sent: false });
    }
    return res.status(409).json({ error: "whatsapp_web_send_paused", retryable: false });
  } catch {
    res.status(503).json({ error: "send_state_unavailable" });
  }
}
