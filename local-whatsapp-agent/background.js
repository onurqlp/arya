const SOURCE = "arya-whatsapp-web-local-agent";
const MAX_DECISIONS = 200;
let flushingDecisions = false;
let pollingOutbox = false;

function storageGet(keys) {
  return new Promise((resolve) => chrome.storage.local.get(keys, resolve));
}

function storageSet(value) {
  return new Promise((resolve) => chrome.storage.local.set(value, resolve));
}

async function config() {
  const result = await storageGet(["config"]);
  return result.config || {};
}

async function sign(timestamp, body, secret) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const result = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(timestamp + "." + body));
  return Array.from(new Uint8Array(result), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function signedAgentRequest(settings, payload) {
  const serialized = JSON.stringify({ source: SOURCE, agent_id: settings.agentId, ...payload });
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = await sign(timestamp, serialized, settings.secret);
  return fetch(settings.endpoint + "/api/local-whatsapp-agent", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Arya-Timestamp": timestamp, "X-Arya-Signature": signature },
    body: serialized,
    signal: AbortSignal.timeout(15000)
  });
}

function setBadge(text, color) {
  chrome.action.setBadgeText({ text: text || "" });
  if (color) chrome.action.setBadgeBackgroundColor({ color });
}

async function enqueueDecision(payload) {
  if (!payload || !/^[0-9a-f-]{36}$/i.test(payload.scheduleId || "") ||
      !/^waweb:[a-f0-9]{64}$/i.test(payload.messageId || "") ||
      !["confirmed", "needs_human_review"].includes(payload.decision) ||
      !["explicit_confirmation", "non_explicit_reply", "teacher_chat_or_sender_mismatch"].includes(payload.reason) ||
      !Number.isFinite(Date.parse(payload.messageTime || ""))) return { ok: false };
  const saved = await storageGet(["decisionQueue"]);
  const queue = Array.isArray(saved.decisionQueue) ? saved.decisionQueue : [];
  if (queue.some((item) => item.messageId === payload.messageId)) return { ok: true, duplicate: true };
  if (queue.length >= MAX_DECISIONS) {
    setBadge("!", "#9c3b3b");
    return { ok: false, overflow: true };
  }
  queue.push({
    scheduleId: payload.scheduleId,
    messageId: payload.messageId,
    messageTime: payload.messageTime,
    decision: payload.decision,
    reason: payload.reason
  });
  await storageSet({ decisionQueue: queue });
  flushDecisions();
  return { ok: true, queued: true };
}

async function flushDecisions() {
  if (flushingDecisions) return;
  flushingDecisions = true;
  let acceptedDecision = false;
  try {
    const settings = await config();
    if (!settings.endpoint || !settings.secret || !settings.agentId) return;
    const saved = await storageGet(["decisionQueue"]);
    const queue = Array.isArray(saved.decisionQueue) ? saved.decisionQueue : [];
    while (queue.length) {
      const event = queue[0];
      let response;
      try {
        response = await signedAgentRequest(settings, { action: "teacher-decision", ...event });
      } catch {
        setBadge("!", "#9c3b3b");
        return;
      }
      if (!response.ok) {
        setBadge("!", "#9c3b3b");
        return;
      }
      acceptedDecision = true;
      queue.shift();
      await storageSet({ decisionQueue: queue });
    }
    setBadge("", null);
  } finally {
    flushingDecisions = false;
  }
  if (acceptedDecision) pollOutbox();
}

function ensurePollAlarm() { chrome.alarms.create("arya-local-whatsapp-agent", { periodInMinutes: 1 }); }
chrome.runtime.onInstalled.addListener(ensurePollAlarm);
chrome.runtime.onStartup.addListener(ensurePollAlarm);
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "arya-local-whatsapp-agent") {
    flushDecisions();
    pollOutbox();
  }
});

async function pollOutbox() {
  if (pollingOutbox) return;
  pollingOutbox = true;
  try {
    const settings = await config();
    if (!settings.endpoint || !settings.secret || !settings.agentId) return;
    const tabs = await chrome.tabs.query({ url: "https://web.whatsapp.com/*" });
    const response = await signedAgentRequest(settings, { action: "pull", whatsapp_tab_open: Boolean(tabs.length) });
    if (!response.ok) { setBadge("!", "#9c3b3b"); return; }
    const result = await response.json().catch(() => ({}));
    await storageSet({ schedules: Array.isArray(result.schedules) ? result.schedules : [] });
    const localState = await storageGet(["checkinBaselines"]);
    const checkinBaselines = localState.checkinBaselines && typeof localState.checkinBaselines === "object" ? localState.checkinBaselines : {};
    for (const tab of tabs) {
      chrome.tabs.sendMessage(tab.id, { type: "ARYA_SET_SCHEDULES", schedules: result.schedules || [], checkinBaselines }).catch(() => {});
    }
    if (!result.job) return;
    const tab = tabs[0];
    if (!tab?.id) {
      await signedAgentRequest(settings, { action: "ack", job_id: result.job.id, outcome: "blocked", error_code: "whatsapp_tab_not_active" });
      setBadge("!", "#9c3b3b");
      return;
    }
    let outcome;
    try {
      outcome = await chrome.tabs.sendMessage(tab.id, { type: "ARYA_SEND_OUTBOX_JOB", job: result.job });
    } catch {
      outcome = { outcome: "uncertain", error_code: "tab_response_missing" };
    }
    const ack = await signedAgentRequest(settings, { action: "ack", job_id: result.job.id,
      outcome: ["sent", "uncertain", "blocked"].includes(outcome?.outcome) ? outcome.outcome : "uncertain",
      ...(outcome?.error_code ? { error_code: outcome.error_code } : {}) });
    if (!ack.ok || outcome?.outcome !== "sent") setBadge("!", "#9c3b3b");
  } catch {
    setBadge("!", "#9c3b3b");
  } finally {
    pollingOutbox = false;
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || typeof message !== "object") return;
  if (message.type === "ARYA_GET_CONFIG") {
    storageGet(["schedules", "checkinBaselines"]).then(async (saved) => {
      const settings = await config();
      sendResponse({
        allowedChats: settings.allowedChats || [],
        schedules: Array.isArray(saved.schedules) ? saved.schedules : [],
        checkinBaselines: saved.checkinBaselines && typeof saved.checkinBaselines === "object" ? saved.checkinBaselines : {},
        configured: Boolean(settings.endpoint && settings.secret)
      });
    }).catch(() => sendResponse({ allowedChats: [], schedules: [], checkinBaselines: {}, configured: false }));
    return true;
  }
  if (message.type === "ARYA_TEACHER_DECISION") {
    enqueueDecision(message.payload).then(sendResponse).catch(() => sendResponse({ ok: false }));
    return true;
  }
  if (message.type === "ARYA_SAVE_CHECKIN_BASELINE") {
    if (!/^[0-9a-f-]{36}$/i.test(message.scheduleId || "") || !Array.isArray(message.messageIds) ||
        message.messageIds.length > 500 || message.messageIds.some((id) => typeof id !== "string" || id.length > 200) ||
        !Number.isFinite(Date.parse(message.sentAt || "")) || typeof message.sent !== "boolean") {
      sendResponse({ ok: false });
      return false;
    }
    storageGet(["checkinBaselines"]).then((saved) => {
      const checkinBaselines = saved.checkinBaselines && typeof saved.checkinBaselines === "object" ? saved.checkinBaselines : {};
      checkinBaselines[message.scheduleId] = { messageIds: [...new Set(message.messageIds)], sentAt: message.sentAt, sent: message.sent };
      return storageSet({ checkinBaselines });
    }).then(() => sendResponse({ ok: true })).catch(() => sendResponse({ ok: false }));
    return true;
  }
  if (message.type === "ARYA_SAVE_CONFIG") {
    const allowedChats = [...new Set((Array.isArray(message.allowedChats) ? message.allowedChats : [])
      .map((item) => String(item).normalize("NFC").replace(/\s+/g, " ").trim()).filter(Boolean))];
    const endpoint = String(message.endpoint || "").replace(/\/+$/, "");
    config().then((existing) => {
      const secret = String(message.secret || "").trim() || String(existing.secret || "");
      if (endpoint !== "https://arya-whatsapp-panel.vercel.app" || secret.length < 32 || !allowedChats.length) {
        sendResponse({ ok: false, error: "invalid_settings" });
        return;
      }
      const agentId = existing.agentId || "arya-local-" + crypto.randomUUID().slice(0, 8);
      storageSet({ config: { endpoint, secret, allowedChats, agentId } }).then(() => {
        sendResponse({ ok: true });
        flushDecisions();
        pollOutbox();
      }).catch(() => sendResponse({ ok: false }));
    }).catch(() => sendResponse({ ok: false }));
    return true;
  }
  if (message.type === "ARYA_POLL_OUTBOX") {
    pollOutbox().then(() => sendResponse({ ok: true })).catch(() => sendResponse({ ok: false }));
    return true;
  }
});
