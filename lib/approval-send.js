import { randomUUID } from "node:crypto";

const CUSTOMER_SERVICE_WINDOW_MS = 24 * 60 * 60 * 1000;

export async function sendApprovedReply(db, id, actor = "admin", fetchImpl = globalThis.fetch) {
  const { META_ACCESS_TOKEN: token, META_PHONE_NUMBER_ID: phoneId, META_GRAPH_API_VERSION: version } = process.env;
  if (!token || !phoneId || !/^v\d+\.\d+$/.test(version || "")) {
    return { ok: false, status: 503, error: "meta_send_not_configured" };
  }
  const drafts = await db.query(
    "SELECT id, source_message_ids, reply_text, status, requires_owner_answer, reviewed_by FROM arya_approvals WHERE id = $1",
    [id],
  );
  const draft = drafts[0];
  if (!draft || draft.status !== "approved") {
    return { ok: false, status: 409, error: "draft_not_approved_or_already_sent" };
  }
  if (draft.requires_owner_answer && !String(draft.reviewed_by || "").startsWith("owner:")) {
    return { ok: false, status: 409, error: "owner_answer_required" };
  }
  const ids = Array.isArray(draft.source_message_ids) ? draft.source_message_ids : [];
  if (!ids.length || ids.length > 20 || typeof draft.reply_text !== "string" || !draft.reply_text.trim() || draft.reply_text.length > 4096) {
    return { ok: false, status: 400, error: "invalid_draft" };
  }
  const messages = await db.query(
    "SELECT conversation_id, sender_id, MAX(message_time) AS latest_inbound_at FROM arya_messages " +
    "WHERE message_id = ANY($1::text[]) GROUP BY conversation_id, sender_id",
    [ids],
  );
  if (messages.length !== 1 || messages[0].conversation_id !== phoneId + ":" + messages[0].sender_id || !/^\d{6,20}$/.test(messages[0].sender_id || "")) {
    return { ok: false, status: 409, error: "individual_conversation_required" };
  }
  const latestRows = await db.query(
    "SELECT MAX(message_time) AS latest_inbound_at FROM arya_messages WHERE conversation_id = $1 AND sender_id = $2",
    [messages[0].conversation_id, messages[0].sender_id],
  );
  const latestInboundAt = new Date(latestRows[0]?.latest_inbound_at || 0).getTime();
  if (!Number.isFinite(latestInboundAt) || Date.now() - latestInboundAt >= CUSTOMER_SERVICE_WINDOW_MS) {
    return { ok: false, status: 409, error: "customer_service_window_closed" };
  }
  const claimed = await db.query(
    "UPDATE arya_approvals SET status = 'sending' WHERE id = $1 AND status = 'approved' RETURNING id",
    [id],
  );
  if (!claimed.length) return { ok: false, status: 409, error: "draft_not_approved_or_already_sent" };

  let response;
  try {
    response = await fetchImpl(`https://graph.facebook.com/${version}/${encodeURIComponent(phoneId)}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: messages[0].sender_id,
        type: "text",
        text: { preview_url: false, body: draft.reply_text },
      }),
      signal: AbortSignal.timeout(20000),
    });
  } catch {
    return { ok: false, status: 502, error: "meta_delivery_uncertain", retryable: false };
  }
  if (!response.ok) {
    await db.query("UPDATE arya_approvals SET status = 'approved' WHERE id = $1 AND status = 'sending'", [id]);
    return { ok: false, status: 502, error: "meta_send_rejected", providerStatus: response.status };
  }
  const payload = await response.json().catch(() => ({}));
  const providerMessageId = payload.messages?.[0]?.id;
  if (!providerMessageId) return { ok: false, status: 502, error: "meta_delivery_uncertain", retryable: false };

  await db.query(
    "UPDATE arya_approvals SET status = 'sent', sent_at = NOW(), provider_message_id = $2 WHERE id = $1 AND status = 'sending'",
    [id, providerMessageId],
  );
  await db.query(
    "INSERT INTO arya_audit (id, actor, action, entity_id, details) VALUES ($1, $2, 'message_sent', $3, $4::jsonb)",
    [randomUUID(), actor, id, JSON.stringify({ providerMessageId })],
  );
  return { ok: true, status: 200, id, statusText: "sent", providerMessageId };
}
