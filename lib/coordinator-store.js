import {
  COORDINATOR_TIME_ZONE,
  idempotencyKey,
  isoWeekday,
  localDateInZone,
  MAX_JOB_ATTEMPTS,
  reminderSchedule,
  validLocalDate,
  validLocalTime,
  zonedTimeToUtc
} from "./lesson-coordinator.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const rowsOf = (result) => Array.isArray(result) ? result : Array.isArray(result?.rows) ? result.rows : [];
const fail = (code, status = 400) => Object.assign(new Error(code), { code, status });

export function validUuid(value) {
  return typeof value === "string" && UUID_RE.test(value);
}

async function recordEvent(db, eventType, details = {}, occurrenceId = null, jobId = null, level = "info") {
  await db.query(
    "INSERT INTO coord_events (event_type, level, occurrence_id, job_id, details) VALUES ($1, $2, $3::uuid, $4::uuid, $5::jsonb)",
    [eventType, level, occurrenceId, jobId, JSON.stringify(details)]
  );
}

async function insertJob(db, { occurrenceId, ruleId, classDate, jobType, runAt, revision, payload }) {
  const key = idempotencyKey(ruleId, classDate, jobType, revision);
  const json = JSON.stringify({ ...payload, dry_run: true, send_enabled: false });
  const result = rowsOf(await db.query(
    "WITH inserted AS (" +
      "INSERT INTO coord_jobs (occurrence_id, job_type, status, run_at, attempts, max_attempts, idempotency_key, payload, send_enabled) " +
      "VALUES ($1::uuid, $2, 'queued', $3::timestamptz, 0, $4, $5, $6::jsonb, false) " +
      "ON CONFLICT (idempotency_key) DO NOTHING RETURNING id, idempotency_key, payload" +
    ") " +
    "INSERT INTO coord_outbox (job_id, idempotency_key, status, payload, send_enabled) " +
    "SELECT id, idempotency_key, 'queued', payload, false FROM inserted " +
    "ON CONFLICT (idempotency_key) DO NOTHING RETURNING job_id",
    [occurrenceId, jobType, runAt.toISOString(), MAX_JOB_ATTEMPTS, key, json]
  ));
  return result.length > 0;
}

export async function loadCoordinatorDashboard(db, now = new Date()) {
  const [schedules, occurrences, jobs, counts, heartbeats, events] = await Promise.all([
    db.query(
      "SELECT r.id::text AS id, r.weekday, to_char(r.start_time, 'HH24:MI') AS start_time, r.time_zone, " +
      "r.enabled, r.status, g.name AS group_name, g.level, t.name AS teacher_name " +
      "FROM schedule_rules r JOIN class_groups g ON g.id = r.group_id AND g.mode = 'demo' " +
      "JOIN teachers t ON t.id = r.teacher_id AND t.mode = 'demo' " +
      "WHERE r.mode = 'demo' ORDER BY r.weekday, r.start_time, g.level"
    ),
    db.query(
      "SELECT o.id::text AS id, o.schedule_rule_id::text AS schedule_rule_id, to_char(o.class_date, 'YYYY-MM-DD') AS class_date, " +
      "o.status, o.planned_start_at, o.confirmed_start_at, o.revision, g.name AS group_name, g.level, t.name AS teacher_name " +
      "FROM coord_occurrences o JOIN schedule_rules r ON r.id = o.schedule_rule_id " +
      "JOIN class_groups g ON g.id = r.group_id AND g.mode = 'demo' " +
      "JOIN teachers t ON t.id = r.teacher_id AND t.mode = 'demo' " +
      "ORDER BY o.class_date DESC, o.created_at DESC LIMIT 100"
    ),
    db.query(
      "SELECT j.id::text AS id, j.occurrence_id::text AS occurrence_id, j.job_type, j.status, j.run_at, " +
      "j.attempts, j.max_attempts, j.last_error, j.send_enabled, j.idempotency_key, " +
      "o.class_date::text AS class_date, g.name AS group_name, g.level, t.name AS teacher_name " +
      "FROM coord_jobs j JOIN coord_occurrences o ON o.id = j.occurrence_id " +
      "JOIN schedule_rules r ON r.id = o.schedule_rule_id " +
      "JOIN class_groups g ON g.id = r.group_id AND g.mode = 'demo' " +
      "JOIN teachers t ON t.id = r.teacher_id AND t.mode = 'demo' " +
      "ORDER BY j.run_at DESC, j.created_at DESC LIMIT 100"
    ),
    db.query("SELECT status, COUNT(*)::int AS count FROM coord_jobs GROUP BY status"),
    db.query(
      "SELECT agent_id, status, last_seen, last_job_id::text AS last_job_id " +
      "FROM coord_agent_heartbeats ORDER BY last_seen DESC LIMIT 5"
    ),
    db.query(
      "SELECT id, event_type, level, occurrence_id::text AS occurrence_id, job_id::text AS job_id, details, created_at " +
      "FROM coord_events ORDER BY created_at DESC LIMIT 60"
    )
  ]);
  const heartbeatRows = rowsOf(heartbeats);
  const latestAgent = heartbeatRows[0] || null;
  const current = new Date(now).getTime();
  return {
    mode: "demo",
    time_zone: COORDINATOR_TIME_ZONE,
    local_date: localDateInZone(now),
    sending_enabled: false,
    database_scope: "arya_ders_koordinatoru / demo",
    schedules: rowsOf(schedules),
    occurrences: rowsOf(occurrences),
    jobs: rowsOf(jobs),
    counts: rowsOf(counts),
    agents: heartbeatRows.map((agent) => ({
      ...agent,
      online: current - new Date(agent.last_seen).getTime() < 2 * 60 * 1000
    })),
    latest_agent: latestAgent ? {
      ...latestAgent,
      online: current - new Date(latestAgent.last_seen).getTime() < 2 * 60 * 1000
    } : null,
    events: rowsOf(events)
  };
}

async function getOccurrence(db, occurrenceId) {
  const result = rowsOf(await db.query(
    "SELECT o.id::text AS id, o.schedule_rule_id::text AS schedule_rule_id, o.class_date::text AS class_date, " +
    "o.status, o.planned_start_at, o.confirmed_start_at, o.revision, r.time_zone, " +
    "to_char(r.start_time, 'HH24:MI') AS scheduled_time, g.name AS group_name, g.level, t.name AS teacher_name " +
    "FROM coord_occurrences o JOIN schedule_rules r ON r.id = o.schedule_rule_id AND r.mode = 'demo' " +
    "JOIN class_groups g ON g.id = r.group_id AND g.mode = 'demo' " +
    "JOIN teachers t ON t.id = r.teacher_id AND t.mode = 'demo' " +
    "WHERE o.id = $1::uuid AND o.mode = 'demo' LIMIT 1",
    [occurrenceId]
  ));
  return result[0] || null;
}

async function createReminderJobs(db, occurrence, startAt, revision, now) {
  const plan = reminderSchedule(
    occurrence.class_date,
    startAt,
    occurrence.time_zone || COORDINATOR_TIME_ZONE,
    now
  );
  let created = 0;
  for (const item of plan.jobs) {
    const didCreate = await insertJob(db, {
      occurrenceId: occurrence.id,
      ruleId: occurrence.schedule_rule_id,
      classDate: occurrence.class_date,
      jobType: item.jobType,
      runAt: item.runAt,
      revision,
      payload: {
        mode: "demo",
        group: occurrence.group_name,
        level: occurrence.level,
        teacher: occurrence.teacher_name,
        class_date: occurrence.class_date,
        confirmed_start_at: new Date(startAt).toISOString()
      }
    });
    if (didCreate) created += 1;
  }
  return { created, skipped: plan.skipped };
}

async function actionEnableDemo(db) {
  const updated = rowsOf(await db.query(
    "UPDATE schedule_rules SET enabled = true, status = 'active', updated_at = NOW() " +
    "WHERE mode = 'demo' AND status <> 'archived' RETURNING id"
  ));
  await recordEvent(db, "demo_schedules_enabled", { count: updated.length });
  return { updated: updated.length };
}

async function actionUpdateSchedule(db, body) {
  if (!validUuid(body.rule_id) || !Number.isInteger(Number(body.weekday)) ||
      Number(body.weekday) < 1 || Number(body.weekday) > 7 ||
      !validLocalTime(body.start_time) || typeof body.enabled !== "boolean" ||
      typeof body.group_name !== "string" || body.group_name.trim().length < 2 || body.group_name.trim().length > 80 ||
      typeof body.teacher_name !== "string" || body.teacher_name.trim().length < 2 || body.teacher_name.trim().length > 80) {
    throw fail("invalid_schedule");
  }
  let updated;
  try {
    updated = rowsOf(await db.query(
      "WITH target AS MATERIALIZED (SELECT id, group_id, teacher_id FROM schedule_rules WHERE id = $4::uuid AND mode = 'demo'), " +
      "group_update AS (UPDATE class_groups g SET name = $5, updated_at = NOW() FROM target t " +
        "WHERE g.id = t.group_id AND g.mode = 'demo' RETURNING g.id), " +
      "teacher_update AS (UPDATE teachers t SET name = $6, updated_at = NOW() FROM target x " +
        "WHERE t.id = x.teacher_id AND t.mode = 'demo' RETURNING t.id) " +
      "UPDATE schedule_rules r SET weekday = $1, start_time = $2::time, enabled = $3, " +
      "status = CASE WHEN $3 THEN 'active' ELSE 'draft' END, updated_at = NOW() " +
      "FROM target WHERE r.id = target.id AND r.mode = 'demo' RETURNING r.id::text AS id",
      [Number(body.weekday), body.start_time, body.enabled, body.rule_id, body.group_name.trim(), body.teacher_name.trim()]
    ));
  } catch (error) {
    if (error?.code === "23505") throw fail("schedule_conflict", 409);
    throw error;
  }
  if (!updated.length) throw fail("schedule_not_found", 404);
  await recordEvent(db, "demo_schedule_updated", {
    rule_id: body.rule_id, weekday: Number(body.weekday), start_time: body.start_time, enabled: body.enabled,
    group_name: body.group_name.trim(), teacher_name: body.teacher_name.trim()
  });
  return { updated: true };
}

export async function generateJobsForDate(db, classDate, now = new Date()) {
  if (!validLocalDate(classDate)) throw fail("invalid_class_date");
  const localToday = localDateInZone(now, COORDINATOR_TIME_ZONE);
  if (classDate < localToday) throw fail("past_date_blocked");
  const weekday = isoWeekday(classDate);
  const rules = rowsOf(await db.query(
    "SELECT r.id::text AS id, r.weekday, to_char(r.start_time, 'HH24:MI') AS start_time, r.time_zone, " +
    "g.name AS group_name, g.level, t.name AS teacher_name " +
    "FROM schedule_rules r JOIN class_groups g ON g.id = r.group_id AND g.mode = 'demo' " +
    "JOIN teachers t ON t.id = r.teacher_id AND t.mode = 'demo' " +
    "WHERE r.mode = 'demo' AND r.enabled = true AND r.status = 'active' AND r.weekday = $1 " +
    "ORDER BY r.start_time, g.level",
      [weekday]
  ));
  let created = 0;
  let skippedPastWindow = 0;
  for (const rule of rules) {
    const timeZone = rule.time_zone || COORDINATOR_TIME_ZONE;
    const plannedStart = zonedTimeToUtc(classDate, String(rule.start_time).slice(0, 5), timeZone);
    const teacherAt = zonedTimeToUtc(classDate, "08:30", timeZone);
    if (!plannedStart || !teacherAt) {
      await recordEvent(db, "invalid_demo_schedule_skipped", { rule_id: rule.id }, null, null, "warn");
      continue;
    }
    const occurrenceRows = rowsOf(await db.query(
      "INSERT INTO coord_occurrences (schedule_rule_id, class_date, planned_start_at) " +
      "VALUES ($1::uuid, $2::date, $3::timestamptz) ON CONFLICT (schedule_rule_id, class_date) DO NOTHING " +
      "RETURNING id::text AS id, revision, status",
      [rule.id, classDate, plannedStart.toISOString()]
    ));
    let occurrence = occurrenceRows[0];
    if (!occurrence) {
      const existing = rowsOf(await db.query(
        "SELECT id::text AS id, revision, status FROM coord_occurrences WHERE schedule_rule_id = $1::uuid AND class_date = $2::date LIMIT 1",
        [rule.id, classDate]
      ));
      occurrence = existing[0];
    }
    if (!occurrence) continue;
    if (occurrence.status && occurrence.status !== "scheduled") continue;
    if (teacherAt <= new Date(now)) {
      skippedPastWindow += 1;
      await db.query(
        "UPDATE coord_occurrences SET status = 'needs_human_review', updated_at = NOW() WHERE id = $1::uuid AND status = 'scheduled' AND mode = 'demo'",
        [occurrence.id]
      );
      await recordEvent(db, "teacher_prompt_window_missed", { rule_id: rule.id, class_date: classDate }, occurrence.id, null, "warn");
      continue;
    }
    const didCreate = await insertJob(db, {
      occurrenceId: occurrence.id,
      ruleId: rule.id,
      classDate,
      jobType: "teacher_confirmation",
      runAt: teacherAt,
      revision: Number(occurrence.revision || 1),
      payload: {
        mode: "demo", group: rule.group_name, level: rule.level, teacher: rule.teacher_name,
        class_date: classDate, planned_start_at: plannedStart.toISOString()
      }
    });
    if (didCreate) created += 1;
  }
  if (created || skippedPastWindow) {
    await recordEvent(db, "demo_jobs_generated", {
      class_date: classDate, matched_rules: rules.length, created_jobs: created, skipped_past_window: skippedPastWindow
    });
  }
  return { created_jobs: created, matched_rules: rules.length, skipped_past_window: skippedPastWindow };
}

async function actionGenerate(db, body, now) {
  return generateJobsForDate(db, body.class_date, now);
}

export async function ensureAgentSchedule(db, now = new Date()) {
  const today = localDateInZone(now, COORDINATOR_TIME_ZONE);
  return generateJobsForDate(db, today, now);
}

async function cancelPendingOccurrenceJobs(db, occurrenceId) {
  await db.query(
    "WITH moved AS (UPDATE coord_jobs SET status = 'cancelled', lease_owner = NULL, lease_until = NULL, updated_at = NOW() " +
    "WHERE occurrence_id = $1::uuid AND status IN ('queued','retry_wait','paused','leased') AND send_enabled = false RETURNING id) " +
    "UPDATE coord_outbox o SET status = 'cancelled', updated_at = NOW() FROM moved WHERE o.job_id = moved.id",
    [occurrenceId]
  );
}

async function actionOccurrence(db, body, now) {
  if (!validUuid(body.occurrence_id)) throw fail("invalid_occurrence");
  const occurrence = await getOccurrence(db, body.occurrence_id);
  if (!occurrence) throw fail("occurrence_not_found", 404);
  if (["simulate-cancel", "simulate-holiday"].includes(body.action)) {
    await db.query(
      "UPDATE coord_occurrences SET status = 'cancelled', updated_at = NOW() WHERE id = $1::uuid AND mode = 'demo'",
      [occurrence.id]
    );
    await cancelPendingOccurrenceJobs(db, occurrence.id);
    const isHoliday = body.action === "simulate-holiday";
    await recordEvent(db, isHoliday ? "demo_holiday_blocked" : "demo_occurrence_cancelled",
      { class_date: occurrence.class_date, reason: isHoliday ? "holiday" : "cancelled" }, occurrence.id, null, "warn");
    return { status: "cancelled", reason: isHoliday ? "holiday" : "cancelled" };
  }
  if (["simulate-uncertain", "simulate-late"].includes(body.action)) {
    await db.query(
      "UPDATE coord_occurrences SET status = 'needs_human_review', updated_at = NOW() WHERE id = $1::uuid AND mode = 'demo'",
      [occurrence.id]
    );
    await cancelPendingOccurrenceJobs(db, occurrence.id);
    const isLate = body.action === "simulate-late";
    await recordEvent(db, isLate ? "demo_teacher_reply_late_or_missing" : "demo_occurrence_needs_review",
      { class_date: occurrence.class_date, reason: isLate ? "late_or_no_reply" : "uncertain_reply" }, occurrence.id, null, "warn");
    return { status: "needs_human_review", reason: isLate ? "late_or_no_reply" : "uncertain_reply" };
  }
  if (body.action === "simulate-confirm") {
    if (occurrence.status === "cancelled") throw fail("cancelled_occurrence");
    const startAt = occurrence.confirmed_start_at || occurrence.planned_start_at;
    const revision = Number(occurrence.revision || 1);
    await db.query(
      "UPDATE coord_occurrences SET status = 'confirmed', confirmed_start_at = $2::timestamptz, updated_at = NOW() " +
      "WHERE id = $1::uuid AND mode = 'demo'",
      [occurrence.id, new Date(startAt).toISOString()]
    );
    const result = await createReminderJobs(db, occurrence, startAt, revision, now);
    await recordEvent(db, "demo_confirmation_simulated", {
      class_date: occurrence.class_date, created_reminders: result.created, skipped_windows: result.skipped
    }, occurrence.id);
    return { status: "confirmed", ...result };
  }
  if (body.action === "simulate-reschedule") {
    if (occurrence.status === "cancelled") throw fail("cancelled_occurrence");
    if (!validLocalTime(body.start_time)) throw fail("invalid_start_time");
    const startAt = zonedTimeToUtc(occurrence.class_date, body.start_time, occurrence.time_zone || COORDINATOR_TIME_ZONE);
    if (!startAt || startAt <= new Date(now)) throw fail("reschedule_time_must_be_future");
    const revision = Number(occurrence.revision || 1) + 1;
    await db.query(
      "UPDATE coord_occurrences SET status = 'rescheduled', confirmed_start_at = $2::timestamptz, revision = $3, updated_at = NOW() " +
      "WHERE id = $1::uuid AND mode = 'demo'",
      [occurrence.id, startAt.toISOString(), revision]
    );
    await cancelPendingOccurrenceJobs(db, occurrence.id);
    const result = await createReminderJobs(db, occurrence, startAt, revision, now);
    await recordEvent(db, "demo_occurrence_rescheduled", {
      class_date: occurrence.class_date, start_time: body.start_time, revision, created_reminders: result.created,
      skipped_windows: result.skipped
    }, occurrence.id);
    return { status: "rescheduled", ...result };
  }
  throw fail("invalid_action");
}

async function actionPause(db, action) {
  if (action === "pause") {
    const moved = rowsOf(await db.query(
      "WITH changed AS (UPDATE coord_jobs SET status = 'paused', lease_owner = NULL, lease_until = NULL, updated_at = NOW() " +
      "WHERE status IN ('queued','retry_wait','leased') AND send_enabled = false RETURNING id) " +
      "UPDATE coord_outbox o SET status = 'blocked', updated_at = NOW() FROM changed WHERE o.job_id = changed.id RETURNING o.job_id"
    ));
    await recordEvent(db, "queue_paused", { count: moved.length }, null, null, "warn");
    return { changed: moved.length };
  }
  const moved = rowsOf(await db.query(
    "WITH changed AS (UPDATE coord_jobs SET status = 'queued', run_at = LEAST(run_at, NOW()), updated_at = NOW() " +
    "WHERE status = 'paused' AND send_enabled = false RETURNING id, idempotency_key, payload) " +
    "UPDATE coord_outbox o SET status = 'queued', payload = changed.payload, updated_at = NOW() " +
    "FROM changed WHERE o.job_id = changed.id RETURNING o.job_id"
  ));
  await recordEvent(db, "queue_resumed", { count: moved.length });
  return { changed: moved.length };
}

async function actionRetry(db, body) {
  if (!validUuid(body.job_id)) throw fail("invalid_job");
  const moved = rowsOf(await db.query(
    "WITH changed AS (UPDATE coord_jobs SET status = 'queued', attempts = 0, run_at = NOW(), last_error = NULL, " +
    "lease_owner = NULL, lease_until = NULL, updated_at = NOW() " +
    "WHERE id = $1::uuid AND status = 'dead_letter' AND send_enabled = false " +
    "AND occurrence_id IN (SELECT id FROM coord_occurrences WHERE mode = 'demo') RETURNING id, payload) " +
    "UPDATE coord_outbox o SET status = 'queued', payload = changed.payload, updated_at = NOW() " +
    "FROM changed WHERE o.job_id = changed.id RETURNING o.job_id",
    [body.job_id]
  ));
  if (!moved.length) throw fail("dead_letter_not_found", 404);
  await recordEvent(db, "demo_dead_letter_requeued", { job_id: body.job_id }, null, body.job_id, "warn");
  return { requeued: true };
}

export async function runCoordinatorAction(db, body, now = new Date()) {
  if (!body || typeof body.action !== "string") throw fail("invalid_action");
  if (body.action === "enable-demo") return actionEnableDemo(db);
  if (body.action === "update-schedule") return actionUpdateSchedule(db, body);
  if (body.action === "generate") return actionGenerate(db, body, now);
  if (["simulate-confirm", "simulate-reschedule", "simulate-cancel", "simulate-holiday", "simulate-uncertain", "simulate-late"].includes(body.action)) {
    return actionOccurrence(db, body, now);
  }
  if (body.action === "pause" || body.action === "resume") return actionPause(db, body.action);
  if (body.action === "retry") return actionRetry(db, body);
  throw fail("invalid_action");
}

export const coordinatorErrors = Object.freeze({
  getRows: rowsOf,
  recordEvent
});
