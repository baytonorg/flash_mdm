import { useState, useMemo, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, GitBranch, Monitor, Users, Globe, RefreshCw, Lock, Layers, AlertTriangle } from 'lucide-react';
import clsx from 'clsx';
import { apiClient } from '@/api/client';
import { useContextStore } from '@/stores/context';
import { usePolicyAssignments, useAssignPolicy, useUnassignPolicy } from '@/api/queries/policies';
import { useGroups } from '@/api/queries/groups';
import DeploymentProgress from '@/components/deployment/DeploymentProgress';

interface PolicyDerivative {
  id: string;
  scope_type: 'environment' | 'group' | 'device';
  scope_id: string;
  scope_name: string | null;
  amapi_name: string | null;
  payload_hash: string;
  status: string;
  device_count: number;
  metadata?: {
    group_overrides_applied?: Array<{ group_id: string; group_name: string; keys: string[] }>;
    device_overrides_applied?: string[];
    locked_sections?: string[];
    device_scoped_variables?: string[];
    requires_per_device_derivative?: boolean;
    device_variable_interpolation_supported?: boolean;
  } | null;
  last_synced_at: string | null;
  created_at: string;
  updated_at: string;
}

const SCOPE_STYLES: Record<string, { bg: string; text: string; label: string; icon: typeof Globe }> = {
  environment: { bg: 'bg-blue-100', text: 'text-blue-700', label: 'Environment', icon: Globe },
  group: { bg: 'bg-purple-100', text: 'text-purple-700', label: 'Group', icon: Users },
  device: { bg: 'bg-orange-100', text: 'text-orange-700', label: 'Device', icon: Monitor },
};

export default function PolicyDerivativesPanel({ policyId, policyName }: { policyId: string; policyName?: string }) {
  const queryClient = useQueryClient();
  const { activeEnvironment } = useContextStore();
  const environmentId = activeEnvironment?.id ?? '';
  const [activeDeploymentJobId, setActiveDeploymentJobId] = useState<string | null>(null);
  const [selectedGroupIds, setSelectedGroupIds] = useState<string[]>([]);
  const [groupSearch, setGroupSearch] = useState('');
  const [assignFeedback, setAssignFeedback] = useState<{ success?: string; error?: string }>({});

  const syncMutation = useMutation({
    mutationFn: () =>
      apiClient.put('/api/policies/update', { id: policyId, push_to_amapi: true }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['policy-derivatives', policyId] });
    },
  });

  const { data, isLoading } = useQuery({
    queryKey: ['policy-derivatives', policyId],
    queryFn: () =>
      apiClient.get<{ derivatives: PolicyDerivative[] }>(
        `/api/policies/derivatives?policy_id=${policyId}`,
      ),
    enabled: !!policyId,
  });

  // Fetch assignments for the assignment map
  const { data: assignments = [] } = usePolicyAssignments(environmentId);
  const policyAssignments = assignments.filter((a) => a.policy_id === policyId);
  const groupAssignments = assignments.filter((a) => a.scope_type === 'group');
  const assignmentByGroupId = new Map(groupAssignments.map((a) => [a.scope_id, a]));
  const assignedGroupIds = new Set(groupAssignments
    .filter((a) => a.policy_id === policyId)
    .map((a) => a.scope_id));

  const { data: groups = [], isLoading: groupsLoading } = useGroups(environmentId);
  const assignMutation = useAssignPolicy();
  const unassignMutation = useUnassignPolicy();

  const derivatives = data?.derivatives ?? [];

  useEffect(() => {
    setSelectedGroupIds([]);
    setGroupSearch('');
    setAssignFeedback({});
  }, [environmentId, policyId]);

  const filteredGroups = useMemo(() => {
    if (!groupSearch.trim()) return groups;
    const term = groupSearch.toLowerCase();
    return groups.filter((g) => g.name.toLowerCase().includes(term));
  }, [groups, groupSearch]);

  const targetGroupIds = selectedGroupIds.filter((id) => !assignedGroupIds.has(id));
  const unassignGroupIds = selectedGroupIds.filter((id) => assignedGroupIds.has(id));
  const assignLabel = assignMutation.isPending
    ? 'Assigning...'
    : targetGroupIds.length > 0
      ? `Assign ${targetGroupIds.length}`
      : 'Assign';
  const unassignLabel = unassignMutation.isPending
    ? 'Unassigning...'
    : unassignGroupIds.length > 0
      ? `Unassign ${unassignGroupIds.length}`
      : 'Unassign';

  const toggleGroupId = (id: string) => {
    setSelectedGroupIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const handleAssignGroups = async () => {
    setAssignFeedback({});
    if (targetGroupIds.length === 0) {
      setAssignFeedback({ error: 'Select at least one group without this policy assigned.' });
      return;
    }
    const policyLabel = policyName?.trim() || 'this policy';
    const confirmedGroupIds: string[] = [];
    for (const groupId of targetGroupIds) {
      const assignment = assignmentByGroupId.get(groupId);
      if (assignment && assignment.policy_id !== policyId) {
        const groupName = groups.find((g) => g.id === groupId)?.name ?? 'this group';
        const existingName = assignment.policy_name || 'existing policy';
        const ok = window.confirm(
          `Override ${existingName} on ${groupName} with ${policyLabel}?`
        );
        if (!ok) continue;
      }
      confirmedGroupIds.push(groupId);
    }
    if (confirmedGroupIds.length === 0) {
      setAssignFeedback({ error: 'No groups were confirmed for assignment.' });
      return;
    }
    const results = await Promise.allSettled(
      confirmedGroupIds.map((groupId) =>
        assignMutation.mutateAsync({
          policy_id: policyId,
          scope_type: 'group',
          scope_id: groupId,
        })
      )
    );
    const failures = results.filter((r) => r.status === 'rejected');
    const successCount = results.length - failures.length;
    if (failures.length === 0) {
      setAssignFeedback({ success: `Assigned to ${successCount} group${successCount === 1 ? '' : 's'}.` });
      setSelectedGroupIds([]);
    } else {
      setAssignFeedback({
        error: `${successCount} assigned, ${failures.length} failed. Check permissions and try again.`,
      });
    }
  };

  const handleUnassignGroups = async () => {
    setAssignFeedback({});
    if (unassignGroupIds.length === 0) {
      setAssignFeedback({ error: 'Select at least one group with this policy assigned.' });
      return;
    }
    const policyLabel = policyName?.trim() || 'this policy';
    const confirmLabel = unassignGroupIds.length === 1
      ? groups.find((g) => g.id === unassignGroupIds[0])?.name ?? 'this group'
      : `${unassignGroupIds.length} groups`;
    const ok = window.confirm(`Unassign ${policyLabel} from ${confirmLabel}?`);
    if (!ok) return;
    const results = await Promise.allSettled(
      unassignGroupIds.map((groupId) =>
        unassignMutation.mutateAsync({ scope_type: 'group', scope_id: groupId })
      )
    );
    const failures = results.filter((r) => r.status === 'rejected');
    const successCount = results.length - failures.length;
    if (failures.length === 0) {
      setAssignFeedback({ success: `Unassigned from ${successCount} group${successCount === 1 ? '' : 's'}.` });
      setSelectedGroupIds([]);
    } else {
      setAssignFeedback({
        error: `${successCount} unassigned, ${failures.length} failed. Check permissions and try again.`,
      });
    }
  };

  const handleUnassignSingle = async (groupId: string, groupName: string) => {
    setAssignFeedback({});
    const policyLabel = policyName?.trim() || 'this policy';
    const ok = window.confirm(`Unassign ${policyLabel} from ${groupName}?`);
    if (!ok) return;
    try {
      await unassignMutation.mutateAsync({ scope_type: 'group', scope_id: groupId });
      setAssignFeedback({ success: `Unassigned from ${groupName}.` });
    } catch {
      setAssignFeedback({ error: `Failed to unassign from ${groupName}.` });
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-accent" />
      </div>
    );
  }

  // Count totals
  const totalDevices = derivatives.reduce((sum, d) => sum + d.device_count, 0);
  const overrideCount = derivatives.filter((d) => {
    const meta = d.metadata;
    return (meta?.group_overrides_applied?.length ?? 0) > 0 || (meta?.device_overrides_applied?.length ?? 0) > 0;
  }).length;

  return (
    <div className="space-y-6">
      {/* Bulk group assignment */}
      <div className="rounded-lg border border-gray-200 bg-white p-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h3 className="text-sm font-semibold text-gray-900 flex items-center gap-2">
              <Users className="h-4 w-4 text-gray-400" />
              Assign to Groups
            </h3>
            <p className="mt-1 text-xs text-gray-500">
              Assign this policy to multiple groups at once. Existing group policies will be overridden.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setSelectedGroupIds([])}
              disabled={selectedGroupIds.length === 0 || assignMutation.isPending || unassignMutation.isPending}
              className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-50"
            >
              Clear
            </button>
            <button
              type="button"
              onClick={handleAssignGroups}
              disabled={assignMutation.isPending || targetGroupIds.length === 0}
              className="rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent/90 disabled:opacity-50"
            >
              {assignLabel}
            </button>
            <button
              type="button"
              onClick={handleUnassignGroups}
              disabled={unassignMutation.isPending || unassignGroupIds.length === 0}
              className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              {unassignLabel}
            </button>
          </div>
        </div>

        <div className="mt-3">
          <input
            type="text"
            value={groupSearch}
            onChange={(e) => setGroupSearch(e.target.value)}
            placeholder="Search groups..."
            className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
          />
        </div>

        <div className="mt-3 max-h-56 overflow-y-auto rounded-lg border border-gray-200">
          {groupsLoading ? (
            <div className="flex items-center gap-2 px-3 py-4 text-sm text-gray-500">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading groups...
            </div>
          ) : filteredGroups.length === 0 ? (
            <div className="px-3 py-4 text-sm text-gray-500">No groups match your search.</div>
          ) : (
            filteredGroups.map((group) => {
              const assignment = assignmentByGroupId.get(group.id);
              const alreadyAssigned = assignedGroupIds.has(group.id);
              return (
                <label
                  key={group.id}
                  className="flex items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
                >
                  <input
                    type="checkbox"
                    checked={selectedGroupIds.includes(group.id)}
                    onChange={() => toggleGroupId(group.id)}
                    className="rounded border-gray-300"
                  />
                  <span className="flex-1 truncate">{group.name}</span>
                  {alreadyAssigned ? (
                    <span className="inline-flex items-center gap-2">
                      <span className="text-[10px] font-medium uppercase tracking-wide text-green-700 bg-green-50 border border-green-200 rounded-full px-2 py-0.5">
                        Assigned
                      </span>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          handleUnassignSingle(group.id, group.name);
                        }}
                        disabled={unassignMutation.isPending}
                        className="text-xs text-red-600 hover:text-red-700 disabled:opacity-50"
                      >
                        Unassign
                      </button>
                    </span>
                  ) : assignment ? (
                    <span className="text-xs text-gray-500">Current: {assignment.policy_name}</span>
                  ) : (
                    <span className="text-xs text-gray-400">No policy</span>
                  )}
                </label>
              );
            })
          )}
        </div>

        {assignFeedback.success && (
          <div className="mt-3 text-xs text-green-700 bg-green-50 border border-green-200 rounded-lg px-3 py-2">
            {assignFeedback.success}
          </div>
        )}
        {assignFeedback.error && (
          <div className="mt-3 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
            {assignFeedback.error}
          </div>
        )}
      </div>

      {/* Assignment Map */}
      {policyAssignments.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-gray-900 flex items-center gap-2 mb-3">
            <Layers className="h-4 w-4 text-gray-400" />
            Assignment Map
          </h3>
          <div className="rounded-lg border border-gray-200 bg-white divide-y divide-gray-100">
            {policyAssignments.map((a) => {
              const scopeStyle = SCOPE_STYLES[a.scope_type] ?? SCOPE_STYLES.environment;
              const ScopeIcon = scopeStyle.icon;
              const assignment = a as typeof a & { locked?: boolean; locked_sections?: string[] | null };
              const derivative = derivatives.find(
                (d) => d.scope_type === a.scope_type && d.scope_id === a.scope_id
              );
              return (
                <div key={a.id} className="flex items-center justify-between px-4 py-3">
                  <div className="flex items-center gap-3">
                    <span
                      className={clsx(
                        'inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium',
                        scopeStyle.bg,
                        scopeStyle.text,
                      )}
                    >
                      <ScopeIcon className="h-3 w-3" />
                      {scopeStyle.label}
                    </span>
                    <span className="text-sm font-medium text-gray-900">
                      {a.scope_name ?? a.scope_id}
                    </span>
                    {assignment.locked && (
                      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-100 text-amber-700">
                        <Lock className="h-2.5 w-2.5" />
                        Locked
                      </span>
                    )}
                    {assignment.locked_sections && assignment.locked_sections.length > 0 && !assignment.locked && (
                      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-blue-100 text-blue-600">
                        <Lock className="h-2.5 w-2.5" />
                        {assignment.locked_sections.length} locked
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-3 text-xs text-gray-500">
                    {derivative && (
                      <span>{derivative.device_count} device{derivative.device_count !== 1 ? 's' : ''}</span>
                    )}
                    {derivative && (
                      <span
                        className={clsx(
                          'inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium',
                          derivative.status === 'production'
                            ? 'bg-green-100 text-green-700'
                            : 'bg-gray-100 text-gray-700',
                        )}
                      >
                        {derivative.status}
                      </span>
                    )}
                    {!derivative && (
                      <span className="inline-flex items-center gap-1 text-amber-600">
                        <AlertTriangle className="h-3 w-3" />
                        No derivative
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          <div className="mt-2 flex items-center gap-4 text-xs text-gray-500">
            <span>{policyAssignments.length} assignment{policyAssignments.length !== 1 ? 's' : ''}</span>
            <span>{totalDevices} device{totalDevices !== 1 ? 's' : ''}</span>
            {overrideCount > 0 && (
              <span className="text-amber-600">{overrideCount} with overrides</span>
            )}
          </div>
        </div>
      )}

      {/* Derivatives Table */}
      <div>
        <div className="mb-4 flex items-start justify-between">
          <div>
            <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
              <GitBranch className="h-5 w-5 text-gray-400" />
              Policy Derivatives
            </h2>
            <p className="mt-1 text-sm text-gray-500">
              Scope-specific policy variations pushed to AMAPI. Each derivative merges the base policy with scoped deployments, overrides, and variables.
            </p>
          </div>
          {derivatives.length > 0 && (
            <button
              onClick={() => syncMutation.mutate()}
              disabled={syncMutation.isPending}
              className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 shadow-sm hover:bg-gray-50 disabled:opacity-50 transition-colors"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${syncMutation.isPending ? 'animate-spin' : ''}`} />
              {syncMutation.isPending ? 'Syncing...' : 'Sync All'}
            </button>
          )}
        </div>

        {derivatives.length === 0 ? (
          <div className="rounded-xl border border-gray-200 bg-white p-8 text-center">
            <GitBranch className="mx-auto h-10 w-10 text-gray-300 mb-3" />
            <p className="text-sm text-gray-500">
              No derivatives have been synced yet. Save and push this policy to AMAPI to generate derivatives.
            </p>
          </div>
        ) : (
          <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                    Scope
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                    Target
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                    Devices
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                    Overrides
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                    Status
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                    Last Synced
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {derivatives.map((d) => {
                  const scopeStyle = SCOPE_STYLES[d.scope_type] ?? SCOPE_STYLES.environment;
                  const ScopeIcon = scopeStyle.icon;
                  const meta = d.metadata;
                  const groupOverrideCount = meta?.group_overrides_applied?.length ?? 0;
                  const deviceOverrideCount = meta?.device_overrides_applied?.length ?? 0;
                  const totalOverrides = groupOverrideCount + deviceOverrideCount;
                  const hasVariables = (meta?.device_scoped_variables?.length ?? 0) > 0;
                  const variablesResolved = meta?.device_variable_interpolation_supported === true;

                  return (
                    <tr key={d.id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-4 py-3">
                        <span
                          className={clsx(
                            'inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium',
                            scopeStyle.bg,
                            scopeStyle.text,
                          )}
                        >
                          <ScopeIcon className="h-3 w-3" />
                          {scopeStyle.label}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div>
                          <span className="text-sm font-medium text-gray-900">
                            {d.scope_name || d.scope_id}
                          </span>
                          {d.amapi_name && (
                            <p className="mt-0.5 text-xs text-gray-400 font-mono truncate max-w-xs" title={d.amapi_name}>
                              {d.amapi_name}
                            </p>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-sm font-medium text-gray-700">
                          {d.device_count}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5">
                          {totalOverrides > 0 && (
                            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-100 text-amber-700">
                              {totalOverrides} override{totalOverrides !== 1 ? 's' : ''}
                            </span>
                          )}
                          {hasVariables && (
                            <span className={clsx(
                              'inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium',
                              variablesResolved
                                ? 'bg-green-100 text-green-700'
                                : 'bg-gray-100 text-gray-500'
                            )}>
                              {variablesResolved ? 'vars resolved' : 'has variables'}
                            </span>
                          )}
                          {(meta?.locked_sections?.length ?? 0) > 0 && (
                            <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-medium bg-blue-100 text-blue-600">
                              <Lock className="h-2.5 w-2.5" />
                              {meta!.locked_sections!.length}
                            </span>
                          )}
                          {totalOverrides === 0 && !hasVariables && (meta?.locked_sections?.length ?? 0) === 0 && (
                            <span className="text-xs text-gray-400">—</span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={clsx(
                            'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium',
                            d.status === 'production'
                              ? 'bg-green-100 text-green-700'
                              : 'bg-gray-100 text-gray-700',
                          )}
                        >
                          {d.status.charAt(0).toUpperCase() + d.status.slice(1)}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-500">
                        {d.last_synced_at
                          ? new Date(d.last_synced_at).toLocaleDateString(undefined, {
                              month: 'short',
                              day: 'numeric',
                              year: 'numeric',
                              hour: '2-digit',
                              minute: '2-digit',
                            })
                          : 'Never'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Deployment Pipeline */}
      {derivatives.length > 0 && environmentId && (
        <div>
          <h3 className="text-sm font-semibold text-gray-900 flex items-center gap-2 mb-3">
            Deployment
          </h3>
          <DeploymentProgress
            jobId={activeDeploymentJobId}
            policyId={policyId}
            environmentId={environmentId}
            onJobCreated={(jobId) => setActiveDeploymentJobId(jobId)}
          />
        </div>
      )}
    </div>
  );
}
