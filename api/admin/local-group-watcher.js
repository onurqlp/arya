import { ensureSchema, recordAudit } from "../../lib/db.js";
import { requireAdmin, sameOrigin } from "../../lib/auth.js";

function cleanGroups(value) {
  if (!Array.isArray(value) || value.length > 50) return null;
  const groups = value.map((item) => typeof item === "string" ? item.trim() : "");
  if (groups.some((item) => item.length > 100)) return null;
  const unique = new Map();
  for (const group of groups) {
    if (!group) continue;
    const key = group.toLocaleLowerCase("tr-TR");
    if (!unique.has(key)) unique.set(key, group);
  }
  return [...unique.values()];
}

function endpointFor(req) {
  const forwarded = req.headers["x-forwarded-host"];
  const host = String(forwarded || req.headers.host || "").split(",")[0].trim();
  if (!/^[a-z0-9.-]+(?::\d+)?$/i.test(host)) return null;
  return (process.env.VERCEL ? "https://" : "http://") + host;
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (!["GET", "POST"].includes(req.method)) {
    res.setHeader("Allow", "GET, POST");
    res.status(405).json({ error: "method_not_allowed" });
    return;
  }
  if (req.method === "POST" && !sameOrigin(req)) {
    res.status(403).json({ error: "origin_not_allowed" });
    return;
  }
  if (!requireAdmin(req, res)) return;

  try {
    const db = await ensureSchema();
    if (req.method === "GET") {
      const [rows, stats] = await Promise.all([
        db.query("SELECT group_names, updated_at FROM arya_local_group_config WHERE id = 'default'"),
        db.query("SELECT COUNT(*)::int AS total, MAX(received_at) AS last_received FROM arya_messages WHERE message_type = 'group-preview'")
      ]);
      res.status(200).json({
        groups: rows[0]?.group_names || [],
        updatedAt: rows[0]?.updated_at || null,
        totalReceived: stats[0]?.total || 0,
        lastReceived: stats[0]?.last_received || null,
        secretConfigured: Boolean(process.env.ARYA_LOCAL_GROUP_INGEST_SECRET &&
          process.env.ARYA_LOCAL_GROUP_INGEST_SECRET.length >= 32)
      });
      return;
    }

    const action = req.body?.action;
    if (action === "save") {
      const groups = cleanGroups(req.body?.groups);
      if (!groups) {
        res.status(400).json({ error: "invalid_group_list" });
        return;
      }
      await db.query(
        "INSERT INTO arya_local_group_config (id, group_names, updated_at) VALUES ('default', $1::jsonb, NOW()) " +
        "ON CONFLICT (id) DO UPDATE SET group_names = EXCLUDED.group_names, updated_at = NOW()",
        [JSON.stringify(groups)],
      );
      await recordAudit(db, "local_group_allowlist_updated", "default", { groupCount: groups.length });
      res.status(200).json({ groups, updatedAt: new Date().toISOString() });
      return;
    }

    if (action === "export") {
      const secret = process.env.ARYA_LOCAL_GROUP_INGEST_SECRET;
      if (!secret || secret.length < 32) {
        res.status(503).json({ error: "group_watcher_key_not_configured" });
        return;
      }
      const rows = await db.query("SELECT group_names FROM arya_local_group_config WHERE id = 'default'");
      const groups = rows[0]?.group_names || [];
      if (!groups.length) {
        res.status(409).json({ error: "group_allowlist_empty" });
        return;
      }
      const endpoint = endpointFor(req);
      if (!endpoint) {
        res.status(400).json({ error: "invalid_host" });
        return;
      }
      res.status(200).json({
        endpoint,
        secret,
        groups,
        generatedAt: new Date().toISOString()
      });
      return;
    }

    res.status(400).json({ error: "invalid_action" });
  } catch {
    res.status(503).json({ error: "storage_unavailable" });
  }
}
