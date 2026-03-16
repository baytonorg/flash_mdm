import type { Context } from '@netlify/functions';
import { execute, queryOne } from './_lib/db.js';
import { requireAuth } from './_lib/auth.js';
import {
  clearEnvironmentPermissionMatrixCache,
  clearWorkspacePermissionMatrixCache,
  requireEnvironmentRole,
  requireWorkspaceRole,
  type PermissionMatrix,
} from './_lib/rbac.js';
import {
  clearEnvironmentRbacSettings,
  cloneDefaultPermissionMatrix,
  clearWorkspaceRbacSettings,
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
        const envSavedMatrix = getEnvironmentRbacOverridesFromFeatures(env.enterprise_features);
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

      // --- Environment-level RBAC override ---
      if (environmentId) {
        const env = await queryOne<{ id: string; enterprise_features: unknown; workspace_id: string }>(
          'SELECT id, enterprise_features, workspace_id FROM environments WHERE id = $1 AND workspace_id = $2',
          [environmentId, workspaceId]
        );
        if (!env) return errorResponse('Environment not found', 404);

        await requireEnvironmentRole(auth, environmentId, 'owner');

        let canonicalMatrix: PermissionMatrix;
        const licensingSettings = await getWorkspaceLicensingSettings(workspaceId);
        const licensingVisible = licensingSettings.effective_licensing_enabled;
        let matrixInput: unknown = body.matrix;
        try {
          if (!licensingVisible && matrixInput && typeof matrixInput === 'object' && !Array.isArray(matrixInput)) {
            const existingMatrix = getEnvironmentRbacOverridesFromFeatures(env.enterprise_features);
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

        const nextFeatures = setEnvironmentRbacSettings(
          env.enterprise_features,
          canonicalMatrix,
          auth.authType === 'session' ? auth.user.id : auth.apiKey?.created_by_user_id ?? null
        );

        await execute(
          'UPDATE environments SET enterprise_features = $1::jsonb, updated_at = now() WHERE id = $2',
          [JSON.stringify(nextFeatures), environmentId]
        );
        clearEnvironmentPermissionMatrixCache();

        await logAudit({
          workspace_id: workspaceId,
          environment_id: environmentId,
          user_id: auth.authType === 'session' ? auth.user.id : undefined,
          action: 'rbac.environment_permission_matrix.updated',
          resource_type: 'environment',
          resource_id: environmentId,
          details: { resource_count: Object.keys(canonicalMatrix).length },
          ip_address: getClientIp(request),
        });

        return jsonResponse({
          message: 'Environment RBAC permissions updated',
          workspace_id: workspaceId,
          environment_id: environmentId,
          matrix: licensingVisible ? canonicalMatrix : filterOutBillingResource(canonicalMatrix),
          environment_has_override: true,
          meta: licensingVisible ? getRbacMatrixMeta() : filterBillingMeta(getRbacMatrixMeta()),
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
        auth.authType === 'session' ? auth.user.id : auth.apiKey?.created_by_user_id ?? null
      );

      await execute(
        'UPDATE workspaces SET settings = $1::jsonb, updated_at = now() WHERE id = $2',
        [JSON.stringify(nextSettings), workspaceId]
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

      const licensingSettings = await getWorkspaceLicensingSettings(workspaceId);
      const licensingVisible = licensingSettings.effective_licensing_enabled;

      // --- Environment-level RBAC override clear ---
      if (environmentId) {
        const env = await queryOne<{ id: string; enterprise_features: unknown }>(
          'SELECT id, enterprise_features FROM environments WHERE id = $1 AND workspace_id = $2',
          [environmentId, workspaceId]
        );
        if (!env) return errorResponse('Environment not found', 404);

        await requireEnvironmentRole(auth, environmentId, 'owner');

        const nextFeatures = clearEnvironmentRbacSettings(env.enterprise_features);
        await execute(
          'UPDATE environments SET enterprise_features = $1::jsonb, updated_at = now() WHERE id = $2',
          [JSON.stringify(nextFeatures), environmentId]
        );
        clearEnvironmentPermissionMatrixCache();

        // Resolve what the environment will now inherit from workspace
        const workspace = await queryOne<{ settings: unknown }>(
          'SELECT settings FROM workspaces WHERE id = $1',
          [workspaceId]
        );
        const defaults = cloneDefaultPermissionMatrix();
        const savedMatrix = getWorkspaceRbacOverridesFromSettings(workspace?.settings);
        const inheritedMatrix = savedMatrix ? mergePermissionMatrixWithDefaults(savedMatrix) : defaults;
        const inheritedWithFeatureGates = licensingVisible ? inheritedMatrix : filterOutBillingResource(inheritedMatrix);

        await logAudit({
          workspace_id: workspaceId,
          environment_id: environmentId,
          user_id: auth.authType === 'session' ? auth.user.id : undefined,
          action: 'rbac.environment_permission_matrix.cleared',
          resource_type: 'environment',
          resource_id: environmentId,
          details: {},
          ip_address: getClientIp(request),
        });

        return jsonResponse({
          message: 'Environment RBAC override cleared',
          workspace_id: workspaceId,
          environment_id: environmentId,
          defaults: filterOutWorkspaceResource(inheritedWithFeatureGates),
          matrix: filterOutWorkspaceResource(inheritedWithFeatureGates),
          environment_has_override: false,
          meta: licensingVisible ? getRbacMatrixMeta() : filterBillingMeta(getRbacMatrixMeta()),
        });
      }

      // --- Workspace-level RBAC override clear (existing) ---
      await requireWorkspaceRole(auth, workspaceId, 'owner');

      const current = await queryOne<{ settings: unknown }>(
        'SELECT settings FROM workspaces WHERE id = $1',
        [workspaceId]
      );
      if (!current) return errorResponse('Workspace not found', 404);

      const nextSettings = clearWorkspaceRbacSettings(current.settings);
      await execute(
        'UPDATE workspaces SET settings = $1::jsonb, updated_at = now() WHERE id = $2',
        [JSON.stringify(nextSettings), workspaceId]
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
    console.error('roles-rbac error:', err);
    return errorResponse('Internal server error', 500);
  }
}
