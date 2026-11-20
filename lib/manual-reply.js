import { randomUUID } from "node:crypto";
import { whatsappTransport } from "./whatsapp-transport.js";

const CUSTOMER_SERVICE_WINDOW_MS = 24 * 60 * 60 * 1000;
const REQUEST_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function audit(db, action, requestId, details) {
  await db.query(
    "INSERT INTO arya_audit (id, actor, action, entity_id, details) VALUES ($1, 'admin', $2, $3, $4::jsonb)",
    [randomUUID(), action, requestId, JSON.stringify(details)],
  ).catch(() => {});
}

function optionalInteger(value) {
  if (typeof value !== "number" && typeof value !== "string") return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : null;
}

export async function sendManualReply(db, { conversationId, text, requestId }, fetchImpl = globalThis.fetch) {
  if (whatsappTransport() === "web") {
    return { ok: false, status: 409, error: "whatsapp_web_sender_not_enabled", retryable: false };
  }
  if (typeof text !== "string" || !text.trim() || text.trim().length > 4096 || /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(text)) {
    return { ok: false, status: 400, error: "invalid_reply_text" };
  }
  if (typeof requestId !== "string" || !REQUEST_ID_PATTERN.test(requestId)) {
    return { ok: false, status: 400, error: "invalid_reply_request_id" };
  }
  const conversation = typeof conversationId === "string"
    ? conversationId.match(/^(\d{5,30}):(\d{6,20})$/)
    : null;
  if (!conversation) return { ok: false, status: 409, error: "individual_conversation_required" };
  const [, phoneId, recipientId] = conversation;
  const { META_ACCESS_TOKEN: token, META_GRAPH_API_VERSION: version } = process.env;
  if (!token || !/^v\d+\.\d+$/.test(version || "")) {
    return { ok: false, status: 503, error: "meta_send_not_configured" };
  }

  const inbound = await db.query(
    "SELECT MAX(message_time) AS latest_inbound_at FROM arya_messages WHERE conversation_id = $1 AND sender_id = $2",
    [conversationId, recipientId],
  );
  if (!inbound[0]?.latest_inbound_at) {
    return { ok: false, status: 404, error: "conversation_not_found" };
  }

  const previous = await db.query(
    "SELECT status, provider_message_id FROM arya_outbound_messages WHERE id = $1",
    [requestId],
  );
  if (previous.length) {
    return {
      ok: false,
      status: 409,
      error: previous[0].status === "sent" ? "reply_already_sent" :
        ["sending", "uncertain"].includes(previous[0].status) ? "manual_delivery_uncertain" : "reply_request_reused",
    };
  }

  const latestInboundAt = new Date(inbound[0].latest_inbound_at).getTime();
  if (!Number.isFinite(latestInboundAt) || Date.now() - latestInboundAt >= CUSTOMER_SERVICE_WINDOW_MS) {
    return { ok: false, status: 409, error: "customer_service_window_closed" };
  }

  const created = await db.query(
    "INSERT INTO arya_outbound_messages (id, conversation_id, recipient_id, body, status) " +
    "VALUES ($1, $2, $3, $4, 'sending') ON CONFLICT (id) DO NOTHING RETURNING id",
    [requestId, conversationId, recipientId, text.trim()],
  );
  if (!created.length) return { ok: false, status: 409, error: "manual_delivery_uncertain" };

  let response;
  try {
    response = await fetchImpl(`https://graph.facebook.com/${version}/${encodeURIComponent(phoneId)}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: recipientId,
        type: "text",
        text: { preview_url: false, body: text.trim() },
      }),
      signal: AbortSignal.timeout(20000),
    });
  } catch {
    await db.query("UPDATE arya_outbound_messages SET status = 'uncertain' WHERE id = $1", [requestId]).catch(() => {});
    await audit(db, "manual_message_delivery_uncertain", requestId, { conversationId });
    return { ok: false, status: 502, error: "meta_delivery_uncertain", retryable: false };
  }

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    const providerError = payload?.error || {};
    const metaCode = optionalInteger(providerError.code);
    const metaSubcode = optionalInteger(providerError.error_subcode);
    const metaType = typeof providerError.type === "string" ? providerError.type.slice(0, 80) : null;
    const fbtraceId = typeof providerError.fbtrace_id === "string" ? providerError.fbtrace_id.slice(0, 120) : null;
    const diagnostic = { requestId, providerStatus: response.status, metaCode, metaSubcode, metaType, fbtraceId };
    await db.query("UPDATE arya_outbound_messages SET status = 'rejected' WHERE id = $1", [requestId]);
    await audit(db, "manual_message_rejected", requestId, { conversationId, ...diagnostic });
    console.error("arya_manual_message_rejected", JSON.stringify(diagnostic));
    return { ok: false, status: 502, error: "meta_send_rejected", ...diagnostic };
  }

  const payload = await response.json().catch(() => ({}));
  const providerMessageId = payload.messages?.[0]?.id;
  if (typeof providerMessageId !== "string" || !providerMessageId) {
    await db.query("UPDATE arya_outbound_messages SET status = 'uncertain' WHERE id = $1", [requestId]).catch(() => {});
    await audit(db, "manual_message_delivery_uncertain", requestId, { conversationId });
    return { ok: false, status: 502, error: "meta_delivery_uncertain", retryable: false };
  }

  await db.query(
    "UPDATE arya_outbound_messages SET status = 'sent', provider_message_id = $2, sent_at = NOW() WHERE id = $1",
    [requestId, providerMessageId],
  );
  await audit(db, "manual_message_sent", requestId, { conversationId, providerMessageId });
  return { ok: true, status: 200, requestId, providerMessageId };
}
