import { recordAudit, ensureSchema, purgeExpired } from "../../lib/db.js";
import { authConfigured, getClientRateKey, safeEqual, sameOrigin, setAdminSession } from "../../lib/auth.js";

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    res.status(405).json({ error: "method_not_allowed" });
    return;
  }
  if (!sameOrigin(req)) {
    res.status(403).json({ error: "origin_not_allowed" });
    return;
  }
  if (!authConfigured()) {
    res.status(503).json({ error: "admin_auth_not_configured" });
    return;
  }

  const password = req.body && typeof req.body.password === "string" ? req.body.password : "";
  if (!password || password.length > 256) {
    res.status(400).json({ error: "invalid_password" });
    return;
  }

  let db;
  let key;
  try {
    db = await ensureSchema();
    await purgeExpired(db);
    key = getClientRateKey(req);
    const blocked = await db.query(
      "SELECT blocked_until > NOW() AS blocked FROM arya_login_limits WHERE key_hash = $1",
      [key],
    );
    if (blocked[0] && blocked[0].blocked) {
      res.setHeader("Retry-After", "900");
      res.status(429).json({ error: "login_temporarily_blocked" });
      return;
    }
  } catch {
    res.status(503).json({ error: "storage_unavailable" });
    return;
  }

  if (!safeEqual(password, process.env.ARYA_ADMIN_PASSWORD)) {
    try {
      await db.query(
        "INSERT INTO arya_login_limits (key_hash, window_started_at, failures) VALUES ($1, NOW(), 1) " +
        "ON CONFLICT (key_hash) DO UPDATE SET " +
        "failures = CASE WHEN arya_login_limits.window_started_at < NOW() - INTERVAL '15 minutes' THEN 1 ELSE arya_login_limits.failures + 1 END, " +
        "window_started_at = CASE WHEN arya_login_limits.window_started_at < NOW() - INTERVAL '15 minutes' THEN NOW() ELSE arya_login_limits.window_started_at END, " +
        "blocked_until = CASE WHEN (CASE WHEN arya_login_limits.window_started_at < NOW() - INTERVAL '15 minutes' THEN 1 ELSE arya_login_limits.failures + 1 END) >= 8 THEN NOW() + INTERVAL '15 minutes' ELSE NULL END",
        [key],
      );
    } catch {
      res.status(503).json({ error: "storage_unavailable" });
      return;
    }
    res.status(401).json({ error: "invalid_credentials" });
    return;
  }

  try {
    await db.query("DELETE FROM arya_login_limits WHERE key_hash = $1", [key]);
    await recordAudit(db, "admin_login", null);
  } catch {
    res.status(503).json({ error: "storage_unavailable" });
    return;
  }

  setAdminSession(res);
  res.status(200).json({ authenticated: true, expiresInSeconds: 14400 });
}
