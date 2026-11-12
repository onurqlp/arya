function target(path) {
  const version = process.env.META_GRAPH_API_VERSION || "";
  if (!/^v\d+\.\d+$/.test(version)) return null;
  return "https://graph.facebook.com/" + version + "/" + path;
}
async function check(path, includeIds = false) {
  try {
    const response = await fetch(target(path), {
      headers: { Authorization: "Bearer " + process.env.META_ACCESS_TOKEN },
      signal: AbortSignal.timeout(6000), cache: "no-store"
    });
    const data = await response.json().catch(() => ({}));
    return { status: response.status, code: Number(data.error?.code) || null,
      subcode: Number(data.error?.error_subcode) || null,
      ...(includeIds ? { id: String(data.id || ""), ids: (Array.isArray(data.data) ? data.data : []).map(x => String(x.id || x.permission || "")) } : {}) };
  } catch { return { status: 0, code: null }; }
}
export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "GET") return res.status(405).json({ error: "method_not_allowed" });
  const business = process.env.META_BUSINESS_ID;
  const phone = process.env.META_PHONE_NUMBER_ID;
  if (!/^\d+$/.test(business || "") || !/^\d+$/.test(phone || "") || !process.env.META_ACCESS_TOKEN ||
      !/^v\d+\.\d+$/.test(process.env.META_GRAPH_API_VERSION || "")) {
    return res.status(503).json({ error: "not_configured" });
  }
  const [identity, permissions, waba, phoneResult, owned, client] = await Promise.all([
    check('me?fields=id,name', true),
    check('me/permissions?fields=permission,status', true),
    check(process.env.META_WABA_ID + '?fields=id,name'),
    check(phone + "?fields=id,verified_name"),
    check(business + "/owned_whatsapp_business_accounts?fields=id,name&limit=50", true),
    check(business + "/client_whatsapp_business_accounts?fields=id,name&limit=50", true)
  ]);
  res.status(200).json({ identity, permissions, waba, phone: phoneResult, owned, client });
}
