import test from "node:test";
import assert from "node:assert/strict";
import handler from "../api/teacher-confirm.js";
import { setAdminSession } from "../lib/auth.js";

function response() {
  return {
    headers: {},
    statusCode: 200,
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
  };
}

function request(method, body, authenticated = true, origin = "https://arya.test") {
  const headers = { host: "arya.test", origin, "x-forwarded-for": "198.51.100.44" };
  if (authenticated) {
    const res = response();
    setAdminSession(res);
    headers.cookie = res.headers["Set-Cookie"].split(";")[0];
  }
  return { method, headers, body };
}

test("Arya admin session protects the synthetic fixture list", async () => {
  process.env.ARYA_ADMIN_PASSWORD = "unit-test-password";
  process.env.ARYA_SESSION_SECRET = "unit-test-session-secret-with-at-least-thirty-two-characters";
  const res = response();
  await handler(request("GET"), res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.fixtures.length, 6);
  assert.equal(res.body.fixtures[0].id, "explicit-confirm");
});

test("unauthenticated requests are rejected", async () => {
  process.env.ARYA_ADMIN_PASSWORD = "unit-test-password";
  process.env.ARYA_SESSION_SECRET = "unit-test-session-secret-with-at-least-thirty-two-characters";
  const res = response();
  await handler(request("GET", null, false), res);
  assert.equal(res.statusCode, 401);
});

test("free-form reply payloads and cross-origin requests are rejected", async () => {
  process.env.ARYA_ADMIN_PASSWORD = "unit-test-password";
  process.env.ARYA_SESSION_SECRET = "unit-test-session-secret-with-at-least-thirty-two-characters";
  const badBody = response();
  await handler(request("POST", { fixture_id: "uncertain", teacher_reply: "real message" }), badBody);
  assert.equal(badBody.statusCode, 400);
  const badOrigin = response();
  await handler(request("POST", { fixture_id: "explicit-confirm" }, true, "https://other.test"), badOrigin);
  assert.equal(badOrigin.statusCode, 403);
});

test("confirmed scenario creates an unsent draft and never enables sending", async () => {
  process.env.ARYA_ADMIN_PASSWORD = "unit-test-password";
  process.env.ARYA_SESSION_SECRET = "unit-test-session-secret-with-at-least-thirty-two-characters";
  delete process.env.OPENAI_API_KEY;
  const res = response();
  await handler(request("POST", { fixture_id: "explicit-confirm" }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.decision, "confirmed");
  assert.equal(res.body.sent, false);
  assert.equal(res.body.sending_enabled, false);
  assert.match(res.body.student_draft, /20:00/);
});

test("uncertain scenario without API key requires human review and has no draft", async () => {
  process.env.ARYA_ADMIN_PASSWORD = "unit-test-password";
  process.env.ARYA_SESSION_SECRET = "unit-test-session-secret-with-at-least-thirty-two-characters";
  delete process.env.OPENAI_API_KEY;
  const res = response();
  await handler(request("POST", { fixture_id: "uncertain" }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.decision, "needs_human_review");
  assert.equal(res.body.student_draft, null);
  assert.equal(res.body.sending_enabled, false);
});
