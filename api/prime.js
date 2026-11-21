import { randomUUID } from "node:crypto";
import { requireAdmin, sameOrigin } from "../lib/auth.js";

const ROOT = "https://api.openai.com/v1/agents/sessions";
const allowedMethods = "GET, POST";

function fail(res, status, error) {
  res.status(status).json({ error });
}
function config() {
  const id = process.env.AYDA_PRIME_SESSION_ID;
  const key = process.env.AYDA_PRIME_OPENAI_API_KEY || process.env.OPENAI_API_KEY;
  if (!/^sess_[a-zA-Z0-9_-]+$/.test(id || "")) return { error: "prime_session_not_configured" };
  if (!key) return { error: "openai_not_configured" };
  return { id, key };
}
async function upstream(id, key, suffix = "", options = {}) {
  const response = await fetch(ROOT + "/" + encodeURIComponent(id) + suffix, {
    ...options,
    headers: {
      Authorization: "Bearer " + key,
      "OpenAI-Beta": "agents=v1",
      Accept: "application/json",
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(options.headers || {})
    },
    signal: AbortSignal.timeout(20000),
    cache: "no-store"
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const err = new Error("upstream_error");
    err.status = response.status;
    throw err;
  }
  return body;
}
function messageRows(items) {
  return (Array.isArray(items) ? items : [])
    .filter(item => item && item.type === "message" && ["user", "assistant"].includes(item.role))
    .map(item => ({
      id: item.id,
      role: item.role,
      text: (Array.isArray(item.content) ? item.content : [])
        .filter(part => part && ["input_text", "output_text"].includes(part.type) && typeof part.text === "string")
        .map(part => part.text).join("\n"),
      status: item.status || "completed"
    }))
    .filter(item => item.text.trim())
    .reverse();
}
export default async function handler(req, res) {
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  if (!["GET", "POST"].includes(req.method)) {
    res.setHeader("Allow", allowedMethods);
    return fail(res, 405, "method_not_allowed");
  }
  if (!requireAdmin(req, res)) return;
  const setting = config();
  if (setting.error) return fail(res, 503, setting.error);
  try {
    if (req.method === "GET") {
      const [session, items] = await Promise.all([
        upstream(setting.id, setting.key),
        upstream(setting.id, setting.key, "/items?order=desc&limit=100")
      ]);
      return res.status(200).json({
        ready: true,
        status: session.status || "unknown",
        model: session.agent?.model || "unknown",
        sessionId: setting.id,
        needsAction: session.status === "requires_action",
        messages: messageRows(items.data)
      });
    }
    if (!sameOrigin(req)) return fail(res, 403, "origin_not_allowed");
    const text = typeof req.body?.message === "string" ? req.body.message.trim() : "";
    if (!text || text.length > 6000) return fail(res, 400, "invalid_message");
    const nonce = req.body?.idempotencyKey;
    const key = typeof nonce === "string" && /^[a-f0-9-]{36}$/.test(nonce) ? nonce : randomUUID();
    await upstream(setting.id, setting.key, "/events", {
      method: "POST",
      headers: { "Idempotency-Key": key },
      body: JSON.stringify({
        events: [{ type: "agent.session.input.message", input: [{
          role: "user", content: [{ type: "input_text", text }]
        }] }]
      })
    });
    return res.status(202).json({ accepted: true });
  } catch (error) {
    if (error?.name === "TimeoutError") return fail(res, 504, "openai_timeout");
    if (error?.status === 401 || error?.status === 403) return fail(res, 502, "openai_key_or_project_mismatch");
    if (error?.status === 404) return fail(res, 502, "openai_session_not_found");
    if (error?.status === 429) return fail(res, 429, "openai_rate_limited");
    return fail(res, 502, "openai_connection_failed");
  }
}
