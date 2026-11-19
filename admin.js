const page = document.getElementById("page");
const state = { route: location.hash === "#kurum-takip" ? "operations" : location.hash === "#ders-teyit" ? "teacher-confirm" : "overview", conversation: null, approvalStatus: "pending", search: "", request: 0, teacherFixtures: [] };
let session = { authenticated: false, setup: {} };
let health = {};
let summary = null;
let operationsCleanup = null;

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
  meta_send_not_configured: "Meta mesaj gönderim bilgileri henüz eklenmedi.",
  individual_conversation_required: "Yalnızca doğrulanmış bireysel sohbetlere gönderim destekleniyor.",
  meta_send_rejected: "Meta gönderimi reddetti.",
  invalid_reply_text: "Yanıt boş olamaz ve 4.096 karakteri geçemez.",
  invalid_reply_request_id: "Gönderim isteği doğrulanamadı. Sayfayı yenileyip yeniden deneyin.",
  conversation_not_found: "Bu sohbet için gönderilebilir bir gelen mesaj bulunamadı.",
  customer_service_window_closed: "WhatsApp’ın 24 saatlik mesajlaşma penceresi kapanmış. Müşteriden yeni mesaj geldikten sonra yanıt gönderebilirsiniz.",
  reply_already_sent: "Bu gönderim isteği daha önce tamamlandı.",
  reply_request_reused: "Bu istek anahtarı daha önce kullanılmış. Yeniden gönderim için sayfayı yenileyin.",
  manual_delivery_uncertain: "Gönderim sonucu belirsiz. WhatsApp teslim durumunu kontrol etmeden yeniden göndermeyin.",
  send_state_unavailable: "Gönderim durumu doğrulanamadı. WhatsApp’ta teslimi kontrol etmeden yeniden göndermeyin.",
  meta_subscription_failed: "Meta aboneliği tamamlanamadı. Aşağıdaki durum kodunu kontrol edin.",
  meta_delivery_uncertain: "Meta yanıtı belirsiz. Tekrar göndermeden önce Meta'da teslim durumunu kontrol edin.",
  unauthorized: "Oturum sona erdi. Yeniden giriş yapın.",
  messages_must_share_conversation: "Aynı konuşmanın mesajlarını seçin.",
  openai_consent_required: "Analiz onayını işaretleyin."
})[code] || "İşlem tamamlanamadı (" + (code || "bağlantı hatası") + ").";

async function api(path, options = {}) {
  const response = await fetch(path, { cache: "no-store", credentials: "same-origin", ...options,
    headers: { Accept: "application/json", ...(options.body ? { "Content-Type": "application/json" } : {}), ...(options.headers || {}) } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || "request_failed");
    error.code = data.error;
    error.providerStatus = data.providerStatus;
    error.metaCode = data.metaCode;
    error.metaSubcode = data.metaSubcode;
    throw error;
  }
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
  if (route === "operations") history.replaceState(null, "", "#kurum-takip");
  else if (route === "teacher-confirm") history.replaceState(null, "", "#ders-teyit");
  else if (location.hash === "#kurum-takip" || location.hash === "#ders-teyit") history.replaceState(null, "", location.pathname + location.search);
  document.getElementById("sidebar").classList.remove("open");
  window.scrollTo(0, 0);
  render();
}
function setNavigation() {
  const labels = { overview: "Genel Bakış", conversations: "Konuşmalar", approvals: "Ekibe Danışma",
    insights: "Analiz ve Bulgular", reports: "Raporlar", operations: "Kurum Takip", "teacher-confirm": "Ders Teyidi", setup: "Ajan ve Bağlantılar" };
  document.getElementById("crumb").textContent = labels[state.route] || "Konuşma";
  document.querySelectorAll("#nav button, .nav button").forEach((node) =>
    node.classList.toggle("active", node.dataset.page === state.route));
}
function connection() {
  const db = Boolean(health.databaseReady), meta = Boolean(health.webhookSubscriptionReady);
  const endpoint = Boolean(health.webhookEndpointReady);
  const ai = Boolean(health.configured?.openAI);
  document.getElementById("connectionPill").innerHTML = '<i class="dot"></i> ' +
    (meta ? "WhatsApp bağlantısı hazır" : endpoint ? "Meta aboneliği bekleniyor" : db ? "Veritabanı hazır · WhatsApp bekleniyor" : "Kurulum bekleniyor");
  document.getElementById("connectionNote").innerHTML = '<strong>● Gerçek veri alanı</strong>' +
    (meta ? "Meta hesabı abone." : endpoint ? "Webhook adresi hazır; AYDA WP1 aboneliği doğrulanmadı." : "WhatsApp bağlantısı bekleniyor.") + "<br>" +
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
  const outgoing = Boolean(message.is_outbound);
  const content = '<div><strong>' + esc(message.sender_name || (outgoing ? "AYDA" : "Katılımcı")) + '</strong> · ' + esc(date(message.message_time)) +
    '<div class="live-message-body">' + esc(message.body || "Metin içermeyen " + message.message_type + " mesajı") + '</div></div>';
  const kind = outgoing ? " outgoing" : "";
  return selectable && !outgoing ? '<label class="live-message"><input type="checkbox" name="messageIds" value="' +
    esc(message.message_id) + '">' + content + '</label>' : '<div class="live-message' + kind + '">' + content + '</div>';
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
    (groups.length ? groups.slice(0, 8).map((g) => '<button class="conversation" data-open-conversation="' + esc(g.id) +
      '"><span class="groupicon">▤</span><span><strong>' + esc(groupName(g)) + '</strong><span class="convo-preview">' +
      esc(g.latest.body || g.latest.message_type) + '</span></span><span class="time">' + esc(date(g.latest.message_time)) +
      '</span></button>').join("") : empty("Henüz gerçek mesaj yok. Meta webhook bağlanınca yeni mesajlar burada görünecek.")) + '</section>';
}
function conversationPage() {
  const groups = conversations().filter((g) => (groupName(g) + " " + g.messages.map((m) => m.body).join(" ")).toLowerCase().includes(state.search.toLowerCase()));
  if (state.conversation) {
    const group = conversations().find((g) => g.id === state.conversation);
    const canReply = Boolean(group && /^\d{5,30}:\d{6,20}$/.test(group.id));
    return title(group ? groupName(group) : "Konuşma bulunamadı", "Son 150 mesajdan bu sohbete ait kayıtlar.",
      button("Mesajları yenile", 'data-refresh') + button("Listeye dön", 'data-route="conversations"')) +
      '<section class="card">' + (group ?
      [...group.messages].reverse().map((m) => messageCard(m, true)).join("") +
      '<form id="analyzeForm"><div class="live-toolbar"><label class="consent-row"><input id="aiConsent" type="checkbox"> Seçtiğim mesajların OpenAI ile analiz edilmesini onaylıyorum.</label>' +
      button("Analiz et ve taslak oluştur", 'type="submit"', "primary") + '</div></form>' +
      (canReply ? '<form id="manualReplyForm" class="manual-reply" data-conversation="' + esc(group.id) + '">' +
        '<h2>WhatsApp’tan yanıtla</h2><p class="muted-note">Yanıt doğrudan müşteriye gider. WhatsApp’ın 24 saatlik mesajlaşma penceresi uygulanır.</p>' +
        '<textarea name="text" maxlength="4096" required placeholder="Yanıtınızı yazın…"></textarea>' +
        '<input type="hidden" name="requestId" value="' + esc(crypto.randomUUID()) + '">' +
        '<div class="live-toolbar">' + button("WhatsApp’tan gönder", 'type="submit"', "primary") + '</div></form>' :
        '<p class="muted-note">Bu kayıt doğrulanmış birebir sohbet numarası taşımadığı için yanıt gönderimi kapalı.</p>') : empty("Bu konuşma erişilebilir değil.")) + '</section>';
  }
  return title("Konuşmalar", "Kaydedilen gerçek mesajlar. En son 150 mesaj üzerinden listelenir.", button("Yenile", 'data-refresh')) +
    '<section class="card"><input class="content-search" id="search" placeholder="Sohbet veya mesaj ara…" value="' + esc(state.search) + '">' +
    (groups.length ? groups.map((g) => '<button class="conversation" data-open-conversation="' + esc(g.id) +
    '"><span class="groupicon">▤</span><span><strong>' + esc(groupName(g)) + '</strong><span class="convo-preview">' +
    esc(g.latest.body || g.latest.message_type) + '</span><span class="tag blue">' + number(g.messages.length) +
    ' mesaj</span></span><span class="time">' + esc(date(g.latest.message_time)) + '</span></button>').join("") :
    empty("Gösterilecek gerçek konuşma yok.")) + '</section>';
}
function approvalsPage() {
  return title("Ekibe Danışma", "Taslakları inceleyin; bireysel sohbetlere gönderim ayrıca Gönder düğmesiyle yapılır.") +
    '<section class="card"><div class="tabs">' +
    [["pending", "Bekleyen"], ["approved", "Onaylanan"], ["sent", "Gönderilen"], ["sending", "Kontrol gerekli"], ["rejected", "Reddedilen"]].map(([key, label]) =>
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
    a.status === "approved" ? (health.configured?.metaSend ?
      button("WhatsApp’a gönder", 'data-send="' + esc(a.id) + '"', "primary") :
      '<span class="tag yellow">Meta gönderim bağlantısı bekleniyor</span>') :
    '<span class="tag ' + (a.status === "sent" ? "green" : "yellow") + '">' +
      esc(a.status === "sent" ? "Gönderildi" : a.status === "sending" ? "Teslim durumu kontrol edilmeli" : "Reddedildi") +
    '</span>') + '</article>').join("") :
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
  const assetAccessDenied = health.metaSubscription?.metaCode === 100 && health.metaSubscription?.metaSubcode === 33;
  const rows = [["Neon veritabanı", health.databaseReady], ["Yönetici erişimi", health.adminReady],
    ["OpenAI anahtarı ve model", c.openAI], ["Meta webhook adresi", health.webhookEndpointReady],
    ["AYDA WP1 webhook aboneliği", health.webhookSubscriptionReady],
    ["WhatsApp mesaj gönderimi", health.outboundSending]];
  return title("Ajan ve Bağlantılar", "Sunucu yapılandırmasının gerçek durumu. Anahtarlar burada gösterilmez.") +
    '<section class="card">' + rows.map(([label, ready]) =>
      '<div class="setting"><strong>' + esc(label) + '</strong><span class="tag ' +
      (ready ? "green" : "yellow") + '">' + (ready ? "Hazır" : "Bekleniyor") + '</span></div>').join("") +
    '</section><section class="card" style="margin-top:15px"><h2>Meta abonelik kontrolü</h2><p>Durum: ' +
    esc(health.metaSubscription?.state || "bilinmiyor") +
    (health.metaSubscription?.metaCode ? ' · Meta kodu: ' + esc(health.metaSubscription.metaCode) : '') +
    '</p>' + (assetAccessDenied ?
      '<p class="warning">Bu jeton AYDA WP1 hesabını ve kayıtlı telefonu okuyamıyor. META_ACCESS_TOKEN değerini doğru sistem kullanıcısının WhatsApp varlık erişimiyle yeniden oluşturun.</p>' :
      !health.webhookSubscriptionReady && c.metaSend ?
      button("AYDA WP1 hesabını bağla", 'data-subscribe', "primary") : '') +
    '</section><section class="card" style="margin-top:15px"><h2>Çalışma akışı</h2><p>Meta bağlantısı kurulunca imzalı yeni mesajlar kaydedilir. OpenAI bağlantısı eklenince yalnızca yönetici tarafından seçilen mesajlar analiz edilir. Taslak onayı kayıt durumunu değiştirir; gönderim açılana kadar WhatsApp’a yanıt gitmez.</p></section>';
}
function teacherConfirmPage(fixtures) {
  const options = fixtures.map((item) =>
    '<option value="' + esc(item.id) + '">' + esc(item.label) + '</option>').join("");
  const first = fixtures[0];
  const reply = first?.teacher_reply || "(Öğretmen yanıtı yok)";
  return title("Ders Teyidi", "Arya oturumunuzla açılan, sentetik öğretmen yanıtı test alanı.") +
    '<div class="warning"><b>Sentetik test alanı</b> Yalnız sabit örnekler değerlendirilir. Gerçek sohbetler okunmaz ve WhatsApp’a mesaj gönderilmez.</div>' +
    '<section class="teacher-confirm-grid">' +
      '<article class="card teacher-confirm-input"><div class="cardhead"><div><h2>Örnek yanıt</h2><p>Öğretmen mesajı sisteme gönderilmez.</p></div><span class="tag">GO 2</span></div>' +
      '<label for="teacherFixture">Senaryo</label><select id="teacherFixture" class="teacher-fixture">' + options + '</select>' +
      '<div class="teacher-fixture-meta"><span>Planlanan ders</span><strong id="teacherPlannedTime">' + esc(first?.planned_time || "—") + '</strong></div>' +
      '<div class="teacher-fixture-reply"><span>Sentetik yanıt</span><p id="teacherReplyText">' + esc(reply) + '</p></div>' +
      '<button class="btn primary" type="button" data-run-teacher-fixture>Yanıtı analiz et</button></article>' +
      '<article class="card teacher-confirm-output"><div class="cardhead"><div><h2>Karar</h2><p>Belirsizlik varsa insan kontrolü gerekir.</p></div></div>' +
      '<div id="teacherResult" class="teacher-result muted-note">Bir senaryo seçip analiz edin. Bu ekranda gönderim işlemi bulunmaz.</div></article>' +
    '</section>';
}
function renderTeacherResult(result) {
  const labels = { confirmed: "Ders teyit edildi", rescheduled: "Saat değişikliği önerildi",
    cancelled: "Ders iptal edildi", uncertain: "Yanıt belirsiz", needs_human_review: "İnsan kontrolü gerekli" };
  const label = labels[result.decision] || labels.needs_human_review;
  const draft = result.student_draft
    ? '<div class="teacher-draft"><strong>Taslak · gönderilmedi</strong><p>' + esc(result.student_draft) + '</p></div>'
    : '<div class="muted-note">Öğrenci mesajı taslağı oluşturulmadı.</div>';
  document.getElementById("teacherResult").innerHTML =
    '<div class="teacher-decision"><span class="tag ' +
    (result.decision === "confirmed" || result.decision === "rescheduled" ? "green" : "yellow") +
    '">' + esc(label) + '</span>' +
    (result.proposed_time ? '<strong>Saat ' + esc(result.proposed_time) + '</strong>' : '') + '</div>' +
    '<p class="teacher-rationale">' + esc(result.rationale || "İnsan kontrolü gerekli.") + '</p>' +
    '<div class="teacher-evidence"><strong>Kanıt</strong><p>' + esc(result.evidence || "—") + '</p></div>' + draft;
}
function bindActions() {
  const fixtureSelect = document.getElementById("teacherFixture");
  if (fixtureSelect) fixtureSelect.onchange = () => {
    const item = state.teacherFixtures.find((fixture) => fixture.id === fixtureSelect.value);
    document.getElementById("teacherPlannedTime").textContent = item?.planned_time || "—";
    document.getElementById("teacherReplyText").textContent = item?.teacher_reply || "(Öğretmen yanıtı yok)";
    document.getElementById("teacherResult").textContent = "Senaryoyu analiz edin. Gönderim kapalıdır.";
  };
  const runFixture = document.querySelector("[data-run-teacher-fixture]");
  if (runFixture) runFixture.onclick = async () => {
    const select = document.getElementById("teacherFixture");
    runFixture.disabled = true;
    document.getElementById("teacherResult").textContent = "Analiz ediliyor…";
    try {
      const result = await api("/api/teacher-confirm", { method: "POST", body: JSON.stringify({ fixture_id: select.value }) });
      renderTeacherResult(result);
    } catch (error) {
      document.getElementById("teacherResult").textContent = errorText(error.code);
    } finally { runFixture.disabled = false; }
  };
  document.querySelectorAll("[data-route]").forEach((element) => element.onclick = () => navigate(element.dataset.route));
  document.querySelectorAll("[data-open-conversation]").forEach((element) => element.onclick = () =>
    navigate("conversations", element.dataset.openConversation));
  document.querySelectorAll("[data-refresh]").forEach((element) => element.onclick = () => {
    if (state.route === "conversations" && state.conversation && hasUnsavedConversationWork()) {
      notice("Yanıt alanında yazı veya seçili analiz varken yenileme yapılmadı."); return;
    }
    render();
  });
  const subscribe = document.querySelector("[data-subscribe]");
  if (subscribe) subscribe.onclick = async () => {
    subscribe.disabled = true;
    try {
      await api("/api/meta-subscription", { method: "POST", body: "{}" });
      await render(); notice("Meta aboneliği doğrulandı.");
    } catch (error) { await render(); notice(errorText(error.code)); }
  };
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
  const replyForm = document.getElementById("manualReplyForm");
  if (replyForm) {
    const textInput = replyForm.elements.text;
    const submit = replyForm.querySelector('[type="submit"]');
    let sending = false;
    const updateSubmit = () => { submit.disabled = sending || !textInput.value.trim(); };
    textInput.addEventListener("input", updateSubmit);
    updateSubmit();
    replyForm.onsubmit = async (event) => {
      event.preventDefault();
      const text = textInput.value;
      const requestId = replyForm.elements.requestId.value;
      if (!text.trim()) { updateSubmit(); return; }
      sending = true;
      updateSubmit();
      notice("WhatsApp’a gönderiliyor…");
      try {
        await api("/api/admin/reply", { method: "POST", body: JSON.stringify({
          conversationId: replyForm.dataset.conversation, text, requestId
        }) });
        state.conversation = replyForm.dataset.conversation;
        await render();
        notice("Yanıt WhatsApp üzerinden gönderildi.");
      } catch (error) {
        const diagnostic = [
          error.providerStatus ? "HTTP " + error.providerStatus : "",
          error.metaCode !== null && error.metaCode !== undefined ? "Meta " + error.metaCode +
            (error.metaSubcode !== null && error.metaSubcode !== undefined ? "/" + error.metaSubcode : "") : ""
        ].filter(Boolean).join(" · ");
        notice(errorText(error.code) + (diagnostic ? " (" + diagnostic + ")" : ""));
        if (error.code === "meta_send_rejected") replyForm.elements.requestId.value = crypto.randomUUID();
        sending = false;
        updateSubmit();
      }
    };
  }
  document.querySelectorAll("[data-approval]").forEach((element) => element.onclick = async () => {
    element.disabled = true;
    try {
      await api("/api/admin/approval", { method: "POST", body: JSON.stringify({
        id: element.dataset.approval, action: element.dataset.action }) });
      await render();
    } catch (error) { notice(errorText(error.code)); element.disabled = false; }
  });
  document.querySelectorAll("[data-send]").forEach((element) => element.onclick = async () => {
    if (!confirm("Bu onaylanmış yanıtı bireysel WhatsApp sohbetine gönderelim mi?")) return;
    element.disabled = true;
    try {
      await api("/api/admin/send", { method: "POST", body: JSON.stringify({ id: element.dataset.send }) });
      state.approvalStatus = "sent"; await render(); notice("Mesaj Meta üzerinden gönderildi.");
    } catch (error) { notice(errorText(error.code)); await render(); }
  });
}
async function render() {
  if (operationsCleanup) { operationsCleanup(); operationsCleanup = null; }
  const request = ++state.request;
  setNavigation();
  page.innerHTML = '<section class="card">Yükleniyor…</section>';
  try {
    if (state.route === "operations") {
      session = await api("/api/admin/session");
      document.getElementById("logoutBtn").hidden = !session.authenticated;
      document.getElementById("connectionPill").textContent = "Kurum takibi · yalnızca okuma";
      document.getElementById("connectionNote").textContent = "CRM ve kurs taramaları bu sekmeden takip edilir. Mesajlaşma bağlantısı ayrı çalışır.";
    } else await load();
  } catch (error) {
    if (request === state.request) page.innerHTML = '<div class="warning">' + esc(errorText(error.code)) + '</div>';
    return;
  }
  if (request !== state.request) return;
  if (!session.authenticated) { login(); return; }
  if (state.route === "teacher-confirm") {
    try {
      const data = await api("/api/teacher-confirm");
      if (request !== state.request) return;
      state.teacherFixtures = data.fixtures || [];
      page.innerHTML = teacherConfirmPage(state.teacherFixtures);
      bindActions();
    } catch (error) {
      if (request === state.request) page.innerHTML = '<div class="warning">' + esc(errorText(error.code)) + '</div>';
    }
    return;
  }
  if (state.route === "operations") {
    try {
      const module = await import("/operations-ui.js?v=20261112");
      if (request !== state.request) return;
      operationsCleanup = module.mountOperations(page, { api, onUnauthorized: () => render() });
    } catch { if (request === state.request) page.innerHTML = '<div class="warning">Kurum Takip yüklenemedi. Sayfayı yenileyin.</div>'; }
    return;
  }
  page.innerHTML = ({
    overview, conversations: conversationPage, approvals: approvalsPage,
    insights, reports, operations: overview, "teacher-confirm": overview, setup
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
function hasUnsavedConversationWork() {
  const reply = document.getElementById("manualReplyForm");
  const analysis = document.getElementById("analyzeForm");
  const active = document.activeElement;
  return Boolean(
    (reply && (reply.contains(active) || reply.elements.text.value.trim())) ||
    (analysis && (analysis.contains(active) || analysis.querySelector('input[name="messageIds"]:checked'))) ||
    document.getElementById("aiConsent")?.checked
  );
}
setInterval(() => { if (session.authenticated && !document.hidden &&
  ["overview", "conversations", "reports", "insights", "approvals"].includes(state.route) &&
  !(state.route === "conversations" && state.conversation) &&
  !hasUnsavedConversationWork()) render(); }, 30000);
render();
