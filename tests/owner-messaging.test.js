import test from "node:test";
import assert from "node:assert/strict";
import { generateOwnerCode, handleOwnerMessage, normalizeWhatsAppId, notifyOwnersForApproval, ownerIdsFromEnvironment, parseOwnerCommand } from "../lib/owner-messaging.js";
import { sendApprovedReply } from "../lib/approval-send.js";
import { createAutomaticReview } from "../lib/reviews.js";

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
  assert.deepEqual(parseOwnerCommand("CEVAP 1A2B3C4D: Pazartesi günü başlayabilirsiniz."), {
    action: "answer", code: "1A2B3C4D", answer: "Pazartesi günü başlayabilirsiniz.",
  });
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

test("clear Asya-style replies are sent to the customer automatically", async () => {
  const envKeys = ["OPENAI_API_KEY", "OPENAI_MODEL", "META_ACCESS_TOKEN", "META_PHONE_NUMBER_ID", "META_GRAPH_API_VERSION", "ARYA_OWNER_WA_IDS"];
  const previous = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
  const previousFetch = globalThis.fetch;
  Object.assign(process.env, {
    OPENAI_API_KEY: "sk-test-key12345678",
    OPENAI_MODEL: "gpt-6-luna",
    META_ACCESS_TOKEN: "meta-test-token",
    META_PHONE_NUMBER_ID: "phone-id",
    META_GRAPH_API_VERSION: "v27.0",
    ARYA_OWNER_WA_IDS: "905321112233,905322223344",
  });
  const customer = "905399998877";
  const incoming = { messageId: "wamid.in.auto", senderId: customer, senderName: "Müşteri", body: "A1 kurs ücreti nedir?", conversationId: `phone-id:${customer}`, messageTime: new Date().toISOString() };
  const stored = { message_id: incoming.messageId, conversation_id: incoming.conversationId, sender_id: incoming.senderId, sender_name: incoming.senderName, body: incoming.body, message_time: incoming.messageTime, message_type: "text" };
  let approval;
  const calls = [];
  const db = { query: async (sql, params = []) => {
    if (sql.includes("WHERE source_message_ids @>")) return [];
    if (sql.includes("SELECT message_id, conversation_id")) return [stored];
    if (sql.includes("INSERT INTO arya_approvals")) {
      approval = { id: params[0], owner_code: params[1], source_message_ids: JSON.parse(params[2]), analysis_text: params[3], reply_text: params[4], status: params[5], requires_owner_answer: params[7] };
      return [{ id: approval.id, owner_code: approval.owner_code, status: approval.status }];
    }
    if (sql.includes("SELECT id, source_message_ids, reply_text, status")) return [approval];
    if (sql.includes("WHERE message_id = ANY")) return [{ conversation_id: incoming.conversationId, sender_id: customer }];
    if (sql.includes("SELECT MAX(message_time) AS latest_inbound_at")) return [{ latest_inbound_at: new Date().toISOString() }];
    if (sql.includes("UPDATE arya_approvals SET status = 'sending'")) return [{ id: approval.id }];
    return [];
  } };
  globalThis.fetch = async (url, options) => {
    const body = JSON.parse(options.body);
    calls.push({ url: String(url), body });
    if (String(url).includes("api.openai.com")) {
      const request = body;
      assert.equal(request.model, "gpt-6-luna");
      assert.equal(request.reasoning.effort, "low");
      return { ok: true, json: async () => ({ output_text: JSON.stringify({ summary: "A1 kurs ücretini soruyor.", reply_draft: "A1 kursumuzun ücreti bilgi tabanındaki güncel tutardır.", risk_notes: [] }) }) };
    }
    return { ok: true, json: async () => ({ messages: [{ id: "wamid.auto.reply" }] }) };
  };
  try {
    const result = await createAutomaticReview(db, incoming);
    assert.equal(result.autoSent, true);
    assert.equal(result.escalated, false);
    assert.equal(calls.length, 2);
    assert.equal(calls[1].body.to, customer);
    assert.equal(calls[1].body.text.body, "A1 kursumuzun ücreti bilgi tabanındaki güncel tutardır.");
  } finally {
    globalThis.fetch = previousFetch;
    for (const [key, value] of Object.entries(previous)) value === undefined ? delete process.env[key] : process.env[key] = value;
  }
});

test("uncertain answers are sent to owners, not the customer", async () => {
  const envKeys = ["OPENAI_API_KEY", "OPENAI_MODEL", "META_ACCESS_TOKEN", "META_PHONE_NUMBER_ID", "META_GRAPH_API_VERSION", "ARYA_OWNER_WA_IDS"];
  const previous = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
  const previousFetch = globalThis.fetch;
  const owners = ["905321112233", "905322223344"];
  Object.assign(process.env, {
    OPENAI_API_KEY: "sk-test-key12345678", OPENAI_MODEL: "gpt-6-luna", META_ACCESS_TOKEN: "meta-test-token",
    META_PHONE_NUMBER_ID: "phone-id", META_GRAPH_API_VERSION: "v27.0", ARYA_OWNER_WA_IDS: owners.join(","),
  });
  const customer = "905399998877";
  const incoming = { messageId: "wamid.in.uncertain", senderId: customer, senderName: "Müşteri", body: "Yarın akşamki grubunuzda yer var mı?", conversationId: `phone-id:${customer}`, messageTime: new Date().toISOString() };
  const stored = { message_id: incoming.messageId, conversation_id: incoming.conversationId, sender_id: incoming.senderId, sender_name: incoming.senderName, body: incoming.body, message_time: incoming.messageTime, message_type: "text" };
  let approval;
  const calls = [];
  const db = { query: async (sql, params = []) => {
    if (sql.includes("WHERE source_message_ids @>")) return [];
    if (sql.includes("SELECT message_id, conversation_id")) return [stored];
    if (sql.includes("INSERT INTO arya_approvals")) {
      approval = { id: params[0], owner_code: params[1], source_message_ids: JSON.parse(params[2]), analysis_text: params[3], reply_text: params[4], status: params[5], requires_owner_answer: params[7] };
      return [{ id: approval.id, owner_code: approval.owner_code, status: approval.status }];
    }
    if (sql.includes("UPDATE arya_approvals SET owner_notification_status = 'sending'")) return [{ id: approval.id }];
    if (sql.includes("SELECT sender_id, last_inbound_at")) return owners.map((sender_id) => ({ sender_id, last_inbound_at: new Date().toISOString() }));
    return [];
  } };
  globalThis.fetch = async (url, options) => {
    const body = JSON.parse(options.body);
    calls.push({ url: String(url), body });
    if (String(url).includes("api.openai.com")) {
      return { ok: true, json: async () => ({ output_text: JSON.stringify({ summary: "Yarınki grubun doluluk durumunu soruyor.", reply_draft: "Kontenjanı ekiple teyit edip size dönüş yapalım.", risk_notes: ["Yarın akşam grubunun güncel kontenjanı bilinmiyor."] }) }) };
    }
    return { ok: true, json: async () => ({ messages: [{ id: "wamid.owner.alert" }] }) };
  };
  try {
    const result = await createAutomaticReview(db, incoming);
    assert.equal(result.autoSent, false);
    assert.equal(result.escalated, true);
    const sends = calls.filter((call) => call.url.includes("graph.facebook.com"));
    assert.deepEqual(sends.map((call) => call.body.to), owners);
    assert.ok(sends.every((call) => call.body.to !== customer));
    assert.ok(sends[0].body.text.body.includes(`CEVAP ${approval.owner_code}:`));
      assert.equal(approval.requires_owner_answer, true);
  } finally {
    globalThis.fetch = previousFetch;
    for (const [key, value] of Object.entries(previous)) value === undefined ? delete process.env[key] : process.env[key] = value;
  }
});

test("owner CEVAP sends the exact team answer to the customer", async () => {
  const envKeys = ["META_ACCESS_TOKEN", "META_PHONE_NUMBER_ID", "META_GRAPH_API_VERSION", "ARYA_OWNER_WA_IDS"];
  const previous = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
  Object.assign(process.env, {
    META_ACCESS_TOKEN: "meta-test-token", META_PHONE_NUMBER_ID: "phone-id", META_GRAPH_API_VERSION: "v27.0",
    ARYA_OWNER_WA_IDS: "905372435123,905536529331",
  });
  const owner = "905372435123", customer = "905399998877", code = "A1B2C3D4";
  const exactAnswer = "Evet, pazartesi saat 20.00'de başlayabilirsiniz. Ücret 13.500 TL'dir.";
  const sentBodies = [];
  const approval = { id: "approval-answer", owner_code: code, status: "pending", analysis_text: "Güncel grup bilgisi soruyor.", reply_text: "Kontenjanı teyit edin.", requires_owner_answer: true };
  const db = { query: async (sql, params = []) => {
    if (sql.includes("SELECT id, owner_code, status, analysis_text, reply_text")) return [{ ...approval }];
    if (sql.includes("UPDATE arya_approvals SET reply_text")) { approval.status = "approved"; approval.reply_text = params[1]; approval.reviewed_by = params[2]; return [{ id: approval.id }]; }
    if (sql.includes("SELECT id, source_message_ids, reply_text, status")) return [{ id: approval.id, source_message_ids: ["wamid.customer"], reply_text: approval.reply_text, status: approval.status, requires_owner_answer: true, reviewed_by: approval.reviewed_by }];
    if (sql.includes("WHERE message_id = ANY")) return [{ conversation_id: `phone-id:${customer}`, sender_id: customer }];
    if (sql.includes("SELECT MAX(message_time) AS latest_inbound_at")) return [{ latest_inbound_at: new Date().toISOString() }];
    if (sql.includes("UPDATE arya_approvals SET status = 'sending'")) return [{ id: approval.id }];
    return [];
  } };
  try {
    const result = await handleOwnerMessage(db, { senderId: owner, body: `CEVAP ${code}: ${exactAnswer}` }, async (_url, options) => {
      const body = JSON.parse(options.body);
      sentBodies.push(body);
      return { ok: true, json: async () => ({ messages: [{ id: `wamid.sent.${sentBodies.length}` }] }) };
    });
    assert.equal(result.handled, true);
    assert.equal(approval.reply_text, exactAnswer);
    assert.equal(sentBodies[0].to, customer);
    assert.equal(sentBodies[0].text.body, exactAnswer);
    assert.equal(sentBodies[1].to, owner);
  } finally {
    for (const [key, value] of Object.entries(previous)) value === undefined ? delete process.env[key] : process.env[key] = value;
  }
});

test("human-answer-required cases cannot send the AI draft with ONAY", async () => {
  const before = {
    META_ACCESS_TOKEN: process.env.META_ACCESS_TOKEN,
    META_PHONE_NUMBER_ID: process.env.META_PHONE_NUMBER_ID,
    META_GRAPH_API_VERSION: process.env.META_GRAPH_API_VERSION,
    ARYA_OWNER_WA_IDS: process.env.ARYA_OWNER_WA_IDS,
  };
  Object.assign(process.env, {
    META_ACCESS_TOKEN: "meta-test-token", META_PHONE_NUMBER_ID: "phone-id", META_GRAPH_API_VERSION: "v27.0",
    ARYA_OWNER_WA_IDS: "905372435123,905536529331",
  });
  const owner = "905372435123", code = "E1F2A3B4", sentTo = [];
  const db = { query: async (sql) => {
    if (sql.includes("SELECT id, owner_code, status, analysis_text, reply_text")) return [{
      id: "approval-risk", owner_code: code, status: "pending", analysis_text: "Canlı kontenjanı soruyor.",
      reply_text: "Ekibe sorup dönüş yapalım.", requires_owner_answer: true,
    }];
    return [];
  } };
  try {
    const result = await handleOwnerMessage(db, { senderId: owner, body: `ONAY ${code}` }, async (_url, options) => {
      sentTo.push(JSON.parse(options.body).to);
      return { ok: true, json: async () => ({ messages: [{ id: "wamid.owner.notice" }] }) };
    });
    assert.equal(result.handled, true);
    assert.deepEqual(sentTo, [owner]);
  } finally {
    for (const [key, value] of Object.entries(before)) value === undefined ? delete process.env[key] : process.env[key] = value;
  }
});
