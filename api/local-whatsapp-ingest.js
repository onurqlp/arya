import { createHmac, timingSafeEqual } from "node:crypto";
import { localWhatsAppIngestConfigured } from "../lib/whatsapp-transport.js";
import { ensureSchema } from "../lib/db.js";
import { getCoordinatorDb } from "../lib/coordinator-db.js";
import { processLocalWhatsAppInbound } from "../lib/local-whatsapp-outbox.js";

const SOURCE = "arya-whatsapp-web-local-agent";
const AGENT_ID_RE = /^arya-local-[a-z0-9-]{6,40}$/;
const MESSAGE_ID_RE = /^waweb:[a-f0-9]{64}$/i;

function normalized(value) {
  return String(value || "").normalize("NFC").replace(/\s+/g, " ").trim().toLocaleLowerCase("tr-TR");
}

function allowlist() {
  try {
    const values = JSON.parse(process.env.ARYA_LOCAL_WHATSAPP_ALLOWED_CHATS || "[]");
    return Array.isArray(values) ? new Set(values.filter((item) => typeof item === "string").map(normalized)) : new Set();
  } catch {
    return new Set();
  }
}

function validSignature(req, secret) {
  const timestamp = String(req.headers["x-arya-timestamp"] || "");
  const signature = String(req.headers["x-arya-signature"] || "");
  if (!/^\d{10}$/.test(timestamp) || !/^[a-f0-9]{64}$/i.test(signature)) return false;
  if (Math.abs(Math.floor(Date.now() / 1000) - Number(timestamp)) > 300) return false;
  const expected = createHmac("sha256", secret).update(timestamp + "." + JSON.stringify(req.body)).digest();
  const supplied = Buffer.from(signature, "hex");
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

function validMessage(message) {
  const messageTime = typeof message?.messageTime === "string" ? Date.parse(message.messageTime) : NaN;
  const age = Date.now() - messageTime;
  return Boolean(message &&
    typeof message.messageId === "string" && MESSAGE_ID_RE.test(message.messageId) &&
    typeof message.chatName === "string" && message.chatName.trim().length > 0 && message.chatName.length <= 100 &&
    (message.senderName === undefined || (typeof message.senderName === "string" && message.senderName.length <= 80 && !/\d{5,}/.test(message.senderName))) &&
    typeof message.body === "string" && message.body.trim().length > 0 && message.body.length <= 3000 &&
    Number.isFinite(messageTime) && age >= -5 * 60 * 1000 && age <= 24 * 60 * 60 * 1000);
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "method_not_allowed" });
  }
  if (!localWhatsAppIngestConfigured()) return res.status(404).json({ error: "not_found" });

  const secret = process.env.ARYA_LOCAL_WHATSAPP_INGEST_SECRET;
  const chats = allowlist();
  if (!secret || secret.length < 32 || !chats.size) return res.status(503).json({ error: "local_whatsapp_not_configured" });
  if (!req.body || typeof req.body !== "object" || Array.isArray(req.body)) return res.status(400).json({ error: "invalid_payload" });
  if (!validSignature(req, secret)) return res.status(401).json({ error: "invalid_signature" });

  const bodySize = Buffer.byteLength(JSON.stringify(req.body), "utf8");
  const { source, agent_id: agentId, messages } = req.body;
  if (bodySize > 40000 || source !== SOURCE || !AGENT_ID_RE.test(agentId || "") ||
      !Array.isArray(messages) || messages.length < 1 || messages.length > 20 || messages.some((message) => !validMessage(message))) {
    return res.status(bodySize > 40000 ? 413 : 400).json({ error: "invalid_payload" });
  }
  if (messages.some((message) => !chats.has("*") && !chats.has(normalized(message.chatName)))) {
    return res.status(403).json({ error: "chat_not_allowlisted" });
  }

  try {
    const coordinatorDb = getCoordinatorDb();
    const panelDb = await ensureSchema();
    let processed = 0;
    for (const message of messages) {
      const chatName = message.chatName.normalize("NFC").replace(/\s+/g, " ").trim();
      const conversationId = "waweb:" + encodeURIComponent(chatName);
      await panelDb.query(
        "INSERT INTO arya_messages (message_id, conversation_id, sender_id, sender_name, message_type, body, message_time) " +
        "VALUES ($1, $2, $3, $4, 'text', $5, $6::timestamptz) ON CONFLICT (message_id) DO NOTHING",
        [message.messageId, conversationId, "whatsapp-web", message.senderName || null, message.body, message.messageTime],
      );
      const result = await processLocalWhatsAppInbound(coordinatorDb, { ...message, chatName });
      if (!result.duplicate && !result.ignored) processed++;
    }
    return res.status(200).json({ received: messages.length, processed, sent: false });
  } catch {
    return res.status(503).json({ error: "storage_unavailable" });
  }
}
