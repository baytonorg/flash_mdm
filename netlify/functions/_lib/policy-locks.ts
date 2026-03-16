import { query, queryOne } from './db.js';
import type { AuthContext } from './auth.js';
import { getEnvironmentRoleForAuth, getGroupRoleForAuth, type WorkspaceRole } from './rbac.js';

/**
 * Represents inherited lock state for a scope.
 */
export type InheritedLockState = {
  /** True if entire policy is locked by an ancestor */
  fully_locked: boolean;
  /** Aggregated locked sections from all ancestors */
  locked_sections: string[];
  /** Which ancestor scope set the lock */
  locked_by_scope: string | null;
  /** Human-readable name of the locking scope */
  locked_by_scope_name: string | null;
};

/**
 * Get the inherited lock state for a given scope by walking up the group
 * hierarchy and checking the environment. Locks accumulate downward — a
 * grandchild inherits locks from both parent and grandparent.
 *
 * Locks control editability of inherited policy config, NOT policy assignment.
 * A child group can always assign a different policy even when the parent is locked.
 */
export async function getInheritedLocks(
  scopeType: 'group' | 'device',
  scopeId: string,
  policyId: string,
  environmentId: string
): Promise<InheritedLockState> {
  const allLockedSections = new Set<string>();
  let fullyLocked = false;
  let lockedByScope: string | null = null;
  let lockedByScopeName: string | null = null;

  // Determine the group ID to start walking from
  let groupId: string | null = null;

  if (scopeType === 'group') {
    groupId = scopeId;
  } else {
    // device — get the device's group
    const device = await queryOne<{ group_id: string | null }>(
      'SELECT group_id FROM devices WHERE id = $1 AND deleted_at IS NULL',
      [scopeId]
    );
    groupId = device?.group_id ?? null;
  }

  // Walk up the group hierarchy via closure table, checking each ancestor for locks
  if (groupId) {
    const ancestorLocks = await query<{
      scope_id: string;
      locked: boolean;
      locked_sections: string[] | null;
      depth: number;
      group_name: string;
    }>(
      `SELECT pa.scope_id, pa.locked, pa.locked_sections, gc.depth, g.name AS group_name
       FROM group_closures gc
       JOIN policy_assignments pa
         ON pa.scope_type = 'group'
        AND pa.scope_id = gc.ancestor_id
        AND pa.policy_id = $2
       JOIN groups g ON g.id = gc.ancestor_id
       WHERE gc.descendant_id = $1
         AND gc.depth > 0
       ORDER BY gc.depth ASC`,
      [groupId, policyId]
    );

    for (const lock of ancestorLocks) {
      if (lock.locked) {
        fullyLocked = true;
        if (!lockedByScope) {
          lockedByScope = `group:${lock.scope_id}`;
          lockedByScopeName = lock.group_name;
        }
      }
      if (lock.locked_sections && lock.locked_sections.length > 0) {
        for (const section of lock.locked_sections) {
          allLockedSections.add(section);
        }
        if (!lockedByScope) {
          lockedByScope = `group:${lock.scope_id}`;
          lockedByScopeName = lock.group_name;
        }
      }
    }
  }

  // Check environment-level lock
  const envLock = await queryOne<{
    locked: boolean;
    locked_sections: string[] | null;
    env_name: string;
  }>(
    `SELECT pa.locked, pa.locked_sections, e.name AS env_name
     FROM policy_assignments pa
     JOIN environments e ON e.id = pa.scope_id
     WHERE pa.scope_type = 'environment'
       AND pa.scope_id = $1
       AND pa.policy_id = $2`,
    [environmentId, policyId]
  );

  if (envLock) {
    if (envLock.locked) {
      fullyLocked = true;
      if (!lockedByScope) {
        lockedByScope = `environment:${environmentId}`;
        lockedByScopeName = envLock.env_name;
      }
    }
    if (envLock.locked_sections && envLock.locked_sections.length > 0) {
      for (const section of envLock.locked_sections) {
        allLockedSections.add(section);
      }
      if (!lockedByScope) {
        lockedByScope = `environment:${environmentId}`;
        lockedByScopeName = envLock.env_name;
      }
    }
  }

  return {
    fully_locked: fullyLocked,
    locked_sections: [...allLockedSections].sort(),
    locked_by_scope: lockedByScope,
    locked_by_scope_name: lockedByScopeName,
  };
}

/**
 * RBAC: Check if the user can modify locks at a given scope.
 *
 * Rules:
 * - Superadmins: always allowed
 * - Environment admins (MSPs): can set/remove locks at any scope
 * - Group admins: can set locks within their subtree, but CANNOT modify
 *   locks set by ancestors above their access level
 * - Members / Viewers: cannot modify locks
 *
 * Returns { allowed: true } or { allowed: false, reason: string }.
 */
export async function canModifyLocks(
  auth: AuthContext,
  scopeType: 'environment' | 'group' | 'device',
  scopeId: string,
  environmentId: string
): Promise<{ allowed: boolean; reason?: string }> {
  if (auth.user.is_superadmin) return { allowed: true };

  // Check environment-level role
  const envRole = await getEnvironmentRoleForAuth(auth, environmentId);

  // Environment admins or owners can set locks at any scope
  if (envRole && roleLevel(envRole) >= roleLevel('admin')) {
    return { allowed: true };
  }

  // For group or device scope, check if user is a group admin within their subtree
  if (scopeType === 'group') {
    const groupRole = await getGroupRoleForAuth(auth, scopeId);
    if (groupRole && roleLevel(groupRole) >= roleLevel('admin')) {
      return { allowed: true };
    }
    return { allowed: false, reason: 'Only environment admins or group admins can set locks' };
  }

  if (scopeType === 'device') {
    // Get the device's group and check group admin
    const device = await queryOne<{ group_id: string | null }>(
      'SELECT group_id FROM devices WHERE id = $1 AND deleted_at IS NULL',
      [scopeId]
    );
    if (device?.group_id) {
      const groupRole = await getGroupRoleForAuth(auth, device.group_id);
      if (groupRole && roleLevel(groupRole) >= roleLevel('admin')) {
        return { allowed: true };
      }
    }
    return { allowed: false, reason: 'Only environment admins or group admins can set locks' };
  }

  // Environment-level locks require environment admin (already checked above)
  return { allowed: false, reason: 'Only environment admins can set environment-level locks' };
}

/**
 * RBAC: Check if the user can save overrides at a given scope.
 *
 * Rules:
 * - Environment admins: can override locked or unlocked sections
 * - Group admins: can only override unlocked sections within their subtree
 * - Viewers: cannot override anything
 */
export async function canSaveOverrides(
  auth: AuthContext,
  scopeType: 'group' | 'device',
  scopeId: string,
  environmentId: string
): Promise<{ allowed: boolean; can_override_locked: boolean; reason?: string }> {
  if (auth.user.is_superadmin) return { allowed: true, can_override_locked: true };

  // Check environment-level role
  const envRole = await getEnvironmentRoleForAuth(auth, environmentId);
  if (envRole && roleLevel(envRole) >= roleLevel('admin')) {
    return { allowed: true, can_override_locked: true };
  }

  // For group/device scope, check group-level access
  let targetGroupId: string | null = null;
  if (scopeType === 'group') {
    targetGroupId = scopeId;
  } else {
    const device = await queryOne<{ group_id: string | null }>(
      'SELECT group_id FROM devices WHERE id = $1 AND deleted_at IS NULL',
      [scopeId]
    );
    targetGroupId = device?.group_id ?? null;
  }

  if (targetGroupId) {
    const groupRole = await getGroupRoleForAuth(auth, targetGroupId);
    if (groupRole && roleLevel(groupRole) >= roleLevel('admin')) {
      // Group admin can override unlocked sections only
      return { allowed: true, can_override_locked: false };
    }
    if (groupRole && roleLevel(groupRole) >= roleLevel('member')) {
      // Members can also save overrides within their scope
      return { allowed: true, can_override_locked: false };
    }
  }

  // Check if user has env-level viewer/member — they can read but not write
  if (envRole && roleLevel(envRole) >= roleLevel('viewer')) {
    return { allowed: false, can_override_locked: false, reason: 'Viewers cannot modify policy overrides' };
  }

  return { allowed: false, can_override_locked: false, reason: 'Insufficient permissions to modify overrides' };
}

// Helper used by canModifyLocks / canSaveOverrides
function roleLevel(role: WorkspaceRole | string): number {
  const levels: Record<string, number> = { owner: 100, admin: 75, member: 50, viewer: 25 };
  return levels[role] ?? 0;
}

/**
 * Validate that an override config doesn't contain keys that are locked
 * by ancestor assignments. Returns an error message if validation fails,
 * or null if the override is allowed.
 */
export function validateOverrideAgainstLocks(
  overrideConfig: Record<string, unknown>,
  lockState: InheritedLockState
): string | null {
  if (lockState.fully_locked) {
    return `Policy is fully locked by ${lockState.locked_by_scope_name ?? 'an ancestor scope'}. No overrides are allowed.`;
  }

  if (lockState.locked_sections.length === 0) {
    return null; // No locked sections — override is allowed
  }

  const overrideKeys = Object.keys(overrideConfig);
  const conflicting = overrideKeys.filter((key) => lockState.locked_sections.includes(key));

  if (conflicting.length > 0) {
    return `Cannot override locked sections: ${conflicting.join(', ')}. Locked by ${lockState.locked_by_scope_name ?? 'an ancestor scope'}.`;
  }

  return null;
}
