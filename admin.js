const renderStaticArya = render;
let liveApprovalStatus = "pending";

function liveEscape(value) {
  return escapeHtml(value == null ? "" : String(value));
}

function liveSetHeader(title) {
  document.getElementById("crumb").textContent = title;
  document.querySelectorAll("#nav button").forEach((button) => {
    button.classList.toggle("active", button.dataset.page === state.page);
  });
  document.getElementById("sidebar").classList.remove("open");
}

function liveErrorText(code) {
  const messages = {
    admin_auth_not_configured: "Yönetici girişi henüz Vercel’de kurulmadı.",
    storage_not_configured: "Neon veritabanı henüz Vercel projesine bağlanmadı.",
    storage_unavailable: "Veritabanına şu an ulaşılamıyor. Kurulum değerlerini kontrol edin.",
    invalid_credentials: "Parola doğru değil.",
    login_temporarily_blocked: "Çok sayıda başarısız deneme oldu. 15 dakika sonra tekrar deneyin.",
    openai_not_configured: "OpenAI API bilgileri henüz Vercel’e eklenmedi.",
    openai_consent_required: "Mesajları OpenAI’ye göndermek için onay kutusunu işaretleyin.",
    messages_must_share_conversation: "Taslak için aynı konuşmadaki mesajları seçin.",
    messages_not_found: "Seçilen mesajlardan biri artık erişilebilir değil.",
    approval_not_pending: "Bu taslak daha önce incelenmiş.",
    unauthorized: "Oturum süresi dolmuş. Yeniden giriş yapın."
  };
  return messages[code] || "İşlem tamamlanamadı. Kurulum durumunu kontrol edin.";
}

async function liveApi(path, options = {}) {
  const headers = Object.assign({ "Accept": "application/json" }, options.headers || {});
  if (options.body) headers["Content-Type"] = "application/json";
  const response = await fetch(path, Object.assign({
    credentials: "same-origin",
    cache: "no-store"
  }, options, { headers }));
  let data = {};
  try { data = await response.json(); } catch {}
  if (!response.ok) {
    const error = new Error(data.error || "request_failed");
    error.code = data.error || "request_failed";
    error.status = response.status;
    throw error;
  }
  return data;
}

function liveSetupList(setup) {
  const items = [
    ["Neon veritabanı", setup.databaseConfigured],
    ["Yönetici parolası ve oturum anahtarı", setup.adminConfigured]
  ];
  return items.map((item) =>
    '<div class="setting"><div>' + item[0] +
    '<small>' + (item[1] ? "Vercel ortam değişkenleri hazır" : "Vercel ortam değişkeni bekleniyor") +
    '</small></div><span class="tag ' + (item[1] ? "green" : "yellow") + '">' +
    (item[1] ? "Hazır" : "Eksik") + '</span></div>'
  ).join("");
}

async function liveSession() {
  return liveApi("/api/admin/session").catch((error) => ({
    authenticated: false,
    setup: {},
    error: error.code
  }));
}

function liveLoginCard(pageTitle, setup, errorCode) {
  setup = setup || {};
  const ready = setup.databaseConfigured && setup.adminConfigured;
  const body = ready
    ? '<form id="aryaLoginForm"><label for="aryaPassword">Yönetici parolası</label><input id="aryaPassword" name="password" type="password" autocomplete="current-password" required><button class="btn primary" type="submit">Giriş yap</button><p class="muted-note">Oturum 4 saat sonra sona erer.</p></form>'
    : '<div class="warning"><span>ⓘ</span><div>Canlı alanı açmak için önce Vercel’de Neon veritabanını bağlayıp yönetici parolası ve oturum anahtarı ekleyin. API anahtarlarını bu ekrana yazmayın.</div></div>' +
      liveSetupList(setup);
  return '<div class="pagehead"><div><div class="eyebrow">Korumalı alan</div><h1>' + pageTitle + '</h1><p>Gerçek mesajlar ve onaylar yalnızca yönetici oturumunda görünür.</p></div></div>' +
    '<section class="card auth-card">' +
    '<div class="cardhead"><div><h2>Yönetici girişi</h2><p>Gizli anahtarları tarayıcıya yazmayın.</p></div></div>' +
    (errorCode ? '<div class="warning"><span>ⓘ</span><div>' + liveEscape(liveErrorText(errorCode)) + '</div></div>' : '') +
    body +
    '</section>';
}

function bindLogin() {
  const form = document.getElementById("aryaLoginForm");
  if (!form) return;
  form.onsubmit = async (event) => {
    event.preventDefault();
    const button = form.querySelector("button");
    button.disabled = true;
    try {
      await liveApi("/api/admin/login", {
        method: "POST",
        body: JSON.stringify({ password: document.getElementById("aryaPassword").value })
      });
      render();
    } catch (error) {
      document.getElementById("page").innerHTML = liveLoginCard(
        state.page === "liveMessages" ? "Canlı Gelenler" : "Yanıt Onayı",
        aryaLastSetup,
        error.code
      );
      bindLogin();
    }
  };
}

let aryaLastSetup = {};

async function requireLiveSession(pageTitle) {
  const session = await liveSession();
  aryaLastSetup = session.setup || {};
  if (!session.authenticated) {
    document.getElementById("page").innerHTML = liveLoginCard(pageTitle, aryaLastSetup, session.error);
    bindLogin();
    return false;
  }
  return true;
}

function liveLogoutButton() {
  return '<button class="btn secondary" id="aryaLogout">Çıkış yap</button>';
}

function bindLogout() {
  const button = document.getElementById("aryaLogout");
  if (!button) return;
  button.onclick = async () => {
    try { await liveApi("/api/admin/logout", { method: "POST", body: "{}" }); } catch {}
    render();
  };
}

function livePageHeading(eyebrow, title, description, button) {
  return '<div class="pagehead"><div><div class="eyebrow">' + eyebrow + '</div><h1>' + title +
    '</h1><p>' + description + '</p></div><div>' + (button || "") + '</div></div>';
}

function liveMessageCard(message) {
  const date = message.message_time ? new Date(message.message_time).toLocaleString("tr-TR") : "";
  const label = message.sender_name || "Katılımcı";
  const type = message.message_type || "Mesaj";
  return '<label class="live-message"><input type="checkbox" name="messageIds" value="' + liveEscape(message.message_id) + '">' +
    '<span><span class="live-message-title">' + liveEscape(label) + '</span>' +
    '<span class="live-message-meta">' + liveEscape(type) + ' · ' + liveEscape(date) + '</span>' +
    '<span class="live-message-body">' + (message.body ? liveEscape(message.body) : "Metin içeriği olmayan " + liveEscape(type.toLowerCase()) + " mesajı") + '</span></span></label>';
}

async function renderLiveMessages() {
  liveSetHeader("Canlı Gelenler");
  document.getElementById("page").innerHTML = '<div class="card">Canlı mesaj kutusu yükleniyor…</div>';
  if (!await requireLiveSession("Canlı Gelenler")) return;
  let result;
  try {
    result = await liveApi("/api/admin/messages");
  } catch (error) {
    document.getElementById("page").innerHTML = livePageHeading("Korumalı alan", "Canlı Gelenler", "Gelen WhatsApp mesajları ve seçili mesajlardan taslak oluşturma.") +
      '<div class="warning"><span>ⓘ</span><div>' + liveEscape(liveErrorText(error.code)) + '</div></div>' +
      '<section class="card">' + liveSetupList(aryaLastSetup) + '</section>';
    return;
  }
  const messages = result.messages || [];
  const warning = '<div class="warning"><span>ⓘ</span><div><b>Güvenli çalışma:</b> Seçtiğiniz mesaj metinleri yalnızca siz düğmeye bastığınızda taslak üretimi için OpenAI’ye gider. Taslaklar insan onayına düşer; buradan WhatsApp’a gönderim yapılmaz.</div></div>';
  const content = messages.length
    ? messages.map(liveMessageCard).join("")
    : '<div class="empty">Henüz webhook üzerinden kaydedilmiş gerçek mesaj yok. WhatsApp bağlantısı kurulunca yeni gelen mesajlar burada görünür.</div>';
  document.getElementById("page").innerHTML =
    livePageHeading("Korumalı canlı alan", "Canlı Gelenler", "Webhook ile kaydedilen mesajlar. En fazla 150 yeni kayıt gösterilir.", liveLogoutButton()) +
    warning +
    '<section class="card"><div class="cardhead"><div><h2>Gelen mesajlar</h2><p>' + messages.length + ' gerçek kayıt</p></div><button class="btn secondary" id="aryaRefresh">Yenile</button></div>' +
    '<form id="aryaAnalyzeForm">' + content +
    (messages.length ? '<div class="live-toolbar"><label class="consent-row"><input type="checkbox" id="aryaAiConsent"><span>Seçtiğim içeriklerin OpenAI’ye gönderilerek özet ve yanıt taslağı üretilmesini onaylıyorum.</span></label><button class="btn primary" id="aryaAnalyze" type="submit" disabled>Analiz et ve onay taslağı oluştur</button></div>' : '') +
    '</form></section>';
  bindLogout();
  const refresh = document.getElementById("aryaRefresh");
  if (refresh) refresh.onclick = () => render();
  const consent = document.getElementById("aryaAiConsent");
  const submit = document.getElementById("aryaAnalyze");
  if (consent && submit) consent.onchange = () => { submit.disabled = !consent.checked; };
  const form = document.getElementById("aryaAnalyzeForm");
  if (form && messages.length) {
    form.onsubmit = async (event) => {
      event.preventDefault();
      const ids = Array.from(form.querySelectorAll('input[name="messageIds"]:checked')).map((input) => input.value);
      if (!ids.length) {
        toast("Önce aynı konuşmadaki mesajları seçin.");
        return;
      }
      submit.disabled = true;
      submit.textContent = "Taslak hazırlanıyor…";
      try {
        await liveApi("/api/agent-draft", {
          method: "POST",
          body: JSON.stringify({ messageIds: ids, confirmOpenAI: consent.checked })
        });
        toast("Taslak insan onayı kuyruğuna eklendi.");
        state.page = "liveApprovals";
        render();
      } catch (error) {
        toast(liveErrorText(error.code));
        submit.disabled = !consent.checked;
        submit.textContent = "Analiz et ve onay taslağı oluştur";
      }
    };
  }
}

function liveApprovalCard(item) {
  const created = item.created_at ? new Date(item.created_at).toLocaleString("tr-TR") : "";
  const title = item.status === "pending" ? "İnsan onayı bekliyor" : item.status === "approved" ? "Onaylandı · gönderilmedi" : "Reddedildi";
  const buttons = item.status === "pending"
    ? '<div class="actions"><button class="btn primary" data-approval-action="approve" data-id="' + liveEscape(item.id) + '">Onayla · gönderim kapalı</button><button class="btn secondary" data-approval-action="reject" data-id="' + liveEscape(item.id) + '">Reddet</button></div>'
    : '<span class="tag ' + (item.status === "approved" ? "green" : "red") + '">' + liveEscape(title) + '</span>';
  return '<article class="live-approval"><div class="live-message-title">' + liveEscape(title) + '</div>' +
    '<div class="live-message-meta">' + liveEscape(created) + ' · ' + (Array.isArray(item.source_message_ids) ? item.source_message_ids.length : 0) + ' mesaj</div>' +
    '<div class="live-approval-text"><b>Özet ve dikkat noktaları</b><br>' + liveEscape(item.analysis_text || "Özet yok.") + '</div>' +
    '<div class="live-approval-text"><b>Yanıt taslağı</b><br>' + liveEscape(item.reply_text || "Yanıt taslağı üretilmedi.") + '</div>' +
    buttons + '</article>';
}

async function renderLiveApprovals() {
  liveSetHeader("Yanıt Onayı");
  document.getElementById("page").innerHTML = '<div class="card">Onay kuyruğu yükleniyor…</div>';
  if (!await requireLiveSession("Yanıt Onayı")) return;
  let result;
  try {
    result = await liveApi("/api/admin/approvals?status=" + encodeURIComponent(liveApprovalStatus));
  } catch (error) {
    document.getElementById("page").innerHTML = livePageHeading("Korumalı alan", "Yanıt Onayı", "Onaylanan taslaklar da bu aşamada WhatsApp’a gönderilmez.") +
      '<div class="warning"><span>ⓘ</span><div>' + liveEscape(liveErrorText(error.code)) + '</div></div>' +
      '<section class="card">' + liveSetupList(aryaLastSetup) + '</section>';
    return;
  }
  const approvals = result.approvals || [];
  const statuses = [["pending", "Bekleyen"], ["approved", "Onaylanan"], ["rejected", "Reddedilen"]];
  const filters = statuses.map((item) =>
    '<button class="tab ' + (liveApprovalStatus === item[0] ? "active" : "") + '" data-live-status="' + item[0] + '">' + item[1] + '</button>'
  ).join("");
  const content = approvals.length
    ? approvals.map(liveApprovalCard).join("")
    : '<div class="empty">Bu görünümde kayıt yok.</div>';
  document.getElementById("page").innerHTML =
    livePageHeading("İnsan denetimi", "Yanıt Onayı", "Taslakları inceleyin. Onay yalnızca kayıt durumunu değiştirir; WhatsApp gönderimi kapalıdır.", liveLogoutButton()) +
    '<div class="warning"><span>ⓘ</span><div><b>Gönderim kapalı.</b> Onaylanan taslaklar kayda alınır, WhatsApp’a gönderilmez.</div></div>' +
    '<section class="card"><div class="tabs">' + filters + '</div>' + content + '</section>';
  bindLogout();
  document.querySelectorAll("[data-live-status]").forEach((button) => {
    button.onclick = () => { liveApprovalStatus = button.dataset.liveStatus; render(); };
  });
  document.querySelectorAll("[data-approval-action]").forEach((button) => {
    button.onclick = async () => {
      button.disabled = true;
      try {
        await liveApi("/api/admin/approval", {
          method: "POST",
          body: JSON.stringify({ id: button.dataset.id, action: button.dataset.approvalAction })
        });
        toast(button.dataset.approvalAction === "approve" ? "Onay kaydedildi. Mesaj gönderilmedi." : "Taslak reddedildi.");
        render();
      } catch (error) {
        toast(liveErrorText(error.code));
        button.disabled = false;
      }
    };
  });
}

render = function () {
  if (state.page === "liveMessages") {
    renderLiveMessages();
    return;
  }
  if (state.page === "liveApprovals") {
    renderLiveApprovals();
    return;
  }
  renderStaticArya();
};
