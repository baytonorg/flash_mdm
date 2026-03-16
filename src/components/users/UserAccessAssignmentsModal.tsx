import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Loader2, X } from 'lucide-react';
import { apiClient } from '@/api/client';
import { useRemoveWorkspaceUser, useUpdateWorkspaceUserAccess, useUpdateWorkspaceUserRole, type WorkspaceUser } from '@/api/queries/users';

interface EnvironmentOption {
  id: string;
  name: string;
}

interface GroupOption {
  id: string;
  name: string;
  environment_id: string;
  depth?: number;
  parent_id?: string | null;
  parent_group_id?: string | null;
}

function resolveScopedRole(user: WorkspaceUser | null, actingEnvironmentId?: string | null): string | null {
  if (!user) return null;
  const envAssignments = user.environment_assignments ?? [];
  const groupAssignments = user.group_assignments ?? [];
  if (actingEnvironmentId) {
    const envRole = envAssignments.find((a) => a.environment_id === actingEnvironmentId)?.role;
    if (envRole) return envRole;
    const groupRole = groupAssignments.find((a) => a.environment_id === actingEnvironmentId)?.role;
    if (groupRole) return groupRole;
  }
  const candidates = [...envAssignments.map((a) => a.role), ...groupAssignments.map((a) => a.role)];
  if (candidates.includes('owner')) return 'owner';
  if (candidates.includes('admin')) return 'admin';
  if (candidates.includes('member')) return 'member';
  if (candidates.includes('viewer')) return 'viewer';
  return null;
}

interface Props {
  open: boolean;
  workspaceId: string;
  workspaceName?: string;
  userId: string;
  userEmail?: string;
  currentUserRole: string;
  currentEnvironmentRole?: string | null;
  isSuperadmin: boolean;
  canManageWorkspaceUsers: boolean;
  actingEnvironmentId?: string | null;
  viewerAccessScope?: 'workspace' | 'scoped';
  onClose: () => void;
  onSaved?: () => void;
}

export default function UserAccessAssignmentsModal({
  open,
  workspaceId,
  workspaceName,
  userId,
  userEmail,
  currentUserRole,
  currentEnvironmentRole = null,
  isSuperadmin,
  canManageWorkspaceUsers,
  actingEnvironmentId,
  viewerAccessScope = 'workspace',
  onClose,
  onSaved,
}: Props) {
  const updateAccess = useUpdateWorkspaceUserAccess();
  const updateRole = useUpdateWorkspaceUserRole();
  const removeWorkspaceUser = useRemoveWorkspaceUser();
  const [accessScope, setAccessScope] = useState<'workspace' | 'scoped'>('workspace');
  const [selectedEnvironmentIds, setSelectedEnvironmentIds] = useState<string[]>([]);
  const [selectedGroupIds, setSelectedGroupIds] = useState<string[]>([]);
  const [role, setRole] = useState('member');
  const [scopedRole, setScopedRole] = useState('member');
  const [feedback, setFeedback] = useState<{ error?: string; success?: string }>({});

  const usersQuery = useQuery<{ users: WorkspaceUser[] }>({
    queryKey: ['workspace-users', workspaceId, 'assignments-modal'],
    queryFn: () => apiClient.get(`/api/workspaces/users?workspace_id=${workspaceId}`),
    enabled: open && !!workspaceId,
  });

  const environmentsQuery = useQuery<{ environments: EnvironmentOption[] }>({
    queryKey: ['workspace-access-modal', 'environments', workspaceId],
    queryFn: () => apiClient.get(`/api/environments/list?workspace_id=${workspaceId}`),
    enabled: open && !!workspaceId,
  });

  const groupsQuery = useQuery<GroupOption[]>({
    queryKey: ['workspace-access-modal', 'groups', workspaceId, (environmentsQuery.data?.environments ?? []).map((e) => e.id).join(',')],
    queryFn: async () => {
      const envs = environmentsQuery.data?.environments ?? [];
      const results = await Promise.all(
        envs.map(async (env) => {
          const data = await apiClient.get<{ groups: GroupOption[] }>(`/api/groups/list?environment_id=${env.id}`);
          return data.groups ?? [];
        })
      );
      return results.flat();
    },
    enabled: open && !!workspaceId && (environmentsQuery.data?.environments?.length ?? 0) > 0,
  });

  const user = useMemo(
    () => (usersQuery.data?.users ?? []).find((u) => u.id === userId) ?? null,
    [usersQuery.data?.users, userId]
  );
  const environmentScopedManager = !canManageWorkspaceUsers && !!actingEnvironmentId;
  const hideWorkspaceRoleDetails = viewerAccessScope === 'scoped' && !isSuperadmin;
  const inheritedWorkspaceUser = environmentScopedManager && (user?.access_scope ?? 'workspace') === 'workspace';
  const scopedEnvironmentRole = useMemo(
    () => resolveScopedRole(user, actingEnvironmentId),
    [user, actingEnvironmentId]
  );

  useEffect(() => {
    if (!open || !user) return;
    const userEnvironmentIds = (user.environment_assignments ?? []).map((a) => a.environment_id);
    const userGroupAssignments = user.group_assignments ?? [];
    if (environmentScopedManager && actingEnvironmentId) {
      setAccessScope('scoped');
      setSelectedEnvironmentIds(userEnvironmentIds.filter((id) => id === actingEnvironmentId));
      setSelectedGroupIds(
        userGroupAssignments
          .filter((a) => a.environment_id === actingEnvironmentId)
          .map((a) => a.group_id)
      );
    } else {
      setAccessScope(user.access_scope ?? 'workspace');
      setSelectedEnvironmentIds(userEnvironmentIds);
      setSelectedGroupIds(userGroupAssignments.map((a) => a.group_id));
    }
    setRole(user.role ?? 'member');
    setScopedRole(scopedEnvironmentRole ?? user.role ?? 'member');
    setFeedback({});
  }, [open, user, environmentScopedManager, actingEnvironmentId, scopedEnvironmentRole]);

  if (!open) return null;

  const visibleEnvironments = (environmentsQuery.data?.environments ?? []).filter((env) =>
    !environmentScopedManager || env.id === actingEnvironmentId
  );
  const visibleGroups = (groupsQuery.data ?? []).filter((group) =>
    !environmentScopedManager || group.environment_id === actingEnvironmentId
  );
  const visibleGroupIds = new Set(visibleGroups.map((group) => group.id));
  const groupedByEnvironment = new Map<string, GroupOption[]>();
  for (const group of visibleGroups) {
    const list = groupedByEnvironment.get(group.environment_id) ?? [];
    list.push(group);
    groupedByEnvironment.set(group.environment_id, list);
  }

  const isLoading = usersQuery.isLoading || environmentsQuery.isLoading || groupsQuery.isLoading;
  const isPending = updateAccess.isPending || updateRole.isPending || removeWorkspaceUser.isPending;
  const canAssignWorkspaceOwner = isSuperadmin || currentUserRole === 'owner';
  const canAssignScopedOwner = isSuperadmin || currentUserRole === 'owner' || currentEnvironmentRole === 'owner';
  const workspaceRoleOptions = canAssignWorkspaceOwner
    ? ['owner', 'admin', 'member', 'viewer']
    : ['admin', 'member', 'viewer'];
  const scopedRoleOptions = canAssignScopedOwner
    ? ['owner', 'admin', 'member', 'viewer']
    : ['admin', 'member', 'viewer'];
  const roleLocked = !canAssignWorkspaceOwner && user?.role === 'owner';
  const scopedRoleLocked = !canAssignScopedOwner && scopedEnvironmentRole === 'owner';
  const effectiveAccessScope: 'workspace' | 'scoped' = environmentScopedManager ? 'scoped' : accessScope;
  const showWorkspaceRoleSelect = canManageWorkspaceUsers;
  const showScopedRoleSelect = environmentScopedManager || !showWorkspaceRoleSelect || effectiveAccessScope === 'scoped';

  const toggleId = (ids: string[], id: string, checked: boolean) =>
    checked ? Array.from(new Set([...ids, id])) : ids.filter((x) => x !== id);

  const handleSave = async () => {
    setFeedback({});
    try {
      if (!environmentScopedManager && user && role !== user.role) {
        await updateRole.mutateAsync({
          workspace_id: workspaceId,
          user_id: userId,
          role,
        });
      }
      const environmentIds = environmentScopedManager && actingEnvironmentId
        ? selectedEnvironmentIds.filter((id) => id === actingEnvironmentId)
        : selectedEnvironmentIds;
      const groupIds = selectedGroupIds.filter((id) => visibleGroupIds.has(id));
      await updateAccess.mutateAsync({
        workspace_id: workspaceId,
        user_id: userId,
        access_scope: effectiveAccessScope,
        scoped_role: scopedRole,
        environment_ids: environmentIds,
        group_ids: groupIds,
        acting_environment_id: environmentScopedManager ? actingEnvironmentId ?? undefined : undefined,
      });
      setFeedback({ success: 'User settings updated' });
      onSaved?.();
    } catch (err) {
      setFeedback({ error: err instanceof Error ? err.message : 'Failed to update access' });
    }
  };

  const handleRemoveFromWorkspace = async () => {
    if (!user) return;
    if (environmentScopedManager) {
      if (inheritedWorkspaceUser) {
        setFeedback({ error: 'This user is inherited from workspace scope and cannot be removed from this environment.' });
        return;
      }
      const confirmed = window.confirm(`Remove ${user.email} from this environment?`);
      if (!confirmed) return;

      setFeedback({});
      try {
        await updateAccess.mutateAsync({
          workspace_id: workspaceId,
          user_id: userId,
          access_scope: 'scoped',
          environment_ids: [],
          group_ids: [],
          acting_environment_id: actingEnvironmentId ?? undefined,
        });
        setFeedback({ success: 'User removed from this environment' });
        onSaved?.();
      } catch (err) {
        setFeedback({ error: err instanceof Error ? err.message : 'Failed to remove user from this environment' });
      }
      return;
    }

    const confirmed = window.confirm(`Remove ${user.email} from ${workspaceName ?? 'this workspace'}?`);
    if (!confirmed) return;

    setFeedback({});
    try {
      await removeWorkspaceUser.mutateAsync({
        workspace_id: workspaceId,
        user_id: userId,
      });
      onSaved?.();
      onClose();
    } catch (err) {
      setFeedback({ error: err instanceof Error ? err.message : 'Failed to remove user from workspace' });
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-3xl rounded-xl border border-gray-200 bg-white p-6 shadow-xl max-h-[90vh] overflow-auto">
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <h3 className="text-lg font-semibold text-gray-900">Access Assignment</h3>
            <p className="text-sm text-gray-500">
              {userEmail ?? user?.email ?? 'User'} in {workspaceName ?? 'workspace'}
            </p>
            {user && (
              <p className="text-xs text-gray-500 mt-1">
                {(user.access_scope ?? 'workspace') === 'scoped' ? (
                  hideWorkspaceRoleDetails ? (
                    <>
                      Scoped RBAC role: <span className="font-medium text-gray-700">{scopedEnvironmentRole ?? user.role}</span>
                    </>
                  ) : (
                    <>
                      Workspace RBAC role: <span className="font-medium text-gray-700">{user.role}</span>
                      {' · '}Scoped environment RBAC: <span className="font-medium text-gray-700">{scopedEnvironmentRole ?? user.role}</span>
                    </>
                  )
                ) : (
                  <>
                    Workspace RBAC role: <span className="font-medium text-gray-700">{user.role}</span>
                  </>
                )}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-5 w-5 animate-spin text-gray-400" />
          </div>
        ) : !user ? (
          <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            User not found in this workspace.
          </div>
        ) : (
          <div className="space-y-5">
            {(showWorkspaceRoleSelect || showScopedRoleSelect) && (
              <div className="rounded-lg border border-gray-200 p-4">
                <h4 className="text-sm font-semibold text-gray-900 mb-2">Role</h4>
                <p className="text-xs text-gray-500 mb-3">
                  Workspace owners can set both workspace and scoped role. Environment-scoped managers can set scoped role only.
                </p>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  {showWorkspaceRoleSelect && (
                    <div>
                      <p className="mb-1 text-xs font-medium uppercase tracking-wide text-gray-500">Workspace Role</p>
                      <select
                        value={role}
                        onChange={(e) => setRole(e.target.value)}
                        disabled={isPending || roleLocked}
                        className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
                      >
                        {workspaceRoleOptions.map((opt) => (
                          <option key={opt} value={opt}>
                            {opt.charAt(0).toUpperCase() + opt.slice(1)}
                          </option>
                        ))}
                      </select>
                      {roleLocked && (
                        <p className="mt-1 text-xs text-amber-700">
                          Owners can only be changed by another owner.
                        </p>
                      )}
                    </div>
                  )}
                  {showScopedRoleSelect && (
                    <div>
                      <p className="mb-1 text-xs font-medium uppercase tracking-wide text-gray-500">Scoped Role</p>
                      <select
                        value={scopedRole}
                        onChange={(e) => setScopedRole(e.target.value)}
                        disabled={isPending || inheritedWorkspaceUser || scopedRoleLocked}
                        className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
                      >
                        {scopedRoleOptions.map((opt) => (
                          <option key={opt} value={opt}>
                            {opt.charAt(0).toUpperCase() + opt.slice(1)}
                          </option>
                        ))}
                      </select>
                      {inheritedWorkspaceUser ? (
                        <p className="mt-1 text-xs text-gray-500">
                          Inherited workspace users cannot be changed at scoped level.
                        </p>
                      ) : scopedRoleLocked ? (
                        <p className="mt-1 text-xs text-amber-700">
                          Owner scoped roles can only be assigned by an owner.
                        </p>
                      ) : (
                        <p className="mt-1 text-xs text-gray-500">
                          Applied to direct environment and group grants in this workspace scope.
                        </p>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}

            <div className="rounded-lg border border-gray-200 p-4">
              <h4 className="text-sm font-semibold text-gray-900 mb-2">Scope Mode</h4>
              {environmentScopedManager ? (
                <p className="text-sm text-gray-700">
                  Scoped to the active environment only.
                </p>
              ) : (
                <div className="space-y-2">
                  <label className="flex items-start gap-2 text-sm text-gray-700">
                    <input
                      type="radio"
                      name="access_scope"
                      checked={accessScope === 'workspace'}
                      onChange={() => setAccessScope('workspace')}
                      disabled={isPending}
                      className="mt-0.5"
                    />
                    <span>
                      Workspace-wide access
                      <span className="block text-xs text-gray-500">Can access all environments and groups in this workspace.</span>
                    </span>
                  </label>
                  <label className="flex items-start gap-2 text-sm text-gray-700">
                    <input
                      type="radio"
                      name="access_scope"
                      checked={accessScope === 'scoped'}
                      onChange={() => setAccessScope('scoped')}
                      disabled={isPending}
                      className="mt-0.5"
                    />
                    <span>
                      Scoped access only
                      <span className="block text-xs text-gray-500">Access is limited to direct environment and group grants below.</span>
                    </span>
                  </label>
                </div>
              )}
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div className="rounded-lg border border-gray-200 p-4">
                <h4 className="text-sm font-semibold text-gray-900 mb-2">Environment Grants</h4>
                <div className="space-y-2 max-h-72 overflow-auto">
                  {visibleEnvironments.map((env) => (
                    <label key={env.id} className="flex items-center gap-2 text-sm text-gray-700">
                      <input
                        type="checkbox"
                        checked={selectedEnvironmentIds.includes(env.id)}
                        onChange={(e) => setSelectedEnvironmentIds((prev) => toggleId(prev, env.id, e.target.checked))}
                        disabled={isPending || inheritedWorkspaceUser}
                      />
                      <span>{env.name}</span>
                    </label>
                  ))}
                  {visibleEnvironments.length === 0 && (
                    <p className="text-xs text-gray-400">No environments available.</p>
                  )}
                </div>
              </div>

              <div className="rounded-lg border border-gray-200 p-4">
                <h4 className="text-sm font-semibold text-gray-900 mb-2">Group Grants</h4>
                <p className="text-xs text-gray-500 mb-2">
                  Direct group grants automatically include descendant groups (inherited via hierarchy).
                </p>
                <div className="space-y-3 max-h-72 overflow-auto">
                  {visibleEnvironments.map((env) => {
                    const groups = groupedByEnvironment.get(env.id) ?? [];
                    if (groups.length === 0) return null;
                    return (
                      <div key={env.id}>
                        <p className="text-xs font-medium uppercase text-gray-500 mb-1">{env.name}</p>
                        <div className="space-y-1">
                          {groups.map((group) => (
                            <label key={group.id} className="flex items-center gap-2 text-sm text-gray-700">
                              <input
                                type="checkbox"
                                checked={selectedGroupIds.includes(group.id)}
                                onChange={(e) => setSelectedGroupIds((prev) => toggleId(prev, group.id, e.target.checked))}
                                disabled={isPending || inheritedWorkspaceUser}
                              />
                              <span>{'— '.repeat(group.depth ?? 0)}{group.name}</span>
                            </label>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                  {visibleGroups.length === 0 && (
                    <p className="text-xs text-gray-400">No groups available.</p>
                  )}
                </div>
              </div>
            </div>

            <div className="rounded-lg border border-blue-100 bg-blue-50/50 px-3 py-2 text-xs text-blue-900">
              Current direct assignment: {effectiveAccessScope === 'workspace'
                ? 'workspace-wide'
                : `${selectedEnvironmentIds.length} environment grant(s), ${selectedGroupIds.length} group grant(s)`}
            </div>

            <div className="rounded-lg border border-red-200 bg-red-50/60 px-3 py-3">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-sm font-medium text-red-900">
                    {environmentScopedManager ? 'Remove from Environment' : 'Remove from Workspace'}
                  </p>
                  <p className="text-xs text-red-700">
                    {environmentScopedManager
                      ? 'Removes direct environment/group grants in the active environment.'
                      : 'Removes the workspace membership and all environment/group grants in this workspace.'}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleRemoveFromWorkspace}
                  disabled={isPending || !user || inheritedWorkspaceUser}
                  className="rounded-lg border border-red-300 bg-white px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
                >
                  {removeWorkspaceUser.isPending || updateAccess.isPending ? 'Removing…' : 'Remove User'}
                </button>
              </div>
              {inheritedWorkspaceUser && (
                <p className="mt-2 text-xs text-red-700">
                  This user is inherited from workspace scope and cannot be removed at environment scope.
                </p>
              )}
            </div>

            {feedback.error && (
              <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                {feedback.error}
              </div>
            )}
            {feedback.success && (
              <div className="rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700">
                {feedback.success}
              </div>
            )}

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={onClose}
                disabled={isPending}
                className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              >
                Close
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={isPending || !user || inheritedWorkspaceUser}
                className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                Save Access
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
