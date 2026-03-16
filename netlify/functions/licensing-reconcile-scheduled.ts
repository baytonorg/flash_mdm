import type { Context } from '@netlify/functions';
import { runLicensingReconcile } from './_lib/licensing-reconcile.js';
import { isLicensingDryRun } from './_lib/licensing.js';

export const config = {
  schedule: '0 * * * *',
};

export default async function handler(_request: Request, _context: Context) {
  try {
    const dryRun = isLicensingDryRun();
    const stats = await runLicensingReconcile({ dryRun });
    return new Response(JSON.stringify({ message: 'Licensing reconcile completed', stats }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('licensing-reconcile-scheduled error:', err);
    return new Response(JSON.stringify({ error: 'Licensing reconcile failed' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
