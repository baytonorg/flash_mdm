import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../client';

// --- Interfaces ---

export interface InheritedLockState {
  fully_locked: boolean;
  locked_sections: string[];
  locked_by_scope: string | null;
  locked_by_scope_name: string | null;
}

export interface PolicyOverrideResponse {
  override_config: Record<string, unknown>;
  effective_base_config?: Record<string, unknown>;
  has_overrides: boolean;
  created_by: string | null;
  created_at: string | null;
  updated_at: string | null;
  lock_state: InheritedLockState;
}

interface SaveOverrideParams {
  policy_id: string;
  scope_type: 'group' | 'device';
  scope_id: string;
  override_config: Record<string, unknown>;
}

interface ResetOverrideParams {
  policy_id: string;
  scope_type: 'group' | 'device';
  scope_id: string;
}

// --- Query Keys ---

export const overrideKeys = {
  all: ['policy-overrides'] as const,
  override: (policyId: string, scopeType: string, scopeId: string) =>
    [...overrideKeys.all, 'override', policyId, scopeType, scopeId] as const,
  locks: (policyId: string, scopeType: string, scopeId: string) =>
    [...overrideKeys.all, 'locks', policyId, scopeType, scopeId] as const,
};

// --- Hooks ---

/**
 * Fetch override config + lock state for a given scope.
 */
export function usePolicyOverride(
  policyId: string | undefined,
  scopeType: 'group' | 'device' | undefined,
  scopeId: string | undefined
) {
  return useQuery({
    queryKey: overrideKeys.override(policyId ?? '', scopeType ?? '', scopeId ?? ''),
    queryFn: () =>
      apiClient.get<PolicyOverrideResponse>(
        `/api/policies/overrides?policy_id=${policyId}&scope_type=${scopeType}&scope_id=${scopeId}`
      ),
    enabled: !!policyId && !!scopeType && !!scopeId,
  });
}

/**
 * Fetch inherited lock state only.
 */
export function useInheritedLocks(
  policyId: string | undefined,
  scopeType: 'group' | 'device' | undefined,
  scopeId: string | undefined
) {
  return useQuery({
    queryKey: overrideKeys.locks(policyId ?? '', scopeType ?? '', scopeId ?? ''),
    queryFn: () =>
      apiClient.get<InheritedLockState>(
        `/api/policies/overrides/locks?policy_id=${policyId}&scope_type=${scopeType}&scope_id=${scopeId}`
      ),
    enabled: !!policyId && !!scopeType && !!scopeId,
  });
}

/**
 * Save override config for a scope.
 */
export function useSavePolicyOverride() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (params: SaveOverrideParams) =>
      apiClient.put<{ message: string }>('/api/policies/overrides', params),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: overrideKeys.all });
      queryClient.invalidateQueries({ queryKey: ['policies'] });
      queryClient.invalidateQueries({ queryKey: ['devices'] });
    },
  });
}

/**
 * Reset (delete) all overrides for a scope.
 */
export function useResetPolicyOverride() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (params: ResetOverrideParams) =>
      apiClient.delete<{ message: string }>(
        `/api/policies/overrides?policy_id=${params.policy_id}&scope_type=${params.scope_type}&scope_id=${params.scope_id}`
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: overrideKeys.all });
      queryClient.invalidateQueries({ queryKey: ['policies'] });
      queryClient.invalidateQueries({ queryKey: ['devices'] });
    },
  });
}
