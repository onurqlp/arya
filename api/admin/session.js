import { authConfigured, hasAdminSession } from "../../lib/auth.js";
import { localWhatsAppAgentConfigured, whatsappTransport } from "../../lib/whatsapp-transport.js";

export default function handler(req, res) {
  const transport = whatsappTransport();
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    res.status(405).json({ error: "method_not_allowed" });
    return;
  }
  res.status(200).json({
    authenticated: hasAdminSession(req),
    transport,
    whatsappWebAgentConfigured: transport === "web" && localWhatsAppAgentConfigured(),
    setup: {
      adminConfigured: authConfigured(),
      databaseConfigured: Boolean(process.env.DATABASE_URL),
      webhookConfigured: false,
      outboundSending: false
    }
  });
}
