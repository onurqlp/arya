import { ensureSchema, purgeExpired } from "../lib/db.js";
import { requireAdmin, sameOrigin } from "../lib/auth.js";
import { createApprovalRecord, loadAsyaKnowledge } from "../lib/reviews.js";
import { generateAiReview } from "../lib/asya-reply.js";
import { notifyOwnersForApproval } from "../lib/owner-messaging.js";

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

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    res.status(503).json({ error: "openai_not_configured" });
    return;
  }
  const ids = req.body && Array.isArray(req.body.messageIds) ? [...new Set(req.body.messageIds)] : [];
  if (!req.body || req.body.confirmOpenAI !== true) {
    res.status(400).json({ error: "openai_consent_required" });
    return;
  }
  if (ids.length < 1 || ids.length > 20 || ids.some((id) => typeof id !== "string" || id.length > 200)) {
    res.status(400).json({ error: "invalid_message_ids" });
    return;
  }

  let stage = "storage";
  try {
    const db = await ensureSchema();
    await purgeExpired(db);
    const placeholders = ids.map((_id, index) => "$" + (index + 1)).join(", ");
    const rows = await db.query(
      "SELECT message_id, conversation_id, sender_id, sender_name, body, message_time FROM arya_messages WHERE message_id IN (" + placeholders + ")",
      ids,
    );
    if (rows.length !== ids.length) {
      res.status(404).json({ error: "messages_not_found" });
      return;
    }
    const conversationIds = new Set(rows.map((row) => row.conversation_id));
    const senderIds = new Set(rows.map((row) => row.sender_id));
    if (conversationIds.size !== 1 || senderIds.size !== 1) {
      res.status(400).json({ error: "messages_must_share_conversation" });
      return;
    }
    const phoneId = process.env.META_PHONE_NUMBER_ID;
    const senderId = rows[0].sender_id;
    if (!/^\d{6,20}$/.test(senderId || "") || rows[0].conversation_id !== `${phoneId}:${senderId}`) {
      res.status(400).json({ error: "individual_conversation_required" });
      return;
    }

    rows.sort((a, b) => new Date(a.message_time).getTime() - new Date(b.message_time).getTime());
    const transcript = rows.slice(-10).map((row) => {
      const who = String(row.sender_name || "Müşteri").replace(/[\r\n:]/g, " ").slice(0, 80);
      return `Müşteri: ${who}: ${String(row.body || "").slice(0, 900)}`;
    }).join("\n").slice(-4800);

    stage = "openai";
    const review = await generateAiReview({
      message: transcript,
      knowledge: await loadAsyaKnowledge(),
      apiKey,
      model: "gpt-6-luna",
      reasoningEffort: "low",
      timeoutMs: 15000,
    });

    stage = "storage";
    const approval = await createApprovalRecord(db, {
      messageIds: rows.map((row) => row.message_id),
      summary: review.summary,
      replyDraft: review.reply_draft,
      riskNotes: review.risk_notes,
      actor: "admin",
    });
    let notification = { status: "not_configured" };
    try {
      notification = await notifyOwnersForApproval(db, approval.id, approval.ownerCode, review.summary);
    } catch {
      notification = { status: "failed" };
    }

    res.status(200).json({
      id: approval.id,
      ownerCode: approval.ownerCode,
      status: "pending",
      summary: review.summary,
      replyDraft: review.reply_draft,
      riskNotes: review.risk_notes,
      ownerNotificationStatus: notification.status,
      sent: false,
    });
  } catch {
    res.status(503).json({ error: stage === "openai" ? "openai_unavailable" : "storage_unavailable" });
  }
}
