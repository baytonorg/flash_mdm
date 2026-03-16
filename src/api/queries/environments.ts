import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../client';

// --- Interfaces ---

export interface Environment {
  id: string;
  workspace_id: string;
  name: string;
  user_role?: 'owner' | 'admin' | 'member' | 'viewer' | null;
  enterprise_id?: string;
  enterprise_name?: string;
  pubsub_topic?: string | null;
  default_policy_id?: string | null;
  enterprise_features?: Record<string, unknown> | null;
  bound: boolean;
  created_at: string;
  updated_at: string;
  [key: string]: unknown;
}

interface EnvironmentsResponse {
  environments: Environment[];
}

interface CreateEnvironmentResponse {
  environment: Environment;
}

interface UpdateEnvironmentResponse {
  message: string;
}

interface DeleteEnvironmentResponse {
  message: string;
}

interface BindStep1Response {
  signup_url: string;
}

interface BindStep2Response {
  enterprise_name: string;
}

interface CreateEnvironmentParams {
  workspace_id: string;
  name: string;
  [key: string]: unknown;
}

interface UpdateEnvironmentParams {
  id: string;
  name?: string;
  pubsub_topic?: string | null;
  [key: string]: unknown;
}

interface BindStep1Params {
  environment_id: string;
}

interface BindStep2Params {
  environment_id: string;
  enterprise_token: string;
}

interface EnterpriseUpgradeStatusResponse {
  enterprise_type: string;
  eligible_for_upgrade: boolean;
  managed_google_play_accounts_enterprise_type?: string | null;
  managed_google_domain_type?: string | null;
}

// --- Query Keys ---

export const environmentKeys = {
  all: ['environments'] as const,
  list: (workspaceId: string) => [...environmentKeys.all, 'list', workspaceId] as const,
  enterpriseUpgradeStatus: (environmentId: string) =>
    [...environmentKeys.all, 'enterprise-upgrade-status', environmentId] as const,
};

// --- Hooks ---

export function useEnvironments(workspaceId: string) {
  return useQuery({
    queryKey: environmentKeys.list(workspaceId),
    queryFn: () =>
      apiClient.get<EnvironmentsResponse>(`/api/environments/list?workspace_id=${workspaceId}`),
    select: (data) => data.environments,
    enabled: !!workspaceId,
  });
}

export function useCreateEnvironment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (params: CreateEnvironmentParams) =>
      apiClient.post<CreateEnvironmentResponse>('/api/environments/create', params),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: environmentKeys.all });
    },
  });
}

export function useUpdateEnvironment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (params: UpdateEnvironmentParams) =>
      apiClient.put<UpdateEnvironmentResponse>('/api/environments/update', params),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: environmentKeys.all });
    },
  });
}

export function useDeleteEnvironment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiClient.delete<DeleteEnvironmentResponse>(`/api/environments/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: environmentKeys.all });
    },
  });
}

export function useDeleteEnterprise() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (environment_id: string) =>
      apiClient.post<{ deleted: boolean; previous_enterprise: string }>(
        '/api/environments/bind',
        { environment_id, action: 'delete_enterprise' }
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: environmentKeys.all });
    },
  });
}

export function useGenerateUpgradeUrl() {
  return useMutation({
    mutationFn: (environment_id: string) =>
      apiClient.post<{ upgrade_url: string }>(
        '/api/environments/enterprise',
        { environment_id, action: 'generate_upgrade_url' }
      ),
  });
}

export function useReconcileEnvironmentDeviceImport() {
  return useMutation({
    mutationFn: (environment_id: string) =>
      apiClient.post<{ message: string; devices_found: number; jobs_enqueued: number; pages_scanned: number }>(
        '/api/environments/enterprise',
        { environment_id, action: 'reconcile_device_import' }
      ),
  });
}

export function useEnterpriseUpgradeStatus(environmentId?: string, enabled = true) {
  return useQuery({
    queryKey: environmentId ? environmentKeys.enterpriseUpgradeStatus(environmentId) : [...environmentKeys.all, 'enterprise-upgrade-status', 'none'],
    queryFn: () =>
      apiClient.post<EnterpriseUpgradeStatusResponse>(
        '/api/environments/enterprise',
        { environment_id: environmentId, action: 'get_upgrade_status' }
      ),
    enabled: Boolean(environmentId) && enabled,
    staleTime: 60_000,
  });
}

export function useBindEnvironmentStep1() {
  return useMutation({
    mutationFn: (params: BindStep1Params) =>
      apiClient.post<BindStep1Response>('/api/environments/bind', params),
  });
}

export function useBindEnvironmentStep2() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (params: BindStep2Params) =>
      apiClient.post<BindStep2Response>('/api/environments/bind', params),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: environmentKeys.all });
    },
  });
}
