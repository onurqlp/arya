import { createHmac, timingSafeEqual } from "node:crypto";

export const config = {
  api: {
    bodyParser: false,
  },
};

const MAX_BODY_BYTES = 1024 * 1024;

function safeEqual(left, right) {
  if (typeof left !== "string" || typeof right !== "string") return false;
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function getQuery(req) {
  const url = new URL(req.url || "/", "http://localhost");
  return url.searchParams;
}

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let tooLarge = false;

    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        tooLarge = true;
        chunks.length = 0;
        return;
      }
      if (!tooLarge) chunks.push(chunk);
    });

    req.on("end", () => {
      if (tooLarge) {
        const error = new Error("Request body exceeds the 1 MB limit.");
        error.statusCode = 413;
        reject(error);
        return;
      }
      resolve(Buffer.concat(chunks));
    });

    req.on("error", reject);
  });
}

function signatureIsValid(rawBody, receivedSignature, appSecret) {
  if (!receivedSignature || !appSecret) return false;
  const expected =
    "sha256=" +
    createHmac("sha256", appSecret).update(rawBody).digest("hex");
  return safeEqual(expected, receivedSignature);
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method === "GET") {
    // A verification success would let Meta subscribe immediately. Keep that
    // impossible until durable event processing and human review are built.
    const messageProcessingEnabled = false;
    if (!messageProcessingEnabled) {
      res.status(503).json({ error: "message_processor_not_ready" });
      return;
    }
    const query = getQuery(req);
    const mode = query.get("hub.mode");
    const token = query.get("hub.verify_token");
    const challenge = query.get("hub.challenge");

    if (
      mode === "subscribe" &&
      process.env.META_WEBHOOK_VERIFY_TOKEN &&
      safeEqual(token, process.env.META_WEBHOOK_VERIFY_TOKEN) &&
      challenge
    ) {
      res.status(200).send(challenge);
      return;
    }

    res.status(403).json({ error: "webhook_verification_failed" });
    return;
  }

  if (req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    res.status(405).json({ error: "method_not_allowed" });
    return;
  }

  if (!process.env.META_APP_SECRET) {
    res.status(503).json({ error: "webhook_not_configured" });
    return;
  }

  let rawBody;
  try {
    rawBody = await readRawBody(req);
  } catch (error) {
    res.status(error.statusCode || 400).json({ error: "invalid_request_body" });
    return;
  }

  if (
    !signatureIsValid(
      rawBody,
      req.headers["x-hub-signature-256"],
      process.env.META_APP_SECRET,
    )
  ) {
    res.status(401).json({ error: "invalid_webhook_signature" });
    return;
  }

  let payload;
  try {
    payload = JSON.parse(rawBody.toString("utf8"));
  } catch {
    res.status(400).json({ error: "invalid_json" });
    return;
  }

  if (!payload || payload.object !== "whatsapp_business_account") {
    res.status(400).json({ error: "unexpected_webhook_payload" });
    return;
  }

  // Do not acknowledge a real event until durable storage, idempotency, and
  // the human-review pipeline are connected. Meta can retry this request.
  res.setHeader("Retry-After", "60");
  res.status(503).json({
    error: "message_processor_not_ready",
    message:
      "Signature verified. Message processing is intentionally disabled until durable storage and human review are configured.",
  });
}
