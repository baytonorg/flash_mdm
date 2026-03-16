import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../client';

// --- Interfaces ---

export interface SigninConfig {
  id?: string;
  environment_id: string;
  enabled: boolean;
  allowed_domains: string[];
  default_group_id: string | null;
  allow_personal_usage: string;
  token_tag: string | null;
  amapi_signin_enrollment_token: string | null;
  amapi_qr_code: string | null;
  created_at?: string;
  updated_at?: string;
}

interface SigninConfigResponse {
  config: SigninConfig;
}

interface UpdateSigninConfigParams {
  environment_id: string;
  enabled: boolean;
  allowed_domains: string[];
  default_group_id?: string | null;
  allow_personal_usage?: string;
  token_tag?: string | null;
}

// --- Query Keys ---

export const signinConfigKeys = {
  all: ['signin-config'] as const,
  detail: (environmentId: string) => [...signinConfigKeys.all, environmentId] as const,
};

// --- Hooks ---

export function useSigninConfig(environmentId: string | undefined) {
  return useQuery({
    queryKey: signinConfigKeys.detail(environmentId ?? ''),
    queryFn: () =>
      apiClient.get<SigninConfigResponse>(
        `/api/signin/config?environment_id=${environmentId}`
      ),
    select: (data) => data.config,
    enabled: !!environmentId,
  });
}

export function useUpdateSigninConfig() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (params: UpdateSigninConfigParams) =>
      apiClient.put<SigninConfigResponse>('/api/signin/config', params),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: signinConfigKeys.detail(variables.environment_id),
      });
    },
  });
}

export function useDeleteSigninConfig() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (environmentId: string) =>
      apiClient.delete<{ deleted: boolean }>(
        `/api/signin/config?environment_id=${environmentId}`
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: signinConfigKeys.all });
    },
  });
}
