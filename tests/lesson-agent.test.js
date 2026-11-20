import test from "node:test";
import assert from "node:assert/strict";
import { acknowledge, claimJob } from "../lib/lesson-agent-queue.js";
import { agentApiEnabled, agentTokenConfigured, authorizedAgentRequest } from "../lib/lesson-agent-auth.js";

test("agent API is hidden in Production even without agent credentials", async () => {
  assert.equal(agentApiEnabled({ VERCEL_ENV: "production" }), false);
  assert.equal(agentTokenConfigured({}), false);
});

test("agent API requires a separate Preview bearer token", async () => {
  const env = { VERCEL_ENV: "preview", DERS_AGENT_TOKEN: "g".repeat(48) };
  assert.equal(agentApiEnabled(env), true);
  assert.equal(agentTokenConfigured(env), true);
  assert.equal(authorizedAgentRequest("Bearer " + env.DERS_AGENT_TOKEN, env.DERS_AGENT_TOKEN), true);
  assert.equal(authorizedAgentRequest("Bearer wrong", env.DERS_AGENT_TOKEN), false);
  assert.equal(authorizedAgentRequest(env.DERS_AGENT_TOKEN, env.DERS_AGENT_TOKEN), false);
});

test("atomic claim query uses row locking, expired-lease recovery, and send-disabled guards", async () => {
  let query = "";
  const db = { async query(sql) { query = sql; return [{ job: null }]; } };
  assert.equal(await claimJob(db, "fake-agent-01"), null);
  assert.match(query, /FOR UPDATE SKIP LOCKED/);
  assert.match(query, /lease_until < NOW\(\)/);
  assert.match(query, /id NOT IN \(SELECT id FROM expired\)/);
  assert.match(query, /agent_lease_expired_dead_letter/);
  assert.match(query, /send_enabled = false/);
});

test("retry acknowledgement reports computed backoff and never marks a send", async () => {
  const calls = [];
  const db = { async query(sql, params) {
    calls.push({ sql, params });
    if (sql.includes("WITH changed AS")) return [{ job_id: "33333333-3333-4333-8333-333333333333", occurrence_id: "22222222-2222-4222-8222-222222222222", status: "retry_wait", retry_after_ms: "60000" }];
    return [];
  } };
  const result = await acknowledge(db, "fake-agent-01", {
    job_id: "33333333-3333-4333-8333-333333333333", outcome: "retry", error_code: "timeout"
  });
  assert.equal(result.status, "retry_wait");
  assert.equal(result.retry_after_ms, 60_000);
  assert.equal(result.sent, false);
  assert.equal(result.sending_enabled, false);
  assert.match(calls[0].sql, /POWER\(2/);
  assert.match(calls[0].sql, /lease_owner = \$2/);
  assert.ok(calls.some(({ sql }) => sql.includes("INSERT INTO coord_events")));
});

test("dead-letter acknowledgement is bounded and has no retry delay", async () => {
  const db = { async query(sql) {
    if (sql.includes("WITH changed AS")) return [{ job_id: "33333333-3333-4333-8333-333333333333", occurrence_id: "22222222-2222-4222-8222-222222222222", status: "dead_letter", retry_after_ms: "0" }];
    return [];
  } };
  const result = await acknowledge(db, "fake-agent-01", {
    job_id: "33333333-3333-4333-8333-333333333333", outcome: "failed", error_code: "simulated_failure"
  });
  assert.equal(result.status, "dead_letter");
  assert.equal(result.retry_after_ms, 0);
  assert.equal(result.sent, false);
});
