import { getCoordinatorDb } from "../lib/coordinator-db.js";
import { requireAdmin, sameOrigin } from "../lib/auth.js";
import {
  approvePrimeReport,
  cancelPrimeReport,
  createPrimeReportDraft,
  listPrimeReports
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
      const [reports, settingsRows] = await Promise.all([
        listPrimeReports(db),
        db.query("SELECT paused, dry_run, send_enabled FROM arya_web_agent_settings WHERE id = 1")
      ]);
      const settings = settingsRows[0];
      return res.status(200).json({
        target: "ARYA ONAY",
        sending_enabled: Boolean(settings && !settings.paused && !settings.dry_run && settings.send_enabled),
        reports
      });
    }
    const body = req.body && typeof req.body === "object" && !Array.isArray(req.body) ? req.body : {};
    if (body.action === "draft") {
      return res.status(201).json(await createPrimeReportDraft(db, {
        idempotency_key: body.idempotencyKey,
        body: body.body,
        data_reviewed: body.dataReviewed
      }));
    }
    if (body.action === "approve") {
      if (!UUID_RE.test(body.id || "")) return fail(res, 400, "invalid_report_id");
      const settings = (await db.query("SELECT paused, dry_run, send_enabled FROM arya_web_agent_settings WHERE id = 1"))[0];
      if (!settings || settings.paused || settings.dry_run || !settings.send_enabled) return fail(res, 409, "sending_disabled");
      return res.status(200).json(await approvePrimeReport(db, body.id, body.contentHash));
    }
    if (body.action === "cancel") {
      if (!UUID_RE.test(body.id || "")) return fail(res, 400, "invalid_report_id");
      return res.status(200).json(await cancelPrimeReport(db, body.id));
    }
    return fail(res, 400, "invalid_action");
  } catch (error) {
    return fail(res, error.status || 503, error.code || "prime_report_storage_unavailable");
  }
}
