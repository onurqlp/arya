(() => {
  const seen = new Set();
  let allowedChats = new Set();
  let schedules = [];
  let checkinBaselines = {};
  let scanningTeachers = false;

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

  function messageTimestamp(node) {
    const raw = node.querySelector("[data-pre-plain-text]")?.getAttribute("data-pre-plain-text") || "";
    const match = raw.match(/^\[(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\s*(AM|PM))?,\s*(\d{1,2})([./])(\d{1,2})[./](\d{2,4})\]/i);
    if (!match) return null;
    let hour = Number(match[1]);
    const minute = Number(match[2]);
    if (match[4]) {
      if (match[4].toUpperCase() === "PM" && hour < 12) hour += 12;
      if (match[4].toUpperCase() === "AM" && hour === 12) hour = 0;
    }
    const first = Number(match[5]), second = Number(match[7]);
    const usOrder = Boolean(match[4]) && match[6] === "/";
    const day = first > 12 ? first : second > 12 ? second : usOrder ? second : first;
    const month = first > 12 ? second : second > 12 ? first : usOrder ? first : second;
    let year = Number(match[8]);
    if (year < 100) year += 2000;
    const secondOfMinute = Number(match[3] || 0);
    const stamp = new Date(`${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:${String(secondOfMinute).padStart(2, "0")}+03:00`);
    return Number.isFinite(stamp.getTime()) ? stamp : null;
  }

  async function reportTeacherMessage(item, schedule, baseline) {
    const waId = item.getAttribute("data-id");
    if (!waId || seen.has(waId) || !Array.isArray(baseline?.messageIds) || baseline.messageIds.includes(waId)) return;
    seen.add(waId);
    if (seen.size > 2000) seen.delete(seen.values().next().value);
    const time = messageTimestamp(item);
    const sentAt = Date.parse(baseline.sentAt);
    const current = new Date();
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Istanbul", year: "numeric", month: "2-digit", day: "2-digit" }).format(current);
    const now = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Istanbul", hour: "2-digit", minute: "2-digit", hour12: false }).format(current);
    const messageDate = time && new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Istanbul", year: "numeric", month: "2-digit", day: "2-digit" }).format(time);
    const inWindow = now >= "09:00" && now <= "12:00" && time &&
      (time.getTime() >= sentAt && messageDate === today && time.getTime() <= current.getTime() + 60_000);
    if (!inWindow) return;
    const body = messageText(item);
    if (!body) return;
    const messageId = await hashMessageId(waId);
    const senderName = visibleSenderName(item);
    const senderMatches = !senderName || senderName.normalize("NFC").toLocaleLowerCase("tr-TR") ===
      clean(schedule.teacher_name).normalize("NFC").toLocaleLowerCase("tr-TR");
    const explicit = /^(?:ok|tamam|evet)[.!?]*$/u.test(body.normalize("NFKC").trim().toLocaleLowerCase("tr-TR"));
    const payload = {
      scheduleId: schedule.id,
      messageId,
      messageTime: time.toISOString(),
      decision: senderMatches && explicit ? "confirmed" : "needs_human_review",
      reason: !senderMatches ? "teacher_chat_or_sender_mismatch" : explicit ? "explicit_confirmation" : "non_explicit_reply"
    };
    chrome.runtime.sendMessage({ type: "ARYA_TEACHER_DECISION", payload });
  }

  async function scanTeacherReplies() {
    if (scanningTeachers) return;
    scanningTeachers = true;
    try {
      const weekday = new Date().toLocaleDateString("en-US", { timeZone: "Europe/Istanbul", weekday: "short" });
      const weekdayNumber = ({ Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 })[weekday];
      const now = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Istanbul", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date());
      if (now < "09:00" || now > "12:00") return;
      const due = schedules.filter((item) => item.enabled && Number(item.weekday) === weekdayNumber &&
        clean(item.checkin_time) === "09:00" && clean(item.response_deadline) === "12:00" &&
        checkinBaselines[item.id]?.sent === true);
      for (const schedule of due) {
        if (!allowedChats.has("*") && !allowedChats.has(clean(schedule.teacher_chat_name).normalize("NFC").toLocaleLowerCase("tr-TR"))) continue;
        if (!await openExactChat(schedule.teacher_chat_name)) continue;
        const chatKey = clean(activeChatName()).normalize("NFC").toLocaleLowerCase("tr-TR");
        const sameChat = due.filter((item) => clean(item.teacher_chat_name).normalize("NFC").toLocaleLowerCase("tr-TR") === chatKey);
        const baseline = checkinBaselines[schedule.id];
        const messages = [...document.querySelectorAll('[data-id].message-in')];
        for (const item of messages) {
          if (sameChat.length !== 1) {
            const waId = item.getAttribute("data-id");
            if (!waId || seen.has(waId) || !Array.isArray(baseline?.messageIds) || baseline.messageIds.includes(waId)) continue;
            seen.add(waId);
            const time = messageTimestamp(item);
            const messageDate = time && new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Istanbul", year: "numeric", month: "2-digit", day: "2-digit" }).format(time);
            const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Istanbul", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
            if (!time || Date.parse(baseline.sentAt) > time.getTime() || messageDate !== today) continue;
            chrome.runtime.sendMessage({ type: "ARYA_TEACHER_DECISION", payload: {
              scheduleId: schedule.id, messageId: await hashMessageId(waId), messageTime: time.toISOString(),
              decision: "needs_human_review", reason: "teacher_chat_or_sender_mismatch"
            }});
            continue;
          }
          await reportTeacherMessage(item, schedule, baseline);
        }
      }
    } finally {
      scanningTeachers = false;
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
    let baseline = null;
    if (job.job_type === "teacher_confirmation" && /^[0-9a-f-]{36}$/i.test(job.schedule_id || "")) {
      const baselineMinute = new Date();
      baselineMinute.setSeconds(0, 0);
      baseline = {
        scheduleId: job.schedule_id,
        messageIds: [...document.querySelectorAll('[data-id].message-in')].map((node) => node.getAttribute("data-id")).filter(Boolean).slice(-500),
        sentAt: baselineMinute.toISOString(),
        sent: false
      };
      const saved = await new Promise((resolve) => chrome.runtime.sendMessage({ type: "ARYA_SAVE_CHECKIN_BASELINE", ...baseline }, resolve));
      if (!saved?.ok) return { outcome: "blocked", error_code: "teacher_baseline_unavailable" };
      checkinBaselines[job.schedule_id] = baseline;
    }
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
      if (outgoingCount(job.body) > before) {
        if (baseline) {
          baseline = { ...baseline, sent: true };
          const saved = await new Promise((resolve) => chrome.runtime.sendMessage({ type: "ARYA_SAVE_CHECKIN_BASELINE", ...baseline }, resolve));
          if (!saved?.ok) return { outcome: "uncertain", error_code: "teacher_baseline_confirm_failed" };
          checkinBaselines[job.schedule_id] = baseline;
        }
        return { outcome: "sent" };
      }
    }
    return { outcome: "uncertain", error_code: "outgoing_bubble_not_observed" };
  }

  function start() {
    chrome.runtime.sendMessage({ type: "ARYA_GET_CONFIG" }, (reply) => {
      allowedChats = new Set((reply?.allowedChats || []).map((name) => clean(name).normalize("NFC").toLocaleLowerCase("tr-TR")));
      schedules = Array.isArray(reply?.schedules) ? reply.schedules : [];
      checkinBaselines = reply?.checkinBaselines && typeof reply.checkinBaselines === "object" ? reply.checkinBaselines : {};
      for (const baseline of Object.values(checkinBaselines)) for (const id of baseline.messageIds || []) seen.add(id);
      scanTeacherReplies().catch(() => {});
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "ARYA_SET_SCHEDULES") {
      schedules = Array.isArray(message.schedules) ? message.schedules : [];
      checkinBaselines = message.checkinBaselines && typeof message.checkinBaselines === "object" ? message.checkinBaselines : checkinBaselines;
      for (const baseline of Object.values(checkinBaselines)) for (const id of baseline.messageIds || []) seen.add(id);
      sendResponse({ ok: true });
      scanTeacherReplies().catch(() => {});
      return false;
    }
    if (message?.type !== "ARYA_SEND_OUTBOX_JOB") return;
    sendToActiveExactChat(message.job).then(sendResponse).catch(() => sendResponse({ outcome: "uncertain", error_code: "send_observation_failed" }));
    return true;
  });
})();
