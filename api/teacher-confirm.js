import { getClientRateKey, requireAdmin, sameOrigin } from "../lib/auth.js";
import { classifyFixture, TEACHER_FIXTURES } from "../lib/teacher-classifier.js";

const modelLimits = new Map();

function allowModel(req) {
  const key = getClientRateKey(req);
  const now = Date.now();
  const current = modelLimits.get(key);
  if (!current || now - current.startedAt > 10 * 60_000) {
    modelLimits.set(key, { startedAt: now, count: 1 });
    return true;
  }
  if (current.count >= 10) return false;
  current.count += 1;
  return true;
}

function readBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") {
    try { return JSON.parse(req.body); } catch { return null; }
  }
  return null;
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  if (!requireAdmin(req, res)) return;

  if (req.method === "GET") {
    return res.status(200).json({
      fixtures: TEACHER_FIXTURES.map(({ id, label, plannedTime, teacherReply }) => ({
        id, label, planned_time: plannedTime, teacher_reply: teacherReply
      }))
    });
  }
  if (req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "method_not_allowed" });
  }
  if (!sameOrigin(req)) return res.status(403).json({ error: "origin_rejected" });

  const body = readBody(req);
  if (!body || Array.isArray(body) || Object.keys(body).length !== 1 || typeof body.fixture_id !== "string") {
    return res.status(400).json({ error: "invalid_fixture" });
  }
  const result = await classifyFixture(body.fixture_id, {
    apiKey: process.env.OPENAI_API_KEY,
    model: process.env.OPENAI_MODEL || "gpt-6-luna",
    beforeModel: () => allowModel(req)
  });
  if (result.error) return res.status(400).json({ error: result.error });
  return res.status(200).json(result);
}
