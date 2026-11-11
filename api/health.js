import { authConfigured } from "../lib/auth.js";
import { ensureSchema } from "../lib/db.js";

export default async function handler(_req, res) {
  const configured = {
    database: Boolean(process.env.DATABASE_URL),
    adminPassword: Boolean(process.env.ARYA_ADMIN_PASSWORD && process.env.ARYA_ADMIN_PASSWORD.length >= 20),
    sessionSecret: Boolean(process.env.ARYA_SESSION_SECRET && process.env.ARYA_SESSION_SECRET.length >= 32),
    openAI: Boolean(process.env.OPENAI_API_KEY && process.env.OPENAI_MODEL),
    metaWebhook: Boolean(process.env.META_APP_SECRET && process.env.META_WEBHOOK_VERIFY_TOKEN),
    metaSend: Boolean(process.env.META_ACCESS_TOKEN && process.env.META_PHONE_NUMBER_ID && process.env.META_GRAPH_API_VERSION)
  };

  let databaseReady = false;
  if (configured.database) {
    try {
      await ensureSchema();
      databaseReady = true;
    } catch {
      databaseReady = false;
    }
  }

  const adminReady = authConfigured();
  const webhookReady = databaseReady && adminReady && configured.metaWebhook;
  const draftReady = databaseReady && adminReady && configured.openAI;

  res.setHeader("Cache-Control", "no-store");
  res.status(200).json({
    service: "arya",
    status: webhookReady ? "inbound_ready" : "setup_required",
    configured,
    databaseReady,
    adminReady,
    webhookSubscriptionReady: webhookReady,
    protectedDraftEndpoint: draftReady,
    messageStorage: databaseReady && adminReady,
    outboundSending: false,
    note: "Inbound messages are stored after webhook setup. Analysis requires an explicit admin action. Approving a draft does not send it."
  });
}
