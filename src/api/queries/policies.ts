import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../client';

// --- Interfaces ---

export interface Policy {
  id: string;
  environment_id: string;
  name: string;
  version: number;
  created_at: string;
  updated_at: string;
  [key: string]: unknown;
}

interface PoliciesResponse {
  policies: Policy[];
}

interface PolicyDetailResponse {
  policy: Policy;
  components: unknown[];
}

interface CreatePolicyResponse {
  policy: Policy;
}

interface UpdatePolicyResponse {
  message: string;
  version: number;
}

interface DeletePolicyResponse {
  message: string;
}

interface BulkPolicyResponse {
  total_targeted: number;
  succeeded: number;
  failed: number;
  results: Array<{ id: string; ok: boolean; error?: string; new_id?: string; new_name?: string }>;
}

export interface ExternalAmapiPolicyResponse {
  policy: Record<string, unknown>;
  local_policy: { id: string; name: string } | null;
}

interface CreatePolicyParams {
  environment_id: string;
  name: string;
  [key: string]: unknown;
}

interface UpdatePolicyParams {
  id: string;
  name?: string;
  [key: string]: unknown;
}

interface PolicyBulkParams {
  environment_id: string;
  operation: 'copy' | 'delete' | 'set_draft' | 'set_production' | 'push_to_amapi';
  selection: {
    ids?: string[];
    all_matching?: boolean;
    excluded_ids?: string[];
    filters?: {
      status?: string;
      scenario?: string;
      search?: string;
    };
  };
  options?: {
    copy_name_prefix?: string;
  };
}

// --- Query Keys ---

export const policyKeys = {
  all: ['policies'] as const,
  list: (environmentId: string) => [...policyKeys.all, 'list', environmentId] as const,
  detail: (id: string) => [...policyKeys.all, 'detail', id] as const,
};

// --- Hooks ---

export function usePolicies(environmentId: string) {
  return useQuery({
    queryKey: policyKeys.list(environmentId),
    queryFn: () =>
      apiClient.get<PoliciesResponse>(`/api/policies/list?environment_id=${environmentId}`),
    select: (data) => data.policies,
    enabled: !!environmentId,
  });
}

export function usePolicy(id: string) {
  return useQuery({
    queryKey: policyKeys.detail(id),
    queryFn: () => apiClient.get<PolicyDetailResponse>(`/api/policies/${id}`),
    enabled: !!id,
  });
}

export function useExternalPolicy(
  environmentId: string | undefined,
  amapiName: string | undefined,
  enabled = true,
  deviceId?: string
) {
  return useQuery({
    queryKey: ['policies', 'external', environmentId, amapiName, deviceId],
    queryFn: () =>
      apiClient.get<ExternalAmapiPolicyResponse>(
        `/api/policies/external?environment_id=${encodeURIComponent(environmentId ?? '')}&amapi_name=${encodeURIComponent(amapiName ?? '')}${deviceId ? `&device_id=${encodeURIComponent(deviceId)}` : ''}`
      ),
    enabled: !!environmentId && !!amapiName && enabled,
  });
}

export function useCreatePolicy() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (params: CreatePolicyParams) =>
      apiClient.post<CreatePolicyResponse>('/api/policies/create', params),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: policyKeys.all });
    },
  });
}

export function useUpdatePolicy() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (params: UpdatePolicyParams) =>
      apiClient.put<UpdatePolicyResponse>('/api/policies/update', params),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: policyKeys.detail(variables.id) });
      queryClient.invalidateQueries({ queryKey: [...policyKeys.all, 'list'] });
    },
  });
}

export function useDeletePolicy() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiClient.delete<DeletePolicyResponse>(`/api/policies/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: policyKeys.all });
    },
  });
}

export function useBulkPolicyAction() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (params: PolicyBulkParams) =>
      apiClient.post<BulkPolicyResponse>('/api/policies/bulk', params),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: policyKeys.list(variables.environment_id) });
      queryClient.invalidateQueries({ queryKey: policyKeys.all });
      queryClient.invalidateQueries({ queryKey: ['devices'] });
    },
  });
}

// --- Policy Assignment Interfaces ---

export interface PolicyAssignment {
  id: string;
  policy_id: string;
  policy_name: string;
  scope_type: 'environment' | 'group' | 'device';
  scope_id: string;
  scope_name: string;
  locked?: boolean;
  locked_sections?: string[];
  locked_by?: string;
  locked_at?: string;
  created_at: string;
}

export interface EffectivePolicy {
  policy_id: string | null;
  policy_name: string | null;
  source: 'device' | 'device_legacy' | 'group' | 'environment' | null;
  source_id: string | null;
  source_name: string | null;
}

// --- Policy Assignment Hooks ---

export function usePolicyAssignments(environmentId: string | undefined) {
  return useQuery({
    queryKey: ['policies', 'assignments', environmentId],
    queryFn: () =>
      apiClient.get<{ assignments: PolicyAssignment[] }>(
        `/api/policies/assignments?environment_id=${environmentId}`,
      ),
    enabled: !!environmentId,
    select: (data) => data.assignments,
  });
}

export function useEffectivePolicy(deviceId: string | undefined) {
  return useQuery({
    queryKey: ['policies', 'effective', deviceId],
    queryFn: () =>
      apiClient.get<EffectivePolicy>(`/api/policies/effective?device_id=${deviceId}`),
    enabled: !!deviceId,
  });
}

export function useAssignPolicy() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: {
      policy_id: string;
      scope_type: string;
      scope_id: string;
      locked?: boolean;
      locked_sections?: string[];
    }) =>
      apiClient.post<{ message: string }>('/api/policies/assign', body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['policies'] });
      queryClient.invalidateQueries({ queryKey: ['policies', 'assignments'] });
      queryClient.invalidateQueries({ queryKey: ['policies', 'effective'] });
      queryClient.invalidateQueries({ queryKey: ['groups'] });
      queryClient.invalidateQueries({ queryKey: ['devices'] });
    },
  });
}

export function useSetPolicyLocks() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: {
      policy_id: string;
      scope_type: string;
      scope_id: string;
      locked: boolean;
      locked_sections: string[];
    }) =>
      apiClient.post<{ message: string }>('/api/policies/assign', body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['policies'] });
      queryClient.invalidateQueries({ queryKey: ['policies', 'assignments'] });
      queryClient.invalidateQueries({ queryKey: ['policies', 'effective'] });
      queryClient.invalidateQueries({ queryKey: ['groups'] });
      queryClient.invalidateQueries({ queryKey: ['policy-override'] });
      queryClient.invalidateQueries({ queryKey: ['devices'] });
    },
  });
}

export function useUnassignPolicy() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: { scope_type: string; scope_id: string }) =>
      apiClient.post<{ message: string }>('/api/policies/unassign', body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['policies'] });
      queryClient.invalidateQueries({ queryKey: ['policies', 'assignments'] });
      queryClient.invalidateQueries({ queryKey: ['policies', 'effective'] });
      queryClient.invalidateQueries({ queryKey: ['groups'] });
      queryClient.invalidateQueries({ queryKey: ['devices'] });
    },
  });
}
