import type { Context } from '@netlify/functions';
import { query, queryOne } from './_lib/db.js';
import { requireAuth } from './_lib/auth.js';
import { requireEnvironmentPermission } from './_lib/rbac.js';
import { jsonResponse, errorResponse, getSearchParams } from './_lib/helpers.js';

type NetworkDeploymentRow = {
  id: string;
  environment_id: string;
  network_type: string;
  name: string;
  ssid: string;
  hidden_ssid: boolean;
  auto_connect: boolean;
  scope_type: string;
  scope_id: string;
  onc_profile: unknown;
  created_at: string;
  updated_at: string;
};

export default async (request: Request, _context: Context) => {
  try {
    const auth = await requireAuth(request);

  if (request.method !== 'GET') {
    return errorResponse('Method not allowed', 405);
  }

  const params = getSearchParams(request);
  const environmentId = params.get('environment_id');
  if (!environmentId) return errorResponse('environment_id is required');

  const env = await queryOne<{ id: string }>(
    'SELECT id FROM environments WHERE id = $1',
    [environmentId]
  );
  if (!env) return errorResponse('Environment not found', 404);

  await requireEnvironmentPermission(auth, environmentId, 'read');

  const rows = await query<NetworkDeploymentRow>(
    `SELECT id, environment_id, network_type, name, ssid, hidden_ssid, auto_connect, scope_type, scope_id, onc_profile, created_at, updated_at
     FROM network_deployments
     WHERE environment_id = $1
     ORDER BY created_at DESC`,
    [environmentId]
  );

    return jsonResponse({
      deployments: rows.map((row) => ({
        ...row,
        onc_profile: normalizeStoredProfile(row.onc_profile),
        network_type: row.network_type || inferNetworkType(row.onc_profile),
      })),
    });
  } catch (err) {
    if (err instanceof Response) return err;
    console.error('network-list error:', err);
    return errorResponse('Internal server error', 500);
  }
};

function safeParseJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function normalizeStoredProfile(value: unknown): Record<string, unknown> {
  if (typeof value === 'string') return safeParseJson(value, {});
  return (value && typeof value === 'object' && !Array.isArray(value)) ? (value as Record<string, unknown>) : {};
}

function inferNetworkType(value: unknown): 'wifi' | 'apn' {
  const profile = normalizeStoredProfile(value);
  if (Array.isArray((profile as any).NetworkConfigurations)) return 'wifi';
  if ((profile as any).kind === 'apnPolicy' || ((profile as any).apnPolicy && typeof (profile as any).apnPolicy === 'object')) {
    return 'apn';
  }
  return 'wifi';
}
