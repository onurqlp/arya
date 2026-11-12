(() => {
  const seen = new Map();
  let allowed = new Set();
  let timer = null;
  let initialized = false;

  function clean(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function askSettings() {
    chrome.runtime.sendMessage({ type: "GET_GROUP_SETTINGS" }, (reply) => {
      allowed = new Set((reply?.groups || []).map((value) => clean(value).toLocaleLowerCase("tr-TR")));
      scan(true);
      if (!timer) timer = setInterval(() => scan(false), 1000);
    });
  }

  function rowName(row) {
    const named = row.querySelector('[data-testid="cell-frame-title"] span[title], [data-testid="cell-frame-title"]');
    if (named) {
      const title = clean(named.getAttribute("title") || named.textContent);
      if (title) return title;
    }
    const titles = [...row.querySelectorAll("span[title]")].map((node) => clean(node.getAttribute("title")));
    return titles.find((value) => value && !/^\d{1,2}:\d{2}$/.test(value)) || "";
  }

  function previewText(row, name) {
    const lines = String(row.innerText || "").split(/\n/).map(clean).filter(Boolean);
    const result = lines.filter((line) => {
      if (line === name || /^\d{1,2}:\d{2}$/.test(line) || /^\d+$/.test(line)) return false;
      if (/^(typing|recording|online|last seen|yazıyor|çevrimiçi|son görülme)/i.test(line)) return false;
      return true;
    });
    return clean(result.join(" · ")).slice(0, 3000);
  }

  function rows() {
    const found = new Set();
    document.querySelectorAll('[data-testid="cell-frame-container"], [role="listitem"], [role="row"]').forEach((node) => {
      if (node.querySelector('[data-testid="cell-frame-title"]') || node.querySelector("span[title]")) found.add(node);
    });
    return [...found];
  }

  function scan(isBaseline) {
    if (!allowed.size || !document.body) return;
    for (const row of rows()) {
      const name = rowName(row);
      if (!name || !allowed.has(name.toLocaleLowerCase("tr-TR"))) continue;
      const preview = previewText(row, name);
      if (!preview) continue;
      if (!seen.has(name)) {
        seen.set(name, preview);
        chrome.runtime.sendMessage({ type: "GROUP_PREVIEW", groupName: name, preview, baseline: true });
        continue;
      }
      const prior = seen.get(name);
      if (prior !== preview) {
        seen.set(name, preview);
        chrome.runtime.sendMessage({ type: "GROUP_PREVIEW", groupName: name, preview, baseline: false });
      }
    }
    if (isBaseline) initialized = true;
  }

  const observer = new MutationObserver(() => {
    if (!initialized || !allowed.size) return;
    scan(false);
  });

  function start() {
    askSettings();
    observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
  }

  if (document.documentElement) start();
  else document.addEventListener("DOMContentLoaded", start, { once: true });
})();