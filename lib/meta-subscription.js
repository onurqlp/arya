const APP_ID = () => process.env.META_APP_ID;
const WABA_ID = () => process.env.META_WABA_ID;
let cached;
let cacheUntil = 0;

function graphUrl() {
  const version = process.env.META_GRAPH_API_VERSION || "";
  if (!/^v\d+\.\d+$/.test(version) || !/^\d+$/.test(WABA_ID() || "") ||
      !/^\d+$/.test(APP_ID() || "") || !process.env.META_ACCESS_TOKEN) return null;
  return `https://graph.facebook.com/${version}/${WABA_ID()}/subscribed_apps`;
}

async function request(method) {
  const response = await fetch(graphUrl(), {
    method,
    headers: { Authorization: `Bearer ${process.env.META_ACCESS_TOKEN}` },
    signal: AbortSignal.timeout(6000),
    cache: "no-store"
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    return { ok: false, state: "meta_error", httpStatus: response.status,
      metaCode: Number(data.error?.code) || null, metaSubcode: Number(data.error?.error_subcode) || null };
  }
  return { ok: true, data };
}

export async function subscriptionStatus(force = false) {
  if (!graphUrl()) return { state: "not_configured", subscribed: false };
  if (!force && cached && Date.now() < cacheUntil) return cached;
  try {
    const result = await request("GET");
    if (!result.ok) return result;
    if (!Array.isArray(result.data.data)) return { state: "unexpected_response", subscribed: false };
    const subscribed = result.data.data.some((item) =>
      String(item?.id || item?.whatsapp_business_api_data?.id || "") === APP_ID());
    cached = { state: subscribed ? "subscribed" : "not_subscribed", subscribed };
    cacheUntil = Date.now() + 30_000;
    return cached;
  } catch {
    return { state: "unavailable", subscribed: false };
  }
}

export async function subscribeWaba() {
  if (!graphUrl()) return { state: "not_configured", subscribed: false };
  try {
    const result = await request("POST");
    if (!result.ok) return result;
    cached = null;
    cacheUntil = 0;
    return await subscriptionStatus(true);
  } catch {
    return { state: "unavailable", subscribed: false };
  }
}
