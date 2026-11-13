import { timingSafeEqual } from "node:crypto";
import { neon } from "@neondatabase/serverless";

const reply = (res, status, body) => res.status(status).json(body);
const text = (value, max = 240) => String(value ?? "").trim().slice(0, max);
const iso = value => {
  const date = new Date(value || "");
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

function authorized(req) {
  const expected = process.env.N8N_REPORT_READ_TOKEN || "";
  const header = req.headers.authorization || "";
  const supplied = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (expected.length < 40 || supplied.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(supplied), Buffer.from(expected));
}

function sourceMessageIds(value) {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === "string") {
    try { const parsed = JSON.parse(value); return Array.isArray(parsed) ? parsed.map(String) : []; } catch { return []; }
  }
  return [];
}

function redactPreview(value) {
  return text(value)
    .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, "[e-posta]")
    .replace(/(?<!\d)\+?\d(?:[\s().-]*\d){8,14}(?!\d)/g, "[telefon]");
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return reply(res, 405, { error: "method_not_allowed" });
  }
  if (!authorized(req)) return reply(res, 401, { error: "unauthorized" });
  if (!process.env.DATABASE_URL) return reply(res, 503, { error: "database_unavailable" });

  const now = new Date();
  const since = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  try {
    const db = neon(process.env.DATABASE_URL);
    const [messages, approvals] = await Promise.all([
      db.query(
        "SELECT message_id, conversation_id, sender_id, sender_name, message_type, body, message_time FROM arya_messages WHERE message_time >= $1::timestamptz ORDER BY message_time DESC LIMIT 500",
        [since],
      ),
      db.query(
        "SELECT source_message_ids, status, created_at, reviewed_at, requires_owner_answer, sent_at FROM arya_approvals WHERE created_at >= $1::timestamptz ORDER BY created_at DESC LIMIT 500",
        [since],
      ),
    ]);

    const approvalByMessage = new Map();
    for (const approval of approvals) {
      for (const id of sourceMessageIds(approval.source_message_ids)) {
        if (!approvalByMessage.has(id)) approvalByMessage.set(id, approval);
      }
    }

    const latestByConversation = new Map();
    for (const message of messages) {
      const key = String(message.conversation_id || "");
      if (!key || latestByConversation.has(key)) continue;
      const approval = approvalByMessage.get(String(message.message_id));
      const status = text(approval?.status || "unreviewed", 30);
      const replied = status === "sent" || !!approval?.sent_at;
      const deliveryUncertain = status === "sending";
      latestByConversation.set(key, {
        conversationId: key,
        name: text(message.sender_name, 100),
        phone: text(message.sender_id, 40),
        lastInboundAt: iso(message.message_time),
        messageType: text(message.message_type, 40),
        preview: redactPreview(message.body),
        reviewStatus: status,
        needsFollowUp: !replied && !deliveryUncertain,
        deliveryUncertain,
        approvalCreatedAt: iso(approval?.created_at),
        reviewedAt: iso(approval?.reviewed_at),
        requiresOwnerAnswer: !!approval?.requires_owner_answer,
      });
    }
    const conversations = [...latestByConversation.values()];
    const unanswered = conversations.filter(item => item.needsFollowUp);
    const uncertain = conversations.filter(item => item.deliveryUncertain);

    return reply(res, 200, {
      source: "arya",
      readOnly: true,
      queryMode: "SELECT only",
      generatedAt: now.toISOString(),
      windowStart: since,
      inboundConversations: { count: conversations.length, items: conversations.slice(0, 200) },
      unanswered: { count: unanswered.length, items: unanswered.slice(0, 200) },
      deliveryUncertain: { count: uncertain.length, items: uncertain.slice(0, 100) },
    });
  } catch (error) {
    console.error("[n8n-readonly-report] read failed", { code: String(error?.code || error?.message || "unknown").slice(0, 80) });
    return reply(res, 503, { error: "readonly_source_unavailable" });
  }
}
