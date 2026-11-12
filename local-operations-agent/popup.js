const statusEl = document.querySelector('#status');
const scanButton = document.querySelector('#scan');
const review = document.querySelector('#review');
const countBox = document.querySelector('#counts');
const approve = document.querySelector('#approveMatches');
const confirmButton = document.querySelector('#confirm');
const publishButton = document.querySelector('#publish');
const autoSync = document.querySelector('#autoSync');
const clearButton = document.querySelector('#clear');

const messages = {
  login_required: 'CRM veya kurs paneli bu tarayıcı profilinde açık değil. Aynı Chrome/Edge profilinde giriş yapıp yeniden deneyin.',
  course_data_incomplete: 'Kurs panelinde yoklama/ödev kapsamı doğrulanamadı. Kısmi veri yayımlanmadı.',
  course_schedule_unavailable: 'Kurs panelindeki öğretmen takvimi okunamadı.',
  course_sessions_not_found: 'Bu ay için okunabilir ders kaydı bulunamadı.',
  course_session_unavailable: 'Bir grup/tarih ekranı açılamadı; eksik kapsamla aktarım durduruldu.',
  course_session_mismatch: 'Grup veya ders tarihi doğrulanamadı; aktarım durduruldu.',
  crm_data_incomplete: 'CRM listelerinden biri eksik veya filtrelenmiş görünüyor. Aktarım yapılmadı.',
  crm_group_reference_ambiguous: 'Bir öğrenci birden fazla aynı adlı CRM grubuyla eşleşiyor; aktarım yapılmadı.',
  crm_group_reference_missing: 'Öğrenci listesindeki bazı grup adları CRM grup listesinde bulunamadı; aktarım yapılmadı.',
  students_table_not_found: 'CRM öğrenci tablosu bulunamadı; site arayüzü değişmiş olabilir.',
  students_columns_missing: 'CRM öğrenci sütunları beklenen yapıda değil.',
  groups_table_not_found: 'CRM grup listesi bulunamadı.',
  crm_groups_filter_incomplete: 'Aktif/arşivlenmiş grup kapsamı doğrulanamadı. Eksik kapsamla aktarım yapılmadı.',
  payments_table_not_found: 'CRM ödeme tablosu bulunamadı.',
  payments_columns_missing: 'CRM ödeme sütunları beklenen yapıda değil.',
  identity_mapping_incomplete: 'Bazı öğrenci veya grup eşleşmeleri tekil değil. Hiçbir veri yayımlanmadı.',
  explicit_match_approval_required: 'Önce eşleşme kuralını gözden geçirip onaylayın.',
  manual_publish_required_first: 'Otomatik aktarımı açmadan önce bir kez elle aktarım yapın.',
  arya_login_required: 'Arya yönetici oturumu gerekli. Arya aktarım sayfasında oturum açıp tekrar deneyin.',
  arya_import_page_unavailable: 'Arya aktarım sayfası yanıt vermedi.',
  storage_unavailable: 'Arya veritabanına ulaşılamadı; kaynak verisi korunmadı.',
  stale_snapshot: 'Kapsam tarihi güncel değil; veri yayımlanmadı.',
  invalid_snapshot: 'Arya şema doğrulamasını geçemedi; veri yayımlanmadı.',
  scan_required: 'Önce CRM ve kurs panellerini tarayın.',
  page_load_timeout: 'Bir panel sayfası zamanında yüklenmedi.',
  scan_already_running: 'Tarama sürüyor.',
  page_agent_unavailable: 'Panel sayfasında yerel okuyucu çalışmadı; yeniden deneyin.',
  course_session_limit: 'Ders ekranı sayısı güvenlik sınırını aştı; aktarım durduruldu.'
};

function setStatus(text, kind = '') {
  statusEl.textContent = text;
  statusEl.className = 'status' + (kind ? ' ' + kind : '');
}
function call(type, extra = {}) {
  return new Promise(resolve => chrome.runtime.sendMessage({ type, ...extra }, result => resolve(result || { ok: false, error: 'unknown_action' })));
}
function renderCounts(counts) {
  const entries = [
    ['CRM öğrencisi', counts.crmStudents], ['CRM grubu', counts.crmGroups], ['Ödeme', counts.payments],
    ['Ders ekranı', counts.courseSessions], ['Yoklama satırı', counts.rosterRows],
    ['Tekil eşleşen öğrenci', counts.matchedStudents], ['Tekil eşleşen grup', counts.matchedGroups],
    ['Çözülemeyen öğrenci/grup', counts.unmatchedStudents + counts.unmatchedGroups],
    ['Yoklama kapsamı', counts.attendanceKnown ? 'Doğrulandı' : 'Belirsiz'],
    ['Ödev kapsamı', counts.homeworkKnown ? 'Doğrulandı' : 'Belirsiz']
  ];
  countBox.replaceChildren(...entries.map(([label, count]) => {
    const box = document.createElement('div'); box.className = 'count';
    const value = document.createElement('b'); value.textContent = String(count ?? 0);
    const caption = document.createElement('span'); caption.textContent = label;
    box.append(value, caption); return box;
  }));
  review.hidden = false;
}
function errorText(code) { return messages[code] || 'İşlem tamamlanamadı (' + code + ').'; }
async function refresh() {
  const value = await call('ARYA_AGENT_GET_STATE');
  if (!value.ok) return;
  autoSync.checked = value.autoSync === true;
  if (value.pending && value.counts) {
    renderCounts(value.counts);
    publishButton.disabled = value.exactMatchConfirmed !== true || value.counts.unmatchedStudents + value.counts.unmatchedGroups > 0 ||
      !value.counts.attendanceKnown || !value.counts.homeworkKnown;
    if (value.exactMatchConfirmed) { approve.checked = true; confirmButton.disabled = true; }
    const incomplete = !value.counts.attendanceKnown || !value.counts.homeworkKnown;
    setStatus(incomplete ? 'Kurs yoklama/ödev kapsamı doğrulanmadı; aktarım kapalı.' : 'Tarama tamamlandı. Veriler şu an yalnızca bu tarayıcı oturumunda bekliyor.', incomplete ? 'error' : 'good');
  }
}

scanButton.onclick = async () => {
  scanButton.disabled = true; publishButton.disabled = true; review.hidden = true;
  setStatus('CRM listeleri ve bu ayın grup/tarih ekranları okunuyor. Kaynak sayfalara yazma yapılmıyor…');
  const result = await call('ARYA_AGENT_SCAN');
  scanButton.disabled = false;
  if (!result.ok) { setStatus(errorText(result.error), 'error'); return; }
  renderCounts(result.counts);
  const unresolved = result.counts.unmatchedStudents + result.counts.unmatchedGroups;
  if (result.exactMatchConfirmed) { approve.checked = true; confirmButton.disabled = true; }
  else { approve.checked = false; confirmButton.disabled = true; }
  publishButton.disabled = result.exactMatchConfirmed !== true || unresolved > 0 || !result.counts.attendanceKnown || !result.counts.homeworkKnown;
  const incomplete = !result.counts.attendanceKnown || !result.counts.homeworkKnown;
  setStatus(unresolved ? 'Tarama bitti; eşleşmeyen kayıt var. Güvenli aktarım kapalı.' : incomplete ? 'Kurs yoklama/ödev kapsamı doğrulanmadı; aktarım kapalı.' : result.exactMatchConfirmed ? 'Tarama bitti. Doğrulanmış eşleşmeler aktarılmaya hazır.' : 'Tarama bitti. Eşleşme kuralını inceleyip onaylayın.', unresolved || incomplete ? 'error' : 'good');
};

approve.onchange = () => { confirmButton.disabled = !approve.checked; };
confirmButton.onclick = async () => {
  confirmButton.disabled = true;
  const result = await call('ARYA_AGENT_CONFIRM_MATCHING');
  if (!result.ok) { confirmButton.disabled = false; setStatus(errorText(result.error), 'error'); return; }
  const value = await call('ARYA_AGENT_GET_STATE');
  const counts = value?.counts;
  publishButton.disabled = !counts || counts.unmatchedStudents + counts.unmatchedGroups > 0 || !counts.attendanceKnown || !counts.homeworkKnown;
  setStatus('Eşleşme kuralı onaylandı. Şimdi aktarımı başlatabilirsiniz.', 'good');
};
publishButton.onclick = async () => {
  publishButton.disabled = true; scanButton.disabled = true;
  setStatus('Doğrulanan anlık görüntüler Arya’ya aktarılıyor…');
  const result = await call('ARYA_AGENT_PUBLISH');
  scanButton.disabled = false;
  if (!result.ok) { setStatus(errorText(result.error), 'error'); await refresh(); return; }
  review.hidden = true;
  setStatus('Tamamlandı. CRM ve kurs anlık görüntüleri Arya Kurum Takip’e kaydedildi.', 'good');
  await refresh();
};

autoSync.onchange = async () => {
  const result = await call('ARYA_AGENT_AUTO_SYNC', { enabled: autoSync.checked });
  if (!result.ok) { autoSync.checked = false; setStatus(errorText(result.error), 'error'); return; }
  setStatus(result.autoSync ? 'Otomatik tarama açıldı: 6 saatte bir, bu tarayıcı açıkken.' : 'Otomatik tarama kapatıldı.', 'good');
};
clearButton.onclick = async () => {
  await call('ARYA_AGENT_CLEAR');
  review.hidden = true; approve.checked = false; publishButton.disabled = true;
  setStatus('Bu tarayıcı oturumundaki bekleyen kayıtlar silindi.', 'good');
};

void refresh();
