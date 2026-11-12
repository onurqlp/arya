import test from "node:test";
import assert from "node:assert/strict";
import { generateOwnerCode, normalizeWhatsAppId, notifyOwnersForApproval, ownerIdsFromEnvironment, parseOwnerCommand } from "../lib/owner-messaging.js";
import { sendApprovedReply } from "../lib/approval-send.js";

test("owner allowlist accepts international numbers and removes duplicates", () => {
  assert.deepEqual(ownerIdsFromEnvironment("+90 532 111 22 33, 905321112233;invalid, +1 555 111 2222"), [
    "905321112233",
    "15551112222",
  ]);
  assert.equal(normalizeWhatsAppId("abc"), "");
});

test("private WhatsApp commands parse without case sensitivity", () => {
  assert.deepEqual(parseOwnerCommand("durum"), { action: "status" });
  assert.deepEqual(parseOwnerCommand("Taslak 1A2B3C4D"), { action: "draft", code: "1A2B3C4D" });
  assert.deepEqual(parseOwnerCommand("onay 1a2b3c4d"), { action: "approve", code: "1A2B3C4D" });
  assert.deepEqual(parseOwnerCommand("RED 1A2B3C4D"), { action: "reject", code: "1A2B3C4D" });
  assert.equal(parseOwnerCommand("ONAY ABC").action, "help");
});

test("owner approval codes are 8 uppercase hexadecimal characters", () => {
  assert.match(generateOwnerCode(), /^[A-F0-9]{8}$/);
});

test("approved customer reply is blocked after WhatsApp's 24-hour window", async () => {
  const before = {
    META_ACCESS_TOKEN: process.env.META_ACCESS_TOKEN,
    META_PHONE_NUMBER_ID: process.env.META_PHONE_NUMBER_ID,
    META_GRAPH_API_VERSION: process.env.META_GRAPH_API_VERSION,
  };
  Object.assign(process.env, {
    META_ACCESS_TOKEN: "test-token",
    META_PHONE_NUMBER_ID: "phone-id",
    META_GRAPH_API_VERSION: "v27.0",
  });
  const senderId = "905321112233";
  let fetchCalls = 0;
  const db = { query: async (sql) => {
    if (sql.includes("SELECT id, source_message_ids")) return [{ id: "approval-1", source_message_ids: ["message-1"], reply_text: "Merhaba", status: "approved" }];
    if (sql.includes("WHERE message_id = ANY")) return [{ conversation_id: `phone-id:${senderId}`, sender_id: senderId, latest_inbound_at: new Date(Date.now() - 25 * 60 * 60 * 1000) }];
    if (sql.includes("WHERE conversation_id = $1")) return [{ latest_inbound_at: new Date(Date.now() - 25 * 60 * 60 * 1000) }];
    throw new Error("Unexpected database query: " + sql);
  } };
  try {
    const outcome = await sendApprovedReply(db, "approval-1", "owner:test", async () => { fetchCalls += 1; });
    assert.equal(outcome.error, "customer_service_window_closed");
    assert.equal(fetchCalls, 0);
  } finally {
    for (const [key, value] of Object.entries(before)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});

test("approval window uses the newest inbound message in that conversation", async () => {
  const before = {
    META_ACCESS_TOKEN: process.env.META_ACCESS_TOKEN,
    META_PHONE_NUMBER_ID: process.env.META_PHONE_NUMBER_ID,
    META_GRAPH_API_VERSION: process.env.META_GRAPH_API_VERSION,
  };
  Object.assign(process.env, {
    META_ACCESS_TOKEN: "test-token",
    META_PHONE_NUMBER_ID: "phone-id",
    META_GRAPH_API_VERSION: "v27.0",
  });
  const senderId = "905321112233";
  const db = { query: async (sql) => {
    if (sql.includes("SELECT id, source_message_ids")) return [{ id: "approval-new", source_message_ids: ["old-message"], reply_text: "Merhaba", status: "approved" }];
    if (sql.includes("WHERE message_id = ANY")) return [{ conversation_id: `phone-id:${senderId}`, sender_id: senderId, latest_inbound_at: new Date(Date.now() - 25 * 60 * 60 * 1000) }];
    if (sql.includes("WHERE conversation_id = $1")) return [{ latest_inbound_at: new Date(Date.now() - 5 * 60 * 1000) }];
    if (sql.includes("UPDATE arya_approvals SET status = 'sending'")) return [{ id: "approval-new" }];
    return [];
  } };
  try {
    const outcome = await sendApprovedReply(db, "approval-new", "owner:test", async (_url, options) => {
      assert.equal(JSON.parse(options.body).to, senderId);
      return { ok: true, json: async () => ({ messages: [{ id: "wamid.latest-window" }] }) };
    });
    assert.equal(outcome.ok, true);
  } finally {
    for (const [key, value] of Object.entries(before)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});

test("owner proactive notification is blocked when no approved-template name is configured", async () => {
  const before = {
    META_ACCESS_TOKEN: process.env.META_ACCESS_TOKEN,
    META_PHONE_NUMBER_ID: process.env.META_PHONE_NUMBER_ID,
    META_GRAPH_API_VERSION: process.env.META_GRAPH_API_VERSION,
    ARYA_OWNER_WA_IDS: process.env.ARYA_OWNER_WA_IDS,
    ARYA_OWNER_NOTIFICATION_TEMPLATE: process.env.ARYA_OWNER_NOTIFICATION_TEMPLATE,
  };
  Object.assign(process.env, {
    META_ACCESS_TOKEN: "test-token",
    META_PHONE_NUMBER_ID: "phone-id",
    META_GRAPH_API_VERSION: "v27.0",
    ARYA_OWNER_WA_IDS: "905321112233",
  });
  delete process.env.ARYA_OWNER_NOTIFICATION_TEMPLATE;
  let fetchCalls = 0;
  const updates = [];
  const db = { query: async (sql) => {
    if (sql.includes("UPDATE arya_approvals")) { updates.push(sql); return [{ id: "approval-3" }]; }
    if (sql.includes("SELECT sender_id, last_inbound_at")) return [];
    return [];
  } };
  try {
    const result = await notifyOwnersForApproval(db, "approval-3", "AB12CD34", "Yeni mesaj", async () => {
      fetchCalls += 1;
      throw new Error("must not send without a template or live owner session");
    });
    assert.equal(result.status, "blocked");
    assert.equal(result.reason, undefined);
    assert.equal(fetchCalls, 0);
    assert.ok(updates.some((sql) => sql.includes("owner_notification_status = 'sending'")));
  } finally {
    for (const [key, value] of Object.entries(before)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});

test("owner approval sends only once and records the provider message", async () => {
  const before = {
    META_ACCESS_TOKEN: process.env.META_ACCESS_TOKEN,
    META_PHONE_NUMBER_ID: process.env.META_PHONE_NUMBER_ID,
    META_GRAPH_API_VERSION: process.env.META_GRAPH_API_VERSION,
  };
  Object.assign(process.env, {
    META_ACCESS_TOKEN: "test-token",
    META_PHONE_NUMBER_ID: "phone-id",
    META_GRAPH_API_VERSION: "v27.0",
  });
  const senderId = "905321112233";
  const seen = [];
  const db = { query: async (sql, params = []) => {
    seen.push(sql);
    if (sql.includes("SELECT id, source_message_ids")) return [{ id: "approval-2", source_message_ids: ["message-2"], reply_text: "Merhaba", status: "approved" }];
    if (sql.includes("MAX(message_time)")) return [{ conversation_id: `phone-id:${senderId}`, sender_id: senderId, latest_inbound_at: new Date().toISOString() }];
    if (sql.includes("UPDATE arya_approvals SET status = 'sending'")) return [{ id: "approval-2" }];
    return [];
  } };
  try {
    const outcome = await sendApprovedReply(db, "approval-2", "owner:test", async (_url, options) => {
      assert.equal(JSON.parse(options.body).to, senderId);
      return { ok: true, json: async () => ({ messages: [{ id: "wamid.test" }] }) };
    });
    assert.equal(outcome.ok, true);
    assert.ok(seen.some((sql) => sql.includes("provider_message_id")));
    assert.ok(seen.some((sql) => sql.includes("message_sent")));
  } finally {
    for (const [key, value] of Object.entries(before)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});
