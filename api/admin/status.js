import { ensureSchema } from "../../lib/db.js";
import { requireAdmin } from "../../lib/auth.js";

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    res.status(405).json({ error: "method_not_allowed" });
    return;
  }
  if (!requireAdmin(req, res)) return;

  let databaseReady = false;
  try {
    await ensureSchema();
    databaseReady = true;
  } catch {
    databaseReady = false;
  }
  res.status(200).json({
    databaseReady,
    openAIConfigured: Boolean(process.env.OPENAI_API_KEY && process.env.OPENAI_MODEL),
    webhookConfigured: Boolean(process.env.META_APP_SECRET && process.env.META_WEBHOOK_VERIFY_TOKEN),
    outboundSending: false
  });
}
