import { requireAdmin, sameOrigin } from "../lib/auth.js";
import { subscriptionStatus, subscribeWaba } from "../lib/meta-subscription.js";

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method === "GET") {
    res.status(200).json(await subscriptionStatus());
    return;
  }
  if (req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    res.status(405).json({ error: "method_not_allowed" });
    return;
  }
  if (!requireAdmin(req, res)) return;
  if (!sameOrigin(req)) {
    res.status(403).json({ error: "origin_mismatch" });
    return;
  }
  const result = await subscribeWaba();
  res.status(result.subscribed ? 200 : 502).json(
    result.subscribed ? result : { ...result, error: "meta_subscription_failed" }
  );
}
