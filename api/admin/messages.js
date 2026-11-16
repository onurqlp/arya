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
    const rows = await db.query(
      "SELECT message_id, conversation_id, sender_name, message_type, body, message_time, is_outbound FROM (" +
      "SELECT message_id, conversation_id, sender_name, message_type, body, message_time, FALSE AS is_outbound FROM arya_messages " +
      "UNION ALL " +
      "SELECT id AS message_id, conversation_id, 'AYDA' AS sender_name, 'text' AS message_type, body, sent_at AS message_time, TRUE AS is_outbound " +
      "FROM arya_outbound_messages WHERE status = 'sent' AND sent_at IS NOT NULL" +
      ") AS conversation_timeline ORDER BY message_time DESC LIMIT 150",
    );
    res.status(200).json({ messages: rows });
  } catch {
    res.status(503).json({ error: "storage_unavailable" });
  }
}
