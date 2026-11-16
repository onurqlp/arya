import { ensureSchema } from "../../lib/db.js";
import { requireAdmin, sameOrigin } from "../../lib/auth.js";
import { sendManualReply } from "../../lib/manual-reply.js";

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

  const { conversationId, text, requestId } = req.body || {};
  try {
    const db = await ensureSchema();
    const result = await sendManualReply(db, { conversationId, text, requestId });
    if (!result.ok) {
      res.status(result.status).json({
        error: result.error,
        ...(result.providerStatus ? { providerStatus: result.providerStatus } : {}),
        ...(result.retryable === false ? { retryable: false } : {}),
      });
      return;
    }
    res.status(200).json({ status: "sent", providerMessageId: result.providerMessageId });
  } catch {
    res.status(503).json({ error: "send_state_unavailable" });
  }
}
