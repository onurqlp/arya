import { ensureSchema } from "../../lib/db.js";
import { requireAdmin, sameOrigin } from "../../lib/auth.js";
import { sendApprovedReply } from "../../lib/approval-send.js";

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
  const id = req.body?.id;
  if (typeof id !== "string" || !id || id.length > 100) {
    res.status(400).json({ error: "invalid_approval_id" });
    return;
  }
  try {
    const db = await ensureSchema();
    const outcome = await sendApprovedReply(db, id, "admin");
    if (!outcome.ok) {
      res.status(outcome.status).json({
        error: outcome.error,
        ...(outcome.providerStatus ? { providerStatus: outcome.providerStatus } : {}),
        ...(outcome.retryable === false ? { retryable: false } : {}),
      });
      return;
    }
    res.status(200).json({ id: outcome.id, status: outcome.statusText, providerMessageId: outcome.providerMessageId });
  } catch {
    res.status(503).json({ error: "send_state_unavailable" });
  }
}
