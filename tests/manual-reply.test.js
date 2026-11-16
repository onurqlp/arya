import test, { afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { sendManualReply } from "../lib/manual-reply.js";

const requestId = "a8c9d1f5-2c74-4b0f-8d6d-e42f826ad9a1";
const conversationId = "12345678901:905551112233";
const savedMetaConfig = {
  accessToken: process.env.META_ACCESS_TOKEN,
  version: process.env.META_GRAPH_API_VERSION,
};

beforeEach(() => {
  process.env.META_ACCESS_TOKEN = "test-token";
  process.env.META_GRAPH_API_VERSION = "v99.0";
});

afterEach(() => {
  if (savedMetaConfig.accessToken === undefined) delete process.env.META_ACCESS_TOKEN;
  else process.env.META_ACCESS_TOKEN = savedMetaConfig.accessToken;
  if (savedMetaConfig.version === undefined) delete process.env.META_GRAPH_API_VERSION;
  else process.env.META_GRAPH_API_VERSION = savedMetaConfig.version;
});

function fakeDb({ latestInboundAt = new Date(Date.now() - 60_000), previous = null } = {}) {
  const calls = [];
  return {
    calls,
    async query(sql, params = []) {
      calls.push({ sql, params });
      if (sql.includes("SELECT MAX(message_time)")) return [{ latest_inbound_at: latestInboundAt }];
      if (sql.includes("SELECT status, provider_message_id")) return previous ? [previous] : [];
      if (sql.includes("INSERT INTO arya_outbound_messages")) return [{ id: params[0] }];
      if (sql.includes("UPDATE arya_outbound_messages")) return [{ id: params[0] }];
      return [];
    },
  };
}

test("sends a manual reply using the phone ID stored with that conversation", async () => {
  const db = fakeDb();
  let sentUrl = "";
  let sentPayload;

  const result = await sendManualReply(db, {
    conversationId,
    text: "Merhaba, size yardımcı olayım.",
    requestId,
  }, async (url, options) => {
    sentUrl = url;
    sentPayload = JSON.parse(options.body);
    return { ok: true, json: async () => ({ messages: [{ id: "wamid.test" }] }) };
  });

  assert.equal(result.ok, true);
  assert.equal(sentUrl, "https://graph.facebook.com/v99.0/12345678901/messages");
  assert.deepEqual(sentPayload, {
    messaging_product: "whatsapp",
    to: "905551112233",
    type: "text",
    text: { preview_url: false, body: "Merhaba, size yardımcı olayım." },
  });
  assert.ok(db.calls.some((call) => call.sql.includes("status = 'sent'")));
});

test("rejects group-shaped conversations before calling Meta", async () => {
  const db = fakeDb();
  let called = false;
  const result = await sendManualReply(db, {
    conversationId: "12345678901:120363000000000000@g.us",
    text: "Merhaba",
    requestId,
  }, async () => { called = true; });
  assert.equal(result.error, "individual_conversation_required");
  assert.equal(called, false);
});

test("keeps replies closed after the 24-hour customer window", async () => {
  const db = fakeDb({ latestInboundAt: new Date(Date.now() - 25 * 60 * 60 * 1000) });
  let called = false;
  const result = await sendManualReply(db, {
    conversationId,
    text: "Merhaba",
    requestId,
  }, async () => { called = true; });
  assert.equal(result.error, "customer_service_window_closed");
  assert.equal(called, false);
  assert.equal(db.calls.some((call) => call.sql.includes("INSERT INTO arya_outbound_messages")), false);
});

test("does not resend a request with an uncertain prior delivery", async () => {
  const db = fakeDb({ previous: { status: "uncertain", provider_message_id: null } });
  let called = false;
  const result = await sendManualReply(db, {
    conversationId,
    text: "Merhaba",
    requestId,
  }, async () => { called = true; });
  assert.equal(result.error, "manual_delivery_uncertain");
  assert.equal(called, false);
});
