import { getDb } from './db.js';
import { sourceStatus, readSource, connectionFingerprint, validSnapshot, minimalSnapshot } from './operations.js';

export const scanSchedule = { timezone: 'Europe/Istanbul', times: ['09:00', '14:00', '19:00'] };
const browserFingerprint = kind => 'tinyfish-browser:' + kind + ':v1';
const todayInIstanbul = now => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Istanbul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
const publicSource = (kind, value) => ({ kind, label: kind === 'crm' ? 'CRM' : 'Kurs paneli', state: value.state,
  ...(value.retrievedAt ? { retrievedAt: value.retrievedAt } : {}),
  ...(value.attemptedAt ? { attemptedAt: value.attemptedAt } : {}),
  ...(value.data?.coverage ? { coverage: value.data.coverage } : {}) });
export const publicSources = sources => Object.fromEntries(Object.entries(sources).map(([kind, value]) => [kind, publicSource(kind, value)]));

// Only refresh creates/writes the isolated snapshot table. Viewing/querying never creates a schema.
export async function runScan({ env = process.env, getDatabase = getDb, read = readSource } = {}) {
  const sources = sourceStatus(env), kinds = Object.keys(sources).filter(kind => sources[kind].state === 'configured');
  if (!kinds.length) return { state: 'waiting_for_connections', sources };
  let db;
  try {
    db = getDatabase();
    await db.query('CREATE TABLE IF NOT EXISTS arya_operations_snapshots (kind TEXT PRIMARY KEY, state TEXT NOT NULL, attempted_at TIMESTAMPTZ NOT NULL, retrieved_at TIMESTAMPTZ, payload JSONB, connection_hash TEXT NOT NULL)');
  } catch { return { state: 'storage_unavailable', sources: Object.fromEntries(Object.entries(sources).map(([kind, value]) => [kind, { ...value, state: kinds.includes(kind) ? 'storage_unavailable' : value.state }])) }; }
  const attemptedAt = new Date().toISOString();
  await Promise.all(kinds.map(async kind => {
    try {
      const value = await read(kind, env);
      await db.query('INSERT INTO arya_operations_snapshots (kind,state,attempted_at,retrieved_at,payload,connection_hash) VALUES ($1,$2,$3,$4,$5::jsonb,$6) ON CONFLICT (kind) DO UPDATE SET state=EXCLUDED.state,attempted_at=EXCLUDED.attempted_at,connection_hash=EXCLUDED.connection_hash,retrieved_at=CASE WHEN arya_operations_snapshots.connection_hash=EXCLUDED.connection_hash THEN COALESCE(EXCLUDED.retrieved_at,arya_operations_snapshots.retrieved_at) ELSE EXCLUDED.retrieved_at END,payload=CASE WHEN EXCLUDED.state=\'verified\' THEN EXCLUDED.payload WHEN arya_operations_snapshots.connection_hash=EXCLUDED.connection_hash THEN arya_operations_snapshots.payload ELSE NULL END WHERE arya_operations_snapshots.attempted_at <= EXCLUDED.attempted_at',
        [kind, value.state, attemptedAt, value.retrievedAt || null, JSON.stringify(value.data || null), connectionFingerprint(kind, env)]);
      sources[kind] = publicSource(kind, { ...value, attemptedAt });
    } catch { sources[kind] = { ...sources[kind], state: 'storage_unavailable' }; }
  }));
  return { state: kinds.every(kind => sources[kind].state === 'verified') ? 'complete' : 'partial', sources };
}

export async function storeBrowserSnapshot(kind, data, { getDatabase = getDb, now = new Date() } = {}) {
  if (!['crm', 'course'].includes(kind) || !validSnapshot(data, kind)) {
    const error = new Error('invalid_snapshot'); error.code = 'invalid_snapshot'; throw error;
  }
  if (data.coverage.to !== todayInIstanbul(now)) {
    const error = new Error('stale_snapshot'); error.code = 'stale_snapshot'; throw error;
  }
  const payload = minimalSnapshot(data, kind), timestamp = now.toISOString(), db = getDatabase();
  await db.query('CREATE TABLE IF NOT EXISTS arya_operations_snapshots (kind TEXT PRIMARY KEY, state TEXT NOT NULL, attempted_at TIMESTAMPTZ NOT NULL, retrieved_at TIMESTAMPTZ, payload JSONB, connection_hash TEXT NOT NULL)');
  await db.query('INSERT INTO arya_operations_snapshots (kind,state,attempted_at,retrieved_at,payload,connection_hash) VALUES ($1,\'verified\',$2,$2,$3::jsonb,$4) ON CONFLICT (kind) DO UPDATE SET state=EXCLUDED.state,attempted_at=EXCLUDED.attempted_at,retrieved_at=EXCLUDED.retrieved_at,payload=EXCLUDED.payload,connection_hash=EXCLUDED.connection_hash WHERE arya_operations_snapshots.attempted_at <= EXCLUDED.attempted_at',
    [kind, timestamp, JSON.stringify(payload), browserFingerprint(kind)]);
  return { kind, state: 'verified', attemptedAt: timestamp, retrievedAt: timestamp, coverage: payload.coverage,
    counts: Object.fromEntries(['students', 'groups', 'payments', 'attendance', 'homework'].filter(key => Array.isArray(payload[key])).map(key => [key, payload[key].length])) };
}


const importParts = { crm: ['students', 'groups', 'payments'], course: ['students', 'groups', 'attendance', 'homework'] };
const importId = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,99}$/.test(value);
const importDay = value => typeof value === 'string' && /^\\d{4}-\\d{2}-\\d{2}$/.test(value) &&
  Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
const importText = (value, max = 160) => typeof value === 'string' && value.trim().length > 0 && value.length <= max;
const validPartRows = (kind, part, rows, coverage) => {
  if (!Array.isArray(rows) || rows.length > 10000 || rows.some(row => !row || !importId(row.id))) return false;
  if (new Set(rows.map(row => row.id)).size !== rows.length) return false;
  if (part === 'students') return rows.every(row => importText(row.name) && typeof row.active === 'boolean' &&
    Array.isArray(row.groupIds) && row.groupIds.length <= 100 && row.groupIds.every(importId) &&
    (row.phone === undefined || row.phone === null || (typeof row.phone === 'string' &&
      row.phone.length <= 32 && /^[+]?[0-9 ()-]{7,32}$/.test(row.phone.trim()))));
  if (part === 'groups') return rows.every(row => importText(row.name) && importText(row.level, 20) &&
    importText(row.teacher) && typeof row.active === 'boolean');
  if (part === 'payments') return kind === 'crm' && rows.every(row => importId(row.studentId) &&
    (row.groupId === null || importId(row.groupId)) && importDay(row.dueDate) &&
    Number.isSafeInteger(row.remainingMinor) && row.remainingMinor >= 0 &&
    ['TRY', 'EUR', 'USD', 'GBP', 'CHF'].includes(row.currency) &&
    ['open', 'paid', 'cancelled'].includes(row.status));
  if (part === 'attendance') return kind === 'course' && rows.every(row => importId(row.studentId) &&
    (row.groupId === null || importId(row.groupId)) && importDay(row.date) &&
    row.date >= coverage.from && row.date <= coverage.to &&
    ['present', 'absent', 'excused', 'unrecorded'].includes(row.status));
  if (part === 'homework') return kind === 'course' && rows.every(row => importId(row.studentId) &&
    (row.groupId === null || importId(row.groupId)) && importDay(row.date) &&
    row.date >= coverage.from && row.date <= coverage.to &&
    ['done', 'missing', 'unchecked', 'submitted'].includes(row.status));
  return false;
};

export async function stageBrowserSnapshotPart(kind, part, rows, coverage, { getDatabase = getDb, now = new Date() } = {}) {
  const parts = importParts[kind], today = todayInIstanbul(now);
  if (!parts || !parts.includes(part) || !coverage || !importDay(coverage.from) || !importDay(coverage.to) ||
      coverage.from > coverage.to || coverage.to !== today || !validPartRows(kind, part, rows, coverage)) {
    const error = new Error('invalid_stage'); error.code = 'invalid_stage'; throw error;
  }
  const db = getDatabase(), timestamp = now.toISOString();
  await db.query('CREATE TABLE IF NOT EXISTS arya_operations_import_staging (kind TEXT NOT NULL, part TEXT NOT NULL, coverage_from DATE NOT NULL, coverage_to DATE NOT NULL, payload JSONB NOT NULL, updated_at TIMESTAMPTZ NOT NULL, PRIMARY KEY(kind,part))');
  const existing = await db.query('SELECT coverage_from,coverage_to,payload FROM arya_operations_import_staging WHERE kind=$1 AND part=$2', [kind, part]);
  let merged = rows;
  if (existing[0]) {
    const oldFrom = String(existing[0].coverage_from).slice(0, 10), oldTo = String(existing[0].coverage_to).slice(0, 10);
    if (oldFrom !== coverage.from || oldTo !== coverage.to) {
      if (oldTo !== today) await db.query('DELETE FROM arya_operations_import_staging WHERE kind=$1', [kind]);
      else { const error = new Error('coverage_mismatch'); error.code = 'coverage_mismatch'; throw error; }
    } else if (['payments', 'attendance', 'homework'].includes(part)) {
      const previous = Array.isArray(existing[0].payload) ? existing[0].payload : [];
      const byId = new Map(previous.map(row => [row.id, row]));
      for (const row of rows) byId.set(row.id, row);
      merged = [...byId.values()];
    }
  }
  await db.query('INSERT INTO arya_operations_import_staging (kind,part,coverage_from,coverage_to,payload,updated_at) VALUES ($1,$2,$3,$4,$5::jsonb,$6) ON CONFLICT (kind,part) DO UPDATE SET coverage_from=EXCLUDED.coverage_from,coverage_to=EXCLUDED.coverage_to,payload=EXCLUDED.payload,updated_at=EXCLUDED.updated_at',
    [kind, part, coverage.from, coverage.to, JSON.stringify(merged), timestamp]);
  return { kind, part, state: 'staged', count: merged.length, coverage };
}

export async function publishStagedBrowserSnapshot(kind, coverage, { getDatabase = getDb, now = new Date() } = {}) {
  const parts = importParts[kind], today = todayInIstanbul(now);
  if (!parts || !coverage || !importDay(coverage.from) || !importDay(coverage.to) || coverage.to !== today) {
    const error = new Error('invalid_stage'); error.code = 'invalid_stage'; throw error;
  }
  const db = getDatabase();
  const rows = await db.query('SELECT part,coverage_from,coverage_to,payload FROM arya_operations_import_staging WHERE kind=$1', [kind]);
  const byPart = new Map(rows.map(row => [row.part, row]));
  if (parts.some(part => !byPart.has(part))) { const error = new Error('staging_incomplete'); error.code = 'staging_incomplete'; throw error; }
  if (parts.some(part => String(byPart.get(part).coverage_from).slice(0, 10) !== coverage.from ||
      String(byPart.get(part).coverage_to).slice(0, 10) !== coverage.to)) {
    const error = new Error('coverage_mismatch'); error.code = 'coverage_mismatch'; throw error;
  }
  const snapshot = { version: 1, complete: true, coverage };
  for (const part of parts) snapshot[part] = Array.isArray(byPart.get(part).payload) ? byPart.get(part).payload : [];
  if (!validSnapshot(snapshot, kind)) { const error = new Error('invalid_snapshot'); error.code = 'invalid_snapshot'; throw error; }
  const result = await storeBrowserSnapshot(kind, snapshot, { getDatabase, now });
  await db.query('DELETE FROM arya_operations_import_staging WHERE kind=$1', [kind]);
  return result;
}

export async function loadSnapshots({ env = process.env, getDatabase = getDb, now = new Date() } = {}) {
  const sources = sourceStatus(env), kinds = Object.keys(sources);
  try {
    const db = getDatabase();
    await Promise.all(kinds.map(async kind => {
      const rows = await db.query('SELECT state,attempted_at,retrieved_at,payload,connection_hash FROM arya_operations_snapshots WHERE kind=$1', [kind]);
      const row = rows[0];
      if (!row) { if (sources[kind].state === 'configured') sources[kind].state = 'not_scanned'; return; }
      const configured = sources[kind].state === 'configured';
      const expected = configured ? connectionFingerprint(kind, env) : browserFingerprint(kind);
      if (!expected || row.connection_hash !== expected) { sources[kind].state = 'not_scanned'; return; }
      const retrievedAt = row.retrieved_at ? new Date(row.retrieved_at).toISOString() : null;
      let state = row.state;
      if (state === 'verified' && (!retrievedAt || now.getTime() - Date.parse(retrievedAt) > 18 * 60 * 60 * 1000)) state = 'stale';
      sources[kind] = { ...sources[kind], state, attemptedAt: new Date(row.attempted_at).toISOString(),
        ...(retrievedAt ? { retrievedAt } : {}), ...(state === 'verified' && row.payload ? { data: row.payload } : {}) };
    }));
  } catch (error) {
    for (const kind of kinds) sources[kind] = { ...sources[kind], state: error.code === '42P01' ? 'not_scanned' : 'storage_unavailable' };
  }
  return sources;
}
