import { authConfigured, hasAdminSession } from "../../lib/auth.js";

export default function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    res.status(405).json({ error: "method_not_allowed" });
    return;
  }
  res.status(200).json({
    authenticated: hasAdminSession(req),
    setup: {
      adminConfigured: authConfigured(),
      databaseConfigured: Boolean(process.env.DATABASE_URL),
      openAIConfigured: Boolean(process.env.OPENAI_API_KEY && process.env.OPENAI_MODEL),
      webhookConfigured: Boolean(process.env.META_APP_SECRET && process.env.META_WEBHOOK_VERIFY_TOKEN),
      outboundSending: false
    }
  });
}
