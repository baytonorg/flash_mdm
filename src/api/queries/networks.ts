import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/api/client';

export interface NetworkDeployment {
  id: string;
  environment_id: string;
  network_type?: 'wifi' | 'apn';
  name: string;
  ssid: string;
  hidden_ssid: boolean;
  auto_connect: boolean;
  scope_type: 'environment' | 'group' | 'device';
  scope_id: string;
  onc_profile: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface NetworkAmapiSync {
  attempted: number;
  synced: number;
  failed: number;
  skipped_reason?: string | null;
  failures: Array<{ policy_id: string; error: string; amapi_status: number | null }>;
}

interface BulkNetworkResponse {
  total_targeted: number;
  succeeded: number;
  failed: number;
  results: Array<{ id: string; ok: boolean; error?: string }>;
}

export const networkKeys = {
  deployments: (environmentId: string) => ['networks', 'deployments', environmentId] as const,
};

export function useNetworkDeployments(environmentId: string | undefined) {
  return useQuery({
    queryKey: networkKeys.deployments(environmentId ?? ''),
    queryFn: () => apiClient.get<{ deployments: NetworkDeployment[] }>(`/api/networks/list?environment_id=${environmentId}`),
    enabled: !!environmentId,
    select: (data) => data.deployments,
  });
}

export function useDeployNetwork() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (body: {
      environment_id: string;
      network_type?: 'wifi' | 'apn';
      name?: string;
      ssid?: string;
      hidden_ssid?: boolean;
      auto_connect?: boolean;
      onc_document?: Record<string, unknown>;
      apn_policy?: Record<string, unknown>;
      scope_type: 'environment' | 'group' | 'device';
      scope_id: string;
    }) => apiClient.post<{ deployment: NetworkDeployment; amapi_sync: NetworkAmapiSync; message?: string }>(
      '/api/networks/deploy',
      body
    ),
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({ queryKey: networkKeys.deployments(vars.environment_id) });
      queryClient.invalidateQueries({ queryKey: ['policies'] });
      queryClient.invalidateQueries({ queryKey: ['devices'] });
    },
  });
}

export function useUpdateNetworkDeployment() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (body: {
      id: string;
      environment_id: string;
      name?: string;
      onc_document?: Record<string, unknown>;
      apn_policy?: Record<string, unknown>;
      hidden_ssid?: boolean;
      auto_connect?: boolean;
    }) => apiClient.put<{ deployment: NetworkDeployment; amapi_sync: NetworkAmapiSync; message?: string }>(
      `/api/networks/${body.id}`,
      body
    ),
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({ queryKey: networkKeys.deployments(vars.environment_id) });
      queryClient.invalidateQueries({ queryKey: ['policies'] });
      queryClient.invalidateQueries({ queryKey: ['devices'] });
    },
  });
}

export function useDeleteNetworkDeployment() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (body: {
      id: string;
      environment_id: string;
    }) => apiClient.delete<{ message: string; amapi_sync: NetworkAmapiSync }>(
      `/api/networks/${body.id}`
    ),
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({ queryKey: networkKeys.deployments(vars.environment_id) });
      queryClient.invalidateQueries({ queryKey: ['policies'] });
      queryClient.invalidateQueries({ queryKey: ['devices'] });
    },
  });
}

export function useBulkNetworkAction() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: {
      environment_id: string;
      operation: 'delete';
      selection: {
        ids?: string[];
        all_matching?: boolean;
        excluded_ids?: string[];
      };
    }) => apiClient.post<BulkNetworkResponse>('/api/networks/bulk', body),
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({ queryKey: networkKeys.deployments(vars.environment_id) });
      queryClient.invalidateQueries({ queryKey: ['policies'] });
      queryClient.invalidateQueries({ queryKey: ['devices'] });
    },
  });
}
