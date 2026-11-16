import { authConfigured } from "../lib/auth.js";
import { ensureSchema } from "../lib/db.js";
import { subscriptionStatus } from "../lib/meta-subscription.js";
import { ownerIdsFromEnvironment } from "../lib/owner-messaging.js";

export default async function handler(_req, res) {
  const configured = {
    database: Boolean(process.env.DATABASE_URL),
    adminPassword: Boolean(process.env.ARYA_ADMIN_PASSWORD && process.env.ARYA_ADMIN_PASSWORD.length >= 3),
    sessionSecret: Boolean(process.env.ARYA_SESSION_SECRET && process.env.ARYA_SESSION_SECRET.length >= 32),
    openAI: Boolean(process.env.OPENAI_API_KEY && process.env.OPENAI_MODEL),
    metaWebhook: Boolean(process.env.META_APP_SECRET && process.env.META_WEBHOOK_VERIFY_TOKEN),
    metaSend: Boolean(process.env.META_ACCESS_TOKEN && process.env.META_PHONE_NUMBER_ID && process.env.META_GRAPH_API_VERSION)
  };
  const ownerCount = ownerIdsFromEnvironment().length;
  const ownerTemplateConfigured = Boolean(String(process.env.ARYA_OWNER_NOTIFICATION_TEMPLATE || "").trim());

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
  const ownerMessaging = {
    enabled: ownerCount === 2,
    ownerCount,
    directRepliesReady: ownerCount === 2 && configured.metaSend,
    ownerTemplateConfigured,
    proactiveNotificationsReady: ownerCount === 2 && configured.metaSend && ownerTemplateConfigured
  };
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
    ownerMessaging,
    note: "Incoming individual messages need both the verified callback and a WABA subscription. Asya-style replies grounded in current verified information are sent automatically. Uncertain or human-decision cases are privately escalated to allowlisted owners; the customer gets no handoff message, and an owner can send the exact answer with CEVAP CODE: answer. WhatsApp customer-service window rules still apply."
  });
}
