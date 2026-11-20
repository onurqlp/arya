export function whatsappTransport(env = process.env) {
  void env;
  return "web";
}

export function localWhatsAppAgentConfigured(env = process.env) {
  let allowedChats = [];
  try {
    const parsed = JSON.parse(env.ARYA_LOCAL_WHATSAPP_ALLOWED_CHATS || "[]");
    if (Array.isArray(parsed)) allowedChats = parsed.filter((item) => typeof item === "string" && item.trim());
  } catch {}
  return env.ARYA_WHATSAPP_TRANSPORT === "web" &&
    env.ARYA_LOCAL_WHATSAPP_ENABLED === "true" &&
    typeof env.ARYA_LOCAL_WHATSAPP_INGEST_SECRET === "string" &&
    env.ARYA_LOCAL_WHATSAPP_INGEST_SECRET.length >= 32 &&
    allowedChats.length > 0;
}
