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
  return res.status(409).json({ error: "whatsapp_web_send_paused", retryable: false });
}
