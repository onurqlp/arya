import test from "node:test";
import assert from "node:assert/strict";
import { ensureAgentSchedule, generateJobsForDate, runCoordinatorAction } from "../lib/coordinator-store.js";

const ruleId = "11111111-1111-4111-8111-111111111111";
const occurrenceId = "22222222-2222-4222-8222-222222222222";
const schedule = { id: ruleId, weekday: 1, start_time: "20:00", time_zone: "Europe/Istanbul", group_name: "A1 Demo", level: "A1", teacher_name: "Melda Demo" };

function demoDb() {
  const occurrences = new Map();
  const jobs = new Set();
  const jobInputs = [];
  const queries = [];
  const events = [];
  return {
    occurrences, jobs, jobInputs, queries, events,
    async query(sql, params = []) {
      queries.push({ sql, params });
      if (sql.includes("FROM schedule_rules r JOIN class_groups")) return [schedule];
      if (sql.startsWith("INSERT INTO coord_occurrences")) {
        const key = `${params[0]}:${params[1]}`;
        if (occurrences.has(key)) return [];
        const occurrence = { id: occurrenceId, revision: 1, status: "scheduled", class_date: params[1], planned_start_at: params[2] };
        occurrences.set(key, occurrence);
        return [occurrence];
      }
      if (sql.includes("FROM coord_occurrences WHERE schedule_rule_id")) {
        return [...occurrences.values()].filter((row) => row.class_date === params[1]);
      }
      if (sql.includes("WITH inserted AS (")) {
        const idempotency = params[4];
        if (jobs.has(idempotency)) return [];
        jobs.add(idempotency);
        jobInputs.push({ job_type: params[1], run_at: params[2], idempotency_key: idempotency, payload: JSON.parse(params[5]) });
        return [{ job_id: "synthetic-job" }];
      }
      if (sql.startsWith("UPDATE coord_occurrences SET status = 'needs_human_review'")) {
        for (const occurrence of occurrences.values()) if (occurrence.id === params[0]) occurrence.status = "needs_human_review";
        return [];
      }
      if (sql.startsWith("INSERT INTO coord_events")) { events.push({ sql, params }); return []; }
      if (sql.includes("FROM coord_occurrences o JOIN schedule_rules")) {
        return [{ id: occurrenceId, schedule_rule_id: ruleId, class_date: "2026-11-23", status: "scheduled", planned_start_at: "2026-11-23T17:00:00.000Z", confirmed_start_at: null, revision: 1, time_zone: "Europe/Istanbul", scheduled_time: "20:00", group_name: "A1 Demo", level: "A1", teacher_name: "Melda Demo" }];
      }
      return [];
    }
  };
}

test("repeated schedule generation creates one occurrence and one idempotent teacher job", async () => {
  const db = demoDb();
  const now = new Date("2026-11-22T20:00:00.000Z");
  const first = await generateJobsForDate(db, "2026-11-23", now);
  const second = await generateJobsForDate(db, "2026-11-23", now);
  assert.equal(first.created_jobs, 1);
  assert.equal(second.created_jobs, 0);
  assert.equal(db.jobs.size, 1);
  assert.equal(db.jobInputs[0].job_type, "teacher_confirmation");
  assert.equal(db.jobInputs[0].run_at, "2026-11-23T05:30:00.000Z");
  assert.equal(db.events.filter(({ params }) => params[0] === "demo_jobs_generated").length, 1);
  assert.ok([...db.jobs][0].includes("teacher_confirmation"));
  assert.ok(db.queries.some(({ sql }) => sql.includes("ON CONFLICT (idempotency_key) DO NOTHING")));
});

test("agent pull planner creates the current Istanbul day only before the 08:30 window", async () => {
  const db = demoDb();
  const result = await ensureAgentSchedule(db, new Date("2026-11-23T04:00:00.000Z"));
  assert.equal(result.created_jobs, 1);
  assert.equal(db.jobInputs[0].run_at, "2026-11-23T05:30:00.000Z");
});

test("missed 08:30 window moves the demo occurrence to human review without queuing", async () => {
  const db = demoDb();
  const result = await generateJobsForDate(db, "2026-11-23", new Date("2026-11-23T06:00:00.000Z"));
  assert.equal(result.created_jobs, 0);
  assert.equal(result.skipped_past_window, 1);
  assert.equal([...db.occurrences.values()][0].status, "needs_human_review");
  assert.equal(db.jobs.size, 0);
  assert.ok(db.events.some(({ params }) => params[0] === "teacher_prompt_window_missed"));
});

test("past demo dates are rejected", async () => {
  const db = demoDb();
  await assert.rejects(
    generateJobsForDate(db, "2026-11-22", new Date("2026-11-23T00:00:00.000Z")),
    (error) => error.code === "past_date_blocked"
  );
});

test("holiday and late/no-reply simulations cancel pending jobs and append an alarm", async () => {
  const db = demoDb();
  const holiday = await runCoordinatorAction(db, { action: "simulate-holiday", occurrence_id: occurrenceId });
  assert.equal(holiday.status, "cancelled");
  assert.ok(db.queries.some(({ sql }) => sql.includes("'leased'")));
  assert.ok(db.events.some(({ sql, params }) => params[0] === "demo_holiday_blocked"));

  const late = await runCoordinatorAction(db, { action: "simulate-late", occurrence_id: occurrenceId });
  assert.equal(late.status, "needs_human_review");
  assert.ok(db.events.some(({ params }) => params[0] === "demo_teacher_reply_late_or_missing"));
});

test("queue transition SQL keeps sending disabled and avoids touching non-demo rows", async () => {
  const db = demoDb();
  await runCoordinatorAction(db, { action: "simulate-cancel", occurrence_id: occurrenceId });
  const transition = db.queries.find(({ sql }) => sql.includes("UPDATE coord_jobs SET status = 'cancelled'"));
  assert.ok(transition.sql.includes("send_enabled = false"));
  assert.ok(transition.sql.includes("status IN ('queued','retry_wait','paused','leased')"));
});

test("queue pause revokes outstanding leases before resume", async () => {
  const db = demoDb();
  await runCoordinatorAction(db, { action: "pause" });
  const transition = db.queries.find(({ sql }) => sql.includes("UPDATE coord_jobs SET status = 'paused'"));
  assert.ok(transition.sql.includes("'leased'"));
  assert.ok(transition.sql.includes("lease_owner = NULL, lease_until = NULL"));
  assert.ok(transition.sql.includes("send_enabled = false"));
});
