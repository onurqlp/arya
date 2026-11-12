import { createHash } from 'node:crypto';
// Isolated read-only integration. No message database, Meta or OpenAI imports.
const SOURCES = {
  crm: { label: 'CRM', host: 'crm.aydadil.com', prefix: 'ARYA_CRM_READ' },
  course: { label: 'Kurs paneli', host: 'kurs.aydadil.com', prefix: 'ARYA_COURSE_READ' }
};
export const queries = {
  overdue: { label: 'Geciken ödemeler', sources: ['crm'] },
  absence: { label: 'Devamsızlık kayıtları', sources: ['course'] },
  homework: { label: 'Kontrol edilmiş eksik ödevler', sources: ['course'] },
  group: { label: 'Grup durumu', sources: ['course'] },
  student: { label: 'Öğrenci durumu', sources: ['course'] }
};
const text = (value, max = 160) => typeof value === 'string' && value.trim().length > 0 && value.length <= max;
const id = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,99}$/.test(value);
const day = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
const fold = value => String(value || '').trim().toLocaleLowerCase('tr-TR').normalize('NFC');
const unique = rows => new Set(rows.map(row => row.id)).size === rows.length;

function configuration(kind, env) {
  const spec = SOURCES[kind];
  if (!spec) return { state: 'invalid_config' };
  const raw = env[spec.prefix + '_URL'], token = env[spec.prefix + '_TOKEN'];
  if (!raw && !token) return { state: 'not_configured' };
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' || url.hostname !== spec.host || url.port || url.username || url.password ||
        url.hash || url.search || !text(token, 4096) || /[\r\n]/.test(token)) throw Error();
    return { state: 'configured', url: url.href, token };
  } catch { return { state: 'invalid_config' }; }
}
export function sourceStatus(env = process.env) {
  return Object.fromEntries(Object.entries(SOURCES).map(([kind, spec]) =>
    [kind, { kind, label: spec.label, state: configuration(kind, env).state }]));
}
export function connectionFingerprint(kind, env = process.env) {
  const config = configuration(kind, env);
  return config.state === 'configured' ? createHash('sha256').update(JSON.stringify([kind, config.url, config.token])).digest('hex') : null;
}
export function validateQuery(input) {
  return input && Object.hasOwn(queries, input.type) && typeof input.search === 'string' && input.search.length <= 120;
}

export function validSnapshot(data, kind) {
  if (!data || data.version !== 1 || data.complete !== true || !day(data.coverage?.from) ||
      !day(data.coverage?.to) || data.coverage.from > data.coverage.to) return false;
  const arrays = kind === 'crm' ? ['students', 'groups', 'payments'] : ['students', 'groups', 'attendance', 'homework'];
  if (arrays.some(key => !Array.isArray(data[key]) || data[key].length > 10000 ||
      data[key].some(row => !row || !id(row.id)) || !unique(data[key]))) return false;
  const groupIds = new Set(data.groups.map(row => row.id)), studentIds = new Set(data.students.map(row => row.id));
  if (!data.groups.every(row => text(row.name) && text(row.level, 20) && text(row.teacher) && typeof row.active === 'boolean')) return false;
  const validPhone = value => value === undefined || value === null || (typeof value === 'string' &&
    value.length <= 32 && /^\\+?[0-9 ()-]{7,32}$/.test(value.trim()));
  if (!data.students.every(row => text(row.name) && typeof row.active === 'boolean' && Array.isArray(row.groupIds) &&
      row.groupIds.length <= 100 && row.groupIds.every(g => groupIds.has(g)) && validPhone(row.phone))) return false;
  const reference = row => studentIds.has(row.studentId) && groupIds.has(row.groupId);
  if (kind === 'crm') return data.payments.every(row => reference(row) && day(row.dueDate) &&
    Number.isSafeInteger(row.remainingMinor) && row.remainingMinor >= 0 &&
    ['TRY', 'EUR', 'USD', 'GBP', 'CHF'].includes(row.currency) && ['open', 'paid', 'cancelled'].includes(row.status));
  return data.attendance.every(row => reference(row) && day(row.date) && row.date >= data.coverage.from &&
    row.date <= data.coverage.to && ['present', 'absent', 'excused', 'unrecorded'].includes(row.status)) &&
    data.homework.every(row => reference(row) && day(row.date) && row.date >= data.coverage.from &&
    row.date <= data.coverage.to && ['done', 'missing', 'unchecked', 'submitted'].includes(row.status));
}

export function minimalSnapshot(data, kind) {
  const pick = (rows, fields) => rows.map(row => Object.fromEntries(fields.map(key => [key, row[key]])));
  return { version: 1, complete: true, coverage: { from: data.coverage.from, to: data.coverage.to },
    students: pick(data.students, ['id', 'name', 'phone', 'active', 'groupIds']),
    groups: pick(data.groups, ['id', 'name', 'level', 'teacher', 'active']),
    ...(kind === 'crm' ? { payments: pick(data.payments, ['id', 'studentId', 'groupId', 'dueDate', 'remainingMinor', 'currency', 'status']) }
      : { attendance: pick(data.attendance, ['id', 'studentId', 'groupId', 'date', 'status']),
        homework: pick(data.homework, ['id', 'studentId', 'groupId', 'date', 'status']) }) };
}

async function limitedJson(response) {
  const max = 2 * 1024 * 1024;
  if (Number(response.headers.get('content-length')) > max ||
      !/application\/json\b/i.test(response.headers.get('content-type') || '')) throw Error();
  const reader = response.body?.getReader();
  if (!reader) throw Error();
  const chunks = []; let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > max) throw Error();
      chunks.push(value);
    }
  } catch (error) { await reader.cancel().catch(() => {}); throw error; }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return JSON.parse(new TextDecoder().decode(bytes));
}
export async function readSource(kind, env = process.env, fetchImpl = fetch, now = new Date()) {
  const config = configuration(kind, env), meta = sourceStatus(env)[kind] || { kind, state: 'invalid_config' };
  if (config.state !== 'configured') return meta;
  try {
    const response = await fetchImpl(config.url, {
      method: 'GET', redirect: 'error', cache: 'no-store',
      headers: { Accept: 'application/json', Authorization: 'Bearer ' + config.token },
      signal: AbortSignal.timeout(8000)
    });
    if (!response.ok) return { ...meta, state: [401, 403].includes(response.status) ? 'unauthorized' : 'unavailable' };
    let data;
    try { data = await limitedJson(response); if (!validSnapshot(data, kind)) throw Error(); }
    catch { return { ...meta, state: 'invalid_response' }; }
    const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Istanbul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
    if (data.coverage.to !== today) return { ...meta, state: 'stale' };
    return { ...meta, state: 'verified', retrievedAt: now.toISOString(), data: minimalSnapshot(data, kind) };
  } catch { return { ...meta, state: 'unavailable' }; }
}

function money(value, currency) {
  const minor = BigInt(value);
  return (minor / 100n).toLocaleString('tr-TR') + ',' + String(minor % 100n).padStart(2, '0') + ' ' + currency;
}
function balances(payments) {
  const totals = new Map();
  for (const p of payments.filter(p => p.status === 'open' && p.remainingMinor > 0))
    totals.set(p.currency, (totals.get(p.currency) || 0n) + BigInt(p.remainingMinor));
  return [...totals].map(([currency, value]) => money(value, currency)).join(' · ') || 'Açık bakiye yok';
}
function metadata(sources, required) {
  return required.map(kind => ({ kind, label: SOURCES[kind].label, state: sources[kind]?.state || 'not_configured',
    ...(sources[kind]?.retrievedAt ? { retrievedAt: sources[kind].retrievedAt } : {}),
    ...(sources[kind]?.data?.coverage ? { coverage: sources[kind].data.coverage } : {}) }));
}
export function queryOperations(input, sources = {}, now = new Date()) {
  const result = { status: 'invalid', message: 'Geçerli bir sorgu ve en fazla 120 karakterlik filtre seçin.', columns: [], rows: [], total: null, truncated: false, sources: [] };
  if (!validateQuery(input)) return result;
  const required = queries[input.type].sources, meta = metadata(sources, required);
  result.sources = meta;
  const available = required.filter(kind => sources[kind]?.state === 'verified');
  if (!available.length || (input.type === 'overdue_absence' && available.length !== 2))
    return { ...result, status: 'unavailable', message: 'Bu sorgu için gerekli veri bağlantısı hazır değil. Sonuç hesaplanmadı.' };
  const crm = available.includes('crm') ? sources.crm.data : null;
  const course = available.includes('course') ? sources.course.data : null;
  const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Istanbul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  const students = new Map([...(course?.students || []), ...(crm?.students || [])].map(row => [row.id, row]));
  const groups = new Map([...(course?.groups || []), ...(crm?.groups || [])].map(row => [row.id, row]));
  const search = fold(input.search);
  const matches = (studentId, groupId) => !search || [students.get(studentId)?.name, studentId, groups.get(groupId)?.name, groupId]
    .some(value => fold(value).includes(search));
  const overdue = (crm?.payments || []).filter(p => p.status === 'open' && p.remainingMinor > 0 && p.dueDate < today);
  const absence = (course?.attendance || []).filter(a => a.status === 'absent');
  const missing = (course?.homework || []).filter(h => h.status === 'missing');
  let rows = [], columns = [];
  if (['overdue', 'overdue_absence'].includes(input.type)) {
    const absentIds = new Set(absence.map(a => a.studentId + '\u0000' + a.groupId));
    columns = ['Öğrenci', 'Grup', 'Vade', 'Kalan'];
    rows = overdue.filter(p => matches(p.studentId, p.groupId) && (input.type === 'overdue' || absentIds.has(p.studentId + '\u0000' + p.groupId)))
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate)).map(p => [students.get(p.studentId).name, groups.get(p.groupId).name, p.dueDate, money(p.remainingMinor, p.currency)]);
  } else if (['absence', 'homework'].includes(input.type)) {
    columns = ['Öğrenci', 'Grup', 'Tarih', 'Durum'];
    rows = (input.type === 'absence' ? absence : missing).filter(a => matches(a.studentId, a.groupId))
      .sort((a, b) => b.date.localeCompare(a.date)).map(a => [students.get(a.studentId).name, groups.get(a.groupId).name, a.date,
        input.type === 'absence' ? 'Mazeretsiz devamsızlık' : 'Kontrol edildi · eksik']);
  } else {
    const isStudent = input.type === 'student';
    if (isStudent && !search) return { ...result, message: 'Öğrenci adı veya öğrenci kimliği girin.' };
    const collection = [...(isStudent ? students : groups).values()];
    const exact = collection.filter(row => row.id === input.search.trim());
    const candidates = exact.length ? exact : collection.filter(row => (!search || fold(row.name).includes(search) || fold(row.id).includes(search)) && (isStudent || row.active));
    if (candidates.length > 1) return { ...result, status: 'needs_selection', message: 'Birden fazla eşleşme var. Kimliği filtre alanına yazarak seçin.',
      columns: ['Kimlik', 'Ad'], rows: candidates.slice(0, 50).map(row => [row.id, row.name]), total: candidates.length, truncated: candidates.length > 50 };
    if (candidates.length === 0) return { ...result, status: available.length < required.length ? 'partial' : 'ready',
      message: 'Erişilebilen kaynaklarda bu filtreyle kayıt bulunamadı.', total: 0 };
    const item = candidates[0];
    const scoped = row => isStudent ? row.studentId === item.id : row.groupId === item.id;
    columns = ['Bilgi', 'Durum'];
    rows = [['Kimlik', item.id], [isStudent ? 'Öğrenci' : 'Grup', item.name]];
    if (!isStudent) rows.push(['Öğretmen', item.teacher], ['Seviye', item.level],
      ['Aktif öğrenci', String([...students.values()].filter(s => s.active && s.groupIds.includes(item.id)).length)]);
    else rows.push(['Gruplar', item.groupIds.map(g => groups.get(g)?.name || g).join(', ') || 'Grup atanmamış']);
    rows.push(['Kalan ödeme', crm ? balances(crm.payments.filter(scoped)) : 'Erişilemiyor'],
      ['Geciken taksit', crm ? String(overdue.filter(scoped).length) : 'Erişilemiyor'],
      ['Devamsızlık kaydı', course ? String(absence.filter(scoped).length) : 'Erişilemiyor'],
      ['Kontrol edilmiş eksik ödev', course ? String(missing.filter(scoped).length) : 'Erişilemiyor']);
  }
  return { ...result, status: available.length < required.length ? 'partial' : 'ready',
    message: available.length < required.length ? 'Kısmi sonuç: erişilemeyen kaynağın bilgileri hesaplanmadı.' : 'Sonuçlar aşağıda belirtilen kaynak kapsamına göre hazırlandı.',
    columns, rows: rows.slice(0, 50), total: rows.length, truncated: rows.length > 50 };
}
