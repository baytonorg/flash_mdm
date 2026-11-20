import type { Context } from '@netlify/functions';
import type { PoolClient } from 'pg';
import { execute, queryOne, transaction } from './_lib/db.js';
import { requireAuth, type AuthContext } from './_lib/auth.js';
import {
  clearEnvironmentPermissionMatrixCache,
  clearWorkspacePermissionMatrixCache,
  requireEnvironmentRole,
  requireWorkspaceRole,
  type PermissionMatrix,
} from './_lib/rbac.js';
import {
  cloneDefaultPermissionMatrix,
  getEnvironmentRbacOverridesFromFeatures,
  getRbacMatrixMeta,
  getWorkspaceRbacOverridesFromSettings,
  mergePermissionMatrixWithDefaults,
  setEnvironmentRbacSettings,
  setWorkspaceRbacSettings,
  validateAndCanonicalizePermissionMatrix,
} from './_lib/rbac-matrix.js';
import { errorResponse, getClientIp, getSearchParams, jsonResponse, parseJsonBody } from './_lib/helpers.js';
import { logAudit } from './_lib/audit.js';
import { getWorkspaceLicensingSettings } from './_lib/licensing.js';
import { ENVIRONMENT_RBAC_CLEAR_SQL, ENVIRONMENT_RBAC_SAVE_SQL } from './_lib/environment-features.js';
import { lockMembershipWorkspaces } from './_lib/membership-lifecycle.js';
import { scopeAuthority } from './_lib/scope-authority.js';

interface UpdateRbacMatrixBody {
  workspace_id?: string;
  environment_id?: string;
  matrix?: unknown;
}

function filterOutWorkspaceResource(matrix: PermissionMatrix): PermissionMatrix {
  const next: PermissionMatrix = {};
  for (const [resource, actions] of Object.entries(matrix)) {
    if (resource === 'workspace') continue;
    next[resource] = { ...actions };
  }
  return next;
}

function filterOutBillingResource(matrix: PermissionMatrix): PermissionMatrix {
  const next: PermissionMatrix = {};
  for (const [resource, actions] of Object.entries(matrix)) {
    if (resource === 'billing') continue;
    next[resource] = { ...actions };
  }
  return next;
}

function filterBillingMeta(meta: ReturnType<typeof getRbacMatrixMeta>) {
  return {
    ...meta,
    resource_order: meta.resource_order.filter((resource) => resource !== 'billing'),
    action_order: meta.action_order.filter((action) => (
      action !== 'license_view'
      && action !== 'billing_view'
      && action !== 'billing_manage'
      && action !== 'billing_customer'
    )),
  };
}

function environmentMeta(licensingVisible: boolean) {
  const meta = licensingVisible ? getRbacMatrixMeta() : filterBillingMeta(getRbacMatrixMeta());
  return { ...meta, resource_order: meta.resource_order.filter(resource => resource !== 'workspace') };
}

async function withEnvironmentRbacWrite<T>(
  auth: AuthContext, workspaceId: string, environmentId: string,
  write: (state: { client: PoolClient; workspace: { settings: unknown }; env: { enterprise_features: unknown }; licensingVisible: boolean }) => Promise<T>,
): Promise<T> {
  return transaction(async client => {
    await client.query("SET LOCAL lock_timeout = '3s'");
    await client.query("SET LOCAL statement_timeout = '15s'");
    await lockMembershipWorkspaces(client, [workspaceId]);
    const workspace = (await client.query('SELECT settings FROM workspaces WHERE id = $1', [workspaceId])).rows[0];
    if (!workspace) throw errorResponse('Workspace no longer exists', 409);
    const env = (await client.query(
      'SELECT id, enterprise_features, workspace_id FROM environments WHERE id = $1 AND workspace_id = $2 FOR UPDATE',
      [environmentId, workspaceId]
    )).rows[0];
    if (!env) throw errorResponse('Environment not found', 404);
    const authority = await scopeAuthority(client, auth, environmentId);
    if (authority.role !== 'owner') throw errorResponse('Forbidden: insufficient environment role', 403);
    // Existing settings rows cannot change halfway through the hidden-resource
    // decision. The parent lock also excludes a new workspace settings row.
    await client.query('SELECT id FROM platform_settings WHERE id = 1 FOR SHARE');
    await client.query('SELECT workspace_id FROM workspace_licensing_settings WHERE workspace_id = $1 FOR SHARE', [workspaceId]);
    const licensingSettings = await getWorkspaceLicensingSettings(workspaceId, client);
    return write({ client, workspace, env, licensingVisible: licensingSettings.effective_licensing_enabled });
  });
}

function requireEnvironmentUpdate(result: { rowCount: number | null }) {
  if (result.rowCount !== 1) throw errorResponse('Environment changed. Reload and try again.', 409);
}

export default async function handler(request: Request, _context: Context) {
  try {
    const auth = await requireAuth(request);

    if (request.method === 'GET') {
      // GET /api/roles/rbac?workspace_id=...&environment_id=... OR /api/roles/rbac?workspace_id=...
      const params = getSearchParams(request);
      const workspaceId = params.get('workspace_id');
      if (!workspaceId) return errorResponse('workspace_id is required');
      const environmentId = params.get('environment_id');

      let canManageWorkspaceMatrix = false;
      try {
        await requireWorkspaceRole(auth, workspaceId, 'owner');
        canManageWorkspaceMatrix = true;
      } catch (err) {
        if (!(err instanceof Response) || err.status !== 403) throw err;
      }

      const workspace = await queryOne<{ settings: unknown }>(
        'SELECT settings FROM workspaces WHERE id = $1',
        [workspaceId]
      );
      if (!workspace) return errorResponse('Workspace not found', 404);

      const defaults = cloneDefaultPermissionMatrix();
      const savedMatrix = getWorkspaceRbacOverridesFromSettings(workspace.settings);
      const effectiveMatrix = savedMatrix ? mergePermissionMatrixWithDefaults(savedMatrix) : defaults;
      const licensingSettings = await getWorkspaceLicensingSettings(workspaceId);
      const licensingVisible = licensingSettings.effective_licensing_enabled;
      const defaultsWithFeatureGates = licensingVisible ? defaults : filterOutBillingResource(defaults);
      const effectiveWithFeatureGates = licensingVisible ? effectiveMatrix : filterOutBillingResource(effectiveMatrix);
      const matrixMeta = licensingVisible ? getRbacMatrixMeta() : filterBillingMeta(getRbacMatrixMeta());

      if (!canManageWorkspaceMatrix) {
        if (!environmentId) {
          return errorResponse('environment_id is required for environment-scoped RBAC view', 400);
        }

        const env = await queryOne<{ id: string; enterprise_features: unknown }>(
          'SELECT id, enterprise_features FROM environments WHERE id = $1 AND workspace_id = $2',
          [environmentId, workspaceId]
        );
        if (!env) return errorResponse('Environment not found', 404);

        // Check if user is environment owner (can manage env-level overrides)
        let canManageEnvironmentMatrix = false;
        try {
          await requireEnvironmentRole(auth, environmentId, 'owner');
          canManageEnvironmentMatrix = true;
        } catch (err) {
          if (!(err instanceof Response) || err.status !== 403) throw err;
        }

        if (!canManageEnvironmentMatrix) {
          await requireEnvironmentRole(auth, environmentId, 'member');
        }

        // Resolve environment-level override
        const envSavedMatrix = getEnvironmentRbacOverridesFromFeatures(env.enterprise_features, effectiveMatrix);
        const envEffective = envSavedMatrix ? mergePermissionMatrixWithDefaults(envSavedMatrix) : effectiveWithFeatureGates;
        const envEffectiveWithFeatureGates = licensingVisible ? envEffective : filterOutBillingResource(envEffective);

        // For env-scoped view, workspace defaults are what the env inherits (workspace effective matrix)
        const environmentDefaults = filterOutWorkspaceResource(effectiveWithFeatureGates);
        const environmentMatrix = filterOutWorkspaceResource(envEffectiveWithFeatureGates);
        const resourceOrder = matrixMeta.resource_order.filter((resource) => resource !== 'workspace');

        return jsonResponse({
          workspace_id: workspaceId,
          environment_id: environmentId,
          defaults: environmentDefaults,
          matrix: environmentMatrix,
          has_override: Boolean(savedMatrix),
          environment_has_override: Boolean(envSavedMatrix),
          view_scope: 'environment',
          can_manage: canManageEnvironmentMatrix,
          meta: {
            ...matrixMeta,
            resource_order: resourceOrder,
          },
        });
      }

      return jsonResponse({
        workspace_id: workspaceId,
        defaults: defaultsWithFeatureGates,
        matrix: effectiveWithFeatureGates,
        has_override: Boolean(savedMatrix),
        view_scope: 'workspace',
        can_manage: true,
        meta: matrixMeta,
      });
    }

    if (request.method === 'PUT') {
      const body = await parseJsonBody<UpdateRbacMatrixBody>(request);
      const workspaceId = body.workspace_id?.trim();
      if (!workspaceId) return errorResponse('workspace_id is required');
      if (body.matrix === undefined) return errorResponse('matrix is required');
      const environmentId = body.environment_id?.trim();

      // Older tabs do not know assignment authority. Refuse an omission rather
      // than silently reducing an existing Owner threshold to the new default.
      if (body.matrix && typeof body.matrix === 'object' && !Array.isArray(body.matrix)) {
        const policy = (body.matrix as Record<string, unknown>).policy;
        if (policy && typeof policy === 'object' && !Array.isArray(policy) && !('assign' in policy)) {
          return errorResponse('Policy assignment permissions have changed. Refresh this page before saving RBAC settings.', 409);
        }
      }

      // --- Environment-level RBAC override ---
      if (environmentId) {
        const { canonicalMatrix, licensingVisible } = await withEnvironmentRbacWrite(auth, workspaceId, environmentId, async ({client, workspace, env, licensingVisible}) => {
          let matrixInput: unknown = body.matrix;
          let canonicalMatrix: PermissionMatrix;
          try {
            if (!licensingVisible && matrixInput && typeof matrixInput === 'object' && !Array.isArray(matrixInput)) {
              const inherited = getWorkspaceRbacOverridesFromSettings(workspace?.settings) ?? cloneDefaultPermissionMatrix();
              const effectiveExisting = getEnvironmentRbacOverridesFromFeatures(env.enterprise_features, inherited) ?? inherited;
              matrixInput = { ...(matrixInput as Record<string, unknown>), billing: effectiveExisting.billing };
            }
            canonicalMatrix = validateAndCanonicalizePermissionMatrix(matrixInput, 'environment');
          } catch (err) {
            throw errorResponse(err instanceof Error ? err.message : 'Invalid RBAC matrix', 400);
          }
          const nextFeatures = setEnvironmentRbacSettings(env.enterprise_features, canonicalMatrix, auth.authType === 'session' ? auth.user.id : null);
          const updated = await client.query(ENVIRONMENT_RBAC_SAVE_SQL, [JSON.stringify(nextFeatures.rbac), environmentId]);
          requireEnvironmentUpdate(updated);
          await logAudit({
            workspace_id: workspaceId,
            environment_id: environmentId,
            user_id: auth.authType === 'session' ? auth.user.id : undefined,
            action: 'rbac.environment_permission_matrix.updated',
            resource_type: 'environment',
            resource_id: environmentId,
            details: { resource_count: Object.keys(canonicalMatrix).length },
            ip_address: getClientIp(request),
          }, client, { requirePersistence: true });
          return { canonicalMatrix, licensingVisible };
        });
        clearEnvironmentPermissionMatrixCache();

        return jsonResponse({
          message: 'Environment RBAC permissions updated',
          workspace_id: workspaceId,
          environment_id: environmentId,
          matrix: licensingVisible ? canonicalMatrix : filterOutBillingResource(canonicalMatrix),
          environment_has_override: true,
          meta: environmentMeta(licensingVisible),
        });
      }

      // --- Workspace-level RBAC override (existing) ---
      await requireWorkspaceRole(auth, workspaceId, 'owner');

      let canonicalMatrix: PermissionMatrix;
      const licensingSettings = await getWorkspaceLicensingSettings(workspaceId);
      const licensingVisible = licensingSettings.effective_licensing_enabled;
      const current = await queryOne<{ settings: unknown }>(
        'SELECT settings FROM workspaces WHERE id = $1',
        [workspaceId]
      );
      if (!current) return errorResponse('Workspace not found', 404);
      let matrixInput: unknown = body.matrix;
      try {
        if (!licensingVisible && matrixInput && typeof matrixInput === 'object' && !Array.isArray(matrixInput)) {
          const existingMatrix = getWorkspaceRbacOverridesFromSettings(current.settings);
          const effectiveExisting = existingMatrix ? mergePermissionMatrixWithDefaults(existingMatrix) : cloneDefaultPermissionMatrix();
          matrixInput = { ...(matrixInput as Record<string, unknown>) };
          if (!('billing' in (matrixInput as Record<string, unknown>))) {
            (matrixInput as Record<string, unknown>).billing = effectiveExisting.billing;
          }
        }

        canonicalMatrix = validateAndCanonicalizePermissionMatrix(matrixInput);
      } catch (err) {
        return errorResponse(err instanceof Error ? err.message : 'Invalid RBAC matrix', 400);
      }

      const nextSettings = setWorkspaceRbacSettings(
        current.settings,
        canonicalMatrix,
        auth.authType === 'session' ? auth.user.id : null
      );

      await execute(
        "UPDATE workspaces SET settings = jsonb_set(COALESCE(settings, '{}'::jsonb), '{rbac}', $1::jsonb), updated_at = now() WHERE id = $2",
        [JSON.stringify(nextSettings.rbac), workspaceId]
      );
      clearWorkspacePermissionMatrixCache();

      await logAudit({
        workspace_id: workspaceId,
        user_id: auth.authType === 'session' ? auth.user.id : undefined,
        action: 'rbac.permission_matrix.updated',
        resource_type: 'workspace',
        resource_id: workspaceId,
        details: { resource_count: Object.keys(canonicalMatrix).length },
        ip_address: getClientIp(request),
      });

      return jsonResponse({
        message: 'RBAC permissions updated',
        workspace_id: workspaceId,
        matrix: licensingVisible ? canonicalMatrix : filterOutBillingResource(canonicalMatrix),
        has_override: true,
        meta: licensingVisible ? getRbacMatrixMeta() : filterBillingMeta(getRbacMatrixMeta()),
      });
    }

    if (request.method === 'DELETE') {
      const params = getSearchParams(request);
      const workspaceId = params.get('workspace_id')?.trim();
      if (!workspaceId) return errorResponse('workspace_id is required');
      const environmentId = params.get('environment_id')?.trim();

      // --- Environment-level RBAC override clear ---
      if (environmentId) {
        const inheritedWithFeatureGates = await withEnvironmentRbacWrite(auth, workspaceId, environmentId, async ({client, workspace, licensingVisible}) => {
          requireEnvironmentUpdate(await client.query(ENVIRONMENT_RBAC_CLEAR_SQL, [environmentId]));
          const savedMatrix = getWorkspaceRbacOverridesFromSettings(workspace.settings);
          const inheritedMatrix = savedMatrix ?? cloneDefaultPermissionMatrix();
          await logAudit({
            workspace_id: workspaceId,
            environment_id: environmentId,
            user_id: auth.authType === 'session' ? auth.user.id : undefined,
            action: 'rbac.environment_permission_matrix.cleared',
            resource_type: 'environment', resource_id: environmentId, details: {}, ip_address: getClientIp(request),
          }, client, { requirePersistence: true });
          return { matrix: licensingVisible ? inheritedMatrix : filterOutBillingResource(inheritedMatrix), licensingVisible };
        });
        clearEnvironmentPermissionMatrixCache();
        return jsonResponse({
          message: 'Environment RBAC override cleared', workspace_id: workspaceId, environment_id: environmentId,
          defaults: filterOutWorkspaceResource(inheritedWithFeatureGates.matrix),
          matrix: filterOutWorkspaceResource(inheritedWithFeatureGates.matrix), environment_has_override: false,
          meta: environmentMeta(inheritedWithFeatureGates.licensingVisible),
        });
      }

      // --- Workspace-level RBAC override clear (existing) ---
      await requireWorkspaceRole(auth, workspaceId, 'owner');

      const licensingSettings = await getWorkspaceLicensingSettings(workspaceId);
      const licensingVisible = licensingSettings.effective_licensing_enabled;
      const current = await queryOne<{ settings: unknown }>(
        'SELECT settings FROM workspaces WHERE id = $1',
        [workspaceId]
      );
      if (!current) return errorResponse('Workspace not found', 404);

      await execute(
        "UPDATE workspaces SET settings = COALESCE(settings, '{}'::jsonb) #- '{rbac,permission_matrix}' #- '{rbac,updated_at}' #- '{rbac,updated_by_user_id}', updated_at = now() WHERE id = $1",
        [workspaceId]
      );
      clearWorkspacePermissionMatrixCache();

      const defaults = cloneDefaultPermissionMatrix();
      const defaultsWithFeatureGates = licensingVisible ? defaults : filterOutBillingResource(defaults);

      await logAudit({
        workspace_id: workspaceId,
        user_id: auth.authType === 'session' ? auth.user.id : undefined,
        action: 'rbac.permission_matrix.cleared',
        resource_type: 'workspace',
        resource_id: workspaceId,
        details: {},
        ip_address: getClientIp(request),
      });

      return jsonResponse({
        message: 'RBAC override cleared',
        workspace_id: workspaceId,
        defaults: defaultsWithFeatureGates,
        matrix: defaultsWithFeatureGates,
        has_override: false,
        meta: licensingVisible ? getRbacMatrixMeta() : filterBillingMeta(getRbacMatrixMeta()),
      });
    }

    return errorResponse('Method not allowed', 405);
  } catch (err) {
    if (err instanceof Response) return err;
    if (err && typeof err === 'object' && 'code' in err && ['55P03', '40P01', '40001'].includes(String(err.code))) {
      return errorResponse('RBAC settings are busy or have changed. Reload and try again.', 409);
    }
    console.error('roles-rbac error:', err);
    return errorResponse('Internal server error', 500);
  }
}
