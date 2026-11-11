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
      "SELECT message_id, conversation_id, sender_name, message_type, body, message_time " +
      "FROM arya_messages ORDER BY message_time DESC LIMIT 150",
    );
    res.status(200).json({ messages: rows });
  } catch {
    res.status(503).json({ error: "storage_unavailable" });
  }
}
