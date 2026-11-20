(() => {
  const seen = new Set();
  let allowedChats = new Set();
  let schedules = [];
  let observing = false;

  const clean = (value) => String(value || "").replace(/\s+/g, " ").trim();

  function activeChatName() {
    const title = document.querySelector('[data-testid="conversation-info-header"] span[title]') ||
      document.querySelector('header span[title]');
    return clean(title?.getAttribute("title") || title?.textContent);
  }

  function messageText(node) {
    const textNode = node.querySelector('[data-testid="selectable-text"]');
    return clean(textNode?.innerText || textNode?.textContent).slice(0, 3000);
  }

  function visibleSenderName(node) {
    const raw = node.querySelector("[data-pre-plain-text]")?.getAttribute("data-pre-plain-text") || "";
    const match = raw.match(/^\[[^\]]+\]\s*(.*?):\s*$/);
    const name = clean(match?.[1]);
    if (!name || name.length > 80 || /\d{5,}/.test(name)) return "";
    return name;
  }

  async function hashMessageId(waId) {
    const data = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(waId));
    return "waweb:" + Array.from(new Uint8Array(data), (byte) => byte.toString(16).padStart(2, "0")).join("");
  }

  async function observe(node) {
    const chatName = activeChatName();
    if (!chatName || (!allowedChats.has("*") && !allowedChats.has(chatName.normalize("NFC").toLocaleLowerCase("tr-TR")))) return;
    const chatKey = chatName.normalize("NFC").toLocaleLowerCase("tr-TR");
    const weekday = new Date().toLocaleDateString("en-US", { timeZone: "Europe/Istanbul", weekday: "short" });
    const weekdayNumber = ({ Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 })[weekday];
    const now = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Istanbul", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date());
    const candidatesForChat = schedules.filter((item) => item.enabled &&
      clean(item.teacher_chat_name).normalize("NFC").toLocaleLowerCase("tr-TR") === chatKey &&
      Number(item.weekday) === weekdayNumber && now >= item.checkin_time && now <= item.response_deadline);
    if (candidatesForChat.length !== 1) return;
    const schedule = candidatesForChat[0];
    const candidates = new Set();
    const parentMessage = node.closest?.('[data-id].message-in');
    if (parentMessage) candidates.add(parentMessage);
    if (node.matches?.('[data-id].message-in')) candidates.add(node);
    node.querySelectorAll?.('[data-id].message-in').forEach((item) => candidates.add(item));
    for (const item of candidates) {
      const waId = item.getAttribute("data-id");
      const body = messageText(item);
      if (!waId || !body || seen.has(waId)) continue;
      seen.add(waId);
      if (seen.size > 1000) seen.delete(seen.values().next().value);
      const messageId = await hashMessageId(waId);
      const senderName = visibleSenderName(item);
      const senderMatches = !senderName || senderName.normalize("NFC").toLocaleLowerCase("tr-TR") ===
        clean(schedule.teacher_name).normalize("NFC").toLocaleLowerCase("tr-TR");
      const explicit = /^(?:ok|tamam|evet)[.!?]*$/u.test(body.normalize("NFKC").trim().toLocaleLowerCase("tr-TR"));
      const payload = {
        scheduleId: schedule.id,
        messageId,
        messageTime: new Date().toISOString(),
        decision: senderMatches && explicit ? "confirmed" : "needs_human_review",
        reason: !senderMatches ? "teacher_chat_or_sender_mismatch" : explicit ? "explicit_confirmation" : "non_explicit_reply"
      };
      chrome.runtime.sendMessage({ type: "ARYA_TEACHER_DECISION", payload });
    }
  }

  function composerNode() {
    return document.querySelector('[data-testid="conversation-compose-box-input"]') ||
      document.querySelector('footer [contenteditable="true"][role="textbox"]');
  }

  function outgoingCount(body) {
    return [...document.querySelectorAll('.message-out')].filter((node) =>
      clean(node.querySelector('[data-testid="selectable-text"]')?.innerText || node.innerText) === body).length;
  }

  async function waitFor(predicate, timeoutMs = 5000) {
    const until = Date.now() + timeoutMs;
    while (Date.now() < until) {
      const value = predicate();
      if (value) return value;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    return null;
  }

  function editableText(node, value) {
    node.focus();
    if (node instanceof HTMLInputElement) {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(node, value);
      node.dispatchEvent(new Event("input", { bubbles: true }));
      return clean(node.value);
    }
    document.execCommand("selectAll", false);
    document.execCommand("insertText", false, value);
    return clean(node.innerText || node.textContent);
  }

  async function openExactChat(target) {
    const current = activeChatName().normalize("NFC").toLocaleLowerCase("tr-TR");
    const wanted = clean(target).normalize("NFC").toLocaleLowerCase("tr-TR");
    if (current === wanted) return true;
    const searchButton = document.querySelector('[data-testid="chat-list-search"]') ||
      [...document.querySelectorAll('button,[role="button"]')].find((node) =>
        /search|ara/i.test((node.getAttribute("aria-label") || "") + " " + (node.getAttribute("title") || "")));
    if (!searchButton) return false;
    searchButton.click();
    const searchBox = await waitFor(() => [...document.querySelectorAll('[contenteditable="true"][role="textbox"], input[role="searchbox"], input')]
      .find((node) => /search|ara/i.test((node.getAttribute("aria-label") || "") + " " + (node.getAttribute("placeholder") || ""))));
    if (!searchBox) return false;
    const entered = editableText(searchBox, target);
    if (entered.normalize("NFC").toLocaleLowerCase("tr-TR") !== wanted) return false;
    const result = await waitFor(() => [...document.querySelectorAll('[data-testid="cell-frame-container"],[role="gridcell"],[role="listitem"]')]
      .find((node) => [...node.querySelectorAll('[title]')].some((titleNode) =>
        clean(titleNode.getAttribute("title")).normalize("NFC").toLocaleLowerCase("tr-TR") === wanted)));
    if (!result) return false;
    result.click();
    const opened = await waitFor(() => activeChatName().normalize("NFC").toLocaleLowerCase("tr-TR") === wanted, 7000);
    return Boolean(opened);
  }

  async function sendToActiveExactChat(job) {
    const settings = await new Promise((resolve) => chrome.runtime.sendMessage({ type: "ARYA_GET_CONFIG" }, resolve));
    const allowed = new Set((settings?.allowedChats || []).map((name) => clean(name).normalize("NFC").toLocaleLowerCase("tr-TR")));
    if (!job || (!allowed.has("*") && !allowed.has(clean(job.chat_name).normalize("NFC").toLocaleLowerCase("tr-TR")))) {
      return { outcome: "blocked", error_code: "chat_not_allowlisted" };
    }
    if (!await openExactChat(job.chat_name)) return { outcome: "blocked", error_code: "exact_chat_not_found" };
    const composer = composerNode();
    const sendButton = document.querySelector('[data-testid="send"]') || document.querySelector('footer button[aria-label="Send"], footer button[aria-label="Gönder"]');
    if (!composer || !sendButton || typeof job.body !== "string" || !job.body.trim() || job.body.length > 3000) {
      return { outcome: "blocked", error_code: "composer_not_ready" };
    }
    const before = outgoingCount(job.body);
    const entered = editableText(composer, job.body);
    if (entered !== clean(job.body)) {
      return { outcome: "blocked", error_code: "draft_verification_failed" };
    }
    // Re-check the exact group immediately before the single send click.
    if (activeChatName().normalize("NFC").toLocaleLowerCase("tr-TR") !== clean(job.chat_name).normalize("NFC").toLocaleLowerCase("tr-TR")) {
      return { outcome: "blocked", error_code: "active_chat_changed" };
    }
    sendButton.click();
    const deadline = Date.now() + 9000;
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 300));
      if (outgoingCount(job.body) > before) return { outcome: "sent" };
    }
    return { outcome: "uncertain", error_code: "outgoing_bubble_not_observed" };
  }

  function start() {
    chrome.runtime.sendMessage({ type: "ARYA_GET_CONFIG" }, (reply) => {
      allowedChats = new Set((reply?.allowedChats || []).map((name) => clean(name).normalize("NFC").toLocaleLowerCase("tr-TR")));
      schedules = Array.isArray(reply?.schedules) ? reply.schedules : [];
      if (observing || !document.body) return;
      observing = true;
      // Baseline all already-rendered messages so refresh does not backfill chat history.
      document.querySelectorAll('[data-id].message-in').forEach((node) => {
        const id = node.getAttribute("data-id");
        if (id) seen.add(id);
      });
      const observer = new MutationObserver((records) => {
        for (const record of records) for (const node of record.addedNodes) {
          if (node.nodeType === Node.ELEMENT_NODE) observe(node);
        }
      });
      observer.observe(document.body, { childList: true, subtree: true });
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "ARYA_SET_SCHEDULES") {
      schedules = Array.isArray(message.schedules) ? message.schedules : [];
      sendResponse({ ok: true });
      return false;
    }
    if (message?.type !== "ARYA_SEND_OUTBOX_JOB") return;
    sendToActiveExactChat(message.job).then(sendResponse).catch(() => sendResponse({ outcome: "uncertain", error_code: "send_observation_failed" }));
    return true;
  });
})();
