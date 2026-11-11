const required = [
  "OPENAI_API_KEY",
  "OPENAI_MODEL",
  "ARYA_INTERNAL_TOKEN",
  "META_ACCESS_TOKEN",
  "META_PHONE_NUMBER_ID",
  "META_APP_SECRET",
  "META_WEBHOOK_VERIFY_TOKEN",
  "META_GRAPH_API_VERSION",
];

export default function handler(_req, res) {
  const configured = Object.fromEntries(
    required.map((name) => [name, Boolean(process.env[name])]),
  );

  res.setHeader("Cache-Control", "no-store");
  res.status(200).json({
    service: "arya",
    status: "integration_scaffold",
    configured,
    webhookSecretsConfigured: Boolean(
      process.env.META_APP_SECRET && process.env.META_WEBHOOK_VERIFY_TOKEN,
    ),
    webhookSubscriptionReady: false,
    protectedDraftEndpoint: Boolean(
      process.env.OPENAI_API_KEY &&
        process.env.OPENAI_MODEL &&
        process.env.ARYA_INTERNAL_TOKEN?.length >= 32,
    ),
    messageProcessing: false,
    note: "No WhatsApp message is processed or sent by this scaffold.",
  });
}
