import { ensureSchema } from "../../lib/db.js";
import { requireAdmin } from "../../lib/auth.js";
import { localWhatsAppAgentConfigured, whatsappTransport } from "../../lib/whatsapp-transport.js";

export default async function handler(req, res) {
  const transport = whatsappTransport();
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
    transport,
    whatsappWebAgentConfigured: transport === "web" && localWhatsAppAgentConfigured(),
    webhookConfigured: false,
    outboundSending: false
  });
}
