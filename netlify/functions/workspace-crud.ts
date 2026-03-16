import type { Context } from '@netlify/functions';
import { query, queryOne, execute } from './_lib/db.js';
import { requireAuth } from './_lib/auth.js';
import { requireWorkspacePermission, requireWorkspaceResourcePermission } from './_lib/rbac.js';
import { encrypt } from './_lib/crypto.js';
import { amapiCall, getAmapiErrorHttpStatus } from './_lib/amapi.js';
import { logAudit } from './_lib/audit.js';
import { jsonResponse, errorResponse, parseJsonBody, getClientIp, getSearchParams } from './_lib/helpers.js';

export default async (request: Request, context: Context) => {
  try {
    const auth = await requireAuth(request);
    const url = new URL(request.url);
    const normalizedPath = url.pathname
      .replace(/^\/api\/workspaces\/?/, '')
      .replace(/^\/\.netlify\/functions\/workspace-crud\/?/, '');
    const segments = normalizedPath.split('/').filter(Boolean);
    const action = segments[0] ?? (request.method === 'GET' ? 'list' : undefined); // list, create, update, delete, or UUID

    // GET /api/workspaces/list (and GET /api/workspaces)
    if (request.method === 'GET' && action === 'list') {
      let workspaces;
      if (auth.authType === 'session' && auth.user.is_superadmin) {
        workspaces = await query(
        `SELECT id, name, gcp_project_id, google_auth_mode, settings, default_pubsub_topic,
                created_at, updated_at,
                (google_credentials_enc IS NOT NULL) as has_google_credentials,
                'owner' as user_role, 'workspace' as access_scope
         FROM workspaces
         ORDER BY name`
        );
      } else if (auth.authType === 'api_key' && auth.apiKey) {
        if (auth.apiKey.scope_type === 'environment') {
          return errorResponse('Forbidden: environment-scoped API keys cannot list workspaces', 403);
        }
        workspaces = await query(
        `SELECT w.id, w.name, w.gcp_project_id, w.google_auth_mode, w.settings, w.default_pubsub_topic,
                w.created_at, w.updated_at,
                (w.google_credentials_enc IS NOT NULL) as has_google_credentials,
                $2::text as user_role, 'workspace' as access_scope
         FROM workspaces w
         WHERE w.id = $1
         ORDER BY w.name`,
          [auth.apiKey.workspace_id, auth.apiKey.role]
        );
      } else {
        workspaces = await query(
        `SELECT w.id, w.name, w.gcp_project_id, w.google_auth_mode, w.settings, w.default_pubsub_topic,
                w.created_at, w.updated_at,
                (w.google_credentials_enc IS NOT NULL) as has_google_credentials,
                wm.role as user_role, wm.access_scope
         FROM workspaces w
         JOIN workspace_memberships wm ON wm.workspace_id = w.id
         WHERE wm.user_id = $1
         ORDER BY w.name`,
          [auth.user.id]
        );
      }
      return jsonResponse({ workspaces });
    }

  // GET /api/workspaces/orphaned-enterprises?workspace_id=...
  if (request.method === 'GET' && action === 'orphaned-enterprises') {
    const params = getSearchParams(request);
    const workspaceId = params.get('workspace_id');
    if (!workspaceId) return errorResponse('workspace_id is required');
    await requireWorkspacePermission(auth, workspaceId, 'write');

    const workspace = await queryOne<{ gcp_project_id: string | null }>(
      'SELECT gcp_project_id FROM workspaces WHERE id = $1',
      [workspaceId]
    );
    if (!workspace) return errorResponse('Workspace not found', 404);
    if (!workspace.gcp_project_id) {
      return jsonResponse({ enterprises: [], warning: 'Workspace has no GCP project ID configured.' });
    }

    try {
      const enterprises = await listDisassociatedEnterprises(workspaceId, workspace.gcp_project_id);
      return jsonResponse({ enterprises });
    } catch (err) {
      const status = getAmapiErrorHttpStatus(err) ?? 502;
      const message = status >= 500
        ? 'Orphaned enterprise discovery is temporarily unavailable. Please try again shortly.'
        : `Failed to query Android Enterprise: ${err instanceof Error ? err.message : 'Unknown error'}`;
      console.warn('workspace-crud orphaned-enterprises unavailable', {
        workspace_id: workspaceId,
        status,
        error: err instanceof Error ? err.message : String(err),
      });
      // This endpoint backs an optional UI panel; fail soft to avoid noisy function error rates.
      return jsonResponse({
        enterprises: [],
        unavailable: true,
        message,
        upstream_status: status,
      });
    }
  }

  // GET /api/workspaces/:id
  if (request.method === 'GET' && action && action !== 'list') {
    await requireWorkspacePermission(auth, action, 'read');
    const ws = auth.authType === 'api_key' && auth.apiKey
      ? await queryOne(
          `SELECT w.id, w.name, w.gcp_project_id, w.google_auth_mode, w.settings, w.default_pubsub_topic,
                  w.created_at, w.updated_at,
                  $2::text as user_role, $3::text as access_scope
           FROM workspaces w
           WHERE w.id = $1`,
          [action, auth.apiKey.role, auth.apiKey.scope_type === 'workspace' ? 'workspace' : 'scoped']
        )
      : await queryOne(
          `SELECT w.id, w.name, w.gcp_project_id, w.google_auth_mode, w.settings, w.default_pubsub_topic,
                  w.created_at, w.updated_at,
                  wm.role as user_role, wm.access_scope
           FROM workspaces w
           JOIN workspace_memberships wm ON wm.workspace_id = w.id AND wm.user_id = $2
           WHERE w.id = $1`,
          [action, auth.user.id]
        );
    if (!ws) return errorResponse('Workspace not found', 404);
    return jsonResponse({ workspace: ws });
  }

  // POST /api/workspaces/create
  if (request.method === 'POST' && action === 'create') {
    if (!auth.user.is_superadmin) return errorResponse('Forbidden', 403);

    const body = await parseJsonBody<{ name: string; gcp_project_id?: string }>(request);
    if (!body.name) return errorResponse('Name is required');

    const id = crypto.randomUUID();
    await execute(
      'INSERT INTO workspaces (id, name, gcp_project_id) VALUES ($1, $2, $3)',
      [id, body.name, body.gcp_project_id ?? null]
    );

    // Add creator as owner
    await execute(
      'INSERT INTO workspace_memberships (workspace_id, user_id, role) VALUES ($1, $2, $3)',
      [id, auth.user.id, 'owner']
    );

    await logAudit({
      workspace_id: id,
      user_id: auth.user.id,
      action: 'workspace.created',
      resource_type: 'workspace',
      resource_id: id,
      details: { name: body.name },
      ip_address: getClientIp(request),
    });

    return jsonResponse({ workspace: { id, name: body.name, gcp_project_id: body.gcp_project_id ?? null } }, 201);
  }

  // PUT /api/workspaces/update
  if (request.method === 'PUT' && action === 'update') {
    const body = await parseJsonBody<{ id: string; name?: string; gcp_project_id?: string; default_pubsub_topic?: string | null }>(request);
    if (!body.id) return errorResponse('Workspace ID is required');

    await requireWorkspacePermission(auth, body.id, 'write');

    const updates: string[] = [];
    const values: unknown[] = [];
    let paramIdx = 1;

    if (body.name) { updates.push(`name = $${paramIdx++}`); values.push(body.name); }
    if (body.gcp_project_id !== undefined) { updates.push(`gcp_project_id = $${paramIdx++}`); values.push(body.gcp_project_id); }
    if (body.default_pubsub_topic !== undefined) {
      const normalised = body.default_pubsub_topic?.trim() || null;
      updates.push(`default_pubsub_topic = $${paramIdx++}`);
      values.push(normalised);
    }
    updates.push(`updated_at = now()`);

    values.push(body.id);
    await execute(
      `UPDATE workspaces SET ${updates.join(', ')} WHERE id = $${paramIdx}`,
      values
    );

    await logAudit({
      workspace_id: body.id,
      user_id: auth.user.id,
      action: 'workspace.updated',
      resource_type: 'workspace',
      resource_id: body.id,
      ip_address: getClientIp(request),
    });

    return jsonResponse({ message: 'Workspace updated' });
  }

  // POST /api/workspaces/secrets — store GCP credentials
  if (request.method === 'POST' && action === 'secrets') {
    const body = await parseJsonBody<{ workspace_id: string; google_credentials_json: string }>(request);
    if (!body.workspace_id || !body.google_credentials_json) {
      return errorResponse('workspace_id and google_credentials_json are required');
    }
    await requireWorkspaceResourcePermission(auth, body.workspace_id, 'workspace', 'manage_settings');

    // Validate JSON
    try {
      const creds = JSON.parse(body.google_credentials_json);
      if (creds.type !== 'service_account') return errorResponse('Credentials must be a service account JSON');
      if (!creds.client_email || !creds.private_key) return errorResponse('Invalid service account JSON');
    } catch {
      return errorResponse('Invalid JSON');
    }

    let encrypted: string;
    try {
      encrypted = encrypt(body.google_credentials_json, `workspace:${body.workspace_id}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Encryption failed';
      return errorResponse(msg.includes('ENCRYPTION_MASTER_KEY')
        ? 'Server encryption is not configured. Set ENCRYPTION_MASTER_KEY in environment variables.'
        : `Encryption failed: ${msg}`, 500);
    }

    // Also store the GCP project ID from the service account JSON
    let gcpProjectId: string | null = null;
    try {
      const creds = JSON.parse(body.google_credentials_json);
      gcpProjectId = creds.project_id ?? null;
    } catch {
      // already validated above
    }

    await execute(
      'UPDATE workspaces SET google_credentials_enc = $1, google_auth_mode = $2, gcp_project_id = COALESCE($3, gcp_project_id), updated_at = now() WHERE id = $4',
      [encrypted, 'service_account', gcpProjectId, body.workspace_id]
    );

    await logAudit({
      workspace_id: body.workspace_id,
      user_id: auth.user.id,
      action: 'workspace.credentials_updated',
      resource_type: 'workspace',
      resource_id: body.workspace_id,
      ip_address: getClientIp(request),
    });

    return jsonResponse({ message: 'Credentials stored securely' });
  }

  return errorResponse('Not found', 404);
  } catch (err) {
    if (err instanceof Response) {
      const status = err.status;
      let bodyPreview = '';
      try {
        bodyPreview = await err.clone().text();
      } catch {
        bodyPreview = '<unreadable>';
      }
      const logFn = status >= 500 ? console.error : console.warn;
      logFn('workspace-crud response error', {
        method: request.method,
        path: new URL(request.url).pathname,
        status,
        body: bodyPreview.slice(0, 400),
      });
      return err;
    }
    console.error('workspace-crud error:', {
      method: request.method,
      path: new URL(request.url).pathname,
      error: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    return errorResponse('Internal server error', 500);
  }
};

interface AmapiEnterpriseListResponse {
  enterprises?: Array<{
    name: string;
    enterpriseDisplayName?: string;
    pubsubTopic?: string;
    enabledNotificationTypes?: string[];
  }>;
  nextPageToken?: string;
}

interface AmapiEnterpriseDetails {
  name: string;
  enterpriseDisplayName?: string;
  pubsubTopic?: string;
  enabledNotificationTypes?: string[];
}

interface AmapiDeviceListResponse {
  devices?: Array<Record<string, unknown>>;
  nextPageToken?: string;
}

async function listDisassociatedEnterprises(workspaceId: string, projectId: string) {
  const linkedRows = await query<{ enterprise_name: string }>(
    `SELECT enterprise_name
     FROM environments
     WHERE workspace_id = $1
       AND enterprise_name IS NOT NULL`,
    [workspaceId]
  );
  const linkedSet = new Set(linkedRows.map((r) => r.enterprise_name));

  const allEnterprises: AmapiEnterpriseDetails[] = [];
  let pageToken: string | undefined;

  do {
    const path = pageToken
      ? `enterprises?projectId=${encodeURIComponent(projectId)}&pageToken=${encodeURIComponent(pageToken)}`
      : `enterprises?projectId=${encodeURIComponent(projectId)}`;

    const response = await amapiCall<AmapiEnterpriseListResponse>(path, workspaceId, {
      method: 'GET',
      projectId,
      resourceType: 'enterprises',
    });

    for (const enterprise of response.enterprises ?? []) {
      if (!enterprise?.name) continue;
      allEnterprises.push(enterprise);
    }
    pageToken = response.nextPageToken;
  } while (pageToken);

  const disassociated = allEnterprises.filter((enterprise) => !linkedSet.has(enterprise.name));

  const hydrated = await Promise.all(disassociated.map(async (enterprise) => {
    let details = enterprise;
    try {
      details = await amapiCall<AmapiEnterpriseDetails>(enterprise.name, workspaceId, {
        method: 'GET',
        projectId,
        enterpriseName: enterprise.name,
        resourceType: 'enterprises',
        resourceId: enterprise.name.split('/').pop(),
      });
    } catch {
      // Keep partial list data if details lookup fails for one enterprise.
    }

    const deviceCount = await countEnterpriseDevices(workspaceId, projectId, enterprise.name);

    return {
      enterprise_name: enterprise.name,
      enterprise_id: enterprise.name.split('/').pop() ?? enterprise.name,
      enterprise_display_name: details.enterpriseDisplayName ?? null,
      pubsub_topic: details.pubsubTopic ?? null,
      enabled_notification_types: details.enabledNotificationTypes ?? [],
      enrolled_device_count: deviceCount.count,
      enrolled_device_count_exact: !deviceCount.truncated,
      read_only_policy_warning:
        'Existing Android Enterprise policies remain readable, but Flash policy state is authoritative only after you push policies from Flash to this recovered environment.',
    };
  }));

  hydrated.sort((a, b) => {
    const aName = a.enterprise_display_name ?? a.enterprise_name;
    const bName = b.enterprise_display_name ?? b.enterprise_name;
    return aName.localeCompare(bName);
  });

  return hydrated;
}

async function countEnterpriseDevices(workspaceId: string, projectId: string, enterpriseName: string): Promise<{ count: number; truncated: boolean }> {
  const PAGE_SIZE = 100;
  const MAX_COUNT = 5000;
  let count = 0;
  let pageToken: string | undefined;
  let truncated = false;

  do {
    if (count >= MAX_COUNT) {
      truncated = true;
      break;
    }
    const path = pageToken
      ? `${enterpriseName}/devices?pageSize=${PAGE_SIZE}&pageToken=${encodeURIComponent(pageToken)}`
      : `${enterpriseName}/devices?pageSize=${PAGE_SIZE}`;

    const response = await amapiCall<AmapiDeviceListResponse>(path, workspaceId, {
      method: 'GET',
      projectId,
      enterpriseName,
      resourceType: 'devices',
    });

    count += response.devices?.length ?? 0;
    pageToken = response.nextPageToken;

    if (pageToken && count >= MAX_COUNT) {
      truncated = true;
      break;
    }
  } while (pageToken);

  return { count, truncated };
}
