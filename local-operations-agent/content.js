(() => {
  const clean = value => String(value || '').replace(/\s+/g, ' ').trim();
  const fold = value => clean(value).toLocaleLowerCase('tr-TR').normalize('NFC');
  const uuidFrom = (value, expression) => {
    const match = String(value || '').match(expression);
    return match ? match[1] : null;
  };
  const asDate = value => {
    const raw = clean(value);
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
    const match = raw.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/);
    if (!match) return null;
    return `${match[3]}-${match[2].padStart(2, '0')}-${match[1].padStart(2, '0')}`;
  };
  function activeValue(value) {
    const text = fold(value);
    if (/pasif|arşiv|arsiv|beklemede|inactive/.test(text)) return false;
    if (/aktif|active|devam/.test(text)) return true;
    return null;
  }
  function tableRows(requiredHeaders) {
    const tables = [...document.querySelectorAll('table')];
    for (const table of tables) {
      const headers = [...table.querySelectorAll('thead th')].map(cell => clean(cell.innerText));
      const normalized = headers.map(fold);
      if (requiredHeaders.every(group => normalized.some(header => group.some(term => header.includes(term))))) {
        return { table, headers, rows: [...table.querySelectorAll('tbody tr')].filter(row => row.querySelectorAll('td').length) };
      }
    }
    return null;
  }
  function headerIndex(headers, terms) {
    return headers.findIndex(header => terms.some(term => fold(header).includes(term)));
  }
  function totalHint() {
    const body = clean(document.body?.innerText);
    const match = body.match(/(?:tümü|toplam|kayıtlar)\s*\(?\s*(\d{1,6})\s*\)?/i);
    return match ? Number(match[1]) : null;
  }
  function visibleCompleteness(count) {
    const next = [...document.querySelectorAll('button,a,[role="button"]')].some(node => {
      const label = fold(node.getAttribute('aria-label') || node.getAttribute('title') || node.innerText);
      return /sonraki|next|ileri/.test(label) && !node.disabled && node.getAttribute('aria-disabled') !== 'true';
    });
    const total = totalHint();
    return { count, total, complete: !next && (total === null || total === count), hasNextPage: next };
  }
  function parseStudents() {
    const found = tableRows([['öğrenci', 'ogrenci'], ['iletişim', 'iletisim', 'telefon'], ['durum']]);
    if (!found) return { error: 'students_table_not_found' };
    const idx = {
      name: headerIndex(found.headers, ['öğrenci', 'ogrenci', 'ad soyad']),
      phone: headerIndex(found.headers, ['iletişim', 'iletisim', 'telefon', 'gsm']),
      level: headerIndex(found.headers, ['seviye', 'düzey', 'duzey']),
      group: headerIndex(found.headers, ['grup']),
      status: headerIndex(found.headers, ['durum'])
    };
    if (Object.values(idx).some(value => value < 0)) return { error: 'students_columns_missing' };
    const rows = found.rows.map(row => {
      const cells = [...row.querySelectorAll('td')];
      const detail = row.querySelector('a[href*="/ogrenciler/"]');
      const id = uuidFrom(detail?.getAttribute('href'), /\/ogrenciler\/([0-9a-f-]{36})(?:[/?#]|$)/i);
      const name = clean(cells[idx.name]?.innerText);
      const phone = clean(cells[idx.phone]?.innerText).match(/\+?[\d ()-]{7,}/)?.[0]?.trim() || '';
      const level = clean(cells[idx.level]?.innerText);
      const groupNames = [...cells[idx.group].querySelectorAll('a,span')].map(node => clean(node.innerText)).filter(Boolean);
      const groupText = clean(cells[idx.group]?.innerText);
      const active = activeValue(cells[idx.status]?.innerText);
      return { id, name, phone, level, groupNames: groupNames.length ? groupNames : (groupText ? [groupText] : []), active };
    });
    const invalid = rows.some(row => !row.id || !row.name || !row.phone || row.active === null);
    return { part: 'students', rows, completeness: visibleCompleteness(rows.length), invalid };
  }
  function parseGroups(activeOverride = null) {
    const found = tableRows([['grup'], ['seviye', 'düzey', 'duzey']]);
    if (!found) return { error: 'groups_table_not_found' };
    const rows = found.rows.map(row => {
      const cells = [...row.querySelectorAll('td')];
      const detail = row.querySelector('a[href*="/gruplar/"]');
      const id = uuidFrom(detail?.getAttribute('href'), /\/gruplar\/([0-9a-f-]{36})(?:[/?#]|$)/i);
      const levelIndex = headerIndex(found.headers, ['seviye', 'düzey', 'duzey']);
      const teacherIndex = headerIndex(found.headers, ['öğretmen', 'ogretmen', 'eğitmen', 'egitmen', 'hoca']);
      const statusIndex = headerIndex(found.headers, ['durum']);
      const nameIndex = headerIndex(found.headers, ['grup adı', 'grup adi', 'grup']);
      const name = nameIndex >= 0 ? clean(cells[nameIndex]?.innerText) : clean(detail?.innerText);
      const level = levelIndex >= 0 ? clean(cells[levelIndex]?.innerText) : '';
      const teacher = teacherIndex >= 0 ? clean(cells[teacherIndex]?.innerText) : '';
      const active = activeOverride !== null ? activeOverride : statusIndex >= 0 ? activeValue(cells[statusIndex]?.innerText) : true;
      return { id, name, level, teacher, active };
    });
    return { part: 'groups', rows, completeness: visibleCompleteness(rows.length), invalid: rows.some(row => !row.id || !row.name || !row.level || !row.teacher || row.active === null) };
  }
  async function parseAllGroups() {
    const controls = [...document.querySelectorAll('button,[role="button"],select')];
    const allButton = controls.find(node => node.tagName !== 'SELECT' && /^tümü$/i.test(clean(node.innerText)));
    const activeButton = controls.find(node => node.tagName !== 'SELECT' && /^aktif$/i.test(clean(node.innerText)));
    const archivedButton = controls.find(node => node.tagName !== 'SELECT' && /^arşivlenmiş$|^arsivlenmis$/i.test(clean(node.innerText)));
    const statusSelect = controls.find(node => node.tagName === 'SELECT' && [...node.options].some(option => /aktif/i.test(option.text)) && [...node.options].some(option => /arşivlenmiş|arsivlenmis/i.test(option.text)));
    const results = [];
    if (statusSelect) {
      const options = [...statusSelect.options];
      for (const [pattern, active] of [[/aktif/i, true], [/arşivlenmiş|arsivlenmis/i, false]]) {
        const option = options.find(item => pattern.test(item.text));
        if (!option) continue;
        statusSelect.value = option.value; statusSelect.dispatchEvent(new Event('input', { bubbles: true })); statusSelect.dispatchEvent(new Event('change', { bubbles: true }));
        await new Promise(resolve => setTimeout(resolve, 350));
        results.push(parseGroups(active));
      }
    } else if (activeButton && archivedButton) {
      for (const [button, active] of [[activeButton, true], [archivedButton, false]]) {
        button.click(); await new Promise(resolve => setTimeout(resolve, 350)); results.push(parseGroups(active));
      }
    }
    if (results.length === 0 && allButton) {
      allButton.click(); await new Promise(resolve => setTimeout(resolve, 350));
      const value = parseGroups(); value.completeness.complete = value.completeness.complete && value.completeness.count === value.completeness.total;
      return value;
    }
    if (results.length !== 2 || results.some(value => value.error || value.invalid || value.completeness.hasNextPage)) return { error: 'crm_groups_filter_incomplete' };
    const byId = new Map();
    for (const result of results) for (const row of result.rows) byId.set(row.id, row);
    const rows = [...byId.values()];
    const total = results.map(value => value.completeness.total).find(value => value !== null) ?? null;
    return { part: 'groups', rows, completeness: { count: rows.length, total, complete: total === null || total === rows.length, hasNextPage: false }, invalid: rows.some(row => !row.id || !row.name || !row.level || !row.teacher || row.active === null) };
  }
  function moneyMinor(value) {
    const raw = clean(value);
    const currency = /€/u.test(raw) ? 'EUR' : /\$/u.test(raw) ? 'USD' : /£/u.test(raw) ? 'GBP' : 'TRY';
    const numeric = raw.replace(/[^\d,.-]/g, '').replace(/\.(?=\d{3}(?:\D|$))/g, '').replace(',', '.');
    const amount = Number(numeric);
    if (!Number.isFinite(amount) || amount < 0 || amount > 100000000) return null;
    return { remainingMinor: Math.round(amount * 100), currency };
  }
  function parsePayments() {
    const found = tableRows([['öğrenci', 'ogrenci'], ['tutar'], ['vade', 'tarih'], ['durum']]);
    if (!found) return { error: 'payments_table_not_found' };
    const idx = {
      student: headerIndex(found.headers, ['öğrenci', 'ogrenci']),
      amount: headerIndex(found.headers, ['tutar', 'kalan']),
      dueDate: headerIndex(found.headers, ['vade', 'tarih']),
      status: headerIndex(found.headers, ['durum'])
    };
    if (Object.values(idx).some(value => value < 0)) return { error: 'payments_columns_missing' };
    const rows = found.rows.map((row, index) => {
      const cells = [...row.querySelectorAll('td')];
      const studentLink = row.querySelector('a[href*="/ogrenciler/"]');
      const studentId = uuidFrom(studentLink?.getAttribute('href'), /\/ogrenciler\/([0-9a-f-]{36})(?:[/?#]|$)/i);
      const amount = moneyMinor(cells[idx.amount]?.innerText);
      const dueDate = asDate(cells[idx.dueDate]?.innerText);
      const statusText = fold(cells[idx.status]?.innerText);
      const status = /iptal|cancel/.test(statusText) ? 'cancelled' : /ödendi|odendi|paid|tahsil/.test(statusText) ? 'paid' : 'open';
      const rowId = clean(row.getAttribute('data-id') || row.id);
      const id = rowId && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,99}$/.test(rowId)
        ? rowId : `payment:${studentId || 'unknown'}:${dueDate || 'unknown'}:${amount?.remainingMinor ?? 'unknown'}:${index}`;
      return { id, studentId, groupId: null, dueDate, remainingMinor: status === 'paid' ? 0 : amount?.remainingMinor,
        currency: amount?.currency, status };
    });
    return { part: 'payments', rows, completeness: visibleCompleteness(rows.length), invalid: rows.some(row => !row.studentId || !row.dueDate || !Number.isSafeInteger(row.remainingMinor) || !row.currency) };
  }
  function isoFromCard(text, href) {
    try {
      const value = new URL(href, location.origin).searchParams.get('tarih');
      const parsed = asDate(value || '');
      if (parsed) return parsed;
    } catch {}
    const months = { 'oca': '01', 'şub': '02', 'sub': '02', 'mar': '03', 'nis': '04', 'may': '05', 'haz': '06', 'tem': '07', 'ağu': '08', 'agu': '08', 'eyl': '09', 'eki': '10', 'kas': '11', 'ara': '12' };
    const match = clean(text).toLocaleLowerCase('tr-TR').match(/(\d{1,2})\s+(oca|şub|sub|mar|nis|may|haz|tem|ağu|agu|eyl|eki|kas|ara)(?:\s+(\d{2,4}))?/);
    if (!match) return null;
    const year = match[3] ? (match[3].length === 2 ? '20' + match[3] : match[3]) : String(new Date().getFullYear());
    return `${year}-${months[match[2]]}-${match[1].padStart(2, '0')}`;
  }
  function parseCourseOverview() {
    const links = [...document.querySelectorAll('a[href*="/ogretmen/grup/"]')];
    const sessions = [];
    for (const link of links) {
      const href = link.getAttribute('href') || '';
      const groupId = uuidFrom(href, /\/ogretmen\/grup\/([0-9a-f-]{36})(?:[/?#]|$)/i);
      const card = link.closest('article,li,[class*="rounded"],[class*="card"]') || link.parentElement;
      const text = clean(card?.innerText || link.innerText);
      const date = isoFromCard(text, href);
      if (!groupId || !date) continue;
      const heading = card?.querySelector('h1,h2,h3,h4,strong') || link;
      const name = clean(heading.innerText || link.innerText);
      const level = text.match(/\b(A1|A2|B1|B2|C1)\b/i)?.[1]?.toUpperCase() || '';
      const teacherMatch = text.match(/(?:öğretmen|ogretmen|eğitmen|egitmen|hoca)\s*[:·-]?\s*([^\n·]+)/i);
      const teacher = teacherMatch ? clean(teacherMatch[1]) : '';
      sessions.push({ groupId, name, date, level, teacher, href: new URL(href, location.origin).href, cardText: text });
    }
    const unique = [...new Map(sessions.map(session => [`${session.groupId}:${session.date}`, session])).values()];
    return { part: 'courseSessions', sessions: unique, complete: unique.length > 0,
      route: location.pathname, month: new Date().toISOString().slice(0, 7) };
  }
  function selectedButton(button) {
    if (button.getAttribute('aria-pressed') === 'true' || button.getAttribute('aria-checked') === 'true' || button.dataset.state === 'on') return true;
    const cls = String(button.className || '').toLocaleLowerCase('tr-TR');
    return /\b(selected|active|is-active|is-selected|ring-2)\b/.test(cls);
  }
  function parseAttendanceRow(row, date, groupId, index) {
    const text = clean(row.innerText);
    const phone = text.match(/\+?[\d ()-]{7,}/)?.[0]?.trim() || '';
    const nameNode = row.querySelector('[data-student-name],strong,b') || row.querySelector('a') || row;
    const name = clean(nameNode.innerText).replace(phone, '').trim();
    const buttons = [...row.querySelectorAll('button,[role="button"]')];
    const presentButton = buttons.find(button => /^var$/i.test(clean(button.innerText)));
    const absentButton = buttons.find(button => /^yok$/i.test(clean(button.innerText)));
    const presentSelected = presentButton && selectedButton(presentButton);
    const absentSelected = absentButton && selectedButton(absentButton);
    let status = null, known = false;
    if (presentSelected && !absentSelected) { status = 'present'; known = true; }
    else if (absentSelected && !presentSelected) { status = 'absent'; known = true; }
    else if (!presentButton && !absentButton) {
      const statusCell = [...row.querySelectorAll('td,[data-status]')].map(node => fold(node.innerText || node.getAttribute('data-status')))
        .find(value => /mazeret|yoklama|katıldı|katildi|gelmedi|devamsız|devamsiz|unrecorded|present|absent/.test(value)) || '';
      if (/mazeret/.test(statusCell)) { status = 'excused'; known = true; }
      else if (/gelmedi|devamsız|devamsiz|absent/.test(statusCell)) { status = 'absent'; known = true; }
      else if (/katıldı|katildi|present/.test(statusCell)) { status = 'present'; known = true; }
      else if (/yoklama girilmedi|kayıt yok|kayit yok|unrecorded/.test(statusCell)) { status = 'unrecorded'; known = true; }
    }
    return { sourceKey: phone ? phone.replace(/\D/g, '') : '', name, phone, groupId, date, status, known, rowIndex: index };
  }
  function parseHomeworkRows() {
    const section = [...document.querySelectorAll('section,article,div')].find(node => {
      const heading = node.querySelector('h1,h2,h3,h4');
      return heading && fold(heading.innerText).includes('ödev kontrol');
    });
    if (!section) return { known: false, rows: [] };
    const rows = [...section.querySelectorAll('tr,li,[data-student-id]')].filter(node => {
      const text = fold(node.innerText);
      return /teslim|tamam|eksik|kontrol/.test(text) && /\+?[\d ()-]{7,}/.test(node.innerText || '');
    }).map((row, index) => {
      const text = clean(row.innerText), phone = text.match(/\+?[\d ()-]{7,}/)?.[0]?.trim() || '';
      const f = fold(text);
      const status = /eksik|yapmadı|yapmadi|missing/.test(f) ? 'missing' : /teslim|tamam|yaptı|yapti|done/.test(f) ? 'done' : /kontrol edilmedi|bekliyor|unchecked/.test(f) ? 'unchecked' : null;
      return { sourceKey: phone.replace(/\D/g, ''), phone, status, known: Boolean(status), rowIndex: index };
    });
    const pageText = fold(section.innerText);
    const assignmentChecked = [...section.querySelectorAll('input[type="checkbox"]')].some(input => input.checked);
    const explicitNone = /ödev verilmedi|ödev gönderilmedi|ödev atanmamış/.test(pageText) || !assignmentChecked;
    return { known: explicitNone || (rows.length > 0 && rows.every(row => row.sourceKey && row.known)), rows, explicitNone };
  }
  function parseCourseDetail() {
    const groupId = uuidFrom(location.pathname, /\/ogretmen\/grup\/([0-9a-f-]{36})(?:\/|$)/i);
    const date = asDate(new URL(location.href).searchParams.get('tarih') || document.querySelector('input[type="date"]')?.value || '');
    if (!groupId || !date) return { error: 'course_detail_identity_missing' };
    const heading = clean(document.querySelector('h1')?.innerText);
    const tables = [...document.querySelectorAll('table')];
    let roster = [];
    for (const table of tables) {
      const headers = [...table.querySelectorAll('thead th')].map(node => fold(node.innerText));
      const nameIndex = headers.findIndex(value => /öğrenci|ogrenci|ad/.test(value));
      const phoneIndex = headers.findIndex(value => /telefon|iletişim|iletisim/.test(value));
      if (nameIndex < 0 || phoneIndex < 0) continue;
      roster = [...table.querySelectorAll('tbody tr')].map((row, index) => parseAttendanceRow(row, date, groupId, index));
      break;
    }
    if (!roster.length) {
      const rows = [...document.querySelectorAll('li,[data-student-id],[class*="group-hover:border-primary"]')];
      roster = rows.map((row, index) => parseAttendanceRow(row, date, groupId, index)).filter(row => row.sourceKey);
    }
    const homework = parseHomeworkRows();
    const pageText = fold(document.body?.innerText);
    const classDone = /ders yapıldı/.test(pageText) && !/ders yapıldı mı/.test(pageText);
    const noRoster = /crm'de bu grupta kayıtlı öğrenci yok|öğrenci bulunamadı/.test(pageText);
    const detailsText = fold(document.body?.innerText);
    const teacherMatch = detailsText.match(/(?:öğretmen|ogretmen|eğitmen|egitmen)\s*[:·-]?\s*([^\n·]+)/i);
    const level = detailsText.match(/\b(A1|A2|B1|B2|C1)\b/i)?.[1]?.toUpperCase() || '';
    return {
      part: 'courseDetail', groupId, date, name: heading, level,
      teacher: teacherMatch ? clean(teacherMatch[1]) : '', roster,
      attendanceKnown: (roster.length > 0 && roster.every(row => row.sourceKey && row.known && ['present', 'absent', 'excused', 'unrecorded'].includes(row.status))) || noRoster,
      homeworkKnown: homework.known, homeworkRows: homework.rows, homeworkExplicitNone: homework.explicitNone,
      noRoster, classDone, route: location.pathname
    };
  }
  async function scanPage() {
    const host = location.hostname;
    const pageText = fold(document.body?.innerText || '').slice(0, 1200);
    if (/^\/(?:login|giris)(?:\/|$)/i.test(location.pathname) ||
        (document.querySelector('input[type="password"]') && /giriş yap|oturum aç|login/.test(pageText))) return { error: 'login_required' };
    if (host === 'crm.aydadil.com') {
      if (location.pathname === '/ogrenciler') return parseStudents();
      if (location.pathname === '/gruplar') return parseAllGroups();
      if (location.pathname === '/odemeler') return parsePayments();
      return { error: 'crm_route_not_supported', route: location.pathname };
    }
    if (host === 'kurs.aydadil.com') {
      if (location.pathname === '/ogretmen') return parseCourseOverview();
      if (/^\/ogretmen\/grup\//.test(location.pathname)) return parseCourseDetail();
      return { error: 'course_route_not_supported', route: location.pathname };
    }
    return { error: 'source_not_allowed' };
  }
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== 'ARYA_SCAN_SOURCE_PAGE') return;
    Promise.resolve().then(scanPage).then(data => sendResponse({ ok: true, data })).catch(() => sendResponse({ ok: false, error: 'page_parse_failed' }));
    return true;
  });
})();
