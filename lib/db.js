import { neon } from "@neondatabase/serverless";

let client;
let schemaPromise;
let lastCleanupAt = 0;

export function getDb() {
  if (!process.env.DATABASE_URL) {
    const error = new Error("database_not_configured");
    error.code = "database_not_configured";
    throw error;
  }
  if (!client) client = neon(process.env.DATABASE_URL);
  return client;
}

const schemaStatements = [
  "CREATE TABLE IF NOT EXISTS arya_messages (message_id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL, sender_id TEXT NOT NULL, sender_name TEXT, message_type TEXT NOT NULL, body TEXT NOT NULL, message_time TIMESTAMPTZ NOT NULL, received_at TIMESTAMPTZ NOT NULL DEFAULT NOW())",
  "CREATE INDEX IF NOT EXISTS arya_messages_received_idx ON arya_messages (received_at DESC)",
  "CREATE INDEX IF NOT EXISTS arya_messages_conversation_idx ON arya_messages (conversation_id, message_time DESC)",
  "CREATE TABLE IF NOT EXISTS arya_approvals (id TEXT PRIMARY KEY, source_message_ids JSONB NOT NULL, analysis_text TEXT NOT NULL, reply_text TEXT NOT NULL, status TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), reviewed_at TIMESTAMPTZ, reviewed_by TEXT)",
  "CREATE INDEX IF NOT EXISTS arya_approvals_status_idx ON arya_approvals (status, created_at DESC)",
  "CREATE TABLE IF NOT EXISTS arya_audit (id TEXT PRIMARY KEY, actor TEXT NOT NULL, action TEXT NOT NULL, entity_id TEXT, details JSONB NOT NULL DEFAULT '{}'::jsonb, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())",
  "CREATE INDEX IF NOT EXISTS arya_audit_created_idx ON arya_audit (created_at DESC)",
  "CREATE TABLE IF NOT EXISTS arya_login_limits (key_hash TEXT PRIMARY KEY, window_started_at TIMESTAMPTZ NOT NULL, failures INTEGER NOT NULL DEFAULT 0, blocked_until TIMESTAMPTZ)"
];

export async function ensureSchema() {
  const db = getDb();
  if (!schemaPromise) {
    schemaPromise = (async () => {
      for (const statement of schemaStatements) await db.query(statement);
    })().catch((error) => {
      schemaPromise = null;
      throw error;
    });
  }
  await schemaPromise;
  return db;
}

function retentionDays() {
  const parsed = Number.parseInt(process.env.ARYA_RETENTION_DAYS || "90", 10);
  return Number.isInteger(parsed) && parsed >= 30 && parsed <= 365 ? parsed : 90;
}

export async function purgeExpired(db) {
  if (Date.now() - lastCleanupAt < 60 * 60 * 1000) return;
  const days = retentionDays();
  await db.query("DELETE FROM arya_approvals WHERE created_at < NOW() - ($1 * INTERVAL '1 day')", [days]);
  await db.query("DELETE FROM arya_messages WHERE received_at < NOW() - ($1 * INTERVAL '1 day')", [days]);
  await db.query("DELETE FROM arya_audit WHERE created_at < NOW() - INTERVAL '365 days'");
  await db.query("DELETE FROM arya_login_limits WHERE window_started_at < NOW() - INTERVAL '1 day'");
  lastCleanupAt = Date.now();
}

export async function recordAudit(db, action, entityId, details = {}) {
  const { randomUUID } = await import("node:crypto");
  await db.query(
    "INSERT INTO arya_audit (id, actor, action, entity_id, details) VALUES ($1, $2, $3, $4, $5::jsonb)",
    [randomUUID(), "admin", action, entityId || null, JSON.stringify(details)],
  );
}
