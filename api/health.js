import { authConfigured } from "../lib/auth.js";
import { ensureSchema } from "../lib/db.js";
import { localWhatsAppIngestConfigured, whatsappTransport } from "../lib/whatsapp-transport.js";

export default async function handler(_req, res) {
  const transport = whatsappTransport();
  const webTransport = transport === "web";
  const configured = {
    database: Boolean(process.env.DATABASE_URL),
    adminPassword: Boolean(process.env.ARYA_ADMIN_PASSWORD && process.env.ARYA_ADMIN_PASSWORD.length >= 3),
    sessionSecret: Boolean(process.env.ARYA_SESSION_SECRET && process.env.ARYA_SESSION_SECRET.length >= 32),
    openAI: Boolean(process.env.OPENAI_API_KEY && process.env.OPENAI_MODEL),
    whatsappWebIngest: webTransport && localWhatsAppIngestConfigured()
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

  res.setHeader("Cache-Control", "no-store");
  res.status(200).json({
    service: "arya",
    status: configured.whatsappWebIngest ? "whatsapp_web_ingest_ready" : "whatsapp_web_setup_required",
    transport,
    configured,
    databaseReady,
    adminReady,
    localAgentMode: true,
    messageInboxEnabled: true,
    outboundSending: false,
    note: "WhatsApp Web local-agent mode. Incoming messages observed in the active WhatsApp Web session are available in the ARYA inbox."
  });
}
