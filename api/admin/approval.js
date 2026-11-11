import { randomUUID } from "node:crypto";
import { ensureSchema, purgeExpired } from "../../lib/db.js";
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

  const id = req.body && typeof req.body.id === "string" ? req.body.id : "";
  const action = req.body && req.body.action;
  if (!id || id.length > 100 || !["approve", "reject"].includes(action)) {
    res.status(400).json({ error: "invalid_approval_action" });
    return;
  }

  try {
    const db = await ensureSchema();
    await purgeExpired(db);
    const status = action === "approve" ? "approved" : "rejected";
    const rows = await db.query(
      "WITH updated AS (" +
      "UPDATE arya_approvals SET status = $2, reviewed_at = NOW(), reviewed_by = $3 " +
      "WHERE id = $1 AND status = 'pending' RETURNING id" +
      ") INSERT INTO arya_audit (id, actor, action, entity_id, details) " +
      "SELECT $4, $3, 'approval_' || $2, id, '{\"sent\":false}'::jsonb FROM updated RETURNING entity_id",
      [id, status, "admin", randomUUID()],
    );
    if (!rows.length) {
      res.status(409).json({ error: "approval_not_pending" });
      return;
    }
    res.status(200).json({ id, status, sent: false });
  } catch {
    res.status(503).json({ error: "storage_unavailable" });
  }
}
