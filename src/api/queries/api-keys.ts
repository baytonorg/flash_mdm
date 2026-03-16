import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../client';

export interface ApiKeyRecord {
  id: string;
  name: string;
  scope_type: 'workspace' | 'environment';
  workspace_id: string;
  environment_id: string | null;
  role: 'owner' | 'admin' | 'member' | 'viewer';
  token: string | null;
  token_prefix: string;
  created_by_user_id: string;
  created_by_email: string | null;
  created_by_name?: string | null;
  created_at: string;
  expires_at: string | null;
  last_used_at: string | null;
  last_used_ip: string | null;
  revoked_at: string | null;
}

const apiKeyKeys = {
  all: ['api-keys'] as const,
  workspace: (workspaceId: string) => [...apiKeyKeys.all, 'workspace', workspaceId] as const,
  environment: (environmentId: string) => [...apiKeyKeys.all, 'environment', environmentId] as const,
};

export function useWorkspaceApiKeys(workspaceId?: string) {
  return useQuery({
    queryKey: workspaceId ? apiKeyKeys.workspace(workspaceId) : [...apiKeyKeys.all, 'workspace', 'none'],
    enabled: Boolean(workspaceId),
    queryFn: () => apiClient.get<{ api_keys: ApiKeyRecord[] }>(`/api/api-keys/list?workspace_id=${encodeURIComponent(workspaceId!)}`),
    select: (data) => data.api_keys,
  });
}

export function useEnvironmentApiKeys(environmentId?: string) {
  return useQuery({
    queryKey: environmentId ? apiKeyKeys.environment(environmentId) : [...apiKeyKeys.all, 'environment', 'none'],
    enabled: Boolean(environmentId),
    queryFn: () => apiClient.get<{ api_keys: ApiKeyRecord[] }>(`/api/api-keys/list?environment_id=${encodeURIComponent(environmentId!)}`),
    select: (data) => data.api_keys,
  });
}

export function useCreateApiKey() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (params: {
      scope_type: 'workspace' | 'environment';
      workspace_id?: string;
      environment_id?: string;
      role?: 'owner' | 'admin' | 'member' | 'viewer';
      name: string;
      expires_in_days?: number;
    }) => apiClient.post<{ api_key: ApiKeyRecord }>('/api/api-keys/create', params),
    onSuccess: (data) => {
      if (data.api_key.scope_type === 'workspace') {
        queryClient.invalidateQueries({ queryKey: apiKeyKeys.workspace(data.api_key.workspace_id) });
      }
      if (data.api_key.scope_type === 'environment' && data.api_key.environment_id) {
        queryClient.invalidateQueries({ queryKey: apiKeyKeys.environment(data.api_key.environment_id) });
      }
    },
  });
}

export function useRevokeApiKey() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (params: { id: string; workspace_id?: string; environment_id?: string }) =>
      apiClient.post<{ message: string }>('/api/api-keys/revoke', { id: params.id }),
    onSuccess: (_data, variables) => {
      if (variables.workspace_id) {
        queryClient.invalidateQueries({ queryKey: apiKeyKeys.workspace(variables.workspace_id) });
      }
      if (variables.environment_id) {
        queryClient.invalidateQueries({ queryKey: apiKeyKeys.environment(variables.environment_id) });
      }
    },
  });
}
