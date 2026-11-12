import { authConfigured } from "../lib/auth.js";
import { ensureSchema } from "../lib/db.js";
import { subscriptionStatus } from "../lib/meta-subscription.js";

export default async function handler(_req, res) {
  const configured = {
    database: Boolean(process.env.DATABASE_URL),
    adminPassword: Boolean(process.env.ARYA_ADMIN_PASSWORD && process.env.ARYA_ADMIN_PASSWORD.length >= 3),
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
  const webhookEndpointReady = databaseReady && adminReady && configured.metaWebhook;
  const metaSubscription = webhookEndpointReady ? await subscriptionStatus() : { state: "not_configured", subscribed: false };
  const webhookReady = webhookEndpointReady && metaSubscription.subscribed;
  const draftReady = databaseReady && adminReady && configured.openAI;
  const assetAccessDenied = metaSubscription.metaCode === 100 && metaSubscription.metaSubcode === 33;

  res.setHeader("Cache-Control", "no-store");
  res.status(200).json({
    service: "arya",
    status: webhookReady ? "inbound_ready" : webhookEndpointReady ? "subscription_unverified" : "setup_required",
    configured,
    databaseReady,
    adminReady,
    webhookEndpointReady,
    metaSubscription,
    webhookSubscriptionReady: webhookReady,
    protectedDraftEndpoint: draftReady,
    messageStorage: databaseReady && adminReady,
    outboundSending: databaseReady && adminReady && configured.metaSend && !assetAccessDenied,
    note: "Incoming messages need both the verified callback and a WABA subscription. Analysis and individual message sending require separate admin actions. Approval alone does not send."
  });
}
