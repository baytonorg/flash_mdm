import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../client';

// ─── Interfaces ─────────────────────────────────────────────────────────────

export interface ConditionRow {
  field: string;
  operator: string;
  value: unknown;
}

export interface Workflow {
  id: string;
  environment_id: string;
  name: string;
  enabled: boolean;
  trigger_type: string;
  trigger_config: Record<string, unknown>;
  conditions: ConditionRow[];
  action_type: string;
  action_config: Record<string, unknown>;
  scope_type: string;
  scope_id: string | null;
  last_triggered_at: string | null;
  created_at: string;
  updated_at: string;
  execution_count?: string;
  last_execution_status?: string | null;
}

export interface WorkflowExecution {
  id: string;
  workflow_id: string;
  device_id: string | null;
  trigger_data: Record<string, unknown> | null;
  status: string;
  result: Record<string, unknown> | null;
  created_at: string;
  manufacturer?: string | null;
  model?: string | null;
  serial_number?: string | null;
}

interface WorkflowsResponse {
  workflows: Workflow[];
}

interface WorkflowDetailResponse {
  workflow: Workflow;
  recent_executions: WorkflowExecution[];
}

interface CreateWorkflowResponse {
  workflow: Workflow;
}

interface UpdateWorkflowResponse {
  message: string;
}

interface DeleteWorkflowResponse {
  message: string;
}

interface ToggleWorkflowResponse {
  message: string;
  enabled: boolean;
}

interface BulkWorkflowResponse {
  total_targeted: number;
  succeeded: number;
  failed: number;
  results: Array<{ id: string; ok: boolean; error?: string }>;
}

interface TestWorkflowResponse {
  execution: WorkflowExecution;
}

export interface CreateWorkflowParams {
  environment_id: string;
  name: string;
  enabled?: boolean;
  trigger_type: string;
  trigger_config?: Record<string, unknown>;
  conditions?: ConditionRow[];
  action_type: string;
  action_config?: Record<string, unknown>;
  scope_type?: string;
  scope_id?: string;
}

export interface UpdateWorkflowParams extends CreateWorkflowParams {
  id: string;
}

// ─── Query Keys ─────────────────────────────────────────────────────────────

export const workflowKeys = {
  all: ['workflows'] as const,
  list: (environmentId: string) => [...workflowKeys.all, 'list', environmentId] as const,
  detail: (id: string) => [...workflowKeys.all, 'detail', id] as const,
};

// ─── Hooks ──────────────────────────────────────────────────────────────────

export function useWorkflows(environmentId: string) {
  return useQuery({
    queryKey: workflowKeys.list(environmentId),
    queryFn: () =>
      apiClient.get<WorkflowsResponse>(`/api/workflows/list?environment_id=${environmentId}`),
    select: (data) => data.workflows,
    enabled: !!environmentId,
  });
}

export function useWorkflow(id: string) {
  return useQuery({
    queryKey: workflowKeys.detail(id),
    queryFn: () => apiClient.get<WorkflowDetailResponse>(`/api/workflows/${id}`),
    enabled: !!id,
  });
}

export function useCreateWorkflow() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (params: CreateWorkflowParams) =>
      apiClient.post<CreateWorkflowResponse>('/api/workflows/create', params),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: workflowKeys.all });
    },
  });
}

export function useUpdateWorkflow() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (params: UpdateWorkflowParams) =>
      apiClient.put<UpdateWorkflowResponse>('/api/workflows/update', params),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: workflowKeys.detail(variables.id) });
      queryClient.invalidateQueries({ queryKey: [...workflowKeys.all, 'list'] });
    },
  });
}

export function useDeleteWorkflow() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiClient.delete<DeleteWorkflowResponse>(`/api/workflows/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: workflowKeys.all });
    },
  });
}

export function useToggleWorkflow() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiClient.post<ToggleWorkflowResponse>(`/api/workflows/${id}/toggle`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: workflowKeys.all });
    },
  });
}

export function useBulkWorkflowAction() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (params: {
      environment_id: string;
      operation: 'enable' | 'disable' | 'delete';
      selection: {
        ids?: string[];
        all_matching?: boolean;
        excluded_ids?: string[];
      };
    }) => apiClient.post<BulkWorkflowResponse>('/api/workflows/bulk', params),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: workflowKeys.list(variables.environment_id) });
      queryClient.invalidateQueries({ queryKey: workflowKeys.all });
    },
  });
}

export function useTestWorkflow() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, device_id }: { id: string; device_id?: string }) =>
      apiClient.post<TestWorkflowResponse>(`/api/workflows/${id}/test`, { device_id }),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: workflowKeys.detail(variables.id) });
    },
  });
}
