import { ensureLocalWhatsAppScheduleSchema } from "./local-whatsapp-schedule.js";
import { randomUUID } from "node:crypto";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const AGENT_RE = /^arya-local-[a-z0-9-]{6,40}$/;

function fail(code, status = 400) {
  return Object.assign(new Error(code), { code, status });
}

export async function ensureLocalWhatsAppOutboxSchema(db) {
  await ensureLocalWhatsAppScheduleSchema(db);
  // Schema is installed through the owner-run migration; see the restricted
  // runtime role note in ensureLocalWhatsAppScheduleSchema.
  void db;
}

export async function enqueueLocalWhatsAppJob(db, job) {
  await ensureLocalWhatsAppOutboxSchema(db);
  if (!job || typeof job.idempotency_key !== "string" || job.idempotency_key.length < 8 || job.idempotency_key.length > 180 ||
      typeof job.job_type !== "string" || !/^[a-z_]{3,40}$/.test(job.job_type) ||
      typeof job.chat_name !== "string" || !job.chat_name.trim() || job.chat_name.length > 100 ||
      typeof job.body !== "string" || !job.body.trim() || job.body.length > 3000 || !Number.isFinite(Date.parse(job.run_at))) {
    throw fail("invalid_whatsapp_outbox_job");
  }
  const rows = await db.query("INSERT INTO arya_web_outbox (idempotency_key, run_id, job_type, chat_name, body, run_at) " +
    "VALUES ($1, $2::uuid, $3, $4, $5, $6::timestamptz) ON CONFLICT (idempotency_key) DO NOTHING RETURNING id::text AS id", [
      job.idempotency_key, job.run_id || null, job.job_type, job.chat_name.trim(), job.body.trim(), job.run_at
    ]);
  return { queued: rows.length === 1, id: rows[0]?.id || null };
}

function istanbulDateTime(value = new Date()) {
  const dateParts = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Istanbul", year: "numeric", month: "2-digit", day: "2-digit" }).format(value);
  const time = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Istanbul", hour: "2-digit", minute: "2-digit", hour12: false }).format(value);
  const weekday = new Intl.DateTimeFormat("en-US", { timeZone: "Europe/Istanbul", weekday: "short" }).format(value);
  return { date: dateParts, time, weekday: ({ Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 })[weekday] };
}

function minutes(value) {
  const [hour, minute] = String(value).slice(0, 5).split(":").map(Number);
  return hour * 60 + minute;
}

async function makeReview(db, run, schedule, { sourceMessageId = null, context = "12.00’ye kadar açık teyit gelmedi." } = {}) {
  const existing = (await db.query("SELECT id::text AS id, review_code FROM arya_web_reviews WHERE run_id = $1::uuid", [run.id]))[0];
  const code = existing?.review_code || randomUUID().replace(/-/g, "").slice(0, 6).toUpperCase();
  const rows = await db.query("INSERT INTO arya_web_reviews (run_id, review_code, source_message_id) VALUES ($1::uuid, $2, $3) " +
    "ON CONFLICT (run_id) DO UPDATE SET source_message_id = COALESCE(arya_web_reviews.source_message_id, EXCLUDED.source_message_id) " +
    "RETURNING id::text AS id, review_code", [run.id, code, sourceMessageId]);
  const review = rows[0] || existing;
  const settings = (await db.query("SELECT approval_chat_name FROM arya_web_agent_settings WHERE id = 1"))[0];
  const agentSettings = (await db.query("SELECT paused, dry_run, send_enabled FROM arya_web_agent_settings WHERE id = 1"))[0];
  if (settings?.approval_chat_name && agentSettings && !agentSettings.paused && !agentSettings.dry_run && agentSettings.send_enabled) {
    await enqueueLocalWhatsAppJob(db, { idempotency_key: `review:${review.id}`, run_id: run.id, job_type: "approval_escalation",
      chat_name: settings.approval_chat_name,
      body: `${schedule.group_name} · ${schedule.teacher_name}: ${context}${sourceMessageId ? " Öğretmen mesajını WhatsApp Web'den kontrol edin." : ""} Yanıtınızı #${review.review_code} ile başlatın.`,
      run_at: new Date().toISOString() });
  }
  return review;
}

export async function enqueueDueLocalWhatsAppJobs(db, now = new Date()) {
  await ensureLocalWhatsAppOutboxSchema(db);
  const settings = (await db.query("SELECT paused, dry_run, send_enabled FROM arya_web_agent_settings WHERE id = 1"))[0];
  if (!settings || settings.paused || settings.dry_run || !settings.send_enabled) return { enqueued: 0, active: false };
  const clock = istanbulDateTime(now);
  const schedules = await db.query("SELECT id::text AS id, group_name, teacher_name, teacher_chat_name, weekday, to_char(class_time,'HH24:MI') AS class_time, " +
    "to_char(checkin_time,'HH24:MI') AS checkin_time, to_char(response_deadline,'HH24:MI') AS response_deadline, preclass_minutes " +
    "FROM arya_web_schedules WHERE enabled = true AND weekday = $1", [clock.weekday]);
  let enqueued = 0;
  for (const schedule of schedules) {
    const runs = await db.query("INSERT INTO arya_web_lesson_runs (schedule_id, run_date) VALUES ($1::uuid, $2::date) " +
      "ON CONFLICT (schedule_id, run_date) DO NOTHING RETURNING id::text AS id", [schedule.id, clock.date]);
    const run = runs[0] || (await db.query("SELECT id::text AS id, status FROM arya_web_lesson_runs WHERE schedule_id = $1::uuid AND run_date = $2::date", [schedule.id, clock.date]))[0];
    if (!run) continue;
    const status = run.status || (await db.query("SELECT status FROM arya_web_lesson_runs WHERE id = $1::uuid", [run.id]))[0]?.status;
    const nowMinute = minutes(clock.time);
    if (status === "awaiting_teacher" && nowMinute >= minutes(schedule.checkin_time)) {
      if (nowMinute <= minutes(schedule.response_deadline)) {
        const result = await enqueueLocalWhatsAppJob(db, { idempotency_key: `checkin:${schedule.id}:${clock.date}`, run_id: run.id,
          job_type: "teacher_confirmation", chat_name: schedule.teacher_chat_name,
          body: `Günaydın ${schedule.teacher_name}, bugün ${schedule.group_name} grubundaki dersimiz saat ${schedule.class_time} için uygun mudur? Yalnızca “ok”, “tamam” veya “evet” açık teyit sayılır.`,
          run_at: now.toISOString() });
        if (result.queued) enqueued++;
      } else {
        await db.query("UPDATE arya_web_lesson_runs SET status = 'no_response', updated_at = NOW() WHERE id = $1::uuid AND status = 'awaiting_teacher'", [run.id]);
        await makeReview(db, run, schedule, { context: `${clock.date} tarihli ${schedule.class_time} dersi için 12.00’ye kadar açık teyit gelmedi. Nasıl ilerleyelim?` });
      }
    }
    if (status === "no_response") await makeReview(db, run, schedule);
    if (status === "confirmed") {
      if (nowMinute <= minutes(schedule.class_time)) {
        const announcement = await enqueueLocalWhatsAppJob(db, { idempotency_key: `class-time:${schedule.id}:${clock.date}`, run_id: run.id,
          job_type: "confirmed_class_time", chat_name: schedule.group_name,
          body: `Arkadaşlar, bugünkü dersimiz saat ${schedule.class_time}. Görüşmek üzere.`, run_at: now.toISOString() });
        if (announcement.queued) enqueued++;
      }
      const reminderMinute = (minutes(schedule.class_time) - Number(schedule.preclass_minutes) + 1440) % 1440;
      if (nowMinute >= reminderMinute && nowMinute <= minutes(schedule.class_time)) {
        const result = await enqueueLocalWhatsAppJob(db, { idempotency_key: `reminder:${schedule.id}:${clock.date}`, run_id: run.id,
          job_type: "preclass_reminder", chat_name: schedule.group_name,
          body: `Dersimiz ${schedule.class_time}’te başlayacak. Görüşmek üzere.`, run_at: now.toISOString() });
        if (result.queued) enqueued++;
      }
    }
  }
  return { enqueued, active: true };
}

export async function processLocalWhatsAppTeacherDecision(db, event) {
  await ensureLocalWhatsAppOutboxSchema(db);
  const messageTime = Date.parse(event?.messageTime || "");
  if (!UUID_RE.test(event?.scheduleId || "") || !/^waweb:[a-f0-9]{64}$/i.test(event?.messageId || "") ||
      !Number.isFinite(messageTime) || !["confirmed", "needs_human_review"].includes(event?.decision) ||
      !["explicit_confirmation", "non_explicit_reply", "teacher_chat_or_sender_mismatch"].includes(event?.reason)) {
    throw fail("invalid_local_teacher_decision");
  }
  const dateTime = istanbulDateTime(new Date(messageTime));
  const schedule = (await db.query(
    "SELECT id::text AS id, group_name, teacher_name, teacher_chat_name, weekday, to_char(class_time,'HH24:MI') AS class_time, " +
    "to_char(checkin_time,'HH24:MI') AS checkin_time, to_char(response_deadline,'HH24:MI') AS response_deadline, preclass_minutes " +
    "FROM arya_web_schedules WHERE id = $1::uuid AND enabled = true",
    [event.scheduleId],
  ))[0];
  if (!schedule || Number(schedule.weekday) !== dateTime.weekday) return { ignored: true, reason: "schedule_not_active_today" };
  const firstDelivery = await db.query("INSERT INTO arya_web_processed_inbound (message_id) VALUES ($1) ON CONFLICT DO NOTHING RETURNING message_id", [event.messageId]);
  if (!firstDelivery.length) return { duplicate: true };

  const runs = await db.query("INSERT INTO arya_web_lesson_runs (schedule_id, run_date) VALUES ($1::uuid, $2::date) " +
    "ON CONFLICT (schedule_id, run_date) DO NOTHING RETURNING id::text AS id, status", [schedule.id, dateTime.date]);
  const run = runs[0] || (await db.query("SELECT id::text AS id, status FROM arya_web_lesson_runs WHERE schedule_id = $1::uuid AND run_date = $2::date",
    [schedule.id, dateTime.date]))[0];
  if (!run || run.status !== "awaiting_teacher") return { ignored: true, reason: "lesson_not_waiting_for_teacher" };

  const needsReview = async (context) => {
    await db.query("UPDATE arya_web_lesson_runs SET status = 'needs_human_review', updated_at = NOW() WHERE id = $1::uuid AND status = 'awaiting_teacher'", [run.id]);
    const review = await makeReview(db, run, schedule, { sourceMessageId: event.messageId, context });
    return { decision: "needs_human_review", review_code: review.review_code };
  };
  if (dateTime.time < schedule.checkin_time || dateTime.time > schedule.response_deadline) {
    return needsReview(schedule.teacher_name + " yanıtı teyit penceresinin dışında geldi. Mesaj metni bu bilgisayardaki WhatsApp Web'de kaldı; sohbeti kontrol edin.");
  }
  if (event.decision !== "confirmed" || event.reason !== "explicit_confirmation") {
    return needsReview(schedule.teacher_name + " açık “ok/tamam/evet” teyidi vermedi. Mesaj metni bu bilgisayardaki WhatsApp Web'de kaldı; sohbeti kontrol edin.");
  }
  if (dateTime.time >= schedule.class_time) {
    return needsReview(schedule.teacher_name + " açık teyit verdi ancak ders saati " + schedule.class_time + " geçti. WhatsApp Web'deki sohbeti kontrol edin.");
  }
  const confirmed = await db.query("UPDATE arya_web_lesson_runs SET status = 'confirmed', confirmed_message_id = $2, updated_at = NOW() " +
    "WHERE id = $1::uuid AND status = 'awaiting_teacher' RETURNING id::text AS id", [run.id, event.messageId]);
  return { decision: confirmed.length ? "confirmed" : "needs_human_review" };
}

export async function claimLocalWhatsAppJob(db, agentId, settings = {}) {
  await ensureLocalWhatsAppOutboxSchema(db);
  if (!AGENT_RE.test(agentId || "")) throw fail("invalid_local_agent_id");
  const sendingEnabled = settings.sendingEnabled ?? settings.send_enabled ?? false;
  const paused = settings.paused ?? true;
  const dryRun = settings.dryRun ?? settings.dry_run ?? true;
  if (!sendingEnabled || paused || dryRun) return { job: null, sending_enabled: false };

  // Expired leases are ambiguous: they are quarantined and never returned to the sendable queue.
  await db.query("UPDATE arya_web_outbox SET status = 'uncertain', lease_owner = NULL, lease_until = NULL, " +
    "outcome_code = 'lease_expired_delivery_unknown' WHERE status = 'leased' AND lease_until < NOW()");
  const owner = await db.query("INSERT INTO arya_web_worker_lease (id, agent_id, lease_until) " +
    "VALUES (1, $1, NOW() + INTERVAL '45 seconds') ON CONFLICT (id) DO UPDATE " +
    "SET agent_id = EXCLUDED.agent_id, lease_until = EXCLUDED.lease_until, updated_at = NOW() " +
    "WHERE arya_web_worker_lease.lease_until < NOW() OR arya_web_worker_lease.agent_id = EXCLUDED.agent_id " +
    "RETURNING agent_id", [agentId]);
  if (!owner.length) return { job: null, sending_enabled: true, owner_busy: true };

  try {
    const rows = await db.query("UPDATE arya_web_outbox SET status = 'leased', lease_owner = $1, " +
      "lease_until = NOW() + INTERVAL '45 seconds' WHERE id = (" +
      "SELECT id FROM arya_web_outbox WHERE status = 'queued' AND run_at <= NOW() " +
      "ORDER BY run_at, created_at FOR UPDATE SKIP LOCKED LIMIT 1) " +
      "AND NOT EXISTS (SELECT 1 FROM arya_web_outbox WHERE status IN ('leased','uncertain')) " +
      "RETURNING id::text AS id, run_id::text AS run_id, idempotency_key, job_type, chat_name, body, lease_until", [agentId]);
    return { job: rows[0] || null, sending_enabled: true, owner_busy: false };
  } catch (error) {
    if (error?.code === "23505") return { job: null, sending_enabled: true, owner_busy: true };
    throw error;
  }
}

export async function acknowledgeLocalWhatsAppJob(db, agentId, value) {
  await ensureLocalWhatsAppOutboxSchema(db);
  if (!AGENT_RE.test(agentId || "") || !UUID_RE.test(value?.job_id || "") ||
      !["sent", "uncertain", "blocked"].includes(value?.outcome)) throw fail("invalid_local_agent_ack");
  const result = value.outcome === "sent" ? "sent" : value.outcome;
  const rows = await db.query("UPDATE arya_web_outbox SET status = $3, delivered_at = CASE WHEN $3 = 'sent' THEN NOW() ELSE NULL END, " +
    "outcome_code = $4, lease_owner = NULL, lease_until = NULL WHERE id = $1::uuid AND status = 'leased' AND lease_owner = $2 " +
    "RETURNING id::text AS id, run_id::text AS run_id, job_type, status", [value.job_id, agentId, result, value.error_code || null]);
  if (!rows.length) throw fail("local_agent_job_lease_lost", 409);
  if (rows[0].run_id && rows[0].job_type === "human_teacher_reply") {
    const reviewStatus = result === "sent" ? "resolved" : result === "uncertain" ? "uncertain" : "answered";
    await db.query("UPDATE arya_web_reviews SET status = $2, updated_at = NOW() WHERE run_id = $1::uuid AND status = 'answered'", [rows[0].run_id, reviewStatus]);
  }
  await db.query("DELETE FROM arya_web_worker_lease WHERE id = 1 AND agent_id = $1", [agentId]);
  return { acknowledged: true, status: rows[0].status };
}

export async function resolveLocalWhatsAppOutbox(db, value) {
  await ensureLocalWhatsAppOutboxSchema(db);
  if (!UUID_RE.test(value?.job_id || "") || !["confirm_sent", "cancel"].includes(value?.resolution)) throw fail("invalid_outbox_resolution");
  const status = value.resolution === "confirm_sent" ? "sent" : "cancelled";
  const rows = await db.query("UPDATE arya_web_outbox SET status = $2, delivered_at = CASE WHEN $2 = 'sent' THEN NOW() ELSE NULL END, " +
    "outcome_code = CASE WHEN $2 = 'sent' THEN 'manually_reconciled_as_sent' ELSE 'manually_cancelled_after_review' END, " +
    "lease_owner = NULL, lease_until = NULL WHERE id = $1::uuid AND status IN ('uncertain','blocked') RETURNING run_id::text AS run_id, job_type, status",
    [value.job_id, status]);
  if (!rows.length) throw fail("outbox_job_not_reconcilable", 409);
  if (rows[0].run_id && rows[0].job_type === "human_teacher_reply") {
    await db.query("UPDATE arya_web_reviews SET status = $2, updated_at = NOW() WHERE run_id = $1::uuid AND status IN ('answered','uncertain')",
      [rows[0].run_id, status === "sent" ? "resolved" : "answered"]);
  }
  await db.query("DELETE FROM arya_web_worker_lease WHERE id = 1 AND lease_until < NOW()");
  return { reconciled: true, status };
}
