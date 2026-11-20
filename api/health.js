import { authConfigured } from "../lib/auth.js";
import { ensureSchema } from "../lib/db.js";
import { localWhatsAppAgentConfigured, whatsappTransport } from "../lib/whatsapp-transport.js";

export default async function handler(_req, res) {
  const transport = whatsappTransport();
  const webTransport = transport === "web";
  const configured = {
    database: Boolean(process.env.DATABASE_URL),
    adminPassword: Boolean(process.env.ARYA_ADMIN_PASSWORD && process.env.ARYA_ADMIN_PASSWORD.length >= 3),
    sessionSecret: Boolean(process.env.ARYA_SESSION_SECRET && process.env.ARYA_SESSION_SECRET.length >= 32),
    whatsappWebAgent: webTransport && localWhatsAppAgentConfigured()
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
    status: configured.whatsappWebAgent ? "whatsapp_web_agent_ready" : "whatsapp_web_setup_required",
    transport,
    configured,
    databaseReady,
    adminReady,
    localAgentMode: true,
    messageInboxEnabled: false,
    outboundSending: false,
    note: "WhatsApp messages stay in the local browser session. The panel stores schedules and delivery status only."
  });
}
