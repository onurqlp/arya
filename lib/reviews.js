import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { generateAiReview } from "./asya-reply.js";
import { generateOwnerCode, notifyOwnersForApproval } from "./owner-messaging.js";
import { sendApprovedReply } from "./approval-send.js";

let knowledgePromise;

export async function loadAsyaKnowledge() {
  if (!knowledgePromise) {
    knowledgePromise = readFile(new URL("./asya-knowledge.json", import.meta.url), "utf8")
      .then((value) => JSON.parse(value))
      .catch((error) => {
        knowledgePromise = null;
        throw error;
      });
  }
  return knowledgePromise;
}

function transcriptFromRows(rows) {
  return rows
    .slice(-10)
    .map((row) => {
      const who = String(row.sender_name || "Müşteri").replace(/[\r\n:]/g, " ").slice(0, 80);
      const body = String(row.body || "").slice(0, 900);
      return `Müşteri: ${who}: ${body}`;
    })
    .join("\n")
    .slice(-4800);
}

export async function createApprovalRecord(db, { messageIds, summary, replyDraft, riskNotes = [], actor = "system", status = "pending", reviewedBy = null, requiresOwnerAnswer = false }) {
  if (!Array.isArray(messageIds) || !messageIds.length || !replyDraft) throw new Error("approval_payload_invalid");
  if (!["pending", "approved"].includes(status)) throw new Error("approval_status_invalid");
  const id = randomUUID();
  let ownerCode;
  let created = false;
  for (let attempt = 0; attempt < 4 && !created; attempt += 1) {
    ownerCode = generateOwnerCode();
    try {
      const rows = await db.query(
        "INSERT INTO arya_approvals (id, owner_code, source_message_ids, analysis_text, reply_text, status, owner_notification_status, reviewed_at, reviewed_by, requires_owner_answer) " +
        "VALUES ($1, $2, $3::jsonb, $4, $5, $6, 'not_sent', CASE WHEN $6 = 'approved' THEN NOW() ELSE NULL END, $7, $8) RETURNING id, owner_code, status",
        [id, ownerCode, JSON.stringify(messageIds), [summary, ...riskNotes.map((note) => `Dikkat: ${note}`)].filter(Boolean).join("\n"), replyDraft, status, reviewedBy, requiresOwnerAnswer],
      );
      if (rows.length) created = true;
    } catch (error) {
      if (error?.code !== "23505" || attempt === 3) throw error;
    }
  }
  if (!created) throw new Error("approval_code_unavailable");
  await db.query(
    "INSERT INTO arya_audit (id, actor, action, entity_id, details) VALUES ($1, $2, 'draft_created', $3, $4::jsonb)",
    [randomUUID(), actor, id, JSON.stringify({ messageCount: messageIds.length, ownerCode })],
  );
  return { id, ownerCode, status, summary, replyDraft, riskNotes };
}

export async function createAutomaticReview(db, incomingMessage) {
  const existing = await db.query(
    "SELECT id, owner_code, status, analysis_text, owner_notification_status FROM arya_approvals " +
    "WHERE source_message_ids @> $1::jsonb ORDER BY created_at DESC LIMIT 1",
    [JSON.stringify([incomingMessage.messageId])],
  );
  if (existing.length) {
    const approval = existing[0];
    if (["pending", "approved", "sending"].includes(approval.status) && ["not_sent", "blocked"].includes(approval.owner_notification_status)) {
      await notifyOwnersForApproval(db, approval.id, approval.owner_code, approval.analysis_text || "Yeni müşteri mesajı.");
    }
    return { created: false, status: approval.status };
  }

  const rows = await db.query(
    "SELECT message_id, conversation_id, sender_id, sender_name, body, message_time FROM arya_messages " +
    "WHERE conversation_id = $1 ORDER BY message_time DESC LIMIT 10",
    [incomingMessage.conversationId],
  );
  if (!rows.length) return { created: false, status: "message_missing" };
  if (rows.some((row) => row.conversation_id !== incomingMessage.conversationId || row.sender_id !== incomingMessage.senderId)) {
    return { created: false, status: "conversation_not_individual" };
  }
  rows.reverse();
  const transcript = transcriptFromRows(rows);
  const review = await generateAiReview({
    message: transcript,
    knowledge: await loadAsyaKnowledge(),
    apiKey: process.env.OPENAI_API_KEY,
    model: process.env.OPENAI_MODEL || "gpt-6-luna",
    reasoningEffort: "low",
    timeoutMs: 12000,
  });
  const handoffPromise = /(?:ekibe\s+sor|teyit\s+edip\s+dön|teyit\s+alıp\s+dön|kontenjanı?\s+kontrol\s+ed|sorup\s+dön|öğrenip\s+dön|danışıp\s+dön)/i
    .test(String(review.reply_draft || "").toLocaleLowerCase("tr-TR"));
  const riskNotes = [...review.risk_notes];
  if (handoffPromise && !riskNotes.some((note) => /taslak.*ekip teyidi/i.test(note))) {
    riskNotes.push("Taslak ekip teyidi veya sonradan dönüş vaat ediyor; müşteriye otomatik gönderilmedi.");
  }
  const needsOwner = riskNotes.length > 0;
  const customerQuestion = String(incomingMessage.body || "").replace(/\s+/g, " ").trim().slice(0, 260);
  const approvalSummary = [customerQuestion ? `Müşteri mesajı: ${customerQuestion}` : "", review.summary].filter(Boolean).join("\n").slice(0, 850);
  const approval = await createApprovalRecord(db, {
    messageIds: [incomingMessage.messageId],
    summary: approvalSummary,
    replyDraft: review.reply_draft,
    riskNotes,
    actor: "auto_inbound",
    status: needsOwner ? "pending" : "approved",
    reviewedBy: needsOwner ? null : "asya:auto",
    requiresOwnerAnswer: needsOwner,
  });
  const ownerSummary = approvalSummary.replace(/\n/g, " | ").slice(0, 600);
  if (needsOwner) {
    const notification = await notifyOwnersForApproval(db, approval.id, approval.ownerCode, ownerSummary);
    return { created: true, status: "pending", escalated: true, autoSent: false, ownerNotificationStatus: notification.status };
  }

  const sent = await sendApprovedReply(db, approval.id, "asya:auto");
  if (sent.ok) return { created: true, status: "sent", escalated: false, autoSent: true, providerMessageId: sent.providerMessageId };

  if (sent.error !== "meta_delivery_uncertain") {
    await db.query(
      "UPDATE arya_approvals SET status = 'pending', reviewed_at = NULL, reviewed_by = NULL, analysis_text = analysis_text || E'\\nOtomatik gönderim başarısız: ' || $2 WHERE id = $1 AND status = 'approved'",
      [approval.id, String(sent.error || "send_failed").slice(0, 100)],
    );
  }
  const notification = await notifyOwnersForApproval(db, approval.id, approval.ownerCode, `${ownerSummary} | Gönderim durumu: ${sent.error || "belirsiz"}`);
  return { created: true, status: sent.error === "meta_delivery_uncertain" ? "sending" : "pending", escalated: true, autoSent: false, sendError: sent.error, ownerNotificationStatus: notification.status };
}
