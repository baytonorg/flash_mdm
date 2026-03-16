import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/api/client';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface PolicyComponent {
  id: string;
  environment_id: string;
  name: string;
  description: string | null;
  category: string;
  config_fragment: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface ComponentAssignment {
  assignment_id: string;
  priority: number;
  assigned_at: string;
  id: string;
  name: string;
  description: string | null;
  category: string;
  config_fragment: Record<string, unknown>;
}

// ─── Query Keys ─────────────────────────────────────────────────────────────

export const componentKeys = {
  all: ['components'] as const,
  list: (environmentId: string) => ['components', 'list', environmentId] as const,
  detail: (id: string) => ['components', 'detail', id] as const,
  policyAssignments: (policyId: string) => ['components', 'policy', policyId] as const,
};

// ─── Queries ────────────────────────────────────────────────────────────────

export function useComponents(environmentId: string | undefined) {
  return useQuery({
    queryKey: componentKeys.list(environmentId ?? ''),
    queryFn: () =>
      apiClient.get<{ components: PolicyComponent[] }>(
        `/api/components/list?environment_id=${environmentId}`
      ),
    enabled: !!environmentId,
    select: (data) => data.components,
  });
}

export function useComponent(id: string | undefined) {
  return useQuery({
    queryKey: componentKeys.detail(id ?? ''),
    queryFn: () =>
      apiClient.get<{ component: PolicyComponent }>(`/api/components/${id}`),
    enabled: !!id,
    select: (data) => data.component,
  });
}

export function usePolicyComponents(policyId: string | undefined) {
  return useQuery({
    queryKey: componentKeys.policyAssignments(policyId ?? ''),
    queryFn: () =>
      apiClient.get<{ assignments: ComponentAssignment[] }>(
        `/api/components/policy/${policyId}`
      ),
    enabled: !!policyId,
    select: (data) => data.assignments,
  });
}

// ─── Mutations ──────────────────────────────────────────────────────────────

export function useCreateComponent() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (body: {
      environment_id: string;
      name: string;
      description?: string;
      category: string;
      config_fragment: Record<string, unknown>;
    }) => apiClient.post<{ component: PolicyComponent }>('/api/components/create', body),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: componentKeys.list(variables.environment_id) });
    },
  });
}

export function useUpdateComponent() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (body: {
      id: string;
      name?: string;
      description?: string;
      category?: string;
      config_fragment?: Record<string, unknown>;
    }) => apiClient.put<{ message: string }>('/api/components/update', body),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: componentKeys.detail(variables.id) });
      queryClient.invalidateQueries({ queryKey: ['components', 'list'] });
    },
  });
}

export function useDeleteComponent() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) =>
      apiClient.delete<{ message: string }>(`/api/components/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['components'] });
    },
  });
}

export function useAssignComponent() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (body: {
      policy_id: string;
      component_id: string;
      priority?: number;
    }) => apiClient.post<{ message: string }>('/api/components/assign', body),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: componentKeys.policyAssignments(variables.policy_id) });
      queryClient.invalidateQueries({ queryKey: ['policy', variables.policy_id] });
    },
  });
}

export function useUnassignComponent() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (body: {
      policy_id: string;
      component_id: string;
    }) => apiClient.post<{ message: string }>('/api/components/unassign', body),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: componentKeys.policyAssignments(variables.policy_id) });
      queryClient.invalidateQueries({ queryKey: ['policy', variables.policy_id] });
    },
  });
}
