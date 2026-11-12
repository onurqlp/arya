import { getDb } from './db.js';
import { sourceStatus, readSource, connectionFingerprint } from './operations.js';

export const scanSchedule = { timezone: 'Europe/Istanbul', times: ['09:00', '14:00', '19:00'] };
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

export async function loadSnapshots({ env = process.env, getDatabase = getDb, now = new Date() } = {}) {
  const sources = sourceStatus(env), kinds = Object.keys(sources).filter(kind => sources[kind].state === 'configured');
  if (!kinds.length) return sources;
  try {
    const db = getDatabase();
    await Promise.all(kinds.map(async kind => {
      const rows = await db.query('SELECT state,attempted_at,retrieved_at,payload,connection_hash FROM arya_operations_snapshots WHERE kind=$1', [kind]);
      const row = rows[0];
      if (!row) { sources[kind].state = 'not_scanned'; return; }
      if (row.connection_hash !== connectionFingerprint(kind, env)) { sources[kind].state = 'not_scanned'; return; }
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
