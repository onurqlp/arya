export const COORDINATOR_TIME_ZONE = "Europe/Istanbul";
export const JOB_TYPES = Object.freeze(["teacher_confirmation", "noon_reminder", "preclass_reminder"]);
export const MAX_JOB_ATTEMPTS = 5;

export function validLocalDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(value + "T00:00:00.000Z");
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function validLocalTime(value) {
  return typeof value === "string" && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
}

export function localDateInZone(value = new Date(), timeZone = COORDINATOR_TIME_ZONE) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit"
  }).formatToParts(new Date(value));
  const map = Object.fromEntries(parts.map((item) => [item.type, item.value]));
  return map.year + "-" + map.month + "-" + map.day;
}

export function isoWeekday(date) {
  if (!validLocalDate(date)) return null;
  const weekday = new Date(date + "T00:00:00.000Z").getUTCDay();
  return weekday === 0 ? 7 : weekday;
}

function zonedParts(instant, timeZone) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23"
  }).formatToParts(instant);
  const values = Object.fromEntries(parts.map((item) => [item.type, item.value]));
  return {
    year: Number(values.year), month: Number(values.month), day: Number(values.day),
    hour: Number(values.hour), minute: Number(values.minute)
  };
}

export function zonedTimeToUtc(date, time, timeZone = COORDINATOR_TIME_ZONE) {
  if (!validLocalDate(date) || !validLocalTime(time)) return null;
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  const desired = Date.UTC(year, month - 1, day, hour, minute);
  let guess = desired;
  for (let index = 0; index < 6; index += 1) {
    const local = zonedParts(new Date(guess), timeZone);
    const observed = Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute);
    const delta = desired - observed;
    guess += delta;
    if (delta === 0) break;
  }
  const result = new Date(guess);
  const actual = zonedParts(result, timeZone);
  if (actual.year !== year || actual.month !== month || actual.day !== day ||
      actual.hour !== hour || actual.minute !== minute) return null;
  return result;
}

export function idempotencyKey(ruleId, classDate, action, revision = 1) {
  return ["demo", String(ruleId), String(classDate), String(action), String(revision)].join(":");
}

export function reminderSchedule(classDate, startAt, timeZone = COORDINATOR_TIME_ZONE, now = new Date()) {
  const current = new Date(now);
  const start = new Date(startAt);
  if (!validLocalDate(classDate) || !Number.isFinite(start.getTime()) || !Number.isFinite(current.getTime())) {
    return { jobs: [], skipped: ["invalid_schedule"] };
  }
  const jobs = [];
  const skipped = [];
  const noon = zonedTimeToUtc(classDate, "12:00", timeZone);
  if (noon && noon > current) jobs.push({ jobType: "noon_reminder", runAt: noon });
  else skipped.push("noon_window_passed");

  const preclass = new Date(start.getTime() - 60 * 60 * 1000);
  if (preclass > current) jobs.push({ jobType: "preclass_reminder", runAt: preclass });
  else skipped.push("preclass_window_passed");
  return { jobs, skipped };
}

export function retryDelayMs(attempt) {
  const safeAttempt = Number.isInteger(Number(attempt)) ? Math.max(1, Number(attempt)) : 1;
  return Math.min(30 * 60 * 1000, 30 * 1000 * (2 ** (safeAttempt - 1)));
}
