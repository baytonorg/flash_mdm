import { usePolicies, useAssignPolicy, useUnassignPolicy } from '@/api/queries/policies';
import { Loader2, RotateCcw } from 'lucide-react';

interface PolicyAssignmentSelectProps {
  scopeType: 'environment' | 'group' | 'device';
  scopeId: string;
  environmentId: string;
  currentPolicyId?: string | null;
  currentSource?: string;
  onAssigned?: () => void;
}

export default function PolicyAssignmentSelect({
  scopeType,
  scopeId,
  environmentId,
  currentPolicyId,
  currentSource,
  onAssigned,
}: PolicyAssignmentSelectProps) {
  const { data: policies = [], isLoading: policiesLoading } = usePolicies(environmentId);
  const assignMutation = useAssignPolicy();
  const unassignMutation = useUnassignPolicy();

  const isPending = assignMutation.isPending || unassignMutation.isPending;

  // The policy is directly assigned at this scope (not inherited)
  const isDirectAssignment = currentSource === scopeType || currentSource === 'device_legacy';

  const handleChange = async (e: React.ChangeEvent<HTMLSelectElement>) => {
    const value = e.target.value;
    if (value === currentPolicyId) return; // No change
    try {
      if (value === '') {
        await unassignMutation.mutateAsync({ scope_type: scopeType, scope_id: scopeId });
      } else {
        await assignMutation.mutateAsync({ policy_id: value, scope_type: scopeType, scope_id: scopeId });
      }
      onAssigned?.();
    } catch {
      // Error state is displayed via mutation.isError below
    }
  };

  const handleRevert = async () => {
    try {
      await unassignMutation.mutateAsync({ scope_type: scopeType, scope_id: scopeId });
      onAssigned?.();
    } catch {
      // Error state is displayed via mutation.isError below
    }
  };

  if (policiesLoading) {
    return <Loader2 className="w-4 h-4 animate-spin text-gray-400" />;
  }

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2">
        <select
          value={currentPolicyId ?? ''}
          onChange={handleChange}
          disabled={isPending}
          className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent disabled:opacity-50"
        >
          <option value="">No policy assigned</option>
          {policies.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        {isPending && <Loader2 className="w-4 h-4 animate-spin text-gray-400 flex-shrink-0" />}
        {isDirectAssignment && !isPending && (
          <button
            type="button"
            onClick={handleRevert}
            title="Revert to inherited policy"
            className="inline-flex items-center gap-1 rounded-lg p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors flex-shrink-0"
          >
            <RotateCcw className="h-4 w-4" />
          </button>
        )}
      </div>
      {currentSource && currentSource !== scopeType && currentSource !== 'device_legacy' && (
        <p className="text-xs text-amber-600">
          Currently inherited from {currentSource}. Assigning here will override.
        </p>
      )}
      {currentSource === 'device_legacy' && scopeType === 'device' && (
        <p className="text-xs text-gray-500">
          Policy set via legacy assignment. Re-assigning will migrate to the new system.
        </p>
      )}
      {(assignMutation.isError || unassignMutation.isError) && (
        <p className="text-xs text-red-600">Failed to update policy assignment.</p>
      )}
    </div>
  );
}
