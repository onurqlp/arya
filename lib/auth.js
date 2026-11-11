import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

const COOKIE_NAME = "arya_admin";
const SESSION_SECONDS = 4 * 60 * 60;

export function safeEqual(left, right) {
  if (typeof left !== "string" || typeof right !== "string") return false;
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function authConfigured() {
  return Boolean(
    process.env.ARYA_ADMIN_PASSWORD &&
    process.env.ARYA_ADMIN_PASSWORD.length >= 20 &&
    process.env.ARYA_SESSION_SECRET &&
    process.env.ARYA_SESSION_SECRET.length >= 32
  );
}

export function sameOrigin(req) {
  const origin = req.headers.origin;
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  if (!origin || !host) return false;
  try {
    return new URL(origin).host.toLowerCase() === String(host).toLowerCase();
  } catch {
    return false;
  }
}

function signature(payload) {
  return createHmac("sha256", process.env.ARYA_SESSION_SECRET)
    .update(payload)
    .digest("base64url");
}

function cookieValue(req) {
  const header = req.headers.cookie || "";
  const item = header.split(";").map((part) => part.trim()).find((part) => part.startsWith(COOKIE_NAME + "="));
  return item ? item.slice(COOKIE_NAME.length + 1) : "";
}

export function hasAdminSession(req) {
  if (!authConfigured()) return false;
  const value = cookieValue(req);
  const pieces = value.split(".");
  if (pieces.length !== 2) return false;
  const expected = signature(pieces[0]);
  if (!safeEqual(pieces[1], expected)) return false;
  try {
    const session = JSON.parse(Buffer.from(pieces[0], "base64url").toString("utf8"));
    return session.v === 1 && Number.isFinite(session.exp) && session.exp > Math.floor(Date.now() / 1000);
  } catch {
    return false;
  }
}

export function setAdminSession(res) {
  const payload = Buffer.from(
    JSON.stringify({ v: 1, exp: Math.floor(Date.now() / 1000) + SESSION_SECONDS, nonce: randomUUID() }),
  ).toString("base64url");
  const secure = process.env.VERCEL ? "; Secure" : "";
  res.setHeader(
    "Set-Cookie",
    COOKIE_NAME + "=" + payload + "." + signature(payload) +
      "; Path=/; HttpOnly; SameSite=Strict; Max-Age=" + SESSION_SECONDS + secure,
  );
}

export function clearAdminSession(res) {
  const secure = process.env.VERCEL ? "; Secure" : "";
  res.setHeader(
    "Set-Cookie",
    COOKIE_NAME + "=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0" + secure,
  );
}

export function getClientRateKey(req) {
  const forwarded = req.headers["x-forwarded-for"];
  const address = typeof forwarded === "string" ? forwarded.split(",")[0].trim() : "unknown";
  return createHmac("sha256", process.env.ARYA_SESSION_SECRET)
    .update(address || "unknown")
    .digest("hex");
}

export function requireAdmin(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (!authConfigured()) {
    res.status(503).json({ error: "admin_auth_not_configured" });
    return false;
  }
  if (!hasAdminSession(req)) {
    res.status(401).json({ error: "unauthorized" });
    return false;
  }
  return true;
}
