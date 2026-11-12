import { createHmac, timingSafeEqual, randomUUID } from "node:crypto";
import { ensureSchema, purgeExpired } from "../lib/db.js";

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

async function claimAlertSlot(db, recipient, groupName) {
  await db.query(
    "CREATE TABLE IF NOT EXISTS arya_local_group_alerts (group_name TEXT NOT NULL, recipient TEXT NOT NULL, last_sent_at TIMESTAMPTZ NOT NULL, PRIMARY KEY (group_name, recipient))",
  );
  const claimed = await db.query(
    "INSERT INTO arya_local_group_alerts (group_name, recipient, last_sent_at) VALUES ($1, $2, NOW()) " +
    "ON CONFLICT (group_name, recipient) DO UPDATE SET last_sent_at = NOW() " +
    "WHERE arya_local_group_alerts.last_sent_at < NOW() - INTERVAL '5 minutes' RETURNING group_name",
    [groupName, recipient],
  );
  return claimed.length > 0;
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

  if (!(await claimAlertSlot(db, recipient, groupName))) return "throttled";

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
    [randomUUID(), groupName, JSON.stringify({ providerMessageId: providerId, messageCount: messages.length })],
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
  if (!secret || secret.length < 32 || !process.env.DATABASE_URL) {
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
    !groupName.trim() ||
    groupName.length > 100 ||
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
    const configRows = await db.query("SELECT group_names FROM arya_local_group_config WHERE id = 'default'");
    const allowlist = Array.isArray(configRows[0]?.group_names) ? configRows[0].group_names : [];
    if (!allowlist.length) {
      res.status(503).json({ error: "group_allowlist_not_configured" });
      return;
    }
    if (!allowlist.includes(groupName)) {
      res.status(403).json({ error: "group_not_allowlisted" });
      return;
    }
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

    const notificationCounts = { sent: 0, outsideWindow: 0, throttled: 0, failed: 0 };
    if (inserted.length) {
      for (const recipient of recipients()) {
        try {
          const status = await notifyRecipient(db, recipient, groupName, inserted);
          if (status === "sent") notificationCounts.sent += 1;
          else if (status === "outside_window") notificationCounts.outsideWindow += 1;
          else if (status === "throttled") notificationCounts.throttled += 1;
          else notificationCounts.failed += 1;
        } catch {
          notificationCounts.failed += 1;
        }
      }
    }
    res.status(200).json({
      received: messages.length,
      stored: inserted.length,
      duplicates: messages.length - inserted.length,
      notifications: notificationCounts
    });
  } catch {
    res.status(503).json({ error: "storage_unavailable" });
  }
}
