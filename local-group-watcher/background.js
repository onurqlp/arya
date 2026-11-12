const SOURCE = "arya-local-group-watcher";
const MAX_QUEUE = 500;
let flushing = false;

function getStorage(keys) {
  return new Promise((resolve) => chrome.storage.local.get(keys, resolve));
}

function setStorage(value) {
  return new Promise((resolve) => chrome.storage.local.set(value, resolve));
}

function normalized(value) {
  return String(value || "").trim().toLocaleLowerCase("tr-TR");
}

function digestHex(value) {
  return crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))
    .then((buffer) => Array.from(new Uint8Array(buffer), (byte) => byte.toString(16).padStart(2, "0")).join(""));
}

function setBadge(text, color) {
  chrome.action.setBadgeText({ text: text || "" });
  if (color) chrome.action.setBadgeBackgroundColor({ color });
}

async function settings() {
  const result = await getStorage(["settings"]);
  return result.settings || {};
}

async function signedPost(endpoint, secret, payload) {
  const body = JSON.stringify(payload);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(timestamp + "." + body)
  );
  const hex = Array.from(new Uint8Array(signature), (byte) => byte.toString(16).padStart(2, "0")).join("");
  return fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Arya-Timestamp": timestamp,
      "X-Arya-Signature": hex
    },
    body
  });
}

async function setBaseline(groupName, preview) {
  const signature = await digestHex(groupName + "\n" + preview);
  const result = await getStorage(["state"]);
  const state = result.state || { last: {}, queue: [] };
  state.last = state.last || {};
  state.queue = state.queue || [];
  state.last[groupName] = signature;
  await setStorage({ state });
  return { ok: true, baseline: true };
}

async function enqueuePreview(message) {
  const config = await settings();
  const allowed = new Set((config.groups || []).map(normalized));
  if (!allowed.has(normalized(message.groupName))) return { ok: true, skipped: true };

  const previewSignature = await digestHex(message.groupName + "\n" + message.preview);
  const stored = await getStorage(["state"]);
  const state = stored.state || { last: {}, queue: [] };
  state.last = state.last || {};
  state.queue = state.queue || [];

  if (message.baseline) {
    state.last[message.groupName] = previewSignature;
    await setStorage({ state });
    return { ok: true, baseline: true };
  }
  if (!message.preview || state.last[message.groupName] === previewSignature) {
    return { ok: true, skipped: true };
  }

  state.last[message.groupName] = previewSignature;
  const messageId = "webpreview:" + await digestHex(
    message.groupName + "\n" + message.preview + "\n" + String(Date.now()) + "\n" + crypto.randomUUID()
  );
  state.queue.push({
    messageId,
    groupName: message.groupName,
    body: message.preview.slice(0, 3000),
    senderName: "WhatsApp Web grup önizlemesi",
    messageTime: new Date().toISOString()
  });
  if (state.queue.length > MAX_QUEUE) state.queue.splice(0, state.queue.length - MAX_QUEUE);
  await setStorage({ state });
  await flushQueue();
  return { ok: true, queued: true };
}

async function flushQueue() {
  if (flushing) return;
  flushing = true;
  try {
    const config = await settings();
    const endpoint = String(config.endpoint || "").replace(/\/+$/, "") + "/api/local-group-ingest";
    if (!/^https:\/\//.test(endpoint) || !config.secret || config.secret.length < 32 || !(config.groups || []).length) {
      setBadge("!", "#9c3b3b");
      return;
    }

    while (true) {
      const stored = await getStorage(["state"]);
      const state = stored.state || { last: {}, queue: [] };
      const queue = state.queue || [];
      if (!queue.length) {
        setBadge("", null);
        break;
      }
      const groupName = queue[0].groupName;
      const batch = queue.filter((item) => item.groupName === groupName).slice(0, 10);
      const payload = {
        source: SOURCE,
        groupName,
        messages: batch.map((item) => ({
          messageId: item.messageId,
          body: item.body,
          senderName: item.senderName,
          messageTime: item.messageTime
        }))
      };
      const response = await signedPost(endpoint, config.secret, payload);
      if (!response.ok) {
        setBadge("!", "#9c3b3b");
        break;
      }
      const ids = new Set(batch.map((item) => item.messageId));
      const latest = await getStorage(["state"]);
      const nextState = latest.state || { last: {}, queue: [] };
      nextState.queue = (nextState.queue || []).filter((item) => !ids.has(item.messageId));
      await setStorage({ state: nextState });
      setBadge("✓", "#287a5d");
    }
  } catch {
    setBadge("!", "#9c3b3b");
  } finally {
    flushing = false;
  }
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create("arya-group-flush", { periodInMinutes: 1 });
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "arya-group-flush") flushQueue();
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || typeof message !== "object") return;
  if (message.type === "GET_GROUP_SETTINGS") {
    settings().then((config) => sendResponse({
      groups: config.groups || [],
      configured: Boolean(config.endpoint && config.secret)
    })).catch(() => sendResponse({ groups: [], configured: false }));
    return true;
  }
  if (message.type === "GROUP_PREVIEW") {
    const action = message.baseline
      ? setBaseline(message.groupName, message.preview)
      : enqueuePreview(message);
    action.then(sendResponse).catch(() => sendResponse({ ok: false }));
    return true;
  }
  if (message.type === "SAVE_SETTINGS") {
    const groups = Array.isArray(message.groups)
      ? [...new Set(message.groups.map((value) => String(value).trim()).filter(Boolean))]
      : [];
    const value = {
      endpoint: String(message.endpoint || "").trim(),
      secret: String(message.secret || "").trim(),
      groups
    };
    setStorage({ settings: value }).then(() => {
      setBadge("✓", "#287a5d");
      sendResponse({ ok: true });
      flushQueue();
    }).catch(() => sendResponse({ ok: false }));
    return true;
  }
  if (message.type === "FLUSH_QUEUE") {
    flushQueue().then(() => sendResponse({ ok: true })).catch(() => sendResponse({ ok: false }));
    return true;
  }
});
