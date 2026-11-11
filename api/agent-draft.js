import { timingSafeEqual } from "node:crypto";

export const config = {
  api: {
    bodyParser: {
      sizeLimit: "128kb",
    },
  },
};

function safeEqual(left, right) {
  if (typeof left !== "string" || typeof right !== "string") return false;
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function readTranscript(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 30) {
    return null;
  }

  const accepted = [];
  for (const item of value) {
    if (
      !item ||
      !["user", "assistant"].includes(item.role) ||
      typeof item.content !== "string"
    ) {
      return null;
    }
    const content = item.content.trim();
    if (!content || content.length > 2000) return null;
    accepted.push({ role: item.role, content });
  }
  return accepted;
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    res.status(405).json({ error: "method_not_allowed" });
    return;
  }

  const internalToken = process.env.ARYA_INTERNAL_TOKEN;
  const authorization = req.headers.authorization || "";
  const suppliedToken = authorization.startsWith("Bearer ")
    ? authorization.slice(7)
    : "";

  if (!internalToken || !safeEqual(suppliedToken, internalToken)) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }

  const apiKey = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_MODEL;
  if (!apiKey || !model) {
    res.status(503).json({ error: "openai_not_configured" });
    return;
  }

  const transcript = readTranscript(req.body?.messages);
  if (!transcript) {
    res.status(400).json({
      error: "invalid_messages",
      message:
        "Provide 1–30 messages, each with role=user|assistant and non-empty content up to 2000 characters.",
    });
    return;
  }

  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        store: false,
        instructions:
          "You are Arya, an operations assistant for AYDA. Review the supplied group conversation and return a concise Turkish analysis with: a short summary, decisions or tasks with owners/deadlines if stated, uncertainties or conflicting details, and an optional reply draft. Do not invent facts, prices, dates, or decisions. Flag sensitive, unclear, or consequential matters for human review. This endpoint produces an internal draft only: never claim that a WhatsApp message was sent.",
        input: transcript,
        max_output_tokens: 700,
      }),
      signal: AbortSignal.timeout(20000),
    });

    if (!response.ok) {
      // Do not return or log provider response details; they may contain data.
      res.status(502).json({ error: "openai_request_failed" });
      return;
    }

    const data = await response.json();
    const outputText =
      data.output_text ||
      (data.output || [])
        .flatMap((item) => item.content || [])
        .filter((item) => item.type === "output_text")
        .map((item) => item.text || "")
        .join("\n")
        .trim();

    if (!outputText) {
      res.status(502).json({ error: "empty_model_response" });
      return;
    }

    res.status(200).json({
      mode: "internal_draft",
      sent: false,
      text: outputText,
      requestId: response.headers.get("x-request-id") || null,
    });
  } catch {
    res.status(502).json({ error: "openai_unavailable" });
  }
}
