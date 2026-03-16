import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/api/client';

export interface DeploymentJob {
  id: string;
  environment_id: string;
  policy_id: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled' | 'rolling_back' | 'rolled_back' | 'rollback_failed';
  total_devices: number;
  completed_devices: number;
  failed_devices: number;
  skipped_devices: number;
  created_by: string | null;
  started_at: string | null;
  completed_at: string | null;
  cancelled_at: string | null;
  error_log: Array<{ device_id: string; error: string; timestamp: string }>;
  created_at: string;
  updated_at: string;
}

// ── Queries ─────────────────────────────────────────────────────────────

export function useDeploymentJob(jobId: string | null) {
  return useQuery({
    queryKey: ['deployment-job', jobId],
    queryFn: () =>
      apiClient.get<{ job: DeploymentJob }>(`/api/deployments?id=${jobId}`),
    enabled: !!jobId,
    refetchInterval: (query) => {
      const job = query.state.data?.job;
      if (!job) return false;
      // Poll every 2s while running, stop when done
      return job.status === 'pending' || job.status === 'running' || job.status === 'rolling_back'
        ? 2000
        : false;
    },
  });
}

export function useDeploymentJobs(environmentId: string) {
  return useQuery({
    queryKey: ['deployment-jobs', environmentId],
    queryFn: () =>
      apiClient.get<{ jobs: DeploymentJob[] }>(`/api/deployments?environment_id=${environmentId}`),
    enabled: !!environmentId,
  });
}

// ── Mutations ───────────────────────────────────────────────────────────

export function useCreateDeployment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (params: { environment_id: string; policy_id: string }) =>
      apiClient.post<{ job: { id: string; status: string; total_devices: number } }>(
        '/api/deployments',
        params
      ),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['deployment-jobs', variables.environment_id] });
    },
  });
}

export function useCancelDeployment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (params: { job_id: string }) =>
      apiClient.post<{ status: string }>('/api/deployments?action=cancel', params),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['deployment-job'] });
      queryClient.invalidateQueries({ queryKey: ['deployment-jobs'] });
    },
  });
}

export function useRollbackDeployment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (params: { job_id: string }) =>
      apiClient.post<{ status: string }>('/api/deployments?action=rollback', params),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['deployment-job'] });
      queryClient.invalidateQueries({ queryKey: ['deployment-jobs'] });
    },
  });
}
