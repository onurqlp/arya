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
  try {
    const db = await ensureSchema();
    await purgeExpired(db);
    const [counts, daily, approvals, recent] = await Promise.all([
      db.query("SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE (message_time AT TIME ZONE 'Europe/Istanbul')::date = (NOW() AT TIME ZONE 'Europe/Istanbul')::date)::int AS today, COUNT(*) FILTER (WHERE message_time >= NOW() - INTERVAL '7 days')::int AS week, COUNT(DISTINCT conversation_id)::int AS conversations FROM arya_messages"),
      db.query("SELECT (message_time AT TIME ZONE 'Europe/Istanbul')::date AS day, COUNT(*)::int AS count FROM arya_messages WHERE message_time >= NOW() - INTERVAL '7 days' GROUP BY day ORDER BY day"),
      db.query("SELECT status, COUNT(*)::int AS count FROM arya_approvals GROUP BY status"),
      db.query("SELECT message_id, conversation_id, sender_name, message_type, body, message_time FROM arya_messages ORDER BY message_time DESC LIMIT 150")
    ]);
    res.status(200).json({ counts: counts[0], daily, approvals, messages: recent });
  } catch {
    res.status(503).json({ error: "storage_unavailable" });
  }
}
