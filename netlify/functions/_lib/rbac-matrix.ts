import {
  DEFAULT_PERMISSION_MATRIX,
  RBAC_ROLE_VALUES,
  getPermissionMatrixMinimumRoleFloor,
  workspaceRoleMeetsMinimum,
  mergePermissionMatrixWithDefaults as mergeMatrix,
  type PermissionMatrix,
  type WorkspaceRole,
} from './rbac.js';

type JsonObject = Record<string, unknown>;

export interface RbacMatrixMeta {
  roles: WorkspaceRole[];
  resource_order: string[];
  action_order: string[];
}

const ACTION_ORDER = [
  'read',
  'read_privileged',
  'write',
  'assign',
  'delete',
  'command',
  'command_destructive',
  'bulk_destructive',
  'manage_users',
  'manage_settings',
  'license_view',
  'billing_view',
  'billing_manage',
  'billing_customer',
] as const;

export function getRbacMatrixMeta(): RbacMatrixMeta {
  return {
    roles: [...RBAC_ROLE_VALUES],
    resource_order: Object.keys(DEFAULT_PERMISSION_MATRIX),
    action_order: [...ACTION_ORDER],
  };
}

export function cloneDefaultPermissionMatrix(): PermissionMatrix {
  return JSON.parse(JSON.stringify(DEFAULT_PERMISSION_MATRIX)) as PermissionMatrix;
}

export function mergePermissionMatrixWithDefaults(value: unknown, workspaceMatrix?: PermissionMatrix): PermissionMatrix {
  return mergeMatrix(value, workspaceMatrix);
}

/** Raw permission matrices, not settings/features containers. */
export function resolvePolicyAssignmentMinimum(workspaceRaw: unknown, environmentRaw?: unknown): WorkspaceRole {
  const workspace = mergeMatrix(workspaceRaw);
  return environmentRaw && typeof environmentRaw === 'object' && !Array.isArray(environmentRaw)
    ? mergeMatrix(environmentRaw, workspace).policy.assign
    : workspace.policy.assign;
}

export function validateAndCanonicalizePermissionMatrix(value: unknown): PermissionMatrix {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('matrix must be an object');
  }

  const input = value as JsonObject;
  const resources = Object.keys(DEFAULT_PERMISSION_MATRIX);
  const unknownResources = Object.keys(input).filter((resource) => !resources.includes(resource));
  if (unknownResources.length > 0) {
    throw new Error(`Unknown resource(s): ${unknownResources.join(', ')}`);
  }

  const output: PermissionMatrix = cloneDefaultPermissionMatrix();

  for (const resource of resources) {
    const expectedActions = Object.keys(DEFAULT_PERMISSION_MATRIX[resource] ?? {});
    const resourceValue = input[resource];
    if (!resourceValue || typeof resourceValue !== 'object' || Array.isArray(resourceValue)) {
      throw new Error(`matrix.${resource} must be an object`);
    }

    const resourceObject = resourceValue as JsonObject;
    const unknownActions = Object.keys(resourceObject).filter((action) => !expectedActions.includes(action));
    if (unknownActions.length > 0) {
      throw new Error(`Unknown action(s) for ${resource}: ${unknownActions.join(', ')}`);
    }

    const missingActions = expectedActions.filter((action) => !(action in resourceObject));
    if (missingActions.length > 0) {
      throw new Error(`Missing action(s) for ${resource}: ${missingActions.join(', ')}`);
    }

    output[resource] = {} as Record<string, WorkspaceRole>;
    for (const action of expectedActions) {
      const minRole = resourceObject[action];
      if (typeof minRole !== 'string' || !RBAC_ROLE_VALUES.includes(minRole as WorkspaceRole)) {
        throw new Error(`matrix.${resource}.${action} must be one of: ${RBAC_ROLE_VALUES.join(', ')}`);
      }
      const floorRole = getPermissionMatrixMinimumRoleFloor(resource, action);
      if (floorRole && !workspaceRoleMeetsMinimum(minRole, floorRole)) {
        throw new Error(`matrix.${resource}.${action} cannot be lower than ${floorRole}`);
      }
      output[resource][action] = minRole as WorkspaceRole;
    }
  }

  return output;
}

export function getWorkspaceRbacOverridesFromSettings(settings: unknown): PermissionMatrix | null {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return null;
  const rbac = (settings as JsonObject).rbac;
  if (!rbac || typeof rbac !== 'object' || Array.isArray(rbac)) return null;
  const matrix = (rbac as JsonObject).permission_matrix;
  if (!matrix || typeof matrix !== 'object' || Array.isArray(matrix)) return null;
  return mergePermissionMatrixWithDefaults(matrix);
}

export function setWorkspaceRbacSettings(
  settings: unknown,
  matrix: PermissionMatrix,
  updatedByUserId: string | null
): JsonObject {
  const base = (settings && typeof settings === 'object' && !Array.isArray(settings)) ? { ...(settings as JsonObject) } : {};
  const existingRbac =
    base.rbac && typeof base.rbac === 'object' && !Array.isArray(base.rbac) ? { ...(base.rbac as JsonObject) } : {};

  base.rbac = {
    ...existingRbac,
    permission_matrix: matrix,
    updated_at: new Date().toISOString(),
    updated_by_user_id: updatedByUserId,
  };

  return base;
}

// --- Environment-level RBAC overrides (stored in environments.enterprise_features) ---

export function getEnvironmentRbacOverridesFromFeatures(enterpriseFeatures: unknown, workspaceMatrix?: PermissionMatrix): PermissionMatrix | null {
  if (!enterpriseFeatures || typeof enterpriseFeatures !== 'object' || Array.isArray(enterpriseFeatures)) return null;
  const rbac = (enterpriseFeatures as JsonObject).rbac;
  if (!rbac || typeof rbac !== 'object' || Array.isArray(rbac)) return null;
  const matrix = (rbac as JsonObject).permission_matrix;
  if (!matrix || typeof matrix !== 'object' || Array.isArray(matrix)) return null;
  return mergePermissionMatrixWithDefaults(matrix, workspaceMatrix);
}

export function setEnvironmentRbacSettings(
  enterpriseFeatures: unknown,
  matrix: PermissionMatrix,
  updatedByUserId: string | null
): JsonObject {
  const base = (enterpriseFeatures && typeof enterpriseFeatures === 'object' && !Array.isArray(enterpriseFeatures))
    ? { ...(enterpriseFeatures as JsonObject) }
    : {};
  const existingRbac =
    base.rbac && typeof base.rbac === 'object' && !Array.isArray(base.rbac) ? { ...(base.rbac as JsonObject) } : {};

  base.rbac = {
    ...existingRbac,
    permission_matrix: matrix,
    updated_at: new Date().toISOString(),
    updated_by_user_id: updatedByUserId,
  };

  return base;
}

export function clearEnvironmentRbacSettings(enterpriseFeatures: unknown): JsonObject {
  const base = (enterpriseFeatures && typeof enterpriseFeatures === 'object' && !Array.isArray(enterpriseFeatures))
    ? { ...(enterpriseFeatures as JsonObject) }
    : {};
  if (!base.rbac || typeof base.rbac !== 'object' || Array.isArray(base.rbac)) return base;

  const rbac = { ...(base.rbac as JsonObject) };
  delete rbac.permission_matrix;
  delete rbac.updated_at;
  delete rbac.updated_by_user_id;

  if (Object.keys(rbac).length === 0) {
    delete base.rbac;
  } else {
    base.rbac = rbac;
  }

  return base;
}

export function clearWorkspaceRbacSettings(settings: unknown): JsonObject {
  const base = (settings && typeof settings === 'object' && !Array.isArray(settings)) ? { ...(settings as JsonObject) } : {};
  if (!base.rbac || typeof base.rbac !== 'object' || Array.isArray(base.rbac)) return base;

  const rbac = { ...(base.rbac as JsonObject) };
  delete rbac.permission_matrix;
  delete rbac.updated_at;
  delete rbac.updated_by_user_id;

  if (Object.keys(rbac).length === 0) {
    delete base.rbac;
  } else {
    base.rbac = rbac;
  }

  return base;
}
