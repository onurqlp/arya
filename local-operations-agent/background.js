const CRM = 'https://crm.aydadil.com';
const COURSE = 'https://kurs.aydadil.com';
const ARYA = 'https://arya-whatsapp-panel.vercel.app';
const STATE_KEY = 'aryaOpsPending';
const SETTINGS_KEY = 'aryaOpsSettings';
let scanning = false;

const get = async key => (await chrome.storage.session.get(key))[key];
const set = async value => chrome.storage.session.set(value);
const settings = async () => (await chrome.storage.local.get(SETTINGS_KEY))[SETTINGS_KEY] || { exactMatchConfirmed: false, autoSync: false, lastPublishedAt: null };
const todayTR = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Istanbul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const fold = value => String(value || '').trim().toLocaleLowerCase('tr-TR').normalize('NFC').replace(/\s+/g, ' ');
const phoneKey = value => String(value || '').replace(/\D/g, '');
const safeError = (error, fallback = 'scan_failed') => typeof error?.message === 'string' && /^[a-z_]+$/.test(error.message) ? error.message : fallback;

function wait(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
function waitTab(tabId, timeout = 30000) {
  return new Promise((resolve, reject) => {
    let done = false;
    const finish = (error, tab) => {
      if (done) return;
      done = true; clearTimeout(timer); chrome.tabs.onUpdated.removeListener(onUpdated);
      error ? reject(error) : resolve(tab);
    };
    const onUpdated = (id, change, tab) => { if (id === tabId && change.status === 'complete') finish(null, tab); };
    const timer = setTimeout(() => finish(new Error('page_load_timeout')), timeout);
    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.tabs.get(tabId).then(tab => { if (tab.status === 'complete') finish(null, tab); }).catch(error => finish(error));
  });
}
async function sendContent(tabId) {
  let last;
  for (let i = 0; i < 12; i++) {
    try { return await chrome.tabs.sendMessage(tabId, { type: 'ARYA_SCAN_SOURCE_PAGE' }); }
    catch (error) { last = error; await wait(350); }
  }
  throw last || new Error('page_agent_unavailable');
}
async function scanUrl(url) {
  const parsed = new URL(url);
  if (!['crm.aydadil.com', 'kurs.aydadil.com'].includes(parsed.hostname) || parsed.protocol !== 'https:') throw new Error('source_host_not_allowed');
  const tab = await chrome.tabs.create({ url: parsed.href, active: false });
  try {
    await waitTab(tab.id);
    await wait(900);
    let lastError = 'page_parse_failed';
    for (let attempt = 0; attempt < 4; attempt++) {
      const response = await sendContent(tab.id);
      if (!response?.ok || !response.data) throw new Error('page_parse_failed');
      if (!response.data.error) return response.data;
      lastError = response.data.error;
      if (['login_required', 'crm_route_not_supported', 'course_route_not_supported'].includes(lastError)) break;
      await wait(700);
    }
    throw new Error(lastError);
  } finally { await chrome.tabs.remove(tab.id).catch(() => {}); }
}

function completePart(part) {
  if (!part || !Array.isArray(part.rows) || part.invalid || part.completeness?.complete !== true) return false;
  if (part.completeness?.total !== null && part.completeness?.total !== part.rows.length) return false;
  return true;
}
function sourceIdMap(rows) {
  const byPhone = new Map();
  for (const row of rows) {
    const key = phoneKey(row.phone);
    if (!key) continue;
    const list = byPhone.get(key) || [];
    list.push(row); byPhone.set(key, list);
  }
  return byPhone;
}
function groupNameKey(row) { return [fold(row.name), fold(row.level)].join('|'); }
function computeMatches(crm, courseDetails) {
  const crmPhones = sourceIdMap(crm.students);
  const coursePeople = new Map();
  const courseGroups = new Map();
  for (const detail of courseDetails) {
    const current = courseGroups.get(detail.groupId) || { id: detail.groupId, name: detail.name, level: detail.level || '', teacher: detail.teacher || '' };
    if (detail.name) current.name = detail.name;
    if (detail.level) current.level = detail.level;
    if (detail.teacher) current.teacher = detail.teacher;
    courseGroups.set(detail.groupId, current);
    for (const person of detail.roster || []) {
      const key = phoneKey(person.phone);
      if (!key) continue;
      const list = coursePeople.get(key) || [];
      list.push({ ...person, groupId: detail.groupId }); coursePeople.set(key, list);
    }
  }
  const students = [];
  for (const [key, people] of coursePeople) {
    const crmRows = crmPhones.get(key) || [];
    const crmUnique = new Map(crmRows.map(row => [row.id, row]));
    if (crmUnique.size === 1) students.push({ key, crmId: [...crmUnique.keys()][0], count: people.length, state: 'match' });
    else students.push({ key, crmId: null, count: people.length, state: crmUnique.size > 1 ? 'ambiguous' : 'unmatched' });
  }
  const crmGroups = new Map();
  for (const group of crm.groups) {
    const key = groupNameKey(group), list = crmGroups.get(key) || [];
    list.push(group); crmGroups.set(key, list);
  }
  const groups = [...courseGroups.values()].map(group => {
    const candidates = crmGroups.get(groupNameKey(group)) || [];
    return { id: group.id, crmId: candidates.length === 1 ? candidates[0].id : null, state: candidates.length === 1 ? 'match' : candidates.length ? 'ambiguous' : 'unmatched' };
  });
  return { students, groups };
}
function makeSnapshots(crm, courseDetails, courseOverview, approved) {
  if (!approved) throw new Error('explicit_match_approval_required');
  const today = todayTR();
  const firstOfMonth = today.slice(0, 8) + '01';
  const matches = computeMatches(crm, courseDetails);
  if (matches.students.some(row => row.state !== 'match') || matches.groups.some(row => row.state !== 'match')) throw new Error('identity_mapping_incomplete');
  if (courseDetails.some(detail => !detail.attendanceKnown || !detail.homeworkKnown)) throw new Error('course_data_incomplete');
  const studentMap = new Map(matches.students.map(match => [match.key, match.crmId]));
  const groupMap = new Map(matches.groups.map(match => [match.id, match.crmId]));
  const crmStudents = new Map(crm.students.map(row => [row.id, row]));
  const crmGroups = new Map(crm.groups.map(row => [row.id, row]));
  const courseStudentGroups = new Map();
  const attendance = [], homework = [];
  for (const detail of courseDetails) {
    const groupId = groupMap.get(detail.groupId);
    if (!groupId) continue;
    for (const person of detail.roster || []) {
      const studentId = studentMap.get(phoneKey(person.phone));
      if (!studentId) throw new Error('identity_mapping_incomplete');
      const groupSet = courseStudentGroups.get(studentId) || new Set(); groupSet.add(groupId); courseStudentGroups.set(studentId, groupSet);
      if (detail.date >= firstOfMonth && detail.date <= today) attendance.push({
        id: `att:${groupId}:${detail.date}:${studentId}`.slice(0, 100), studentId, groupId, date: detail.date, status: person.status
      });
    }
    for (const item of detail.homeworkRows || []) {
      const studentId = studentMap.get(phoneKey(item.phone));
      if (!studentId) throw new Error('identity_mapping_incomplete');
      if (detail.date >= firstOfMonth && detail.date <= today) homework.push({
        id: `hw:${groupId}:${detail.date}:${studentId}`.slice(0, 100), studentId, groupId, date: detail.date, status: item.status
      });
    }
  }
  const courseIds = new Set([...courseStudentGroups.keys()]);
  const courseGroups = [...groupMap.values()].map(id => crmGroups.get(id)).filter(Boolean);
  const courseStudents = [...courseIds].map(id => {
    const row = crmStudents.get(id);
    if (!row) throw new Error('identity_mapping_incomplete');
    return { ...row, groupIds: [...(courseStudentGroups.get(id) || [])] };
  });
  const coverage = { from: firstOfMonth, to: today };
  const crmSnapshot = { version: 1, complete: true, coverage, students: crm.students, groups: crm.groups, payments: crm.payments };
  const courseSnapshot = { version: 1, complete: true, coverage, students: courseStudents, groups: courseGroups, attendance, homework };
  return { crm: crmSnapshot, course: courseSnapshot, matches: { students: matches.students.length, groups: matches.groups.length },
    pages: { crmStudents: crm.students.length, crmGroups: crm.groups.length, payments: crm.payments.length,
      courseSessions: courseOverview.sessions.length, courseDetails: courseDetails.length, attendance: attendance.length, homework: homework.length } };
}

async function scanAll() {
  if (scanning) throw new Error('scan_already_running');
  scanning = true;
  try {
    const [studentsPart, groupsPart, paymentsPart] = await Promise.all([
      scanUrl(CRM + '/ogrenciler'), scanUrl(CRM + '/gruplar'), scanUrl(CRM + '/odemeler')
    ]);
    if (studentsPart.part !== 'students' || groupsPart.part !== 'groups' || paymentsPart.part !== 'payments' ||
        !completePart(studentsPart) || !completePart(groupsPart) || !completePart(paymentsPart)) throw new Error('crm_data_incomplete');
    const rawGroups = groupsPart.rows;
    const groupsByName = new Map();
    for (const group of rawGroups) {
      const key = fold(group.name), list = groupsByName.get(key) || [];
      list.push(group); groupsByName.set(key, list);
    }
    const crmStudents = studentsPart.rows.map(row => {
      const groupIds = [];
      for (const name of row.groupNames || []) {
        if (/^(?:-|—|grup yok|grup atanmamış|grup atanmamis|atanmadı|atanmadi)$/i.test(fold(name))) continue;
        const candidates = groupsByName.get(fold(name)) || [];
        if (candidates.length > 1) throw new Error('crm_group_reference_ambiguous');
        if (candidates.length === 1) groupIds.push(candidates[0].id);
        else throw new Error('crm_group_reference_missing');
      }
      return { id: row.id, name: row.name, phone: row.phone, active: row.active, groupIds: [...new Set(groupIds)] };
    });
    const crm = { students: crmStudents, groups: rawGroups.map(({ id, name, level, teacher, active }) => ({ id, name, level, teacher, active })), payments: paymentsPart.rows };
    const overview = await scanUrl(COURSE + '/ogretmen');
    if (overview.part !== 'courseSessions' || !overview.complete || !overview.sessions.length) throw new Error('course_schedule_unavailable');
    const today = todayTR(), from = today.slice(0, 8) + '01';
    const sessions = overview.sessions.filter(item => item.date >= from && item.date <= today);
    if (!sessions.length) throw new Error('course_sessions_not_found');
    if (sessions.length > 200) throw new Error('course_session_limit');
    const details = [];
    for (const session of sessions) {
      const detail = await scanUrl(session.href);
      if (detail.part !== 'courseDetail' || detail.error) throw new Error('course_session_unavailable');
      if (detail.groupId !== session.groupId || detail.date !== session.date) throw new Error('course_session_mismatch');
      detail.name = session.name || detail.name;
      detail.level = session.level || detail.level || '';
      detail.teacher = session.teacher || detail.teacher || '';
      details.push(detail);
    }
    const matches = computeMatches(crm, details);
    const pending = { crm, courseDetails: details, overview, matches,
      counts: { crmStudents: crm.students.length, crmGroups: crm.groups.length, payments: crm.payments.length,
        courseSessions: sessions.length, rosterRows: details.reduce((sum, item) => sum + item.roster.length, 0),
        attendanceKnown: details.every(item => item.attendanceKnown), homeworkKnown: details.every(item => item.homeworkKnown),
        matchedStudents: matches.students.filter(item => item.state === 'match').length,
        unmatchedStudents: matches.students.filter(item => item.state !== 'match').length,
        matchedGroups: matches.groups.filter(item => item.state === 'match').length,
        unmatchedGroups: matches.groups.filter(item => item.state !== 'match').length }
    };
    await set({ [STATE_KEY]: pending });
    const config = await settings();
    return { ok: true, state: 'ready_for_review', counts: pending.counts, exactMatchConfirmed: config.exactMatchConfirmed === true, generatedAt: new Date().toISOString() };
  } catch (error) {
    await chrome.action.setBadgeText({ text: '!' });
    await chrome.action.setBadgeBackgroundColor({ color: '#a33b3b' });
    throw new Error(safeError(error));
  } finally { scanning = false; }
}

async function publishSnapshots() {
  const pending = await get(STATE_KEY);
  const config = await settings();
  if (!pending?.crm || !pending?.courseDetails) throw new Error('scan_required');
  const result = makeSnapshots(pending.crm, pending.courseDetails, pending.overview, config.exactMatchConfirmed === true);
  const crmResult = await postToArya('crm', result.crm);
  const courseResult = await postToArya('course', result.course);
  const configAfter = await settings();
  await chrome.storage.local.set({ [SETTINGS_KEY]: { ...configAfter, lastPublishedAt: new Date().toISOString() } });
  await chrome.storage.session.remove(STATE_KEY);
  await chrome.action.setBadgeText({ text: 'OK' });
  await chrome.action.setBadgeBackgroundColor({ color: '#247a60' });
  return { ok: true, state: 'published', crm: crmResult, course: courseResult, counts: result.pages };
}

async function postToArya(kind, snapshot) {
  let tabs = await chrome.tabs.query({ url: ARYA + '/operations-import.html*' });
  let tab = tabs.find(item => item.url?.startsWith(ARYA + '/operations-import.html'));
  if (!tab) {
    tab = await chrome.tabs.create({ url: ARYA + '/operations-import.html', active: true });
    await waitTab(tab.id, 45000); await wait(800);
  }
  for (let i = 0; i < 10; i++) {
    try {
      const response = await chrome.tabs.sendMessage(tab.id, { type: 'ARYA_PUBLISH_SNAPSHOT', kind, snapshot });
      if (response?.ok) return response.result;
      if (response?.error === 'unauthorized') throw new Error('arya_login_required');
      throw new Error(response?.error || 'arya_publish_failed');
    } catch (error) {
      if (error?.message === 'arya_login_required' || /^[a-z_]+$/.test(error?.message || '')) throw error;
      await wait(400);
    }
  }
  throw new Error('arya_import_page_unavailable');
}

async function setAutoSync(enabled) {
  const current = await settings();
  if (enabled && (!current.exactMatchConfirmed || !current.lastPublishedAt)) throw new Error('manual_publish_required_first');
  const next = { ...current, autoSync: enabled === true };
  await chrome.storage.local.set({ [SETTINGS_KEY]: next });
  if (next.autoSync) chrome.alarms.create('arya-operations-sync', { periodInMinutes: 360 });
  else chrome.alarms.clear('arya-operations-sync');
  return { ok: true, autoSync: next.autoSync };
}

chrome.alarms.onAlarm.addListener(async alarm => {
  if (alarm.name !== 'arya-operations-sync') return;
  const config = await settings();
  if (!config.autoSync || !config.exactMatchConfirmed) return;
  try { await scanAll(); await publishSnapshots(); }
  catch { await chrome.action.setBadgeText({ text: '!' }); await chrome.action.setBadgeBackgroundColor({ color: '#a33b3b' }); }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || typeof message !== 'object') return;
  const run = async () => {
    if (message.type === 'ARYA_AGENT_GET_STATE') {
      const [pending, config] = await Promise.all([get(STATE_KEY), settings()]);
      return { ok: true, pending: Boolean(pending), counts: pending?.counts || null, autoSync: config.autoSync, exactMatchConfirmed: config.exactMatchConfirmed };
    }
    if (message.type === 'ARYA_AGENT_SCAN') return scanAll();
    if (message.type === 'ARYA_AGENT_CONFIRM_MATCHING') {
      const pending = await get(STATE_KEY);
      if (!pending) throw new Error('scan_required');
      if (pending.counts.unmatchedStudents || pending.counts.unmatchedGroups) throw new Error('identity_mapping_incomplete');
      const config = await settings(); await chrome.storage.local.set({ [SETTINGS_KEY]: { ...config, exactMatchConfirmed: true } });
      return { ok: true, exactMatchConfirmed: true };
    }
    if (message.type === 'ARYA_AGENT_PUBLISH') return publishSnapshots();
    if (message.type === 'ARYA_AGENT_AUTO_SYNC') return setAutoSync(message.enabled);
    if (message.type === 'ARYA_AGENT_CLEAR') { await chrome.storage.session.remove(STATE_KEY); return { ok: true }; }
    throw new Error('unknown_action');
  };
  run().then(sendResponse).catch(error => sendResponse({ ok: false, error: safeError(error) }));
  return true;
});
