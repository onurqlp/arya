import test from "node:test";
import assert from "node:assert/strict";
import {
  idempotencyKey,
  isoWeekday,
  reminderSchedule,
  retryDelayMs,
  validLocalDate,
  zonedTimeToUtc
} from "../lib/lesson-coordinator.js";

const classDate = "2026-11-23";
const startAt = zonedTimeToUtc(classDate, "20:00");

test("Europe/Istanbul lesson dates map to stable UTC instants", () => {
  assert.equal(isoWeekday(classDate), 1);
  assert.equal(zonedTimeToUtc(classDate, "08:30").toISOString(), "2026-11-23T05:30:00.000Z");
  assert.equal(startAt.toISOString(), "2026-11-23T17:00:00.000Z");
});

test("confirmed lesson queues noon and lesson-minus-60 reminders", () => {
  const result = reminderSchedule(classDate, startAt, "Europe/Istanbul", new Date("2026-11-23T08:45:00.000Z"));
  assert.deepEqual(result.jobs.map((job) => [job.jobType, job.runAt.toISOString()]), [
    ["noon_reminder", "2026-11-23T09:00:00.000Z"],
    ["preclass_reminder", "2026-11-23T16:00:00.000Z"]
  ]);
  assert.deepEqual(result.skipped, []);
});

test("past noon is never caught up; future lesson-minus-60 remains scheduled", () => {
  const result = reminderSchedule(classDate, startAt, "Europe/Istanbul", new Date("2026-11-23T09:15:00.000Z"));
  assert.deepEqual(result.jobs.map((job) => job.jobType), ["preclass_reminder"]);
  assert.deepEqual(result.skipped, ["noon_window_passed"]);
});

test("late or invalid reminder windows fail closed", () => {
  const late = reminderSchedule(classDate, startAt, "Europe/Istanbul", new Date("2026-11-23T16:05:00.000Z"));
  assert.deepEqual(late.jobs, []);
  assert.deepEqual(late.skipped, ["noon_window_passed", "preclass_window_passed"]);
  assert.deepEqual(reminderSchedule("2026-02-30", startAt).jobs, []);
  assert.equal(validLocalDate("2026-02-30"), false);
});

test("idempotency changes only when the revision changes", () => {
  const first = idempotencyKey("rule-1", classDate, "preclass_reminder", 1);
  assert.equal(first, idempotencyKey("rule-1", classDate, "preclass_reminder", 1));
  assert.notEqual(first, idempotencyKey("rule-1", classDate, "preclass_reminder", 2));
});

test("retry backoff is bounded and increases by attempt", () => {
  assert.equal(retryDelayMs(1), 30_000);
  assert.equal(retryDelayMs(2), 60_000);
  assert.equal(retryDelayMs(8), 30 * 60_000);
  assert.equal(retryDelayMs(0), 30_000);
});
