import test from "node:test";
import assert from "node:assert/strict";
import { TEACHER_FIXTURES, classifyFixture, deterministicClassification, validateModelClassification } from "../lib/teacher-classifier.js";

const fixture = id => TEACHER_FIXTURES.find(item => item.id === id);

test("explicit same-time teacher reply is confirmed without model access", async () => {
  const result = await classifyFixture("explicit-confirm", { apiKey: "" });
  assert.equal(result.decision, "confirmed");
  assert.equal(result.proposed_time, "20:00");
  assert.match(result.student_draft, /20:00/);
  assert.equal(result.sent, false);
  assert.equal(result.sending_enabled, false);
});

test("explicit single new time is a reschedule", () => {
  assert.equal(deterministicClassification(fixture("reschedule")).decision, "rescheduled");
  assert.equal(deterministicClassification(fixture("reschedule")).proposed_time, "20:30");
});

test("clear cancellation never creates a student reminder draft", async () => {
  const result = await classifyFixture("cancelled", { apiKey: "" });
  assert.equal(result.decision, "cancelled");
  assert.equal(result.student_draft, null);
});

test("no reply and conflicting times always require human review", () => {
  assert.equal(deterministicClassification(fixture("no-reply")).decision, "needs_human_review");
  assert.equal(deterministicClassification(fixture("contradiction")).decision, "needs_human_review");
});

test("uncertain fixture uses strict JSON Schema Responses API and remains a draft only", async () => {
  let requestBody;
  const fetchImpl = async (_url, options) => {
    requestBody = JSON.parse(options.body);
    return new Response(JSON.stringify({
      status: "completed",
      output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify({ decision: "uncertain", proposed_time: "", evidence: "Öğretmen daha sonra döneceğini söylüyor.", rationale: "Kesin teyit yok." }) }] }]
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  const result = await classifyFixture("uncertain", { apiKey: "test-only", fetchImpl });
  assert.equal(requestBody.store, false);
  assert.equal(requestBody.text.format.type, "json_schema");
  assert.equal(requestBody.text.format.strict, true);
  assert.equal(result.decision, "uncertain");
  assert.equal(result.student_draft, null);
  assert.equal(result.sent, false);
  assert.equal(result.sending_enabled, false);
});

test("model cannot confirm a reply without explicit confirmation evidence", () => {
  const result = validateModelClassification({ decision: "confirmed", proposed_time: "20:00", evidence: "affirmative", rationale: "yes", }, fixture("uncertain"));
  assert.equal(result.decision, "needs_human_review");
});

test("model refusal, invalid schema, and API errors downgrade to human review", async () => {
  const refusalFetch = async () => new Response(JSON.stringify({ status: "completed", output: [{ content: [{ type: "refusal", refusal: "no" }] }] }), { status: 200 });
  const failedFetch = async () => new Response("{}", { status: 503 });
  const malformedFetch = async () => new Response(JSON.stringify({ status: "completed", output_text: "not-json" }), { status: 200 });
  for (const fetchImpl of [refusalFetch, failedFetch, malformedFetch]) {
    const result = await classifyFixture("uncertain", { apiKey: "test-only", fetchImpl });
    assert.equal(result.decision, "needs_human_review");
    assert.equal(result.student_draft, null);
  }
});
