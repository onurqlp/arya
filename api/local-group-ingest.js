import { createHmac, timingSafeEqual, randomUUID } from "node:crypto";
import { ensureSchema, purgeExpired } from "../lib/db.js";

function parseAllowlist() {
  const raw = process.env.ARYA_LOCAL_GROUP_ALLOWLIST || "";
  try {
    const value = JSON.parse(raw);
    return Array.isArray(value)
      ? new Set(value.filter((item) => typeof item === "string").map((item) => item.trim()).filter(Boolean))
      : new Set();
  } catch {
    return new Set(raw.split("\n").map((item) => item.trim()).filter(Boolean));
  }
}

function validSignature(req, secret) {
  const timestamp = String(req.headers["x-arya-timestamp"] || "");
  const signature = String(req.headers["x-arya-signature"] || "");
  if (!/^\d{10}$/.test(timestamp) || !/^[a-f0-9]{64}$/i.test(signature)) return false;
  const seconds = Number(timestamp);
  if (Math.abs(Math.floor(Date.now() / 1000) - seconds) > 300) return false;
  const body = JSON.stringify(req.body);
  const expected = createHmac("sha256", secret).update(timestamp + "." + body).digest();
  const supplied = Buffer.from(signature, "hex");
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

function validIso(value) {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function recipients() {
  return (process.env.ARYA_LOCAL_GROUP_NOTIFY_TO || "")
    .split(",")
    .map((value) => value.replace(/\D/g, ""))
    .filter((value) => /^\d{10,15}$/.test(value));
}

async function notifyRecipient(db, recipient, groupName, messages) {
  const token = process.env.META_ACCESS_TOKEN;
  const phoneId = process.env.META_PHONE_NUMBER_ID;
  const version = process.env.META_GRAPH_API_VERSION;
  if (!token || !phoneId || !/^v\d+\.\d+$/.test(version || "")) return "not_configured";

  const recent = await db.query(
    "SELECT MAX(message_time) AS latest FROM arya_messages WHERE conversation_id = $1 AND sender_id = $2",
    [phoneId + ":" + recipient, recipient],
  );
  const lastInbound = recent[0]?.latest ? new Date(recent[0].latest).getTime() : 0;
  if (!lastInbound || Date.now() - lastInbound > 24 * 60 * 60 * 1000) return "outside_window";

  const excerpt = messages.map((message) => message.body).join("\n").slice(0, 2800);
  const body = ("Arya · Grup bildirimi\n" + groupName + "\n\n" + excerpt +
    "\n\nArya panelinde inceleyebilirsin.").slice(0, 4000);

  let response;
  try {
    response = await fetch("https://graph.facebook.com/" + version + "/" + encodeURIComponent(phoneId) + "/messages", {
      method: "POST",
      headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: recipient,
        type: "text",
        text: { preview_url: false, body }
      }),
      signal: AbortSignal.timeout(15000)
    });
  } catch {
    return "delivery_uncertain";
  }
  if (!response.ok) return "provider_rejected";
  const payload = await response.json().catch(() => ({}));
  const providerId = payload.messages?.[0]?.id;
  if (!providerId) return "delivery_uncertain";

  await db.query(
    "INSERT INTO arya_audit (id, actor, action, entity_id, details) VALUES ($1, 'local-group-watcher', 'group_alert_sent', $2, $3::jsonb)",
    [randomUUID(), groupName, JSON.stringify({ recipient, providerMessageId: providerId, messageCount: messages.length })],
  );
  return "sent";
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    res.status(405).json({ error: "method_not_allowed" });
    return;
  }

  const secret = process.env.ARYA_LOCAL_GROUP_INGEST_SECRET;
  const allowlist = parseAllowlist();
  if (!secret || secret.length < 32 || !process.env.DATABASE_URL || !allowlist.size) {
    res.status(503).json({ error: "local_group_ingest_not_configured" });
    return;
  }
  if (!req.body || typeof req.body !== "object" || Array.isArray(req.body)) {
    res.status(400).json({ error: "invalid_payload" });
    return;
  }
  if (!validSignature(req, secret)) {
    res.status(401).json({ error: "invalid_signature" });
    return;
  }

  const bodySize = Buffer.byteLength(JSON.stringify(req.body), "utf8");
  if (bodySize > 50000) {
    res.status(413).json({ error: "payload_too_large" });
    return;
  }
  const { source, groupName, messages } = req.body;
  if (
    source !== "arya-local-group-watcher" ||
    typeof groupName !== "string" ||
    !allowlist.has(groupName) ||
    !Array.isArray(messages) ||
    messages.length < 1 ||
    messages.length > 20
  ) {
    res.status(400).json({ error: "invalid_or_unapproved_group" });
    return;
  }
  if (messages.some((message) =>
    !message ||
    typeof message.messageId !== "string" ||
    !/^webpreview:[a-f0-9]{64}$/i.test(message.messageId) ||
    typeof message.body !== "string" ||
    !message.body.trim() ||
    message.body.length > 3000 ||
    !validIso(message.messageTime) ||
    (message.senderName !== undefined &&
      (typeof message.senderName !== "string" || message.senderName.length > 120))
  )) {
    res.status(400).json({ error: "invalid_group_message" });
    return;
  }

  try {
    const db = await ensureSchema();
    await purgeExpired(db);
    const inserted = [];
    for (const message of messages) {
      const rows = await db.query(
        "INSERT INTO arya_messages (message_id, conversation_id, sender_id, sender_name, message_type, body, message_time) " +
        "VALUES ($1, $2, 'local-group-preview', $3, 'group-preview', $4, $5::timestamptz) " +
        "ON CONFLICT (message_id) DO NOTHING RETURNING message_id, body, message_time",
        [
          message.messageId,
          "local-group " + groupName,
          message.senderName || "Grup önizlemesi",
          message.body.trim(),
          message.messageTime
        ],
      );
      if (rows.length) inserted.push({ body: rows[0].body, messageTime: rows[0].message_time });
    }

    const notify = {};
    if (inserted.length) {
      for (const recipient of recipients()) {
        try {
          notify[recipient] = await notifyRecipient(db, recipient, groupName, inserted);
        } catch {
          notify[recipient] = "notification_unavailable";
        }
      }
    }
    res.status(200).json({
      received: messages.length,
      stored: inserted.length,
      duplicates: messages.length - inserted.length,
      notifications: notify
    });
  } catch {
    res.status(503).json({ error: "storage_unavailable" });
  }
}
