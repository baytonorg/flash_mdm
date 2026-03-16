import { useState, useEffect, useMemo, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useContextStore } from '@/stores/context';
import { apiClient } from '@/api/client';
import { useWorkspaceUsers, useInviteUser, useBulkWorkspaceUsersAction, type WorkspaceUser } from '@/api/queries/users';
import { useGroups, type Group } from '@/api/queries/groups';
import { type WorkspaceRole, useWorkspaceRbacMatrix } from '@/api/queries/rbac';
import { useAuthStore } from '@/stores/auth';
import DataTable, { type ColumnDef } from '@/components/common/DataTable';
import BulkActionBar, { type BulkAction } from '@/components/common/BulkActionBar';
import SelectAllMatchingNotice from '@/components/common/SelectAllMatchingNotice';
import UserAccessAssignmentsModal from '@/components/users/UserAccessAssignmentsModal';
import { Plus, X, UserPlus } from 'lucide-react';
import clsx from 'clsx';
import { useBulkSelection } from '@/hooks/useBulkSelection';

// ---- Helpers ----

function timeAgo(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const seconds = Math.floor((now.getTime() - date.getTime()) / 1000);

  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  const years = Math.floor(months / 12);
  return `${years}y ago`;
}

const ROLE_STYLES: Record<string, string> = {
  owner: 'bg-purple-100 text-purple-700',
  admin: 'bg-blue-100 text-blue-700',
  member: 'bg-green-100 text-green-700',
  viewer: 'bg-gray-100 text-gray-600',
};

function RoleBadge({ role }: { role: string }) {
  return (
    <span
      className={clsx(
        'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium capitalize',
        ROLE_STYLES[role] ?? 'bg-gray-100 text-gray-600',
      )}
    >
      {role}
    </span>
  );
}

function accessSummary(user: WorkspaceUser): string {
  const scope = (user.access_scope ?? 'workspace') as 'workspace' | 'scoped';
  if (scope === 'workspace') return 'Workspace-wide';
  return `Scoped · ${(user.environment_assignments ?? []).length} env · ${(user.group_assignments ?? []).length} group`;
}

function getScopedDisplayRole(user: WorkspaceUser, activeEnvironmentId?: string): string {
  const envAssignments = user.environment_assignments ?? [];
  const groupAssignments = user.group_assignments ?? [];
  if (activeEnvironmentId) {
    const envRole = envAssignments.find((a) => a.environment_id === activeEnvironmentId)?.role;
    if (envRole) return envRole;
    const groupRole = groupAssignments.find((a) => a.environment_id === activeEnvironmentId)?.role;
    if (groupRole) return groupRole;
  }

  const candidates = [...envAssignments.map((a) => a.role), ...groupAssignments.map((a) => a.role)];
  if (candidates.includes('owner')) return 'owner';
  if (candidates.includes('admin')) return 'admin';
  if (candidates.includes('member')) return 'member';
  if (candidates.includes('viewer')) return 'viewer';
  return user.role;
}

function hasDirectEnvironmentVisibility(user: WorkspaceUser, environmentId: string): boolean {
  if ((user.environment_assignments ?? []).some((assignment) => assignment.environment_id === environmentId)) {
    return true;
  }
  return (user.group_assignments ?? []).some((assignment) => assignment.environment_id === environmentId);
}

function roleLevel(role: string | null | undefined): number {
  switch (role) {
    case 'owner': return 100;
    case 'admin': return 75;
    case 'member': return 50;
    case 'viewer': return 25;
    default: return 0;
  }
}

function meetsRole(userRole: string | null | undefined, requiredRole: WorkspaceRole): boolean {
  return roleLevel(userRole) >= roleLevel(requiredRole);
}

// ---- Invite Modal ----

interface InviteModalProps {
  open: boolean;
  onClose: () => void;
  workspaceId: string;
  currentUser: WorkspaceUser | null;
  isSuperadmin: boolean;
  activeEnvironment: { id: string; name: string } | null;
  activeGroup: { id: string; name: string; environment_id: string } | null;
}

type InviteScopeMode = 'workspace' | 'environment' | 'group';

function InviteModal({
  open,
  onClose,
  workspaceId,
  currentUser,
  isSuperadmin,
  activeEnvironment,
  activeGroup,
}: InviteModalProps) {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('member');
  const [scopeMode, setScopeMode] = useState<InviteScopeMode>('workspace');
  const [selectedGroupId, setSelectedGroupId] = useState('');
  const overlayRef = useRef<HTMLDivElement>(null);
  const inviteUser = useInviteUser();
  const { data: environmentGroups = [] } = useGroups(activeEnvironment?.id ?? '');

  const currentWorkspaceRole = (currentUser?.role ?? null) as string | null;
  const currentAccessScope = (currentUser?.access_scope ?? 'workspace') as 'workspace' | 'scoped';
  const canSendWorkspaceWideInvite = isSuperadmin || (
    !!currentWorkspaceRole
    && (currentWorkspaceRole === 'owner' || currentWorkspaceRole === 'admin')
    && currentAccessScope === 'workspace'
  );
  const hasActiveGroupScope = !!activeGroup?.id;
  const hasGroupScope = !!activeEnvironment?.id;
  const hasActiveEnvironmentScope = !!activeEnvironment?.id;
  const preferredScopeMode: InviteScopeMode | null =
    hasActiveGroupScope ? 'group'
      : hasActiveEnvironmentScope ? 'environment'
        : canSendWorkspaceWideInvite ? 'workspace'
          : null;
  const effectiveScopeMode: InviteScopeMode | null =
    scopeMode === 'workspace' && !canSendWorkspaceWideInvite ? preferredScopeMode
      : scopeMode === 'group' && !hasGroupScope ? preferredScopeMode
        : scopeMode === 'environment' && !hasActiveEnvironmentScope ? preferredScopeMode
          : scopeMode;
  const environmentIds = effectiveScopeMode === 'environment' && activeEnvironment ? [activeEnvironment.id] : [];
  const groupIds = effectiveScopeMode === 'group' && selectedGroupId ? [selectedGroupId] : [];
  const canSubmitGroupScope = effectiveScopeMode !== 'group' || !!selectedGroupId;
  const selectableGroupOptions = [...environmentGroups].sort((a, b) => {
    const depthA = Number(a.depth ?? 0);
    const depthB = Number(b.depth ?? 0);
    if (depthA !== depthB) return depthA - depthB;
    return String(a.name ?? '').localeCompare(String(b.name ?? ''));
  });
  const currentEnvironmentRole = activeEnvironment
    ? (
      currentUser?.environment_assignments?.find((assignment) => assignment.environment_id === activeEnvironment.id)?.role
      ?? currentUser?.group_assignments?.find((assignment) => assignment.environment_id === activeEnvironment.id)?.role
      ?? null
    )
    : null;
  const currentGroupRole = activeGroup
    ? (
      currentUser?.group_assignments?.find((assignment) => assignment.group_id === activeGroup.id)?.role
      ?? currentEnvironmentRole
      ?? null
    )
    : null;
  const canGrantOwnerInScope = isSuperadmin || (
    effectiveScopeMode === 'workspace'
      ? currentWorkspaceRole === 'owner'
      : effectiveScopeMode === 'environment'
        ? currentEnvironmentRole === 'owner'
        : effectiveScopeMode === 'group'
          ? currentGroupRole === 'owner'
          : false
  );
  const inviteRoleOptions = [
    ...(canGrantOwnerInScope
      ? [{ value: 'owner', label: 'Owner' }]
      : []),
    { value: 'admin', label: 'Admin' },
    { value: 'member', label: 'Member' },
    { value: 'viewer', label: 'Viewer' },
  ];
  const roleAllowed = inviteRoleOptions.some((opt) => opt.value === role);

  useEffect(() => {
    if (open) {
      setEmail('');
      setRole('member');
      setScopeMode(preferredScopeMode ?? 'workspace');
      setSelectedGroupId(activeGroup?.id ?? '');
      inviteUser.reset();
    }
  }, [open, preferredScopeMode, activeGroup?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open || effectiveScopeMode !== 'group') return;
    if (selectedGroupId) return;
    if (activeGroup?.id && activeGroup.environment_id === activeEnvironment?.id) {
      setSelectedGroupId(activeGroup.id);
      return;
    }
    const firstGroup = selectableGroupOptions[0];
    if (firstGroup?.id) setSelectedGroupId(firstGroup.id);
  }, [
    open,
    effectiveScopeMode,
    selectedGroupId,
    activeGroup?.id,
    activeGroup?.environment_id,
    activeEnvironment?.id,
    selectableGroupOptions,
  ]);

  useEffect(() => {
    if (!roleAllowed) {
      setRole(inviteRoleOptions[0]?.value ?? 'member');
    }
  }, [roleAllowed, inviteRoleOptions]);

  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [open, onClose]);

  if (!open) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !effectiveScopeMode) return;
    if (effectiveScopeMode === 'group' && !selectedGroupId) return;
    try {
      await inviteUser.mutateAsync({
        workspace_id: workspaceId,
        email: email.trim(),
        role,
        environment_ids: environmentIds,
        group_ids: groupIds,
      });
      onClose();
    } catch {
      // error handled by mutation
    }
  };

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={(e) => { if (e.target === overlayRef.current) onClose(); }}
    >
      <div className="w-full max-w-md rounded-xl border border-border bg-surface p-6 shadow-xl">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <UserPlus className="h-5 w-5 text-accent" />
            <h3 className="text-lg font-semibold text-gray-900">Invite User</h3>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
              placeholder="user@example.com"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Role</label>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value)}
              className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
            >
              {inviteRoleOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>

          <div className="rounded-lg border border-gray-200 p-3">
            <p className="mb-2 text-sm font-medium text-gray-700">Access Assignment</p>
            <div className="space-y-2 text-sm">
              <label className="flex items-start gap-2 text-gray-700">
                <input
                  type="radio"
                  name="invite_scope"
                  checked={effectiveScopeMode === 'workspace'}
                  onChange={() => setScopeMode('workspace')}
                  disabled={!canSendWorkspaceWideInvite || inviteUser.isPending}
                  className="mt-0.5"
                />
                <span>
                  Workspace-wide
                  <span className="block text-xs text-gray-500">
                    Full access across all environments and groups in this workspace.
                  </span>
                </span>
              </label>

              {activeEnvironment && (
                <label className="flex items-start gap-2 text-gray-700">
                  <input
                    type="radio"
                    name="invite_scope"
                    checked={effectiveScopeMode === 'environment'}
                    onChange={() => setScopeMode('environment')}
                    disabled={inviteUser.isPending}
                    className="mt-0.5"
                  />
                  <span>
                    Current environment
                    <span className="block text-xs text-gray-500">
                      {activeEnvironment.name}
                    </span>
                  </span>
                </label>
              )}

              {activeEnvironment && (
                <label className="flex items-start gap-2 text-gray-700">
                  <input
                    type="radio"
                    name="invite_scope"
                    checked={effectiveScopeMode === 'group'}
                    onChange={() => setScopeMode('group')}
                    disabled={inviteUser.isPending || selectableGroupOptions.length === 0}
                    className="mt-0.5"
                  />
                  <span>
                    Specific group (subtree)
                    <span className="block text-xs text-gray-500">
                      {activeGroup?.id && activeGroup.environment_id === activeEnvironment.id
                        ? `Current group preselected: ${activeGroup.name}`
                        : 'Choose a group in the current environment. Access includes descendants.'}
                    </span>
                  </span>
                </label>
              )}

              {effectiveScopeMode === 'group' && activeEnvironment && (
                <div className="ml-6">
                  <select
                    value={selectedGroupId}
                    onChange={(e) => setSelectedGroupId(e.target.value)}
                    disabled={inviteUser.isPending || selectableGroupOptions.length === 0}
                    className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
                  >
                    {selectableGroupOptions.length === 0 && (
                      <option value="">No groups available</option>
                    )}
                    {selectableGroupOptions.map((group: Group) => (
                      <option key={group.id} value={group.id}>
                        {`${'  '.repeat(Math.max(0, Number(group.depth ?? 0)))}${group.name}`}
                      </option>
                    ))}
                  </select>
                  <p className="mt-1 text-xs text-gray-500">
                    Invite will apply to the selected group and all descendant groups.
                  </p>
                </div>
              )}
            </div>

            {!canSendWorkspaceWideInvite && (
              <p className="mt-2 text-xs text-amber-700">
                Workspace-wide invites are disabled for your scoped access. Invite into the current environment/group instead.
              </p>
            )}

            {effectiveScopeMode === 'group' && activeEnvironment && selectableGroupOptions.length === 0 && (
              <p className="mt-2 text-xs text-amber-700">
                No visible groups found in this environment. Create/select a group or invite at environment scope.
              </p>
            )}

            {!effectiveScopeMode && (
              <p className="mt-2 text-xs text-danger">
                No valid invite scope is available in this context. Select an environment or group before inviting.
              </p>
            )}

            {effectiveScopeMode && (
              <p className="mt-2 text-xs text-gray-500">
                Invite will be created with{' '}
                <span className="font-medium text-gray-700">
                  {effectiveScopeMode === 'workspace'
                    ? 'workspace-wide'
                    : effectiveScopeMode === 'environment'
                      ? `environment scope (${activeEnvironment?.name ?? 'current environment'})`
                      : `group scope (${selectableGroupOptions.find((g) => g.id === selectedGroupId)?.name ?? activeGroup?.name ?? 'selected group'})`}
                </span>.
              </p>
            )}
          </div>

          {inviteUser.isError && (
            <p className="text-sm text-danger">
              {inviteUser.error?.message ?? 'Failed to send invite'}
            </p>
          )}

          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={inviteUser.isPending}
              className="rounded-lg border border-border bg-surface px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={inviteUser.isPending || !email.trim() || !effectiveScopeMode || !canSubmitGroupScope}
              className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-light transition-colors disabled:opacity-50"
            >
              {inviteUser.isPending ? 'Sending...' : 'Send Invite'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ---- Main Users page ----

export default function Users() {
  const { activeWorkspace, activeEnvironment, activeGroup } = useContextStore();
  const authUser = useAuthStore((s) => s.user);
  const workspaceId = activeWorkspace?.id ?? '';

  const { data: users = [], isLoading, isError, error } = useWorkspaceUsers(workspaceId);
  const bulkUsersAction = useBulkWorkspaceUsersAction();
  const [inviteOpen, setInviteOpen] = useState(false);
  const [accessUser, setAccessUser] = useState<WorkspaceUser | null>(null);
  const [bulkAccessOpen, setBulkAccessOpen] = useState(false);
  const [bulkRole, setBulkRole] = useState('');
  const [bulkScope, setBulkScope] = useState<'workspace' | 'scoped'>('workspace');
  const [bulkEnvironmentIds, setBulkEnvironmentIds] = useState<string[]>([]);
  const [bulkGroupIds, setBulkGroupIds] = useState<string[]>([]);
  const currentUser = users.find((u) => u.id === authUser?.id) ?? null;
  const visibleUsers = useMemo(() => {
    if (!activeEnvironment?.id) return users;
    return users.filter((user) => hasDirectEnvironmentVisibility(user, activeEnvironment.id));
  }, [users, activeEnvironment?.id]);
  const currentUserRole = (currentUser?.role ?? activeWorkspace?.user_role ?? 'viewer') as string;
  const activeEnvironmentRole = (activeEnvironment?.user_role ?? currentUserRole ?? null) as string | null;
  const hideWorkspaceRoleDetails = Boolean(
    !authUser?.is_superadmin && (currentUser?.access_scope ?? 'workspace') === 'scoped'
  );
  const hasWorkspaceScopedAccess = Boolean(authUser?.is_superadmin || activeWorkspace?.access_scope === 'workspace');
  const rbacQuery = useWorkspaceRbacMatrix(
    workspaceId && (hasWorkspaceScopedAccess || activeEnvironment?.id) ? workspaceId : undefined,
    hasWorkspaceScopedAccess ? undefined : activeEnvironment?.id
  );
  const workspaceManageUsersMinRole = (rbacQuery.data?.matrix?.workspace?.manage_users ?? 'admin') as WorkspaceRole;
  const environmentManageUsersMinRole = (rbacQuery.data?.matrix?.environment?.manage_users ?? 'admin') as WorkspaceRole;
  const canManageWorkspaceUsers = Boolean(
    authUser?.is_superadmin
    || (hasWorkspaceScopedAccess && meetsRole(currentUserRole, workspaceManageUsersMinRole))
  );
  const canManageEnvironmentUsers = Boolean(
    authUser?.is_superadmin
    || (activeEnvironment?.id && meetsRole(activeEnvironmentRole, environmentManageUsersMinRole))
  );
  const canManageUsers = canManageWorkspaceUsers || canManageEnvironmentUsers;

  const environmentsQuery = useQuery<{ environments: Array<{ id: string; name: string }> }>({
    queryKey: ['bulk-users-environments', workspaceId],
    queryFn: () => apiClient.get(`/api/environments/list?workspace_id=${workspaceId}`),
    enabled: !!workspaceId && canManageWorkspaceUsers,
  });
  const groupsByEnvironmentQuery = useQuery<Array<{ id: string; name: string; environment_id: string; depth?: number }>>({
    queryKey: ['bulk-users-groups', workspaceId, (environmentsQuery.data?.environments ?? []).map((e) => e.id).join(',')],
    queryFn: async () => {
      const envs = environmentsQuery.data?.environments ?? [];
      const results = await Promise.all(
        envs.map(async (env) => {
          const data = await apiClient.get<{ groups: Array<{ id: string; name: string; environment_id: string; depth?: number }> }>(`/api/groups/list?environment_id=${env.id}`);
          return data.groups ?? [];
        })
      );
      return results.flat();
    },
    enabled: !!workspaceId && canManageWorkspaceUsers && (environmentsQuery.data?.environments?.length ?? 0) > 0,
  });

  const bulkSelection = useBulkSelection<WorkspaceUser>({
    rows: visibleUsers.filter((u) => u.id !== authUser?.id),
    rowKey: (row) => row.id,
    totalMatching: visibleUsers.filter((u) => u.id !== authUser?.id).length,
  });

  const columns: ColumnDef<WorkspaceUser>[] = [
    {
      key: 'name',
      label: 'Name',
      sortable: true,
      render: (_val, row) => {
        const first = (row.first_name as string) ?? '';
        const last = (row.last_name as string) ?? '';
        const fullName = `${first} ${last}`.trim();
        return (
          <div className="flex items-center gap-3">
            <div className="h-8 w-8 rounded-full bg-gray-200 flex items-center justify-center text-sm font-medium text-gray-600 flex-shrink-0">
              {(first?.[0] ?? row.email[0]).toUpperCase()}
            </div>
            <div className="min-w-0">
              <p className="font-medium text-gray-900 truncate">
                {fullName || row.email}
              </p>
              {fullName && (
                <p className="text-xs text-gray-500 truncate">{row.email}</p>
              )}
            </div>
          </div>
        );
      },
    },
    {
      key: 'email',
      label: 'Email',
      sortable: true,
      render: (_val, row) => (
        <span className="text-sm text-gray-600">{row.email}</span>
      ),
    },
    {
      key: 'role',
      label: 'Role',
      render: (_val, row) => {
        const scopedRole = getScopedDisplayRole(row, activeEnvironment?.id);
        const workspaceRole = row.role;
        const showRoleSplit = (row.access_scope ?? 'workspace') === 'scoped' && scopedRole !== workspaceRole;
        if (!showRoleSplit || hideWorkspaceRoleDetails) {
          return <RoleBadge role={scopedRole} />;
        }
        return (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] uppercase tracking-wide text-gray-500">Env</span>
            <RoleBadge role={scopedRole} />
            <span className="text-[11px] uppercase tracking-wide text-gray-500">Ws</span>
            <RoleBadge role={workspaceRole} />
          </div>
        );
      },
    },
    {
      key: 'assignment',
      label: 'Assignment',
      render: (_val, row) => {
        const scopedRole = getScopedDisplayRole(row, activeEnvironment?.id);
        const workspaceRole = row.role;
        const showRoleSplit = (row.access_scope ?? 'workspace') === 'scoped' && scopedRole !== workspaceRole;
        return (
          <div className="text-sm">
            <div className="text-gray-700">{accessSummary(row)}</div>
            {showRoleSplit && !hideWorkspaceRoleDetails ? (
              <div className="text-xs text-gray-500 mt-0.5">
                Env RBAC: {scopedRole} · Workspace RBAC: {workspaceRole}
              </div>
            ) : (
              <div className="text-xs text-gray-500 mt-0.5">RBAC: {scopedRole}</div>
            )}
          </div>
        );
      },
    },
    {
      key: 'joined',
      label: 'Joined',
      sortable: true,
      render: (_val, row) => {
        const dateStr = (row.joined_at ?? row.invited_at ?? row.created_at) as string | undefined;
        if (!dateStr) return <span className="text-gray-400">—</span>;
        return (
          <span className="text-sm text-gray-500" title={new Date(dateStr).toLocaleString()}>
            {timeAgo(dateStr)}
          </span>
        );
      },
    },
    ...(canManageUsers ? [
      {
        key: 'actions',
        label: '',
        className: 'w-32 text-right',
        render: (_val, row) => row.id === authUser?.id ? null : (
          <button
            type="button"
            onClick={() => setAccessUser(row)}
            className="rounded-lg border border-border bg-surface px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 transition-colors"
          >
            Manage Access
          </button>
        ),
      } as ColumnDef<WorkspaceUser>,
    ] : []),
  ];

  const bulkActions: BulkAction[] = [
    { key: 'access_overwrite', label: 'Bulk Access Edit' },
    { key: 'remove', label: 'Remove from Workspace', variant: 'danger' },
  ];

  if (!activeWorkspace) {
    return (
      <div>
        <h1 className="text-2xl font-bold text-gray-900 mb-6">Users</h1>
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <p className="text-gray-500">Select a workspace to manage users.</p>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Users</h1>
        {canManageUsers && (
          <button
            onClick={() => setInviteOpen(true)}
            className="inline-flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-light transition-colors"
          >
            <Plus className="h-4 w-4" />
            Invite User
          </button>
        )}
      </div>

      <DataTable<WorkspaceUser>
        columns={columns}
        data={visibleUsers}
        loading={isLoading}
        emptyMessage={isError
          ? 'Unable to load users for this workspace.'
          : activeEnvironment?.id
            ? 'No users scoped to this environment.'
            : 'No users in this workspace yet.'}
        selectable={canManageWorkspaceUsers}
        selectedRows={bulkSelection.selectedRows}
        onSelectionChange={bulkSelection.onSelectionChange}
        rowKey={(row) => row.id}
      />
      {isError && (
        <p className="mt-2 text-sm text-danger">
          {error instanceof Error ? error.message : 'Failed to load workspace users.'}
        </p>
      )}
      <div className="mt-3">
        <SelectAllMatchingNotice
          loadedCount={visibleUsers.filter((u) => u.id !== authUser?.id).length}
          totalCount={visibleUsers.filter((u) => u.id !== authUser?.id).length}
          allMatching={bulkSelection.allMatching}
          canSelectAllMatching={bulkSelection.canSelectAllMatching}
          onSelectAllMatching={bulkSelection.selectAllMatching}
        />
      </div>

      {canManageWorkspaceUsers && (
        <BulkActionBar
          selectedCount={bulkSelection.selectedCount}
          actions={bulkActions}
          onAction={(key) => {
            if (key === 'remove') {
              if (!window.confirm(`Remove ${bulkSelection.selectedCount} user(s) from workspace?`)) return;
              bulkUsersAction.mutate({
                workspace_id: workspaceId,
                operation: 'remove',
                selection: bulkSelection.selectionPayload,
              }, {
                onSuccess: (data) => {
                  if (data.failed > 0) window.alert(`Bulk remove completed with ${data.failed} failure(s).`);
                  bulkSelection.clearSelection();
                },
              });
              return;
            }
            setBulkAccessOpen(true);
          }}
          onClear={bulkSelection.clearSelection}
        />
      )}

      {canManageUsers && (
        <InviteModal
          open={inviteOpen}
          onClose={() => setInviteOpen(false)}
          workspaceId={workspaceId}
          currentUser={currentUser}
          isSuperadmin={!!authUser?.is_superadmin}
          activeEnvironment={activeEnvironment ? { id: activeEnvironment.id, name: activeEnvironment.name } : null}
          activeGroup={activeGroup ? { id: activeGroup.id, name: activeGroup.name, environment_id: activeGroup.environment_id } : null}
        />
      )}
      {canManageUsers && accessUser && (
        <UserAccessAssignmentsModal
          open={!!accessUser}
          workspaceId={workspaceId}
          workspaceName={activeWorkspace.name}
          userId={accessUser.id}
          userEmail={accessUser.email}
          currentUserRole={currentUserRole}
          currentEnvironmentRole={activeEnvironmentRole}
          isSuperadmin={!!authUser?.is_superadmin}
          canManageWorkspaceUsers={canManageWorkspaceUsers}
          actingEnvironmentId={canManageEnvironmentUsers ? activeEnvironment?.id ?? null : null}
          viewerAccessScope={(currentUser?.access_scope ?? 'workspace') as 'workspace' | 'scoped'}
          onClose={() => setAccessUser(null)}
        />
      )}

      {canManageWorkspaceUsers && bulkAccessOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-3xl rounded-xl border border-gray-200 bg-white p-6 shadow-xl max-h-[90vh] overflow-auto">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-gray-900">Bulk Access Edit</h3>
              <button
                onClick={() => setBulkAccessOpen(false)}
                className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <p className="mb-4 text-sm text-amber-700">
              This overwrites direct access assignments for {bulkSelection.selectedCount} selected user(s).
            </p>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Role (optional override)</label>
                <select
                  value={bulkRole}
                  onChange={(e) => setBulkRole(e.target.value)}
                  className="w-full rounded-lg border border-border px-3 py-2 text-sm"
                >
                  <option value="">Keep existing role</option>
                  <option value="owner">Owner</option>
                  <option value="admin">Admin</option>
                  <option value="member">Member</option>
                  <option value="viewer">Viewer</option>
                </select>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Access Scope</label>
                <select
                  value={bulkScope}
                  onChange={(e) => setBulkScope(e.target.value as 'workspace' | 'scoped')}
                  className="w-full rounded-lg border border-border px-3 py-2 text-sm"
                >
                  <option value="workspace">Workspace-wide</option>
                  <option value="scoped">Scoped</option>
                </select>
              </div>
            </div>
            {bulkScope === 'scoped' && (
              <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
                <div className="rounded-lg border border-gray-200 p-3">
                  <h4 className="mb-2 text-sm font-semibold text-gray-900">Environment Grants</h4>
                  <div className="max-h-56 space-y-1 overflow-auto">
                    {(environmentsQuery.data?.environments ?? []).map((env) => (
                      <label key={env.id} className="flex items-center gap-2 text-sm text-gray-700">
                        <input
                          type="checkbox"
                          checked={bulkEnvironmentIds.includes(env.id)}
                          onChange={(e) => setBulkEnvironmentIds((prev) => e.target.checked ? Array.from(new Set([...prev, env.id])) : prev.filter((id) => id !== env.id))}
                        />
                        {env.name}
                      </label>
                    ))}
                  </div>
                </div>
                <div className="rounded-lg border border-gray-200 p-3">
                  <h4 className="mb-2 text-sm font-semibold text-gray-900">Group Grants</h4>
                  <div className="max-h-56 space-y-1 overflow-auto">
                    {(groupsByEnvironmentQuery.data ?? []).map((group) => (
                      <label key={group.id} className="flex items-center gap-2 text-sm text-gray-700">
                        <input
                          type="checkbox"
                          checked={bulkGroupIds.includes(group.id)}
                          onChange={(e) => setBulkGroupIds((prev) => e.target.checked ? Array.from(new Set([...prev, group.id])) : prev.filter((id) => id !== group.id))}
                        />
                        {`${'— '.repeat(group.depth ?? 0)}${group.name}`}
                      </label>
                    ))}
                  </div>
                </div>
              </div>
            )}
            <div className="mt-5 flex justify-end gap-2">
              <button
                onClick={() => setBulkAccessOpen(false)}
                className="rounded-lg border border-border px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  bulkUsersAction.mutate({
                    workspace_id: workspaceId,
                    operation: 'access_overwrite',
                    selection: bulkSelection.selectionPayload,
                    options: {
                      role: bulkRole || undefined,
                      access_scope: bulkScope,
                      environment_ids: bulkScope === 'scoped' ? bulkEnvironmentIds : [],
                      group_ids: bulkScope === 'scoped' ? bulkGroupIds : [],
                    },
                  }, {
                    onSuccess: (data) => {
                      if (data.failed > 0) window.alert(`Bulk access edit completed with ${data.failed} failure(s).`);
                      setBulkAccessOpen(false);
                      bulkSelection.clearSelection();
                    },
                  });
                }}
                disabled={bulkUsersAction.isPending}
                className="rounded-lg bg-accent px-4 py-2 text-sm text-white hover:bg-accent-light disabled:opacity-50"
              >
                {bulkUsersAction.isPending ? 'Saving…' : 'Apply Bulk Access'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
