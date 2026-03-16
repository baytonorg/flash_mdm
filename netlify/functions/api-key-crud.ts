import type { Context } from '@netlify/functions';
import { query, queryOne, execute } from './_lib/db.js';
import { requireAuth } from './_lib/auth.js';
import {
  requireEnvironmentResourcePermission,
  requireWorkspacePermission,
  requireWorkspaceResourcePermission,
} from './_lib/rbac.js';
import { encrypt, generateToken, hashToken } from './_lib/crypto.js';
import { logAudit } from './_lib/audit.js';
import { errorResponse, getClientIp, getSearchParams, isValidUuid, jsonResponse, parseJsonBody } from './_lib/helpers.js';

type ApiKeyRow = {
  id: string;
  name: string;
  scope_type: 'workspace' | 'environment';
  workspace_id: string;
  environment_id: string | null;
  role: 'owner' | 'admin' | 'member' | 'viewer';
  token_prefix: string;
  created_by_user_id: string;
  created_by_email: string | null;
  created_by_name: string | null;
  created_at: string;
  expires_at: string | null;
  last_used_at: string | null;
  last_used_ip: string | null;
  revoked_at: string | null;
};

const VALID_API_KEY_ROLES = ['owner', 'admin', 'member', 'viewer'] as const;
type ApiKeyRole = typeof VALID_API_KEY_ROLES[number];
const MAX_API_KEY_EXPIRY_DAYS = 3650;
const API_KEY_ROLE_LEVEL: Record<ApiKeyRole, number> = {
  owner: 100,
  admin: 75,
  member: 50,
  viewer: 25,
};

function normalizeName(name: string | undefined): string {
  const trimmed = (name ?? '').trim();
  return trimmed.slice(0, 120);
}

async function resolveEnvironmentScope(environmentId: string): Promise<{ environment_id: string; workspace_id: string } | null> {
  return queryOne<{ environment_id: string; workspace_id: string }>(
    'SELECT id AS environment_id, workspace_id FROM environments WHERE id = $1',
    [environmentId]
  );
}

function serializeKeyRow(row: ApiKeyRow): ApiKeyRow & { token: null } {
  // Secrets are only returned at creation time; list views get metadata + prefix only.
  return { ...row, token: null };
}

export default async (request: Request, context: Context) => {
  try {
    const auth = await requireAuth(request);
    const url = new URL(request.url);
    const segments = url.pathname.replace('/api/api-keys', '').split('/').filter(Boolean);
    const action = segments[0] ?? 'list';

    if (auth.authType === 'api_key' && request.method !== 'GET') {
      return errorResponse('API keys cannot manage other API keys', 403);
    }

    // GET /api/api-keys/list?workspace_id=... OR ?environment_id=...
    if (request.method === 'GET' && (action === 'list' || action === undefined)) {
      const params = getSearchParams(request);
      const workspaceId = params.get('workspace_id');
      const environmentId = params.get('environment_id');

      if (!workspaceId && !environmentId) {
        return errorResponse('workspace_id or environment_id is required');
      }
      if (workspaceId && environmentId) {
        return errorResponse('Use either workspace_id or environment_id, not both');
      }
      if (workspaceId && !isValidUuid(workspaceId)) {
        return errorResponse('workspace_id must be a valid UUID');
      }
      if (environmentId && !isValidUuid(environmentId)) {
        return errorResponse('environment_id must be a valid UUID');
      }

      let rows: ApiKeyRow[];
      if (environmentId) {
        const env = await resolveEnvironmentScope(environmentId);
        if (!env) return errorResponse('Environment not found', 404);
        await requireEnvironmentResourcePermission(auth, env.environment_id, 'environment', 'write');
        rows = await query<ApiKeyRow>(
          `SELECT ak.id, ak.name, ak.scope_type, ak.workspace_id, ak.environment_id,
                  ak.role, ak.token_prefix, ak.created_by_user_id,
                  ak.created_at, ak.expires_at, ak.last_used_at, ak.last_used_ip, ak.revoked_at,
                  u.email AS created_by_email,
                  NULLIF(TRIM(COALESCE(u.first_name, '') || ' ' || COALESCE(u.last_name, '')), '') AS created_by_name
           FROM api_keys ak
           LEFT JOIN users u ON u.id = ak.created_by_user_id
           WHERE ak.environment_id = $1 AND ak.revoked_at IS NULL
           ORDER BY ak.created_at DESC`,
          [env.environment_id]
        );
      } else {
        await requireWorkspacePermission(auth, workspaceId!, 'write');
        rows = await query<ApiKeyRow>(
          `SELECT ak.id, ak.name, ak.scope_type, ak.workspace_id, ak.environment_id,
                  ak.role, ak.token_prefix, ak.created_by_user_id,
                  ak.created_at, ak.expires_at, ak.last_used_at, ak.last_used_ip, ak.revoked_at,
                  u.email AS created_by_email,
                  NULLIF(TRIM(COALESCE(u.first_name, '') || ' ' || COALESCE(u.last_name, '')), '') AS created_by_name
           FROM api_keys ak
           LEFT JOIN users u ON u.id = ak.created_by_user_id
           WHERE ak.workspace_id = $1
             AND ak.scope_type = 'workspace'
             AND ak.revoked_at IS NULL
           ORDER BY ak.created_at DESC`,
          [workspaceId]
        );
      }

      return jsonResponse({ api_keys: rows.map(serializeKeyRow) });
    }

    // POST /api/api-keys/create
    if (request.method === 'POST' && action === 'create') {
      const body = await parseJsonBody<{
        scope_type: 'workspace' | 'environment';
        workspace_id?: string;
        environment_id?: string;
        name?: string;
        role?: ApiKeyRole;
        expires_in_days?: number;
      }>(request);

      const name = normalizeName(body.name);
      if (!name) return errorResponse('name is required');
      if (!body.scope_type || !['workspace', 'environment'].includes(body.scope_type)) {
        return errorResponse('scope_type must be "workspace" or "environment"');
      }
      if (body.role && !VALID_API_KEY_ROLES.includes(body.role)) {
        return errorResponse(`role must be one of: ${VALID_API_KEY_ROLES.join(', ')}`);
      }
      const expiresInDays = body.expires_in_days;
      if (expiresInDays != null) {
        if (!Number.isInteger(expiresInDays)) {
          return errorResponse('expires_in_days must be an integer');
        }
        if (expiresInDays < 1 || expiresInDays > MAX_API_KEY_EXPIRY_DAYS) {
          return errorResponse(`expires_in_days must be between 1 and ${MAX_API_KEY_EXPIRY_DAYS}`);
        }
      }

      let workspaceId: string;
      let environmentId: string | null = null;
      let creatorRole: ApiKeyRole;

      if (body.scope_type === 'workspace') {
        if (!body.workspace_id) return errorResponse('workspace_id is required for workspace keys');
        if (!isValidUuid(body.workspace_id)) return errorResponse('workspace_id must be a valid UUID');
        workspaceId = body.workspace_id;
        creatorRole = await requireWorkspaceResourcePermission(auth, workspaceId, 'workspace', 'manage_settings') as ApiKeyRole;
      } else {
        if (!body.environment_id) return errorResponse('environment_id is required for environment keys');
        if (!isValidUuid(body.environment_id)) return errorResponse('environment_id must be a valid UUID');
        const env = await resolveEnvironmentScope(body.environment_id);
        if (!env) return errorResponse('Environment not found', 404);
        workspaceId = env.workspace_id;
        environmentId = env.environment_id;
        creatorRole = await requireEnvironmentResourcePermission(auth, environmentId, 'environment', 'manage_settings') as ApiKeyRole;
      }
      const requestedRole: ApiKeyRole = (body.role ?? creatorRole) as ApiKeyRole;
      if (API_KEY_ROLE_LEVEL[requestedRole] > API_KEY_ROLE_LEVEL[creatorRole]) {
        return errorResponse('Forbidden: cannot create API key with a role higher than your own', 403);
      }
      const role = requestedRole;
      const expiresAt = expiresInDays
        ? new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000).toISOString()
        : null;

      const apiKeyId = crypto.randomUUID();
      const token = `flash_${body.scope_type}_` + generateToken();
      const tokenHash = hashToken(token);
      const tokenPrefix = token.slice(0, 24);
      let tokenEnc: string;
      try {
        tokenEnc = encrypt(token, `api-key:${apiKeyId}`);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return errorResponse(message.includes('ENCRYPTION_MASTER_KEY')
          ? 'Server encryption is not configured. Set ENCRYPTION_MASTER_KEY in environment variables.'
          : 'Failed to encrypt API key', 500);
      }

      const inserted = await queryOne<{ id: string; created_at: string; expires_at: string | null }>(
        `INSERT INTO api_keys (
           id, name, scope_type, workspace_id, environment_id, role,
           token_hash, token_enc, token_prefix, created_by_user_id, expires_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         RETURNING id, created_at, expires_at`,
        [
          apiKeyId,
          name,
          body.scope_type,
          workspaceId,
          environmentId,
          role,
          tokenHash,
          tokenEnc,
          tokenPrefix,
          auth.user.id,
          expiresAt,
        ]
      );

      if (!inserted) return errorResponse('Failed to create API key', 500);

      await logAudit({
        workspace_id: workspaceId,
        environment_id: environmentId ?? undefined,
        user_id: auth.user.id,
        action: 'api_key.created',
        resource_type: 'api_key',
        resource_id: inserted.id,
        details: {
          scope_type: body.scope_type,
          role,
          name,
          token_prefix: tokenPrefix,
          expires_in_days: expiresInDays ?? null,
          expires_at: inserted.expires_at ?? null,
        },
        ip_address: getClientIp(request),
      });

      return jsonResponse({
        api_key: {
          id: inserted.id,
          name,
          scope_type: body.scope_type,
          workspace_id: workspaceId,
          environment_id: environmentId,
          role,
          token,
          token_prefix: tokenPrefix,
          created_at: inserted.created_at,
          expires_at: inserted.expires_at ?? null,
        },
      }, 201);
    }

    // POST /api/api-keys/revoke
    if (request.method === 'POST' && action === 'revoke') {
      const body = await parseJsonBody<{ id: string }>(request);
      if (!body.id) return errorResponse('id is required');
      if (!isValidUuid(body.id)) return errorResponse('id must be a valid UUID');

      const keyRow = await queryOne<{
        id: string;
        name: string;
        scope_type: 'workspace' | 'environment';
        workspace_id: string;
        environment_id: string | null;
        revoked_at: string | null;
      }>('SELECT id, name, scope_type, workspace_id, environment_id, revoked_at FROM api_keys WHERE id = $1', [body.id]);
      if (!keyRow) return errorResponse('API key not found', 404);
      if (keyRow.revoked_at) return jsonResponse({ message: 'API key already revoked' });

      if (keyRow.scope_type === 'workspace') {
        await requireWorkspaceResourcePermission(auth, keyRow.workspace_id, 'workspace', 'manage_settings');
      } else if (keyRow.environment_id) {
        await requireEnvironmentResourcePermission(auth, keyRow.environment_id, 'environment', 'manage_settings');
      } else {
        return errorResponse('API key scope is invalid', 500);
      }

      await execute(
        'UPDATE api_keys SET revoked_at = now(), revoked_by_user_id = $2 WHERE id = $1 AND revoked_at IS NULL',
        [keyRow.id, auth.user.id]
      );

      await logAudit({
        workspace_id: keyRow.workspace_id,
        environment_id: keyRow.environment_id ?? undefined,
        user_id: auth.user.id,
        action: 'api_key.revoked',
        resource_type: 'api_key',
        resource_id: keyRow.id,
        details: { scope_type: keyRow.scope_type, name: keyRow.name },
        ip_address: getClientIp(request),
      });

      return jsonResponse({ message: 'API key revoked' });
    }

    return errorResponse('Not found', 404);
  } catch (err) {
    if (err instanceof Response) return err;
    console.error('api-key-crud error:', err);
    return errorResponse('Internal server error', 500);
  }
};
