const labels = {
  not_configured: 'Bağlantı bekleniyor', configured: 'İlk tarama bekleniyor', not_scanned: 'Henüz taranmadı',
  verified: 'Veri alındı', invalid_config: 'Bağlantı ayarı kontrol edilmeli', unauthorized: 'Giriş yetkisi gerekli',
  unavailable: 'Kaynağa ulaşılamadı', invalid_response: 'Veri bağlantısı tamamlanmalı',
  storage_unavailable: 'Tarama kaydına ulaşılamadı', stale: 'Son tarama güncel değil'
};
const when = value => value ? new Date(value).toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' }) : 'Henüz başarılı tarama yok';
function node(tag, text, className) {
  const element = document.createElement(tag);
  if (text !== undefined) element.textContent = text;
  if (className) element.className = className;
  return element;
}

export function mountOperations(page, { api, onUnauthorized }) {
  let active = true, busy = false, status = null;
  page.innerHTML = `
    <div class="pagehead"><div><div class="eyebrow">Arya · kurum yönetimi</div><h1>Kurum Takip</h1>
      <p>Ödeme, devam ve ödev durumunu tek yerden takip edin.</p></div><span class="pill">Yalnızca görüntüleme</span></div>
    <div class="ops-layout">
      <section class="card ops-query"><div class="cardhead"><div><h2>Neyi kontrol edelim?</h2><p>Bir sorgu seçin; isterseniz öğrenci veya grupla daraltın.</p></div></div>
        <form id="operationsForm"><label for="operationType">Sorgu</label><select id="operationType" disabled><option>Yükleniyor…</option></select>
          <label for="operationSearch">Öğrenci / grup filtresi <span class="muted-note">(isteğe bağlı)</span></label>
          <input id="operationSearch" maxlength="120" placeholder="Örnek: B1 Kasım veya öğrenci adı" autocomplete="off">
          <p class="muted-note">Aynı isimli öğrenciler varsa seçmeniz için kimlikleri gösterilir.</p>
          <button class="btn primary" type="submit" id="operationsSubmit" disabled>Sorgula</button>
        </form><div class="ops-shortcuts" id="operationsShortcuts" aria-label="Hızlı sorgular"></div>
      </section>
      <aside class="ops-sidebar"><section class="card"><div class="cardhead"><h2>Veri bağlantıları</h2><button class="btn secondary" id="operationsStatusRefresh" type="button">Durumu yenile</button></div>
        <div id="operationsSources" aria-live="polite">Bağlantı durumu yükleniyor…</div>
        <div class="ops-schedule"><strong>Günde 3 tarama</strong><p>09.00 · 14.00 · 19.00 <span class="muted-note">Türkiye saati</span></p><p class="muted-note" id="operationsScheduleState"></p>
          <button type="button" class="btn secondary" id="operationsScan">Şimdi tara</button></div>
      </section><section class="card ops-about"><h2>Bağlantıyı tamamlama</h2><p>CRM ve kurs panelinin yetkili veri erişimi tanımlandığında taramalar bu kaynaklardan alınır. Yönetici şifresini buradaki sorgu alanına yazmayın.</p>
        <a href="https://crm.aydadil.com/login" target="_blank" rel="noopener noreferrer">CRM panelini aç ↗</a>
        <a href="https://kurs.aydadil.com/login" target="_blank" rel="noopener noreferrer">Kurs panelini aç ↗</a>
        <p class="muted-note">Panelde oturum açmak tek başına Arya'nın sunucu bağlantısını kurmaz. Giriş ve veri erişimi birlikte doğrulanmalıdır.</p>
      </section></aside>
    </div>
    <section class="card ops-result" aria-labelledby="operationsResultTitle"><div class="cardhead"><h2 id="operationsResultTitle">Sorgu sonucu</h2><span class="tag blue">Kaynaklı bilgi</span></div>
      <div id="operationsResult" role="status" aria-live="polite"><p class="muted-note">Bir sorgu çalıştırdığınızda sonuç ve kullanılan verilerin tarihi burada görünür. Bağlantı olmadan sayı üretilmez.</p></div>
    </section>`;
  const form = page.querySelector('#operationsForm'), select = page.querySelector('#operationType');
  const search = page.querySelector('#operationSearch'), submit = page.querySelector('#operationsSubmit');
  const result = page.querySelector('#operationsResult'), sources = page.querySelector('#operationsSources');
  const scanButton = page.querySelector('#operationsScan'), refreshButton = page.querySelector('#operationsStatusRefresh');
  const fail = error => {
    if (!active) return;
    if (error.code === 'unauthorized') { onUnauthorized(); return; }
    result.replaceChildren(node('p', 'İşlem tamamlanamadı. Bağlantıyı kontrol edip yeniden deneyin.', 'warning'));
  };
  function showSources(items) {
    sources.replaceChildren();
    for (const kind of ['crm', 'course']) {
      const source = items[kind] || { state: 'not_configured' };
      const row = node('div', undefined, 'ops-source');
      const head = node('div', undefined, 'ops-source-head');
      head.append(node('strong', kind === 'crm' ? 'CRM' : 'Kurs paneli'), node('span', labels[source.state] || 'Kontrol gerekli', 'tag ' + (source.state === 'verified' ? 'green' : 'yellow')));
      row.append(head, node('p', 'Son başarılı tarama: ' + when(source.retrievedAt), 'muted-note'));
      if (source.attemptedAt) row.append(node('p', 'Son deneme: ' + when(source.attemptedAt), 'muted-note'));
      sources.append(row);
    }
  }
  async function loadStatus() {
    refreshButton.disabled = true;
    try {
      const value = await api('/api/admin/operations');
      if (!active) return;
      status = value; showSources(value.sources);
      const previous = select.value;
      select.replaceChildren(...value.queries.map(query => {
        const option = node('option', query.label); option.value = query.type; return option;
      }));
      if (value.queries.some(query => query.type === previous)) select.value = previous;
      select.disabled = false; submit.disabled = false;
      page.querySelector('#operationsScheduleState').textContent = value.schedule?.enabled
        ? 'Zamanlama hazır. Kaynak bağlantıları tamamlanınca veri taraması yapılır.' : 'Tarama planı hazır; zamanlayıcı etkinleştirmesi bekleniyor.';
      const shortcuts = page.querySelector('#operationsShortcuts'); shortcuts.replaceChildren();
      for (const type of ['overdue', 'absence', 'homework', 'overdue_absence']) {
        const choice = value.queries.find(query => query.type === type); if (!choice) continue;
        const button = node('button', choice.label, 'ops-shortcut'); button.type = 'button';
        button.onclick = () => { select.value = type; form.requestSubmit(); }; shortcuts.append(button);
      }
    } catch (error) { fail(error); }
    finally { if (active) refreshButton.disabled = false; }
  }
  function showResult(value) {
    result.replaceChildren(node('p', value.message, value.status === 'unavailable' || value.status === 'invalid' ? 'warning' : 'muted-note'));
    if (value.total !== null && value.columns.length) {
      const wrapper = node('div', undefined, 'ops-table-wrap'), table = node('table', undefined, 'table');
      const header = node('tr'); value.columns.forEach(label => header.append(node('th', label)));
      const thead = node('thead'); thead.append(header); const tbody = node('tbody');
      value.rows.forEach(values => { const tr = node('tr'); values.forEach(value => tr.append(node('td', String(value)))); tbody.append(tr); });
      table.append(thead, tbody); wrapper.append(table); result.append(wrapper);
      result.append(node('p', value.truncated ? `İlk ${value.rows.length} kayıt gösteriliyor · Toplam ${value.total} kayıt.` : `${value.total} satır gösteriliyor.`, 'muted-note'));
    }
    if (value.status === 'ready' && value.total === 0) result.append(node('p', 'Belirtilen kaynak kapsamı ve filtrede eşleşme bulunamadı.'));
    const details = node('div', undefined, 'ops-result-sources');
    for (const source of value.sources || []) {
      const line = source.label + ' · ' + (labels[source.state] || 'Kontrol gerekli') +
        (source.retrievedAt ? ' · Alındı: ' + when(source.retrievedAt) : '') +
        (source.coverage ? ' · Kapsam: ' + source.coverage.from + ' – ' + source.coverage.to : '');
      details.append(node('p', line, 'muted-note'));
    }
    result.append(details);
  }
  form.onsubmit = async event => {
    event.preventDefault(); if (busy || !status) return;
    busy = true; submit.disabled = true; result.replaceChildren(node('p', 'Son tarama verileri kontrol ediliyor…', 'muted-note'));
    try {
      const value = await api('/api/admin/operations', { method: 'POST', body: JSON.stringify({ type: select.value, search: search.value.trim() }) });
      if (!active) return;
      showResult(value);
      const merged = { ...status.sources }; for (const source of value.sources || []) merged[source.kind] = source;
      showSources(merged);
    } catch (error) { fail(error); }
    finally { busy = false; if (active) submit.disabled = false; }
  };
  scanButton.onclick = async () => {
    if (busy) return; busy = true; scanButton.disabled = true; scanButton.textContent = 'Taranıyor…';
    try {
      const value = await api('/api/admin/operations', { method: 'POST', body: JSON.stringify({ action: 'refresh' }) });
      if (!active) return;
      result.replaceChildren(node('p', value.state === 'waiting_for_connections'
        ? 'Tarama başlatılamadı: CRM ve kurs veri bağlantıları henüz tanımlanmadı.'
        : value.state === 'complete' ? 'Tarama tamamlandı. Güncel sonuç için sorgunuzu yeniden çalıştırın.'
          : 'Tarama tam olarak tamamlanamadı. Kaynak durumlarını kontrol edin.', 'muted-note'));
      await loadStatus();
    } catch (error) { fail(error); }
    finally { busy = false; if (active) { scanButton.disabled = false; scanButton.textContent = 'Şimdi tara'; } }
  };
  refreshButton.onclick = loadStatus;
  void loadStatus();
  return () => { active = false; };
}
