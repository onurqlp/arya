import { requireAdmin, sameOrigin } from '../../lib/auth.js';
import { queries, validateQuery, queryOperations } from '../../lib/operations.js';
import { loadSnapshots, publicSources, runScan, scanSchedule } from '../../lib/operations-scan.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (!['GET', 'POST'].includes(req.method)) {
    res.setHeader('Allow', 'GET, POST'); res.status(405).json({ error: 'method_not_allowed' }); return;
  }
  if (!requireAdmin(req, res)) return;
  if (req.method === 'GET') {
    res.status(200).json({ mode: 'read_only', sources: publicSources(await loadSnapshots()),
      schedule: { ...scanSchedule, enabled: process.env.ARYA_TINYFISH_SCHEDULE_ENABLED === '1' },
      queries: Object.entries(queries).map(([type, q]) => ({ type, label: q.label, sources: q.sources })) });
    return;
  }
  if (!sameOrigin(req)) { res.status(403).json({ error: 'origin_not_allowed' }); return; }
  if (req.body?.action === 'refresh') { res.status(200).json(await runScan()); return; }
  if (!validateQuery(req.body)) { res.status(400).json({ error: 'invalid_operations_query' }); return; }
  res.status(200).json(queryOperations(req.body, await loadSnapshots()));
}
