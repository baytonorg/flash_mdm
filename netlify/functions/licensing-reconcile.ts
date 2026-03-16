import type { Context } from '@netlify/functions';
import { runLicensingReconcile } from './_lib/licensing-reconcile.js';
import { isLicensingDryRun } from './_lib/licensing.js';
import { requireInternalCaller } from './_lib/internal-auth.js';
import { jsonResponse, errorResponse } from './_lib/helpers.js';

export default async function handler(request: Request, _context: Context) {
  if (request.method !== 'POST') {
    return errorResponse('Method not allowed', 405);
  }

  try {
    requireInternalCaller(request);
    const stats = await runLicensingReconcile({ dryRun: isLicensingDryRun() });
    return jsonResponse({ message: 'Licensing reconcile completed', stats });
  } catch (err) {
    if (err instanceof Response) return err;
    console.error('licensing-reconcile error:', err);
    return errorResponse('Internal server error', 500);
  }
}
