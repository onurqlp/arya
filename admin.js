const page = document.getElementById("page");
const state = { route: "overview", conversation: null, approvalStatus: "pending", search: "", request: 0 };
let session = { authenticated: false, setup: {} };
let health = {};
let summary = null;

const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
const date = (value) => value ? new Date(value).toLocaleString("tr-TR", { timeZone: "Europe/Istanbul" }) : "";
const number = (value) => Number(value || 0).toLocaleString("tr-TR");
const title = (name, description, action = "") => '<div class="pagehead"><div><div class="eyebrow">Arya · canlı veriler</div><h1>' + esc(name) + '</h1><p>' + esc(description) + '</p></div>' + action + '</div>';
const empty = (message) => '<div class="empty">' + esc(message) + '</div>';
const metric = (label, value, detail) => '<div class="card metric"><div class="metric-label">' + esc(label) + '</div><div class="metric-value accent-mint">' + number(value) + '</div><div class="metric-foot">' + esc(detail) + '</div></div>';
const button = (label, attr, type = "secondary") => '<button class="btn ' + type + '" ' + attr + '>' + esc(label) + '</button>';
const errorText = (code) => ({
  invalid_credentials: "Parola yanlış.",
  login_temporarily_blocked: "Giriş denemeleri geçici olarak sınırlandı. 15 dakika sonra deneyin.",
  storage_unavailable: "Veritabanına ulaşılamadı.",
  openai_not_configured: "OpenAI anahtarı ve model adı henüz eklenmedi.",
  unauthorized: "Oturum sona erdi. Yeniden giriş yapın.",
  messages_must_share_conversation: "Aynı konuşmanın mesajlarını seçin.",
  openai_consent_required: "Analiz onayını işaretleyin."
})[code] || "İşlem tamamlanamadı (" + (code || "bağlantı hatası") + ").";

async function api(path, options = {}) {
  const response = await fetch(path, { cache: "no-store", credentials: "same-origin", ...options,
    headers: { Accept: "application/json", ...(options.body ? { "Content-Type": "application/json" } : {}), ...(options.headers || {}) } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) { const error = new Error(data.error || "request_failed"); error.code = data.error; throw error; }
  return data;
}
function notice(message) {
  const node = document.createElement("div");
  node.className = "toast";
  node.textContent = message;
  document.body.append(node);
  setTimeout(() => node.remove(), 3600);
}
function navigate(route, conversation = null) {
  state.route = route;
  state.conversation = conversation;
  state.search = "";
  document.getElementById("sidebar").classList.remove("open");
  window.scrollTo(0, 0);
  render();
}
function setNavigation() {
  const labels = { overview: "Genel Bakış", conversations: "Konuşmalar", approvals: "Ekibe Danışma",
    insights: "Analiz ve Bulgular", reports: "Raporlar", setup: "Ajan ve Bağlantılar" };
  document.getElementById("crumb").textContent = labels[state.route] || "Konuşma";
  document.querySelectorAll("#nav button, .nav button").forEach((node) =>
    node.classList.toggle("active", node.dataset.page === state.route));
}
function connection() {
  const db = Boolean(health.databaseReady), meta = Boolean(health.configured?.metaWebhook);
  const ai = Boolean(health.configured?.openAI);
  document.getElementById("connectionPill").innerHTML = '<i class="dot"></i> ' +
    (meta ? "Webhook hazır" : db ? "Veritabanı hazır · WhatsApp bekleniyor" : "Kurulum bekleniyor");
  document.getElementById("connectionNote").innerHTML = '<strong>● Gerçek veri alanı</strong>' +
    (meta ? "Meta bağlantısı hazır." : "WhatsApp bağlantısı bekleniyor.") + "<br>" +
    (ai ? "OpenAI taslak üretimi hazır." : "OpenAI bağlantısı bekleniyor.");
  document.getElementById("logoutBtn").hidden = !session.authenticated;
}
function login() {
  page.innerHTML = title("Yönetici girişi", "Konuşmalar ve raporlar yalnızca yetkili oturumunda gösterilir.") +
    '<section class="card auth-card">' +
    (!session.setup?.databaseConfigured ? '<div class="warning">Neon veritabanı bağlantısı bekleniyor.</div>' : "") +
    (!session.setup?.adminConfigured ? '<div class="warning">Yönetici parolası veya oturum anahtarı Vercel’de hazır değil.</div>' : "") +
    (session.setup?.adminConfigured && session.setup?.databaseConfigured ?
      '<form id="loginForm"><label for="password">Yönetici parolası</label><input id="password" type="password" autocomplete="current-password" required>' +
      button("Giriş yap", 'type="submit"', "primary") + '</form>' : "") + '</section>';
  const form = document.getElementById("loginForm");
  if (form) form.onsubmit = async (event) => {
    event.preventDefault();
    const submit = form.querySelector("button"); submit.disabled = true;
    try {
      session = await api("/api/admin/login", { method: "POST", body: JSON.stringify({ password: form.querySelector("input").value }) });
      await render();
    } catch (error) {
      notice(errorText(error.code)); submit.disabled = false; form.querySelector("input").value = "";
    }
  };
}
async function load() {
  session = await api("/api/admin/session");
  health = await api("/api/health");
  connection();
  if (session.authenticated) summary = await api("/api/admin/summary");
}
function conversations() {
  const groups = new Map();
  for (const message of summary.messages || []) {
    const id = message.conversation_id;
    if (!groups.has(id)) groups.set(id, []);
    groups.get(id).push(message);
  }
  return [...groups].map(([id, messages]) => ({ id, messages, latest: messages[0] }));
}
function groupName(group) {
  return "Sohbet " + group.id.split(":").slice(-1)[0];
}
function messageCard(message, selectable = false) {
  const content = '<div><strong>' + esc(message.sender_name || "Katılımcı") + '</strong> · ' + esc(date(message.message_time)) +
    '<div class="live-message-body">' + esc(message.body || "Metin içermeyen " + message.message_type + " mesajı") + '</div></div>';
  return selectable ? '<label class="live-message"><input type="checkbox" name="messageIds" value="' +
    esc(message.message_id) + '">' + content + '</label>' : '<div class="live-message">' + content + '</div>';
}
function overview() {
  const c = summary.counts || {};
  const pending = summary.approvals?.find((row) => row.status === "pending")?.count || 0;
  const groups = conversations();
  return title("Genel Bakış", "Veritabanına kaydedilen WhatsApp mesajlarının mevcut durumu.", button("Yenile", 'data-refresh')) +
    '<div class="grid metrics">' + metric("Konuşma", c.conversations, "Gerçek kayıtlar") +
    metric("Bugün gelen", c.today, "Türkiye saatine göre") + metric("Son 7 gün", c.week, "Gelen mesajlar") +
    metric("Onay bekleyen", pending, "Yanıt taslakları") + '</div>' +
    '<section class="card"><div class="cardhead"><h2>Son konuşmalar</h2>' +
    button("Tüm konuşmalar", 'data-route="conversations"') + '</div>' +
    (groups.length ? groups.slice(0, 8).map((g) => '<button class="conversation" data-conversation="' + esc(g.id) +
      '"><span class="groupicon">▤</span><span><strong>' + esc(groupName(g)) + '</strong><span class="convo-preview">' +
      esc(g.latest.body || g.latest.message_type) + '</span></span><span class="time">' + esc(date(g.latest.message_time)) +
      '</span></button>').join("") : empty("Henüz gerçek mesaj yok. Meta webhook bağlanınca yeni mesajlar burada görünecek.")) + '</section>';
}
function conversationPage() {
  const groups = conversations().filter((g) => (groupName(g) + " " + g.messages.map((m) => m.body).join(" ")).toLowerCase().includes(state.search.toLowerCase()));
  if (state.conversation) {
    const group = conversations().find((g) => g.id === state.conversation);
    return title(group ? groupName(group) : "Konuşma bulunamadı", "Son 150 mesajdan bu sohbete ait kayıtlar.",
      button("Listeye dön", 'data-route="conversations"')) +
      '<section class="card">' + (group ? '<form id="analyzeForm">' +
      [...group.messages].reverse().map((m) => messageCard(m, true)).join("") +
      '<div class="live-toolbar"><label class="consent-row"><input id="aiConsent" type="checkbox"> Seçtiğim mesajların OpenAI ile analiz edilmesini onaylıyorum.</label>' +
      button("Analiz et ve taslak oluştur", 'type="submit"', "primary") + '</div></form>' : empty("Bu konuşma erişilebilir değil.")) + '</section>';
  }
  return title("Konuşmalar", "Kaydedilen gerçek mesajlar. En son 150 mesaj üzerinden listelenir.", button("Yenile", 'data-refresh')) +
    '<section class="card"><input class="content-search" id="search" placeholder="Sohbet veya mesaj ara…" value="' + esc(state.search) + '">' +
    (groups.length ? groups.map((g) => '<button class="conversation" data-conversation="' + esc(g.id) +
    '"><span class="groupicon">▤</span><span><strong>' + esc(groupName(g)) + '</strong><span class="convo-preview">' +
    esc(g.latest.body || g.latest.message_type) + '</span><span class="tag blue">' + number(g.messages.length) +
    ' mesaj</span></span><span class="time">' + esc(date(g.latest.message_time)) + '</span></button>').join("") :
    empty("Gösterilecek gerçek konuşma yok.")) + '</section>';
}
function approvalsPage() {
  return title("Ekibe Danışma", "Ajan taslakları insan incelemesine sunulur. Onay, WhatsApp’a mesaj göndermez.") +
    '<section class="card"><div class="tabs">' +
    [["pending", "Bekleyen"], ["approved", "Onaylanan"], ["rejected", "Reddedilen"]].map(([key, label]) =>
      '<button class="tab ' + (state.approvalStatus === key ? "active" : "") +
      '" data-status="' + key + '">' + label + '</button>').join("") + '</div><div id="approvalItems">Yükleniyor…</div></section>';
}
async function fillApprovals(request) {
  const result = await api("/api/admin/approvals?status=" + state.approvalStatus);
  if (request !== state.request) return;
  const target = document.getElementById("approvalItems"); if (!target) return;
  target.innerHTML = result.approvals.length ? result.approvals.map((a) =>
    '<article class="live-approval"><b>' + esc(date(a.created_at)) + '</b> · ' +
    number(a.source_message_ids?.length) + ' mesaj<div class="live-approval-text"><b>Analiz</b><br>' +
    esc(a.analysis_text) + '</div><div class="live-approval-text"><b>Yanıt taslağı</b><br>' + esc(a.reply_text) + '</div>' +
    (a.status === "pending" ? '<div class="actions">' +
    button("Onayla", 'data-approval="' + esc(a.id) + '" data-action="approve"', "primary") +
    button("Reddet", 'data-approval="' + esc(a.id) + '" data-action="reject"') + '</div>' :
    '<span class="tag green">' + esc(a.status) + ' · gönderilmedi</span>') + '</article>').join("") :
    empty("Bu durumda kayıt yok.");
}
function insights() {
  const all = summary.approvals || [];
  const total = all.reduce((sum, row) => sum + Number(row.count), 0);
  return title("Analiz ve Bulgular", "Yalnızca seçilip analiz edilen gerçek mesajlardan oluşturulan kayıtlar.") +
    '<div class="grid metrics">' + metric("Üretilen analiz", total, "Gerçek taslak sayısı") +
    metric("Bekleyen", all.find((a) => a.status === "pending")?.count, "Ekip incelemesi") +
    metric("Onaylanan", all.find((a) => a.status === "approved")?.count, "Gönderim yapılmadı") +
    metric("Reddedilen", all.find((a) => a.status === "rejected")?.count, "İncelenen taslak") + '</div>' +
    '<section class="card">' + (total ? button("Taslaklara git", 'data-route="approvals"') :
      empty("Henüz analiz yok. Bir konuşmadaki mesajları seçip analiz başlatabilirsiniz.")) + '</section>';
}
function reports() {
  const c = summary.counts || {}, max = Math.max(1, ...(summary.daily || []).map((row) => Number(row.count)));
  return title("Raporlar", "Son yedi gündeki kayıtlı mesaj hareketi.") +
    '<div class="grid metrics">' + metric("Toplam mesaj", c.total, "Saklanan kayıtlar") +
    metric("Son 7 gün", c.week, "Gelen mesaj") +
    metric("Konuşma", c.conversations, "Benzersiz sohbet") +
    metric("Bugün", c.today, "Gelen mesaj") + '</div><section class="card"><h2>Günlük hareket</h2>' +
    (summary.daily?.length ? summary.daily.map((row) =>
      '<div class="progressrow"><span>' + esc(row.day?.slice(0, 10)) + '</span><div class="bar"><i style="width:' +
      Math.round(100 * Number(row.count) / max) + '%"></i></div><b>' + number(row.count) + '</b></div>').join("") :
      empty("Son yedi günde mesaj kaydı bulunmuyor.")) + '</section>';
}
function setup() {
  const c = health.configured || {};
  const rows = [["Neon veritabanı", health.databaseReady], ["Yönetici erişimi", health.adminReady],
    ["OpenAI anahtarı ve model", c.openAI], ["Meta webhook", c.metaWebhook],
    ["WhatsApp mesaj gönderimi", health.outboundSending]];
  return title("Ajan ve Bağlantılar", "Sunucu yapılandırmasının gerçek durumu. Anahtarlar burada gösterilmez.") +
    '<section class="card">' + rows.map(([label, ready]) =>
      '<div class="setting"><strong>' + esc(label) + '</strong><span class="tag ' +
      (ready ? "green" : "yellow") + '">' + (ready ? "Hazır" : "Bekleniyor") + '</span></div>').join("") +
    '</section><section class="card" style="margin-top:15px"><h2>Çalışma akışı</h2><p>Meta bağlantısı kurulunca imzalı yeni mesajlar kaydedilir. OpenAI bağlantısı eklenince yalnızca yönetici tarafından seçilen mesajlar analiz edilir. Taslak onayı kayıt durumunu değiştirir; gönderim açılana kadar WhatsApp’a yanıt gitmez.</p></section>';
}
function bindActions() {
  document.querySelectorAll("[data-route]").forEach((element) => element.onclick = () => navigate(element.dataset.route));
  document.querySelectorAll("[data-conversation]").forEach((element) => element.onclick = () =>
    navigate("conversations", element.dataset.conversation));
  document.querySelectorAll("[data-refresh]").forEach((element) => element.onclick = render);
  document.querySelectorAll("[data-status]").forEach((element) => element.onclick = () => {
    state.approvalStatus = element.dataset.status; render();
  });
  const search = document.getElementById("search");
  if (search) search.oninput = () => {
    const value = search.value, caret = search.selectionStart;
    state.search = value; page.innerHTML = conversationPage(); bindActions();
    const next = document.getElementById("search"); next.focus(); next.setSelectionRange(caret, caret);
  };
  const form = document.getElementById("analyzeForm");
  if (form) form.onsubmit = async (event) => {
    event.preventDefault();
    const messageIds = [...form.querySelectorAll('input[name="messageIds"]:checked')].map((input) => input.value);
    if (!messageIds.length || !document.getElementById("aiConsent").checked) {
      notice("Mesaj seçin ve analiz onayını işaretleyin."); return;
    }
    const submit = form.querySelector('[type="submit"]'); submit.disabled = true;
    try {
      await api("/api/agent-draft", { method: "POST", body: JSON.stringify({ messageIds, confirmOpenAI: true }) });
      state.approvalStatus = "pending"; navigate("approvals");
    } catch (error) { notice(errorText(error.code)); submit.disabled = false; }
  };
  document.querySelectorAll("[data-approval]").forEach((element) => element.onclick = async () => {
    element.disabled = true;
    try {
      await api("/api/admin/approval", { method: "POST", body: JSON.stringify({
        id: element.dataset.approval, action: element.dataset.action }) });
      await render();
    } catch (error) { notice(errorText(error.code)); element.disabled = false; }
  });
}
async function render() {
  const request = ++state.request;
  setNavigation();
  page.innerHTML = '<section class="card">Yükleniyor…</section>';
  try { await load(); } catch (error) {
    if (request === state.request) page.innerHTML = '<div class="warning">' + esc(errorText(error.code)) + '</div>';
    return;
  }
  if (request !== state.request) return;
  if (!session.authenticated) { login(); return; }
  page.innerHTML = ({
    overview, conversations: conversationPage, approvals: approvalsPage,
    insights, reports, setup
  }[state.route] || overview)();
  bindActions();
  if (state.route === "approvals") {
    try { await fillApprovals(request); bindActions(); } catch (error) {
      const node = document.getElementById("approvalItems");
      if (node && request === state.request) node.textContent = errorText(error.code);
    }
  }
}
document.querySelectorAll(".nav button[data-page]").forEach((element) => element.onclick = () => navigate(element.dataset.page));
document.getElementById("menuBtn").onclick = () => document.getElementById("sidebar").classList.toggle("open");
document.getElementById("helpBtn").onclick = () => notice("Bağlantı durumunu Ajan ve Bağlantılar bölümünde görebilirsiniz.");
document.getElementById("logoutBtn").onclick = async () => {
  await api("/api/admin/logout", { method: "POST", body: "{}" }).catch(() => {});
  summary = null; await render();
};
setInterval(() => { if (session.authenticated && !document.hidden &&
  ["overview", "conversations", "reports", "insights", "approvals"].includes(state.route) &&
  !document.getElementById("analyzeForm")) render(); }, 30000);
render();
