import { safeEqual } from "./auth.js";

export function agentApiEnabled(env = process.env) {
  return env.VERCEL_ENV !== "production";
}

export function agentTokenConfigured(env = process.env) {
  return typeof env.DERS_AGENT_TOKEN === "string" && env.DERS_AGENT_TOKEN.length >= 32;
}

export function authorizedAgentRequest(authorization, expected = process.env.DERS_AGENT_TOKEN) {
  const supplied = typeof authorization === "string" && authorization.startsWith("Bearer ")
    ? authorization.slice(7) : "";
  return Boolean(expected && expected.length >= 32 && safeEqual(supplied, expected));
}
