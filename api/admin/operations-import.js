import { requireAdmin, sameOrigin } from '../../lib/auth.js';
import { storeBrowserSnapshot, stageBrowserSnapshotPart, publishStagedBrowserSnapshot } from '../../lib/operations-scan.js';

export const config = { api: { bodyParser: { sizeLimit: '3mb' } } };

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); res.status(405).json({ error: 'method_not_allowed' }); return; }
  if (!requireAdmin(req, res)) return;
  if (!sameOrigin(req)) { res.status(403).json({ error: 'origin_not_allowed' }); return; }
  const { kind, action, part, rows, coverage, snapshot } = req.body || {};
  if (!['crm', 'course'].includes(kind)) { res.status(400).json({ error: 'invalid_snapshot' }); return; }
  try {
    let result;
    if (action === 'stage') result = await stageBrowserSnapshotPart(kind, part, rows, coverage);
    else if (action === 'publish') result = await publishStagedBrowserSnapshot(kind, coverage);
    else if (snapshot) result = await storeBrowserSnapshot(kind, snapshot);
    else { res.status(400).json({ error: 'invalid_snapshot' }); return; }
    res.status(200).json(result);
  } catch (error) {
    if (['invalid_snapshot', 'stale_snapshot', 'invalid_stage', 'coverage_mismatch', 'staging_incomplete'].includes(error.code)) {
      res.status(400).json({ error: error.code }); return;
    }
    res.status(503).json({ error: 'storage_unavailable' });
  }
}
