const page = document.getElementById("page");
const routeByHash = { "#kurum-takip": "operations", "#ders-teyit": "teacher-confirm", "#whatsapp-web-dersleri": "waweb-schedule", "#ders-programi": "coord-schedule", "#ders-kuyrugu": "coord-queue", "#ders-saglik": "coord-health", "#ders-gecmis": "coord-history" };
const state = { route: routeByHash[location.hash] || "overview", conversation: null, approvalStatus: "pending", search: "", request: 0, teacherFixtures: [] };
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
  invalid_whatsapp_schedule: "Grup, öğretmen, gün ve saat alanlarını kontrol edin.",
  whatsapp_schedule_conflict: "Bu grup için aynı gün ve saatte başka bir ders kaydı var.",
  invalid_approval_chat: "Onay WhatsApp grubu adını kontrol edin.",
  invalid_whatsapp_agent_action: "Ajan işlemi tanınmadı.",
  invalid_preview_date: "Önizleme için geçerli bir ders tarihi seçin.",
  invalid_outbox_resolution: "Kuyruk uzlaştırma işlemi geçersiz.",
  outbox_job_not_reconcilable: "Bu iş artık elle uzlaştırılabilir durumda değil.",
  whatsapp_local_agent_not_configured: "Yerel WhatsApp Web köprüsü sunucuda hazır değil.",
  whatsapp_local_agent_not_online: "Canlı kapıyı açmadan önce bu PC’de WhatsApp Web açıkken yerel ajanı bağlayın.",
  whatsapp_recipient_verification_required: "Canlı gönderim için etkin dersleri ve ARYA ONAY grubunu sunucu allowlist'iyle eşleştirin.",
  live_send_confirmation_required: "Canlı gönderim onayı alınamadı.",
  coordinator_database_scope_invalid: "Ders koordinatörü için ayrı veritabanı yapılandırılmalı.",
  coordinator_store_not_configured: "Ders koordinatörü veritabanı henüz yapılandırılmadı.",
  coordinator_storage_disabled: "Ders koordinatörü depolaması kapalı.",
  meta_send_rejected: "Meta gönderimi reddetti.",
  whatsapp_web_sender_not_enabled: "WhatsApp Web alımı hazırlıkta; yerel gönderim bu sürümde kapalı.",
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
  const routeHashes = { operations: "#kurum-takip", "teacher-confirm": "#ders-teyit", "waweb-schedule": "#whatsapp-web-dersleri", "coord-schedule": "#ders-programi", "coord-queue": "#ders-kuyrugu", "coord-health": "#ders-saglik", "coord-history": "#ders-gecmis" };
  if (routeHashes[route]) history.replaceState(null, "", routeHashes[route]);
  else if (Object.values(routeHashes).includes(location.hash)) history.replaceState(null, "", location.pathname + location.search);
  document.getElementById("sidebar").classList.remove("open");
  window.scrollTo(0, 0);
  render();
}
function setNavigation() {
  const labels = { overview: "Genel Bakış", conversations: "Konuşmalar", approvals: "Ekibe Danışma",
    insights: "Analiz ve Bulgular", reports: "Raporlar", operations: "Kurum Takip", "teacher-confirm": "Ders Teyidi",
    "waweb-schedule": "WhatsApp Web Dersleri",
    "coord-schedule": "Ders Programı", "coord-queue": "Görev Kuyruğu", "coord-health": "Sistem Sağlığı",
    "coord-history": "Geçmiş / Alarmlar", setup: "Ajan ve Bağlantılar" };
  document.getElementById("crumb").textContent = labels[state.route] || "Konuşma";
  document.querySelectorAll("#nav button, .nav button").forEach((node) =>
    node.classList.toggle("active", node.dataset.page === state.route));
}
function whatsappWebSchedulePage(data) {
  const weekdays = ["", "Pazartesi", "Salı", "Çarşamba", "Perşembe", "Cuma", "Cumartesi", "Pazar"];
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Europe/Istanbul" });
  const rows = (data.schedules || []).map((item) => '<tr><td><strong>' + esc(item.group_name) + '</strong><br><span class="muted-note">' + esc(item.teacher_name) + ' · birebir: ' + esc(item.teacher_chat_name) + '</span></td>' +
    '<td>' + weekdays[Number(item.weekday)] + ' · ' + esc(item.class_time) + '</td><td>' + esc(item.checkin_time) + ' / ' + esc(item.response_deadline) + '</td>' +
    '<td>Ders öncesi ' + number(item.preclass_minutes) + ' dk</td><td><span class="tag ' + (item.enabled ? 'green' : 'yellow') + '">' + (item.enabled ? 'Taslak etkin' : 'Kapalı') + '</span></td>' +
    '<td><button class="btn secondary" data-waweb-edit="' + esc(item.id) + '">Düzenle</button></td></tr>').join("");
  const outboxRows = (data.outbox || []).map((item) => '<tr><td>' + esc(item.job_type) + '</td><td>' + esc(item.chat_name) + '</td><td>' + esc(date(item.run_at)) + '</td>' +
    '<td><span class="tag ' + (item.status === 'sent' ? 'green' : ['uncertain','blocked'].includes(item.status) ? 'red' : 'yellow') + '">' + esc(item.status) + '</span><br>' + esc(item.outcome_code || '') + '</td>' +
    '<td>' + (['uncertain','blocked'].includes(item.status) ? '<button class="btn secondary" data-waweb-resolve="confirm_sent" data-id="' + esc(item.id) + '">Teslim edildi</button> <button class="btn secondary" data-waweb-resolve="cancel" data-id="' + esc(item.id) + '">İptal et</button>' : '—') + '</td></tr>').join("");
  const settings = data.settings || {};
  return title("WhatsApp Web ders koordinasyonu", "09.00 teyidi öğretmenin birebir sohbetine gider; açık onay gelirse ders saati gruba yazılır. 12.00’ye kadar yanıt beklenir; hatırlatma varsayılan olarak 60 dakika öncedir.") +
    '<div class="warning"><b>Güvenli hazırlık modu</b><span>Ajan duraklatıldı, kuru çalışma açık, gerçek gönderim kapalı. Bu paneldeki planlar demo ders programından ayrıdır. Henüz WhatsApp’a mesaj gönderilmez.</span></div>' +
    '<div class="grid split"><section class="card"><div class="cardhead"><div><h2>Haftalık öğretmen / grup eşlemesi</h2><p>Öğretmen birebir sohbeti ve sınıf grubu başlıklarını WhatsApp’taki adlarıyla eşleştir.</p></div><button class="btn secondary" data-waweb-new>Yeni ders</button></div>' +
    '<div class="ops-table-wrap"><table class="table"><thead><tr><th>WhatsApp grubu / öğretmen</th><th>Ders</th><th>Teyit penceresi</th><th>Hatırlatma</th><th>Durum</th><th></th></tr></thead><tbody>' + (rows || '<tr><td colspan="6">Henüz eşleme yok. Yeni ders ile elle tanımla.</td></tr>') + '</tbody></table></div></section>' +
    '<section class="card"><div class="cardhead"><div><h2>İnsan kontrolü</h2><p>Beklenmedik/çelişkili yanıtlar için iç grup.</p></div></div>' +
    '<form id="wawebApprovalChatForm"><label for="wawebApprovalChat">Onay WhatsApp grubu</label><input id="wawebApprovalChat" name="chat_name" maxlength="100" value="' + esc(settings.approval_chat_name || "ARYA ONAY") + '" required>' +
    '<p class="muted-note">Bu ad yalnızca taslak ayarıdır; gönderim kapalı. Canlıya geçmeden önce açık WhatsApp oturumunda grup başlığı doğrulanmalıdır.</p><button class="btn secondary" type="submit">Grup adını kaydet</button></form>' +
    '<div class="setting"><div><strong>Ajan durumu</strong><small>' + (data.agent?.agent_online ? 'Bu PC çevrimiçi · WhatsApp Web sekmesi bulundu' : 'Bu PC’de yerel ajan/WhatsApp Web bağlı değil') + '<br>' +
    (settings.paused ? 'Duraklatıldı' : 'Çalışır durumda') + ' · ' + (settings.dry_run ? 'Kuru çalışma' : 'Canlı kip') + ' · gönderim ' + (settings.send_enabled ? 'açık' : 'kapalı') + '</small></div>' +
    '<button class="btn secondary" data-waweb-pause="' + (settings.paused ? 'resume' : 'pause') + '">' + (settings.paused ? 'Hazırlığı sürdür' : 'Ajanı duraklat') + '</button></div>' +
    '<div class="warning"><b>Canlı gönderim kapısı</b><span>Alıcıları ve günlük kuru çalışma taslaklarını WhatsApp Web başlıklarıyla doğrulamadan açma. Açmak, sonraki zamanlanmış işleri gerçek gruplara gönderebilir.</span></div>' +
    '<button class="btn primary" data-waweb-arm>Canlı gönderim kapısını aç</button>' +
    '</section></div><section class="card"><div class="cardhead"><div><h2>Günlük kuru çalışma</h2><p>Alıcı başlıklarını ve tam mesaj taslaklarını gözden geçir. Buradaki önizleme hiçbir kuyruğa yazmaz ve gönderim yapmaz.</p></div></div>' +
    '<form id="wawebPreviewForm" class="coord-generate"><label for="wawebPreviewDate">Ders tarihi</label><input id="wawebPreviewDate" name="date" type="date" value="' + today + '" required><button class="btn secondary" type="submit">Günlük taslakları göster</button></form><div id="wawebPreviewResult"></div></section>' +
    '<section class="card"><div class="cardhead"><div><h2>Tek gönderim kuyruğu</h2><p>Belirsiz teslimat otomatik yinelenmez. Belirsiz/engelli işi WhatsApp’ta kontrol ettikten sonra elle kapat.</p></div></div>' +
    '<div class="ops-table-wrap"><table class="table"><thead><tr><th>İş</th><th>Alıcı</th><th>Plan</th><th>Durum</th><th>Elle uzlaştırma</th></tr></thead><tbody>' + (outboxRows || '<tr><td colspan="5">Kuyrukta iş yok.</td></tr>') + '</tbody></table></div></section>' +
    '<section id="wawebEditor" class="card" hidden></section>';
}
function whatsappWebScheduleEditor(item = {}) {
  const weekdays = ["", "Pazartesi", "Salı", "Çarşamba", "Perşembe", "Cuma", "Cumartesi", "Pazar"];
  const dayOptions = weekdays.slice(1).map((name, index) => '<option value="' + (index + 1) + '" ' + (Number(item.weekday || 1) === index + 1 ? 'selected' : '') + '>' + name + '</option>').join("");
  const editor = document.getElementById("wawebEditor");
  editor.hidden = false;
  editor.innerHTML = '<div class="cardhead"><div><h2>' + (item.id ? 'Ders eşlemesini düzenle' : 'Yeni ders eşlemesi') + '</h2><p>Kaydetmek mesaj göndermez. Yeni kayıt varsayılan olarak kapalıdır.</p></div></div>' +
    '<form id="wawebScheduleForm" data-id="' + esc(item.id || '') + '"><label>WhatsApp grup başlığı<input name="group_name" maxlength="100" required value="' + esc(item.group_name || '') + '"></label>' +
    '<label>Öğretmenin görünen adı<input name="teacher_name" maxlength="80" required value="' + esc(item.teacher_name || '') + '"></label>' +
    '<label>Öğretmenin birebir WhatsApp başlığı<input name="teacher_chat_name" maxlength="100" required value="' + esc(item.teacher_chat_name || '') + '"></label>' +
    '<label>Haftanın günü<select name="weekday">' + dayOptions + '</select></label>' +
    '<label>Ders saati<input type="time" name="class_time" required value="' + esc(item.class_time || '10:00') + '"></label>' +
    '<label>Teyit mesajı saati<input type="time" name="checkin_time" required value="' + esc(item.checkin_time || '09:00') + '"></label>' +
    '<label>Yanıt için son saat<input type="time" name="response_deadline" required value="' + esc(item.response_deadline || '12:00') + '"></label>' +
    '<label>Ders öncesi hatırlatma (dakika)<input type="number" name="preclass_minutes" min="5" max="240" value="' + esc(item.preclass_minutes ?? 60) + '" required></label>' +
    '<label><input type="checkbox" name="enabled" ' + (item.enabled ? 'checked' : '') + '> Taslak planı etkinleştir</label><div class="coord-actions"><button class="btn primary" type="submit">Kaydet</button><button class="btn secondary" type="button" data-waweb-cancel>Vazgeç</button></div></form>';
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
  if (group.id.startsWith("waweb:")) {
    try { return "WhatsApp Web · " + decodeURIComponent(group.id.slice(6)); }
    catch { return "WhatsApp Web sohbeti"; }
  }
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
      '</span></button>').join("") : empty("Henüz mesaj yok. Bağlı alım kaynaklarından gelen kayıtlar burada görünecek.")) + '</section>';
}
function conversationPage() {
  const groups = conversations().filter((g) => (groupName(g) + " " + g.messages.map((m) => m.body).join(" ")).toLowerCase().includes(state.search.toLowerCase()));
  if (state.conversation) {
    const group = conversations().find((g) => g.id === state.conversation);
    const canReply = Boolean(health.transport !== "web" && group && /^\d{5,30}:\d{6,20}$/.test(group.id));
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
    a.status === "approved" ? (health.transport === "web" ?
      '<span class="tag yellow">WhatsApp Web yerel gönderimi kapalı</span>' : health.configured?.metaSend ?
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
function coordinatorPage(route, data) {
  const headings = {
    "coord-schedule": ["Ders Programı", "Demo öğretmen, grup ve haftalık taslak programları."],
    "coord-queue": ["Görev Kuyruğu", "Yalnız simülasyon işleri; gerçek gönderim kapalı."],
    "coord-health": ["Sistem Sağlığı", "İzole demo veritabanı, kuyruk ve sahte ajan durumu."],
    "coord-history": ["Geçmiş / Alarmlar", "Demo programı ve kuyruk işlemlerinin denetlenebilir geçmişi."]
  }[route];
  const weekdays = ["", "Pazartesi", "Salı", "Çarşamba", "Perşembe", "Cuma", "Cumartesi", "Pazar"];
  const weekdayOptions = (selected) => weekdays.slice(1).map((name, index) =>
    '<option value="' + (index + 1) + '" ' + (Number(selected) === index + 1 ? "selected" : "") + '>' + name + '</option>').join("");
  const jobNames = { teacher_confirmation: "Öğretmen teyidi", noon_reminder: "12.00 grup hatırlatması", preclass_reminder: "Ders−60 dk hatırlatması" };
  const statuses = { scheduled: "Planlandı", confirmed: "Teyit simüle edildi", rescheduled: "Saat değişikliği simüle edildi", cancelled: "İptal / tatil", needs_human_review: "İnsan kontrolü", queued: "Kuyrukta", leased: "Ajan aldı · simülasyon", retry_wait: "Yeniden denenecek", paused: "Durduruldu", simulated: "Simülasyon tamamlandı", dead_letter: "Dead-letter", blocked: "Gönderim kapalı" };
  const banner = '<div class="warning"><b>GO3 demo alanı</b> Ayrı demo veritabanını kullanır. Canlı sohbet okunmaz; PC/WhatsApp bağlantısı ve mesaj gönderimi yoktur. Görevler yalnızca simüle edilir.</div>';
  let content = "";
  if (route === "coord-schedule") {
    const scheduleRows = (data.schedules || []).map((item, index) => {
      const formId = "coordScheduleForm" + index;
      return '<tr><td><strong>' + esc(item.level) + '</strong><label class="coord-field-label" for="' + formId + '-group">Grup adı</label>' +
      '<input id="' + formId + '-group" class="coord-name-input" type="text" maxlength="80" name="group_name" form="' + formId + '" value="' + esc(item.group_name) + '">' +
      '<label class="coord-field-label" for="' + formId + '-teacher">Öğretmen</label><input id="' + formId + '-teacher" class="coord-name-input" type="text" maxlength="80" name="teacher_name" form="' + formId + '" value="' + esc(item.teacher_name) + '"></td>' +
      '<td><form id="' + formId + '" class="coord-schedule-form" data-coord-schedule-form data-id="' + esc(item.id) + '"><select name="weekday" aria-label="Ders günü">' + weekdayOptions(item.weekday) + '</select>' +
      '<input type="time" name="start_time" aria-label="Ders saati" value="' + esc(item.start_time) + '" required>' +
      '<label class="coord-check"><input type="checkbox" name="enabled" ' + (item.enabled ? "checked" : "") + '> Aktif</label>' +
      '<button class="btn secondary" type="submit">Kaydet</button></form></td>' +
      '<td><span class="tag ' + (item.enabled && item.status === "active" ? "green" : "yellow") + '">' + esc(item.enabled && item.status === "active" ? "Aktif demo" : "Taslak") + '</span></td></tr>';
    }).join("");
    content = '<section class="card"><div class="cardhead"><div><h2>Demo haftalık planlar</h2><p>Bu kayıtlar yalnız GO1 izole demosuna aittir.</p></div><button class="btn secondary" data-coord-action="enable-demo">Demo taslaklarını etkinleştir</button></div>' +
      '<form id="coordGenerateForm" class="coord-generate"><label for="coordClassDate">Demo ders tarihi</label><input id="coordClassDate" name="class_date" type="date" value="' + esc(data.local_date) + '" required><button class="btn primary" type="submit">Bu tarih için demo görevleri oluştur</button></form>' +
      '<div class="ops-table-wrap"><table class="table"><thead><tr><th>Grup / öğretmen</th><th>Gün ve saat</th><th>Durum</th></tr></thead><tbody>' + (scheduleRows || '<tr><td colspan="3">Demo programı bulunamadı.</td></tr>') + '</tbody></table></div></section>';
  } else if (route === "coord-queue") {
    const occurrenceRows = (data.occurrences || []).map((item) =>
      '<article class="coord-occurrence"><div><strong>' + esc(item.level) + ' · ' + esc(item.group_name) + '</strong><span class="tag yellow">' + esc(statuses[item.status] || item.status) + '</span><p>' + esc(item.teacher_name) + ' · ' + esc(item.class_date) + ' · ' + esc(date(item.confirmed_start_at || item.planned_start_at)) + '</p></div>' +
      '<div class="coord-sim-actions"><button class="btn secondary" data-coord-action="simulate-confirm" data-id="' + esc(item.id) + '">Teyidi simüle et</button>' +
      '<button class="btn secondary" data-coord-action="simulate-cancel" data-id="' + esc(item.id) + '">İptali simüle et</button>' +
      '<button class="btn secondary" data-coord-action="simulate-holiday" data-id="' + esc(item.id) + '">Tatil olarak işaretle</button>' +
      '<button class="btn secondary" data-coord-action="simulate-uncertain" data-id="' + esc(item.id) + '">Belirsiz yanıt</button>' +
      '<button class="btn secondary" data-coord-action="simulate-late" data-id="' + esc(item.id) + '">Geç / yanıtsız</button>' +
      '<form class="coord-reschedule-form" data-coord-reschedule-form data-id="' + esc(item.id) + '"><input type="time" name="start_time" value="' + esc(item.confirmed_start_at ? new Date(item.confirmed_start_at).toLocaleTimeString("tr-TR", { timeZone: "Europe/Istanbul", hour: "2-digit", minute: "2-digit", hour12: false }) : String(item.planned_start_at).slice(11, 16)) + '" aria-label="Yeni ders saati" required><button class="btn secondary" type="submit">Saati simüle et</button></form></div></article>'
    ).join("");
    const jobRows = (data.jobs || []).map((item) =>
      '<tr><td>' + esc(jobNames[item.job_type] || item.job_type) + '<br><span class="muted-note">' + esc(item.level) + ' · ' + esc(item.group_name) + '</span></td>' +
      '<td>' + esc(date(item.run_at)) + '</td><td><span class="tag ' + (item.status === "dead_letter" ? "red" : item.status === "simulated" ? "green" : "yellow") + '">' + esc(statuses[item.status] || item.status) + '</span></td>' +
      '<td>' + esc(item.last_error || "—") + '</td><td>' + (item.status === "dead_letter" ? '<button class="btn secondary" data-coord-action="retry" data-id="' + esc(item.id) + '">Güvenli yeniden sırala</button>' : '—') + '</td></tr>'
    ).join("");
    const hasPaused = (data.counts || []).some((item) => item.status === "paused" && Number(item.count) > 0);
    content = '<section class="card"><div class="cardhead"><div><h2>Güvenli simülasyon denetimi</h2><p>Kuyruk çıkışı gerçek WhatsApp’a gönderilmez.</p></div><div class="coord-actions"><button class="btn secondary" data-coord-action="' + (hasPaused ? "resume" : "pause") + '">' + (hasPaused ? "Kuyruğu sürdür" : "Kuyruğu durdur") + '</button></div></div>' +
      '<div class="cardhead"><div><h2>Ders olayları</h2><p>Teyit, saat değişikliği, iptal veya belirsiz yanıt yalnız demo durumunu günceller.</p></div></div>' +
      (occurrenceRows || '<div class="empty">Henüz demo görevi yok. Ders Programı sekmesinden bir tarih için oluşturun.</div>') +
      '<div class="cardhead coord-subhead"><div><h2>Planlanmış işler</h2><p>Idempotency anahtarı, claim/lease ve retry durumu sunucuda tutulur.</p></div></div>' +
      '<div class="ops-table-wrap"><table class="table"><thead><tr><th>İş</th><th>Çalışma zamanı</th><th>Durum</th><th>Son hata</th><th>İşlem</th></tr></thead><tbody>' + (jobRows || '<tr><td colspan="5">Kuyruk boş.</td></tr>') + '</tbody></table></div></section>';
  } else if (route === "coord-health") {
    const counts = (data.counts || []).map((item) => '<div class="coord-count"><span>' + esc(statuses[item.status] || item.status) + '</span><strong>' + number(item.count) + '</strong></div>').join("");
    const agent = data.latest_agent;
    content = '<div class="grid metrics coord-metrics">' +
      '<div class="card metric"><div class="metric-label">Veritabanı</div><div class="metric-value accent-mint">Bağlı</div><div class="metric-foot">Arya ders demosu · ayrı DB</div></div>' +
      '<div class="card metric"><div class="metric-label">PC ajanı</div><div class="metric-value ' + (agent && agent.online ? "accent-mint" : "accent-amber") + '">' + esc(agent && agent.online ? "Çevrimiçi" : "Çevrimdışı") + '</div><div class="metric-foot">' + esc(agent ? agent.agent_id + " · " + date(agent.last_seen) : "GO3 sahte istemcisi henüz bağlanmadı") + '</div></div>' +
      '<div class="card metric"><div class="metric-label">Ders gönderimi</div><div class="metric-value accent-amber">Kapalı</div><div class="metric-foot">sending_enabled=false</div></div>' +
      '<div class="card metric"><div class="metric-label">Ders cron’u</div><div class="metric-value accent-blue">Yok</div><div class="metric-foot">İşler ajan pull kuyruğunda bekler</div></div></div>' +
      '<section class="card"><div class="cardhead"><div><h2>Kuyruk durumu</h2><p>İşler UTC timestamp ile saklanır, panel Europe/Istanbul gösterir.</p></div></div><div class="coord-counts">' + (counts || '<div class="empty">Henüz kuyruk işi yok.</div>') + '</div>' +
      '<div class="coord-safety"><strong>Güvenlik sınırı</strong><p>GO3 yalnız Preview’da etkin. Agent uçları Production’da 404 verir. Gerçek PC, WhatsApp Web ve Meta kullanılmaz.</p></div></section>';
  } else {
    const eventRows = (data.events || []).map((item) =>
      '<tr><td>' + esc(date(item.created_at)) + '</td><td><span class="tag ' + (item.level === "error" || item.level === "warn" ? "yellow" : "blue") + '">' + esc(item.level) + '</span></td>' +
      '<td>' + esc(item.event_type) + '</td><td><code>' + esc(JSON.stringify(item.details || {})) + '</code></td></tr>'
    ).join("");
    content = '<section class="card"><div class="cardhead"><div><h2>Audit geçmişi</h2><p>Yalnız demo kaydı ve test olayları; canlı mesaj içeriği tutulmaz.</p></div></div>' +
      '<div class="ops-table-wrap"><table class="table"><thead><tr><th>Zaman</th><th>Seviye</th><th>Olay</th><th>Detay</th></tr></thead><tbody>' + (eventRows || '<tr><td colspan="4">Henüz geçmiş kaydı yok.</td></tr>') + '</tbody></table></div></section>';
  }
  return '<div class="pagehead"><div><div class="eyebrow">Arya · Ders Koordinatörü · demo</div><h1>' + esc(headings[0]) + '</h1><p>' + esc(headings[1]) + '</p></div><span class="tag yellow">Gönderim kapalı</span></div>' + banner + content;
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
  if (state.route === "waweb-schedule") {
    const reloadSchedulePage = async () => {
      const data = await api("/api/admin/local-whatsapp-schedules");
      page.innerHTML = whatsappWebSchedulePage(data);
      bindActions();
    };
    document.querySelectorAll("[data-waweb-new]").forEach((element) => element.onclick = () => whatsappWebScheduleEditor());
    document.querySelectorAll("[data-waweb-edit]").forEach((element) => element.onclick = async () => {
      try {
        const data = await api("/api/admin/local-whatsapp-schedules");
        whatsappWebScheduleEditor((data.schedules || []).find((row) => row.id === element.dataset.wawebEdit) || {});
      } catch (error) { notice(errorText(error.code)); }
    });
    document.querySelectorAll("[data-waweb-pause]").forEach((element) => element.onclick = async () => {
      element.disabled = true;
      try {
        await api("/api/admin/local-whatsapp-schedules", { method: "POST", body: JSON.stringify({ action: element.dataset.wawebPause }) });
        await reloadSchedulePage();
        notice("Ajan durumu kaydedildi. Gerçek gönderim kapalı kalır.");
      } catch (error) { notice(errorText(error.code)); element.disabled = false; }
    });
    document.querySelectorAll("[data-waweb-resolve]").forEach((element) => element.onclick = async () => {
      const resolution = element.dataset.wawebResolve;
      if (resolution === "confirm_sent" && !confirm("WhatsApp Web’de bu mesajın gönderildiğini gördün mü? Yalnızca gördüysen onayla.")) return;
      element.disabled = true;
      try {
        await api("/api/admin/local-whatsapp-schedules", { method: "POST", body: JSON.stringify({ action: "resolve-outbox", job_id: element.dataset.id, resolution }) });
        await reloadSchedulePage(); notice("Kuyruk kaydı elle uzlaştırıldı.");
      } catch (error) { notice(errorText(error.code)); element.disabled = false; }
    });
    const armButton = document.querySelector("[data-waweb-arm]");
    if (armButton) armButton.onclick = async () => {
      const phrase = prompt("WhatsApp Web’de grup başlıklarını ve kuru çalışma taslaklarını doğruladıysan ALICI_VE_KURU_CALISMA_DOGRULANDI yaz.");
      if (phrase !== "ALICI_VE_KURU_CALISMA_DOGRULANDI") return;
      armButton.disabled = true;
      try {
        await api("/api/admin/local-whatsapp-schedules", { method: "POST", body: JSON.stringify({ action: "arm-live-send", confirmation: phrase }) });
        await reloadSchedulePage(); notice("Canlı gönderim kapısı açıldı.");
      } catch (error) { notice(errorText(error.code)); armButton.disabled = false; }
    };
    const approvalForm = document.getElementById("wawebApprovalChatForm");
    if (approvalForm) approvalForm.onsubmit = async (event) => {
      event.preventDefault();
      try {
        await api("/api/admin/local-whatsapp-schedules", { method: "POST", body: JSON.stringify({ action: "set-approval-chat", chat_name: approvalForm.elements.chat_name.value }) });
        notice("Onay grubu adı taslak ayar olarak kaydedildi.");
      } catch (error) { notice(errorText(error.code)); }
    };
    const previewForm = document.getElementById("wawebPreviewForm");
    if (previewForm) previewForm.onsubmit = async (event) => {
      event.preventDefault();
      const submit = previewForm.querySelector('[type="submit"]');
      const resultNode = document.getElementById("wawebPreviewResult");
      submit.disabled = true;
      resultNode.textContent = "Taslaklar hazırlanıyor…";
      try {
        const result = await api("/api/admin/local-whatsapp-schedules", { method: "POST", body: JSON.stringify({ action: "preview-day", date: previewForm.elements.date.value }) });
        resultNode.innerHTML = (result.preview || []).map((item) => '<article class="coord-occurrence"><div><strong>' + esc(item.at) + ' · ' + esc(item.to) + '</strong><span class="tag yellow">' + esc(item.kind) + '</span><p>' + esc(item.condition) + '</p><p>' + esc(item.text) + '</p></div></article>').join("") || '<div class="empty">Bu tarihte etkin eşleme yok.</div>';
        notice("Kuru çalışma hazırlandı. Mesaj gönderilmedi.");
      } catch (error) { resultNode.textContent = errorText(error.code); }
      finally { submit.disabled = false; }
    };
    document.querySelectorAll("[data-waweb-cancel]").forEach((element) => element.onclick = () => document.getElementById("wawebEditor").hidden = true);
    const scheduleForm = document.getElementById("wawebScheduleForm");
    if (scheduleForm) scheduleForm.onsubmit = async (event) => {
      event.preventDefault();
      const form = scheduleForm;
      const schedule = { id: form.dataset.id || undefined, group_name: form.elements.group_name.value,
        teacher_name: form.elements.teacher_name.value, teacher_chat_name: form.elements.teacher_chat_name.value, weekday: Number(form.elements.weekday.value),
        class_time: form.elements.class_time.value, checkin_time: form.elements.checkin_time.value,
        response_deadline: form.elements.response_deadline.value, preclass_minutes: Number(form.elements.preclass_minutes.value),
        enabled: form.elements.enabled.checked };
      const submit = form.querySelector('[type="submit"]'); submit.disabled = true;
      try {
        await api("/api/admin/local-whatsapp-schedules", { method: "POST", body: JSON.stringify({ action: "save-schedule", schedule }) });
        await reloadSchedulePage(); notice("Ders eşlemesi taslak olarak kaydedildi; WhatsApp’a mesaj gönderilmedi.");
      } catch (error) { notice(errorText(error.code)); submit.disabled = false; }
    };
  }
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
  const coordinatorAction = async (payload, element) => {
    if (element) element.disabled = true;
    try {
      await api("/api/lesson-coordinator", { method: "POST", body: JSON.stringify(payload) });
      notice("Demo işlemi kaydedildi; mesaj gönderilmedi.");
      await render();
    } catch (error) {
      notice(errorText(error.code));
      if (element) element.disabled = false;
    }
  };
  document.querySelectorAll("[data-coord-action]").forEach((element) => element.onclick = () => {
    const action = element.dataset.coordAction;
    const payload = { action };
    if (action.startsWith("simulate-")) payload.occurrence_id = element.dataset.id;
    if (action === "retry") payload.job_id = element.dataset.id;
    coordinatorAction(payload, element);
  });
  const generateForm = document.getElementById("coordGenerateForm");
  if (generateForm) generateForm.onsubmit = (event) => {
    event.preventDefault();
    coordinatorAction({ action: "generate", class_date: generateForm.elements.class_date.value }, generateForm.querySelector("button"));
  };
  document.querySelectorAll("[data-coord-schedule-form]").forEach((form) => form.onsubmit = (event) => {
    event.preventDefault();
    coordinatorAction({ action: "update-schedule", rule_id: form.dataset.id, weekday: Number(form.elements.weekday.value),
      start_time: form.elements.start_time.value, enabled: form.elements.enabled.checked,
      group_name: form.elements.group_name.value, teacher_name: form.elements.teacher_name.value }, form.querySelector("button"));
  });
  document.querySelectorAll("[data-coord-reschedule-form]").forEach((form) => form.onsubmit = (event) => {
    event.preventDefault();
    coordinatorAction({ action: "simulate-reschedule", occurrence_id: form.dataset.id, start_time: form.elements.start_time.value }, form.querySelector("button"));
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
    } else if (state.route.startsWith("coord-")) {
      session = await api("/api/admin/session");
      document.getElementById("logoutBtn").hidden = !session.authenticated;
      document.getElementById("connectionPill").textContent = "Ders Koordinatörü · demo";
      document.getElementById("connectionNote").textContent = "Arya girişi kullanılır. İzole demo alanı; canlı mesaj gönderimi kapalı.";
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
  if (state.route === "waweb-schedule") {
    try {
      const data = await api("/api/admin/local-whatsapp-schedules");
      if (request !== state.request) return;
      document.getElementById("connectionPill").textContent = "WhatsApp Web · hazırlık / gönderim kapalı";
      document.getElementById("connectionNote").textContent = "Yerel tarayıcı ajanı alım prototipi. Bu ekrandan WhatsApp mesajı gönderilmez.";
      page.innerHTML = whatsappWebSchedulePage(data);
      bindActions();
    } catch (error) {
      if (request === state.request) page.innerHTML = '<div class="warning">' + esc(errorText(error.code)) + '</div>';
    }
    return;
  }
  if (state.route.startsWith("coord-")) {
    try {
      const data = await api("/api/lesson-coordinator");
      if (request !== state.request) return;
      page.innerHTML = coordinatorPage(state.route, data);
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

