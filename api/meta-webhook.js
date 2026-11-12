import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { authConfigured, safeEqual } from "../lib/auth.js";
import { ensureSchema, purgeExpired } from "../lib/db.js";
import { createAutomaticReview } from "../lib/reviews.js";
import { handleOwnerMessage, normalizeWhatsAppId, ownerIdsFromEnvironment } from "../lib/owner-messaging.js";

export const config = {
  maxDuration: 60,
  api: {
    bodyParser: false
  }
};

const MAX_BODY_BYTES = 1024 * 1024;
const MAX_MESSAGES_PER_EVENT = 100;

function getQuery(req) {
  const url = new URL(req.url || "/", "http://localhost");
  return url.searchParams;
}

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let tooLarge = false;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        tooLarge = true;
        chunks.length = 0;
        return;
      }
      if (!tooLarge) chunks.push(chunk);
    });
    req.on("end", () => {
      if (tooLarge) {
        const error = new Error("body_too_large");
        error.statusCode = 413;
        reject(error);
        return;
      }
      resolve(Buffer.concat(chunks));
    });
    req.on("error", reject);
  });
}

function signatureIsValid(rawBody, receivedSignature, appSecret) {
  if (!receivedSignature || !appSecret) return false;
  const expected = "sha256=" + createHmac("sha256", appSecret).update(rawBody).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(String(receivedSignature));
  return a.length === b.length && timingSafeEqual(a, b);
}

function flattenMessages(payload) {
  const result = [];
  for (const entry of Array.isArray(payload.entry) ? payload.entry : []) {
    for (const change of Array.isArray(entry.changes) ? entry.changes : []) {
      const value = change && change.value ? change.value : {};
      const metadata = value.metadata || {};
      const names = new Map(
        (Array.isArray(value.contacts) ? value.contacts : [])
          .filter((item) => item && item.wa_id && item.profile && item.profile.name)
          .map((item) => [String(item.wa_id), String(item.profile.name).slice(0, 120)]),
      );
      for (const message of Array.isArray(value.messages) ? value.messages : []) {
        if (!message || typeof message.id !== "string" || typeof message.from !== "string") continue;
        let body = "";
        if (message.type === "text" && message.text && typeof message.text.body === "string") {
          body = message.text.body;
        } else if (message.interactive && message.interactive.button_reply) {
          body = message.interactive.button_reply.title || "";
        } else if (message.interactive && message.interactive.list_reply) {
          body = message.interactive.list_reply.title || "";
        } else if (message.button && typeof message.button.text === "string") {
          body = message.button.text;
        } else if (message.image && typeof message.image.caption === "string") {
          body = message.image.caption;
        } else if (message.document && typeof message.document.caption === "string") {
          body = message.document.caption;
        }
        const rawTime = Number(message.timestamp);
        const messageTime = Number.isFinite(rawTime) && rawTime > 0
          ? new Date(rawTime * 1000).toISOString()
          : new Date().toISOString();
        result.push({
          messageId: message.id,
          conversationId: String(metadata.phone_number_id || "whatsapp") + ":" +
            String(message.group_id || (message.context && message.context.group_id) || message.from),
          senderId: message.from,
          senderName: names.get(message.from) || null,
          messageType: String(message.type || "unknown").slice(0, 40),
          body: String(body).slice(0, 10000),
          messageTime
        });
        if (result.length > MAX_MESSAGES_PER_EVENT) {
          const error = new Error("too_many_messages");
          error.statusCode = 413;
          throw error;
        }
      }
    }
  }
  return result;
}

function readyForWebhook() {
  return Boolean(
    process.env.META_APP_SECRET &&
    process.env.META_WEBHOOK_VERIFY_TOKEN &&
    process.env.DATABASE_URL &&
    authConfigured()
  );
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method === "GET") {
    // Meta's initial webhook handshake only sends the verify token and challenge.
    // The app secret is required later to validate signed POST events, not this GET.
    if (!process.env.META_WEBHOOK_VERIFY_TOKEN || !process.env.DATABASE_URL || !authConfigured()) {
      res.status(503).json({ error: "webhook_setup_incomplete" });
      return;
    }
    const query = getQuery(req);
    const mode = query.get("hub.mode");
    const token = query.get("hub.verify_token");
    const challenge = query.get("hub.challenge");
    if (
      mode === "subscribe" &&
      safeEqual(token, process.env.META_WEBHOOK_VERIFY_TOKEN) &&
      challenge
    ) {
      try {
        await ensureSchema();
      } catch {
        res.status(503).json({ error: "storage_unavailable" });
        return;
      }
      res.status(200).send(challenge);
      return;
    }
    res.status(403).json({ error: "webhook_verification_failed" });
    return;
  }

  if (req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    res.status(405).json({ error: "method_not_allowed" });
    return;
  }
  if (!process.env.META_APP_SECRET) {
    res.status(503).json({ error: "webhook_not_configured" });
    return;
  }

  let rawBody;
  try {
    rawBody = await readRawBody(req);
  } catch (error) {
    res.status(error.statusCode || 400).json({ error: "invalid_request_body" });
    return;
  }
  if (!signatureIsValid(rawBody, req.headers["x-hub-signature-256"], process.env.META_APP_SECRET)) {
    res.status(401).json({ error: "invalid_webhook_signature" });
    return;
  }

  let payload;
  try {
    payload = JSON.parse(rawBody.toString("utf8"));
  } catch {
    res.status(400).json({ error: "invalid_json" });
    return;
  }
  if (!payload || payload.object !== "whatsapp_business_account") {
    res.status(400).json({ error: "unexpected_webhook_payload" });
    return;
  }
  if (!readyForWebhook()) {
    res.setHeader("Retry-After", "60");
    res.status(503).json({ error: "webhook_setup_incomplete" });
    return;
  }

  let messages;
  try {
    messages = flattenMessages(payload);
  } catch (error) {
    res.status(error.statusCode || 400).json({ error: error.message || "invalid_webhook_payload" });
    return;
  }

  try {
    const db = await ensureSchema();
    await purgeExpired(db);
    let inserted = 0;
    let ownerMessagesHandled = 0;
    let ownerRepliesFailed = 0;
    let nonIndividualIgnored = 0;
    const newCustomerMessages = [];
    const ownerIds = new Set(ownerIdsFromEnvironment());
    for (const message of messages) {
      const individualConversation = message.conversationId === `${process.env.META_PHONE_NUMBER_ID}:${normalizeWhatsAppId(message.senderId)}`;
      if (ownerIds.has(normalizeWhatsAppId(message.senderId)) && individualConversation) {
        const result = await handleOwnerMessage(db, message);
        if (result.handled) {
          ownerMessagesHandled += 1;
          if (result.status === "reply_failed") ownerRepliesFailed += 1;
        }
        continue;
      }
      if (!individualConversation) {
        nonIndividualIgnored += 1;
        continue;
      }
      const rows = await db.query(
        "INSERT INTO arya_messages (message_id, conversation_id, sender_id, sender_name, message_type, body, message_time) " +
        "VALUES ($1, $2, $3, $4, $5, $6, $7::timestamptz) ON CONFLICT (message_id) DO NOTHING RETURNING message_id",
        [
          message.messageId,
          message.conversationId,
          message.senderId,
          message.senderName,
          message.messageType,
          message.body,
          message.messageTime
        ],
      );
      if (rows.length) {
        inserted += 1;
        newCustomerMessages.push(message);
      }
    }
    const latestByConversation = new Map();
    for (const message of newCustomerMessages) {
      if (!message.body.trim()) continue;
      if (message.conversationId !== `${process.env.META_PHONE_NUMBER_ID}:${message.senderId}`) continue;
      latestByConversation.set(message.conversationId, message);
    }
    let draftsCreated = 0;
    let draftFailures = 0;
    let autoRepliesSent = 0;
    let ownerEscalations = 0;
    for (const message of latestByConversation.values()) {
      try {
        const result = await createAutomaticReview(db, message);
        if (result.created) draftsCreated += 1;
        if (result.autoSent) autoRepliesSent += 1;
        if (result.escalated) ownerEscalations += 1;
      } catch {
        draftFailures += 1;
        await db.query(
          "INSERT INTO arya_audit (id, actor, action, entity_id, details) VALUES ($1, 'system', 'auto_review_failed', $2, '{\"stage\":\"draft_or_notification\"}'::jsonb)",
          [randomUUID(), message.messageId],
        ).catch(() => {});
      }
    }
    res.status(200).json({
      received: messages.length,
      stored: inserted,
      duplicates: messages.length - inserted - ownerMessagesHandled - nonIndividualIgnored,
      nonIndividualIgnored,
      draftsCreated,
      draftFailures,
      autoRepliesSent,
      ownerEscalations,
      ownerMessagesHandled,
      ownerRepliesFailed,
    });
  } catch {
    res.setHeader("Retry-After", "60");
    res.status(503).json({ error: "storage_unavailable" });
  }
}
