import { randomUUID } from "node:crypto";
import { ensureSchema } from "../../lib/db.js";
import { requireAdmin, sameOrigin } from "../../lib/auth.js";

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
  const { META_ACCESS_TOKEN: token, META_PHONE_NUMBER_ID: phoneId, META_GRAPH_API_VERSION: version } = process.env;
  if (!token || !phoneId || !/^v\d+\.\d+$/.test(version || "")) {
    res.status(503).json({ error: "meta_send_not_configured" });
    return;
  }
  const id = req.body?.id;
  if (typeof id !== "string" || id.length > 100 || !id) {
    res.status(400).json({ error: "invalid_approval_id" });
    return;
  }
  try {
    const db = await ensureSchema();
    const rows = await db.query("SELECT id, source_message_ids, reply_text, status FROM arya_approvals WHERE id = $1", [id]);
    const draft = rows[0];
    if (!draft || draft.status !== "approved") {
      res.status(409).json({ error: "draft_not_approved_or_already_sent" });
      return;
    }
    const ids = draft.source_message_ids;
    if (!Array.isArray(ids) || !ids.length || ids.length > 20 || typeof draft.reply_text !== "string" ||
        !draft.reply_text.trim() || draft.reply_text.length > 4096) {
      res.status(400).json({ error: "invalid_draft" });
      return;
    }
    const messages = await db.query(
      "SELECT DISTINCT conversation_id, sender_id FROM arya_messages WHERE message_id = ANY($1::text[])", [ids]);
    if (messages.length !== 1 || messages[0].conversation_id !== phoneId + ":" + messages[0].sender_id ||
        !/^\d{6,20}$/.test(messages[0].sender_id)) {
      res.status(409).json({ error: "individual_conversation_required" });
      return;
    }
    // Claim the draft once. An ambiguous provider timeout stays in 'sending' for manual reconciliation.
    const claimed = await db.query("UPDATE arya_approvals SET status = 'sending' WHERE id = $1 AND status = 'approved' RETURNING id", [id]);
    if (!claimed.length) {
      res.status(409).json({ error: "draft_not_approved_or_already_sent" });
      return;
    }
    let response;
    try {
      response = await fetch("https://graph.facebook.com/" + version + "/" + encodeURIComponent(phoneId) + "/messages", {
        method: "POST",
        headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
        body: JSON.stringify({ messaging_product: "whatsapp", to: messages[0].sender_id,
          type: "text", text: { preview_url: false, body: draft.reply_text } }),
        signal: AbortSignal.timeout(20000)
      });
    } catch {
      res.status(502).json({ error: "meta_delivery_uncertain", retryable: false });
      return;
    }
    if (!response.ok) {
      await db.query("UPDATE arya_approvals SET status = 'approved' WHERE id = $1 AND status = 'sending'", [id]);
      res.status(502).json({ error: "meta_send_rejected", providerStatus: response.status });
      return;
    }
    const payload = await response.json().catch(() => ({}));
    const providerId = payload.messages?.[0]?.id;
    if (!providerId) {
      res.status(502).json({ error: "meta_delivery_uncertain", retryable: false });
      return;
    }
    await db.query("UPDATE arya_approvals SET status = 'sent', sent_at = NOW(), provider_message_id = $2 WHERE id = $1 AND status = 'sending'", [id, providerId]);
    await db.query("INSERT INTO arya_audit (id, actor, action, entity_id, details) VALUES ($1, 'admin', 'message_sent', $2, $3::jsonb)",
      [randomUUID(), id, JSON.stringify({ providerMessageId: providerId })]);
    res.status(200).json({ id, status: "sent", providerMessageId: providerId });
  } catch {
    res.status(503).json({ error: "send_state_unavailable" });
  }
}
