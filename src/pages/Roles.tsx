import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Loader2, RotateCcw, Save, ShieldCheck, Table2 } from 'lucide-react';
import { useAuthStore } from '@/stores/auth';
import { useContextStore } from '@/stores/context';
import {
  type PermissionMatrix,
  type WorkspaceRole,
  useClearWorkspaceRbacOverride,
  useUpdateWorkspaceRbacMatrix,
  useWorkspaceRbacMatrix,
} from '@/api/queries/rbac';

const ROLE_DESCRIPTIONS: Record<WorkspaceRole, string> = {
  viewer: 'Read-only baseline',
  member: 'Operational access',
  admin: 'Administrative access',
  owner: 'Highest workspace authority',
};

const ROLE_ORDER_ASC: WorkspaceRole[] = ['viewer', 'member', 'admin', 'owner'];
const ROLE_ORDER_DESC: WorkspaceRole[] = ['owner', 'admin', 'member', 'viewer'];
const ROLE_LEVEL: Record<WorkspaceRole, number> = {
  viewer: 25,
  member: 50,
  admin: 75,
  owner: 100,
};

const MATRIX_ACTIVE_PERMISSIONS = new Set<string>([
  'workspace:read',
  'workspace:write',
  'workspace:delete',
  'workspace:manage_users',
  'workspace:manage_settings',
  'environment:read',
  'environment:write',
  'environment:delete',
  'environment:manage_users',
  'environment:manage_settings',
  'group:read',
  'group:write',
  'group:delete',
  'group:manage_users',
  'device:read',
  'device:write',
  'device:delete',
  'policy:read',
  'policy:write',
  'policy:delete',
  'certificate:read',
  'certificate:write',
  'certificate:delete',
  'geofence:read',
  'geofence:write',
  'geofence:delete',
  'audit:read',
  'invite:read',
  'invite:write',
  'invite:delete',
  'billing:license_view',
  'billing:billing_view',
  'billing:billing_manage',
  'billing:billing_customer',
]);

function cloneMatrix(matrix: PermissionMatrix): PermissionMatrix {
  return JSON.parse(JSON.stringify(matrix)) as PermissionMatrix;
}

function matrixEqual(a: PermissionMatrix | null, b: PermissionMatrix | null): boolean {
  if (!a || !b) return false;
  return JSON.stringify(a) === JSON.stringify(b);
}

function titleCase(value: string): string {
  return value.replace(/_/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase());
}

function isRoleAllowedForThreshold(role: WorkspaceRole, minRole: WorkspaceRole): boolean {
  return ROLE_LEVEL[role] >= ROLE_LEVEL[minRole];
}

function nextHigherRole(role: WorkspaceRole): WorkspaceRole | null {
  const index = ROLE_ORDER_ASC.indexOf(role);
  if (index < 0 || index === ROLE_ORDER_ASC.length - 1) return null;
  return ROLE_ORDER_ASC[index + 1];
}

function permissionStatus(resource: string, action: string): 'Active' | 'Defined' {
  return MATRIX_ACTIVE_PERMISSIONS.has(`${resource}:${action}`) ? 'Active' : 'Defined';
}

function statusBadgeClasses(status: 'Active' | 'Defined'): string {
  return status === 'Active'
    ? 'border border-green-200 bg-green-50 text-green-700'
    : 'border border-gray-200 bg-gray-50 text-gray-600';
}

function getRoleLedActionSets(actions: string[]) {
  const standardPriority = ['read', 'write', 'delete'];
  const standard = standardPriority.filter((a) => actions.includes(a));
  const advanced = actions.filter((a) => !standardPriority.includes(a));
  return { standard, advanced };
}

export default function Roles() {
  const { user } = useAuthStore();
  const { activeWorkspace, activeEnvironment } = useContextStore();

  const workspaceId = activeWorkspace?.id;
  const environmentId = activeEnvironment?.id;
  const workspaceRole = (activeWorkspace?.user_role ?? null) as string | null;
  const environmentRole = (activeEnvironment?.user_role ?? null) as string | null;
  const hasWorkspaceScopedAccess = Boolean(user?.is_superadmin || activeWorkspace?.access_scope === 'workspace');

  // Workspace owners (workspace-scoped) can manage the workspace matrix
  const isWorkspaceOwner = Boolean(user?.is_superadmin || (hasWorkspaceScopedAccess && workspaceRole === 'owner'));
  // Environment owners can manage environment-level overrides
  const isEnvironmentOwner = Boolean(!isWorkspaceOwner && environmentRole === 'owner');
  const canManage = isWorkspaceOwner || isEnvironmentOwner;
  const canQuery = Boolean(workspaceId && (isWorkspaceOwner || environmentId));

  // For workspace owners, query without environment_id to get workspace view
  // For env-scoped users, query with environment_id
  const rbacQuery = useWorkspaceRbacMatrix(canQuery ? workspaceId : undefined, isWorkspaceOwner ? undefined : environmentId);
  const updateMatrix = useUpdateWorkspaceRbacMatrix();
  const clearOverride = useClearWorkspaceRbacOverride();

  const [draftMatrix, setDraftMatrix] = useState<PermissionMatrix | null>(null);
  const [feedback, setFeedback] = useState<{ success?: string; error?: string }>({});
  const [viewMode, setViewMode] = useState<'role' | 'matrix'>('role');
  const [advancedOpen, setAdvancedOpen] = useState<Record<string, boolean>>({});

  // Derive management scope from API response
  const viewScope = rbacQuery.data?.view_scope;
  const apiCanManage = rbacQuery.data?.can_manage ?? false;
  const effectiveCanManage = canManage && apiCanManage;
  const isEnvironmentScope = viewScope === 'environment';
  const environmentHasOverride = rbacQuery.data?.environment_has_override ?? false;

  useEffect(() => {
    if (rbacQuery.data?.matrix) {
      setDraftMatrix(cloneMatrix(rbacQuery.data.matrix));
    } else {
      setDraftMatrix(null);
    }
  }, [rbacQuery.data]);

  const defaults = rbacQuery.data?.defaults ?? null;
  const effective = rbacQuery.data?.matrix ?? null;
  const roles = rbacQuery.data?.meta.roles ?? ROLE_ORDER_ASC;
  const resourceOrder = rbacQuery.data?.meta.resource_order ?? (effective ? Object.keys(effective) : []);
  const actionOrder = rbacQuery.data?.meta.action_order ?? ['read', 'write', 'delete', 'manage_users', 'manage_settings'];

  const hasUnsavedChanges = !!draftMatrix && !!effective && !matrixEqual(draftMatrix, effective);
  const hasDefaultsLoaded = !!defaults && !!draftMatrix;

  let changedCellCount = 0;
  if (defaults && draftMatrix) {
    for (const [resource, actions] of Object.entries(draftMatrix)) {
      for (const [action, role] of Object.entries(actions)) {
        if (defaults[resource]?.[action] !== role) changedCellCount += 1;
      }
    }
  }
  const hasOverride = isEnvironmentScope ? environmentHasOverride : Boolean(rbacQuery.data?.has_override);
  const overrideMatchesDefaults = Boolean(hasOverride && changedCellCount === 0);

  const displayRoles = useMemo(() => {
    const allowed = new Set(roles);
    return ROLE_ORDER_DESC.filter((r) => allowed.has(r));
  }, [roles]);

  const handleCellChange = (resource: string, action: string, role: WorkspaceRole) => {
    if (!effectiveCanManage) return;
    setFeedback({});
    setDraftMatrix((current) => {
      if (!current) return current;
      return {
        ...current,
        [resource]: {
          ...current[resource],
          [action]: role,
        },
      };
    });
  };

  const handleRoleActionToggle = (resource: string, action: string, role: WorkspaceRole, nextAllowed: boolean) => {
    if (!effectiveCanManage) return;
    setFeedback({});
    setDraftMatrix((current) => {
      if (!current || !current[resource] || !current[resource][action]) return current;
      const currentThreshold = current[resource][action];
      let nextThreshold = currentThreshold;

      if (nextAllowed) {
        nextThreshold = role;
      } else {
        const higher = nextHigherRole(role);
        if (!higher) return current; // owner cannot be disabled because no higher role exists
        nextThreshold = higher;
      }

      if (nextThreshold === currentThreshold) return current;
      return {
        ...current,
        [resource]: {
          ...current[resource],
          [action]: nextThreshold,
        },
      };
    });
  };

  const handleSave = async () => {
    if (!workspaceId || !draftMatrix || !effectiveCanManage) return;
    setFeedback({});
    try {
      const params: { workspace_id: string; environment_id?: string; matrix: PermissionMatrix } = {
        workspace_id: workspaceId,
        matrix: draftMatrix,
      };
      if (isEnvironmentScope && environmentId) {
        params.environment_id = environmentId;
      }
      await updateMatrix.mutateAsync(params);
      setFeedback({ success: isEnvironmentScope ? 'Environment RBAC permissions updated.' : 'RBAC permissions updated.' });
    } catch (err) {
      setFeedback({ error: err instanceof Error ? err.message : 'Failed to update RBAC permissions' });
    }
  };

  const handleResetToDefaults = () => {
    if (!defaults) return;
    setFeedback({});
    setDraftMatrix(cloneMatrix(defaults));
  };

  const handleRevert = () => {
    if (!effective) return;
    setFeedback({});
    setDraftMatrix(cloneMatrix(effective));
  };

  const handleClearOverride = async () => {
    if (!workspaceId || !effectiveCanManage) return;
    setFeedback({});
    try {
      const params: { workspace_id: string; environment_id?: string } = { workspace_id: workspaceId };
      if (isEnvironmentScope && environmentId) {
        params.environment_id = environmentId;
      }
      await clearOverride.mutateAsync(params);
      setFeedback({
        success: isEnvironmentScope
          ? 'Environment RBAC override cleared. Now inheriting workspace defaults.'
          : 'RBAC override cleared. Workspace is now using defaults.',
      });
    } catch (err) {
      setFeedback({ error: err instanceof Error ? err.message : 'Failed to clear RBAC override' });
    }
  };

  const toggleAdvanced = (role: WorkspaceRole, resource: string) => {
    const key = `${role}:${resource}`;
    setAdvancedOpen((current) => ({ ...current, [key]: !current[key] }));
  };

  const scopeLabel = isEnvironmentScope ? 'environment' : 'workspace';

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-accent" />
            <h1 className="text-2xl font-bold text-gray-900">Roles</h1>
          </div>
          <p className="mt-1 text-sm text-gray-500">
            {effectiveCanManage
              ? isEnvironmentScope
                ? 'Environment RBAC override editor. Changes override the workspace defaults for this environment only.'
                : 'Workspace RBAC policy editor. Changes are saved via API and apply to role-based permissions within this workspace (including workspace and environment access checks).'
              : 'Read-only RBAC role viewer for your selected environment scope.'}
          </p>
          <p className="mt-1 text-xs text-amber-700">
            Most workspace/environment API authorization now uses this RBAC matrix. Some platform/admin and billing or licensing flows may still use domain-specific checks.
          </p>
        </div>
        <div className="flex flex-col items-end gap-1">
          {activeWorkspace && (
            <div className="rounded-lg border border-border bg-white px-3 py-2 text-sm text-gray-700">
              Workspace: <span className="font-medium">{activeWorkspace.name}</span>
            </div>
          )}
          {isEnvironmentScope && activeEnvironment && (
            <div className="rounded-lg border border-accent/30 bg-accent/5 px-3 py-2 text-sm text-gray-700">
              Environment: <span className="font-medium">{activeEnvironment.name}</span>
            </div>
          )}
        </div>
      </div>

      {!activeWorkspace ? (
        <div className="rounded-xl border border-border bg-white p-4 text-sm text-gray-600">
          Select a workspace to manage RBAC roles.
        </div>
      ) : !isWorkspaceOwner && !activeEnvironment ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          Select an environment to view role-based permissions for owner, admin, and member.
        </div>
      ) : rbacQuery.isLoading ? (
        <div className="flex items-center gap-2 rounded-xl border border-border bg-white p-4 text-sm text-gray-500">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading RBAC permissions…
        </div>
      ) : rbacQuery.error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {rbacQuery.error instanceof Error ? rbacQuery.error.message : 'Failed to load RBAC permissions'}
        </div>
      ) : !draftMatrix || !defaults ? (
        <div className="rounded-xl border border-border bg-white p-4 text-sm text-gray-600">
          RBAC data unavailable.
        </div>
      ) : (
        <>
          {!effectiveCanManage && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
              Read-only permissions view: owner defines policy, admins and members can review role-based permissions here.
            </div>
          )}
          {effectiveCanManage && isEnvironmentScope && (
            <div className="rounded-xl border border-accent/30 bg-accent/5 p-4 text-sm text-gray-700">
              Editing environment-level RBAC override for <span className="font-medium">{activeEnvironment?.name}</span>.
              {' '}Defaults shown are inherited from the workspace. Changes apply only to this environment.
            </div>
          )}
          <div className="rounded-xl border border-border bg-white p-4">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div className="text-sm text-gray-700">
                <span className="font-medium">{changedCellCount}</span> permission threshold
                {changedCellCount === 1 ? '' : 's'} changed from {isEnvironmentScope ? 'workspace' : ''} defaults
                {hasOverride
                  ? ` (${scopeLabel} override active).`
                  : isEnvironmentScope
                    ? ' (inheriting workspace defaults).'
                    : ' (currently using defaults).'}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <div className="inline-flex rounded-lg border border-border bg-white p-1">
                  <button
                    type="button"
                    onClick={() => setViewMode('role')}
                    className={`rounded-md px-3 py-1.5 text-sm font-medium ${viewMode === 'role' ? 'bg-gray-100 text-gray-900' : 'text-gray-600 hover:bg-gray-50'}`}
                  >
                    Role View
                  </button>
                  <button
                    type="button"
                    onClick={() => setViewMode('matrix')}
                    className={`inline-flex items-center gap-1 rounded-md px-3 py-1.5 text-sm font-medium ${viewMode === 'matrix' ? 'bg-gray-100 text-gray-900' : 'text-gray-600 hover:bg-gray-50'}`}
                  >
                    <Table2 className="h-3.5 w-3.5" />
                    Raw Matrix
                  </button>
                </div>
                {effectiveCanManage && (
                  <>
                    <button
                      type="button"
                      onClick={handleResetToDefaults}
                      disabled={!hasDefaultsLoaded || updateMatrix.isPending}
                      className="inline-flex items-center gap-1 rounded-lg border border-border bg-white px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                      title={isEnvironmentScope ? 'Reset to workspace defaults' : 'Reset to system defaults'}
                    >
                      <RotateCcw className="h-4 w-4" />
                      Reset to defaults
                    </button>
                    <button
                      type="button"
                      onClick={handleRevert}
                      disabled={!effective || updateMatrix.isPending || clearOverride.isPending || !hasUnsavedChanges}
                      className="inline-flex items-center gap-1 rounded-lg border border-border bg-white px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                    >
                      <RotateCcw className="h-4 w-4" />
                      Revert
                    </button>
                    <button
                      type="button"
                      onClick={handleClearOverride}
                      disabled={!hasOverride || updateMatrix.isPending || clearOverride.isPending}
                      className="inline-flex items-center gap-1 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800 hover:bg-amber-100 disabled:opacity-50"
                    >
                      {clearOverride.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
                      Clear override
                    </button>
                    <button
                      type="button"
                      onClick={handleSave}
                      disabled={!hasUnsavedChanges || updateMatrix.isPending || clearOverride.isPending}
                      className="inline-flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-light disabled:opacity-50"
                    >
                      {updateMatrix.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                      {updateMatrix.isPending ? 'Saving...' : 'Save RBAC'}
                    </button>
                  </>
                )}
              </div>
            </div>
            {(feedback.success || feedback.error) && (
              <div className={`mt-3 rounded-lg px-3 py-2 text-sm ${feedback.error ? 'border border-red-200 bg-red-50 text-red-700' : 'border border-green-200 bg-green-50 text-green-700'}`}>
                {feedback.error ?? feedback.success}
              </div>
            )}
            {overrideMatchesDefaults && (
              <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                This {scopeLabel} override currently matches {isEnvironmentScope ? 'workspace' : ''} defaults. Use <span className="font-medium">Clear override</span> to remove the stored override and return to inherited defaults-only state.
              </div>
            )}
          </div>

          {viewMode === 'role' ? (
            <div className="space-y-4">
              <div className="rounded-xl border border-border bg-white p-4">
                <div className="flex flex-col gap-2 text-sm text-gray-700 sm:flex-row sm:items-center sm:justify-between">
                  <p>
                    Role-first view: each card shows what that role can do per resource in this {scopeLabel}. <span className="font-medium">Write</span> currently covers create + update behaviour in the backend model.
                  </p>
                  <div className="flex items-center gap-2 text-xs">
                    <span className={`rounded-full px-2 py-0.5 ${statusBadgeClasses('Active')}`}>Active</span>
                    <span className={`rounded-full px-2 py-0.5 ${statusBadgeClasses('Defined')}`}>Defined</span>
                  </div>
                </div>
              </div>

              <div className="grid gap-4 xl:grid-cols-2">
                {displayRoles.map((role) => (
                  <section key={role} className="rounded-xl border border-border bg-white p-4">
                    <div className="mb-3 flex items-center justify-between gap-2">
                      <div>
                        <h2 className="text-base font-semibold text-gray-900 capitalize">{role}</h2>
                        <p className="text-xs text-gray-500">{ROLE_DESCRIPTIONS[role]}</p>
                      </div>
                      <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600">
                        {resourceOrder.length} resources
                      </span>
                    </div>

                    <div className="space-y-3">
                      {resourceOrder.map((resource) => {
                        const resourceActions = draftMatrix[resource] ?? {};
                        const orderedActions = [
                          ...actionOrder.filter((action) => action in resourceActions),
                          ...Object.keys(resourceActions).filter((action) => !actionOrder.includes(action)),
                        ];
                        const { standard, advanced } = getRoleLedActionSets(orderedActions);
                        const advancedKey = `${role}:${resource}`;
                        const isAdvancedOpen = Boolean(advancedOpen[advancedKey]);

                        return (
                          <div key={`${role}:${resource}`} className="rounded-lg border border-gray-200 p-3">
                            <div className="mb-3 flex items-center justify-between gap-2">
                              <div>
                                <p className="text-sm font-medium text-gray-900">{titleCase(resource)}</p>
                                <p className="text-xs text-gray-500">
                                  Minimum roles are edited by toggling what this role can do. Higher roles inherit lower-role permissions.
                                </p>
                              </div>
                              <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600">
                                {orderedActions.length} actions
                              </span>
                            </div>

                            {standard.length > 0 && (
                              <div className="grid gap-2 md:grid-cols-3">
                                {standard.map((action) => {
                                  const threshold = resourceActions[action] as WorkspaceRole;
                                  const checked = isRoleAllowedForThreshold(role, threshold);
                                  const status = permissionStatus(resource, action);
                                  const ownerLocked = role === 'owner' && checked;
                                  return (
                                    <label key={`${role}:${resource}:${action}`} className="flex items-start gap-2 rounded-md border border-gray-200 bg-gray-50 p-2">
                                      <input
                                        type="checkbox"
                                        checked={checked}
                                        disabled={!effectiveCanManage || ownerLocked}
                                        onChange={(e) => handleRoleActionToggle(resource, action, role, e.target.checked)}
                                        className="mt-0.5"
                                      />
                                      <span className="min-w-0 flex-1">
                                        <span className="flex items-center gap-2 text-sm font-medium text-gray-900">
                                          {titleCase(action)}
                                          <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${statusBadgeClasses(status)}`}>{status}</span>
                                        </span>
                                        <span className="mt-0.5 block text-xs text-gray-500">
                                          Min role: <span className="font-medium text-gray-700 capitalize">{threshold}</span>
                                          {action === 'write' ? ' (create/update)' : ''}
                                        </span>
                                        {ownerLocked && (
                                          <span className="mt-0.5 block text-[11px] text-gray-500">Owner cannot be disabled.</span>
                                        )}
                                      </span>
                                    </label>
                                  );
                                })}
                              </div>
                            )}

                            {advanced.length > 0 && (
                              <div className="mt-3">
                                <button
                                  type="button"
                                  onClick={() => toggleAdvanced(role, resource)}
                                  className="inline-flex items-center gap-1 text-xs font-medium text-gray-600 hover:text-gray-900"
                                >
                                  {isAdvancedOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                                  Advanced ({advanced.length})
                                </button>
                                {isAdvancedOpen && (
                                  <div className="mt-2 grid gap-2 md:grid-cols-2">
                                    {advanced.map((action) => {
                                      const threshold = resourceActions[action] as WorkspaceRole;
                                      const checked = isRoleAllowedForThreshold(role, threshold);
                                      const status = permissionStatus(resource, action);
                                      const ownerLocked = role === 'owner' && checked;
                                      return (
                                        <label key={`${role}:${resource}:${action}`} className="flex items-start gap-2 rounded-md border border-gray-200 bg-white p-2">
                                          <input
                                            type="checkbox"
                                            checked={checked}
                                            disabled={!effectiveCanManage || ownerLocked}
                                            onChange={(e) => handleRoleActionToggle(resource, action, role, e.target.checked)}
                                            className="mt-0.5"
                                          />
                                          <span className="min-w-0 flex-1">
                                            <span className="flex items-center gap-2 text-sm font-medium text-gray-900">
                                              {titleCase(action)}
                                              <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${statusBadgeClasses(status)}`}>{status}</span>
                                            </span>
                                            <span className="mt-0.5 block text-xs text-gray-500">
                                              Min role: <span className="font-medium text-gray-700 capitalize">{threshold}</span>
                                            </span>
                                          </span>
                                        </label>
                                      );
                                    })}
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </section>
                ))}
              </div>
            </div>
          ) : (
            <div className="grid gap-4 lg:grid-cols-2">
              {resourceOrder.map((resource) => {
                const resourceActions = draftMatrix[resource] ?? {};
                const orderedActions = [
                  ...actionOrder.filter((action) => action in resourceActions),
                  ...Object.keys(resourceActions).filter((action) => !actionOrder.includes(action)),
                ];

                return (
                  <section key={resource} className="rounded-xl border border-border bg-white p-4">
                    <div className="mb-3 flex items-center justify-between gap-2">
                      <h2 className="text-base font-semibold text-gray-900">{titleCase(resource)}</h2>
                      <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600">
                        {orderedActions.length} actions
                      </span>
                    </div>

                    <div className="space-y-3">
                      {orderedActions.map((action) => {
                        const value = resourceActions[action];
                        const defaultValue = defaults[resource]?.[action];
                        const isChanged = value !== defaultValue;
                        const status = permissionStatus(resource, action);
                        return (
                          <div key={`${resource}:${action}`} className="rounded-lg border border-gray-200 p-3">
                            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                              <div>
                                <p className="flex items-center gap-2 text-sm font-medium text-gray-900">
                                  {titleCase(action)}
                                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${statusBadgeClasses(status)}`}>{status}</span>
                                </p>
                                <p className="text-xs text-gray-500">
                                  {isEnvironmentScope ? 'Workspace' : 'Default'}: <span className="font-medium text-gray-700">{defaultValue}</span>
                                  {isChanged && <span className="ml-2 text-amber-700">Modified</span>}
                                </p>
                              </div>
                              <select
                                value={value}
                                onChange={(e) => handleCellChange(resource, action, e.target.value as WorkspaceRole)}
                                disabled={!effectiveCanManage}
                                className={`w-full sm:w-44 rounded-lg border bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent/20 ${isChanged ? 'border-amber-300' : 'border-border'}`}
                              >
                                {roles.map((role) => (
                                  <option key={role} value={role}>
                                    {titleCase(role)}
                                  </option>
                                ))}
                              </select>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </section>
                );
              })}
            </div>
          )}

          <div className="rounded-xl border border-border bg-white p-4">
            <h2 className="text-sm font-semibold text-gray-900">Role Levels</h2>
            <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              {displayRoles.map((role) => (
                <div key={role} className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
                  <p className="text-sm font-medium text-gray-900 capitalize">{role}</p>
                  <p className="text-xs text-gray-500">{ROLE_DESCRIPTIONS[role]}</p>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
