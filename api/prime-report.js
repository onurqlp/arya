import { getCoordinatorDb } from "../lib/coordinator-db.js";
import { requireAdmin, sameOrigin } from "../lib/auth.js";
import {
  approvePrimeReport,
  approvePrimeReportBatch,
  cancelPrimeReport,
  cancelPrimeReportBatch,
  createPrimeReportDraft,
  createPrimeReportBatchDraft,
  getPrimeReportSendingSetting,
  listPrimeReports,
  setPrimeReportSendingSetting
} from "../lib/prime-report-outbox.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function fail(res, status, error) {
  return res.status(status).json({ error });
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  if (!["GET", "POST"].includes(req.method)) {
    res.setHeader("Allow", "GET, POST");
    return fail(res, 405, "method_not_allowed");
  }
  if (!requireAdmin(req, res)) return;
  if (req.method === "POST" && !sameOrigin(req)) return fail(res, 403, "origin_not_allowed");
  try {
    const db = getCoordinatorDb();
    if (req.method === "GET") {
      const [reports, settings] = await Promise.all([listPrimeReports(db), getPrimeReportSendingSetting(db)]);
      return res.status(200).json({ target: "ARYA ONAY", sending_enabled: settings.sending_enabled, reports });
    }
    const body = req.body && typeof req.body === "object" && !Array.isArray(req.body) ? req.body : {};
    if (body.action === "set_sending_enabled") {
      if (typeof body.sendingEnabled !== "boolean") return fail(res, 400, "invalid_sending_setting");
      return res.status(200).json(await setPrimeReportSendingSetting(db, body.sendingEnabled));
    }
    if (body.action === "draft") {
      return res.status(201).json(await createPrimeReportDraft(db, {
        idempotency_key: body.idempotencyKey,
        body: body.body,
        data_reviewed: body.dataReviewed
      }));
    }
    if (body.action === "draft_batch") {
      return res.status(201).json(await createPrimeReportBatchDraft(db, {
        idempotency_key: body.idempotencyKey,
        parts: body.parts,
        data_reviewed: body.dataReviewed
      }));
    }
    if (body.action === "approve") {
      if (!UUID_RE.test(body.id || "")) return fail(res, 400, "invalid_report_id");
      const settings = await getPrimeReportSendingSetting(db);
      if (!settings.sending_enabled) return fail(res, 409, "sending_disabled");
      return res.status(200).json(await approvePrimeReport(db, body.id, body.contentHash));
    }
    if (body.action === "approve_batch") {
      if (!UUID_RE.test(body.batchId || "")) return fail(res, 400, "invalid_report_batch");
      const settings = await getPrimeReportSendingSetting(db);
      if (!settings.sending_enabled) return fail(res, 409, "sending_disabled");
      return res.status(200).json(await approvePrimeReportBatch(db, body.batchId, body.contentHashes));
    }
    if (body.action === "cancel") {
      if (!UUID_RE.test(body.id || "")) return fail(res, 400, "invalid_report_id");
      return res.status(200).json(await cancelPrimeReport(db, body.id));
    }
    if (body.action === "cancel_batch") {
      if (!UUID_RE.test(body.batchId || "")) return fail(res, 400, "invalid_report_batch");
      return res.status(200).json(await cancelPrimeReportBatch(db, body.batchId));
    }
    return fail(res, 400, "invalid_action");
  } catch (error) {
    return fail(res, error.status || 503, error.code || "prime_report_storage_unavailable");
  }
}
