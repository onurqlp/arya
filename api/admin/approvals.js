import { ensureSchema, purgeExpired } from "../../lib/db.js";
import { requireAdmin } from "../../lib/auth.js";

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    res.status(405).json({ error: "method_not_allowed" });
    return;
  }
  if (!requireAdmin(req, res)) return;

  const requestedStatus = new URL(req.url || "/", "http://localhost").searchParams.get("status") || "pending";
  if (!["pending", "approved", "rejected", "sent", "sending"].includes(requestedStatus)) {
    res.status(400).json({ error: "invalid_status" });
    return;
  }
  try {
    const db = await ensureSchema();
    await purgeExpired(db);
    const rows = await db.query(
      "SELECT id, owner_code, owner_notification_status, owner_notification_error, source_message_ids, analysis_text, reply_text, status, requires_owner_answer, created_at, reviewed_at, sent_at " +
      "FROM arya_approvals WHERE status = $1 ORDER BY created_at DESC LIMIT 100",
      [requestedStatus],
    );
    res.status(200).json({ approvals: rows, status: requestedStatus });
  } catch {
    res.status(503).json({ error: "storage_unavailable" });
  }
}
