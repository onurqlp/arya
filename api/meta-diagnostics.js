import { ensureSchema } from "../lib/db.js";

export const config = { maxDuration: 30 };

function failure(response, data) {
  return {
    ok: false,
    status: response.status,
    code: Number(data?.error?.code) || null,
    subcode: Number(data?.error?.error_subcode) || null,
    message: String(data?.error?.message || "").slice(0, 180)
  };
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "GET") return res.status(405).json({ error: "method_not_allowed" });
  const version = process.env.META_GRAPH_API_VERSION;
  const token = process.env.META_ACCESS_TOKEN;
  const waba = process.env.META_WABA_ID;
  const phone = process.env.META_PHONE_NUMBER_ID;
  const app = process.env.META_APP_ID;
  const business = process.env.META_BUSINESS_ID;
  if (!/^v\d+\.\d+$/.test(version || "") || !token || !/^\d+$/.test(waba || "") ||
      !/^\d+$/.test(phone || "") || !/^\d+$/.test(app || "")) {
    return res.status(200).json({ state: "missing_configuration" });
  }
  const endpoints = {
    waba: `/${waba}?fields=id,name`,
    phone: `/${phone}?fields=id,display_phone_number`,
    wabaPhones: `/${waba}/phone_numbers?fields=id&limit=100`,
    subscriptions: `/${waba}/subscribed_apps`
  };
  if (/^\d+$/.test(business || "")) {
    endpoints.ownedWabas = `/${business}/owned_whatsapp_business_accounts?fields=id&limit=100`;
    endpoints.clientWabas = `/${business}/client_whatsapp_business_accounts?fields=id&limit=100`;
  }
  async function check(path) {
    try {
      const response = await fetch(`https://graph.facebook.com/${version}${path}`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(7000),
        cache: "no-store"
      });
      const data = await response.json().catch(() => ({}));
      return response.ok ? { ok: true, data } : failure(response, data);
    } catch (error) {
      return { ok: false, status: null, message: error?.name === "TimeoutError" ? "timeout" : "network_error" };
    }
  }
  const checks = Object.fromEntries(await Promise.all(Object.entries(endpoints).map(async ([name, path]) => [name, await check(path)])));
  const summarize = (item) => item.ok ? { ok: true } : item;
  let storage;
  try {
    const db = await ensureSchema();
    const rows = await db.query("SELECT COUNT(*)::int AS total, MAX(received_at) AS last_received FROM arya_messages");
    storage = { ok: true, total: rows[0]?.total ?? 0, lastReceived: rows[0]?.last_received ?? null };
  } catch {
    storage = { ok: false };
  }
  return res.status(200).json({
    configuredWaba: summarize(checks.waba),
    configuredPhone: summarize(checks.phone),
    phoneInConfiguredWaba: checks.wabaPhones.ok
      ? { ok: true, match: checks.wabaPhones.data.data?.some((item) => String(item.id) === phone) || false }
      : summarize(checks.wabaPhones),
    appSubscribed: checks.subscriptions.ok
      ? { ok: true, match: checks.subscriptions.data.data?.some((item) => String(item.id || item.whatsapp_business_api_data?.id) === app) || false }
      : summarize(checks.subscriptions),
    ownedWaba: checks.ownedWabas
      ? checks.ownedWabas.ok ? { ok: true, match: checks.ownedWabas.data.data?.some((item) => String(item.id) === waba) || false } : summarize(checks.ownedWabas)
      : null,
    clientWaba: checks.clientWabas
      ? checks.clientWabas.ok ? { ok: true, match: checks.clientWabas.data.data?.some((item) => String(item.id) === waba) || false } : summarize(checks.clientWabas)
      : null,
    storage
  });
}
