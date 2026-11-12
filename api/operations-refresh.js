import { safeEqual } from '../lib/auth.js';
import { runScan } from '../lib/operations-scan.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); res.status(405).json({ error: 'method_not_allowed' }); return; }
  const secret = process.env.CRON_SECRET;
  if (!secret || !safeEqual(req.headers.authorization || '', 'Bearer ' + secret)) {
    res.status(401).json({ error: 'unauthorized' }); return;
  }
  const result = await runScan();
  // Cron response never returns source records.
  res.status(result.state === 'storage_unavailable' ? 503 : 200).json(result);
}
