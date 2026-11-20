const SOURCE = "arya-whatsapp-web-local-agent";
const MAX_QUEUE = 500;
let flushing = false;
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

function normalized(value) {
  return String(value || "").normalize("NFC").replace(/\s+/g, " ").trim().toLocaleLowerCase("tr-TR");
}

function setBadge(text, color) {
  chrome.action.setBadgeText({ text: text || "" });
  if (color) chrome.action.setBadgeBackgroundColor({ color });
}

async function digestHex(value) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
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

async function enqueue(message) {
  const settings = await config();
  const allowed = new Set((settings.allowedChats || []).map(normalized));
  if (!allowed.has("*") && !allowed.has(normalized(message.chatName))) return { ok: true, skipped: true };
  const saved = await storageGet(["queue"]);
  const queue = Array.isArray(saved.queue) ? saved.queue : [];
  if (queue.some((item) => item.messageId === message.messageId)) return { ok: true, duplicate: true };
  if (queue.length >= MAX_QUEUE) {
    setBadge("!", "#9c3b3b");
    return { ok: false, overflow: true };
  }
  queue.push(message);
  await storageSet({ queue });
  await flushQueue();
  return { ok: true, queued: true };
}

async function flushQueue() {
  if (flushing) return;
  flushing = true;
  try {
    const settings = await config();
    const endpoint = String(settings.endpoint || "").replace(/\/+$/, "");
    const queueState = await storageGet(["queue"]);
    const queue = Array.isArray(queueState.queue) ? queueState.queue : [];
    if (!/^https:\/\/arya-whatsapp-panel\.vercel\.app$/.test(endpoint) || !settings.secret || settings.secret.length < 32 || !settings.allowedChats?.length) {
      setBadge("!", "#9c3b3b");
      return;
    }
    if (!queue.length) {
      setBadge("", null);
      return;
    }
    const batch = queue.slice(0, 20);
    const payload = { source: SOURCE, agent_id: settings.agentId, messages: batch };
    const serialized = JSON.stringify(payload);
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = await sign(timestamp, serialized, settings.secret);
    const response = await fetch(endpoint + "/api/local-whatsapp-ingest", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Arya-Timestamp": timestamp, "X-Arya-Signature": signature },
      body: serialized,
      signal: AbortSignal.timeout(15000)
    });
    if (!response.ok) {
      setBadge("!", "#9c3b3b");
      return;
    }
    const accepted = new Set(batch.map((item) => item.messageId));
    const latest = await storageGet(["queue"]);
    const remaining = (latest.queue || []).filter((item) => !accepted.has(item.messageId));
    await storageSet({ queue: remaining });
    setBadge(remaining.length ? String(Math.min(remaining.length, 99)) : "", "#287a5d");
  } catch {
    setBadge("!", "#9c3b3b");
  } finally {
    flushing = false;
  }
}

function ensurePollAlarm() { chrome.alarms.create("arya-local-whatsapp-flush", { periodInMinutes: 1 }); }
chrome.runtime.onInstalled.addListener(ensurePollAlarm);
chrome.runtime.onStartup.addListener(ensurePollAlarm);
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "arya-local-whatsapp-flush") {
    flushQueue();
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
    config().then((settings) => sendResponse({ allowedChats: settings.allowedChats || [], configured: Boolean(settings.endpoint && settings.secret) }))
      .catch(() => sendResponse({ allowedChats: [], configured: false }));
    return true;
  }
  if (message.type === "ARYA_INBOUND_MESSAGE") {
    enqueue(message.payload).then(sendResponse).catch(() => sendResponse({ ok: false }));
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
        flushQueue();
      }).catch(() => sendResponse({ ok: false }));
    }).catch(() => sendResponse({ ok: false }));
    return true;
  }
  if (message.type === "ARYA_FLUSH_QUEUE") {
    flushQueue().then(() => sendResponse({ ok: true })).catch(() => sendResponse({ ok: false }));
    return true;
  }
  if (message.type === "ARYA_POLL_OUTBOX") {
    pollOutbox().then(() => sendResponse({ ok: true })).catch(() => sendResponse({ ok: false }));
    return true;
  }
});
