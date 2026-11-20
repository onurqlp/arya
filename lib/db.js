import { neon } from "@neondatabase/serverless";

let client;
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

export async function ensureSchema() {
  const db = getDb();
  // Runtime roles deliberately have no CREATE/ALTER privilege. Schema changes
  // are installed from db/migrations by the database owner.
  await db.query("SELECT 1");
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
  await db.query("DELETE FROM arya_outbound_messages WHERE created_at < NOW() - ($1 * INTERVAL '1 day')", [days]);
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
