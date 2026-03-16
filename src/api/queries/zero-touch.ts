import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/api/client';
import { enrollmentKeys } from '@/api/queries/enrollment';

export interface ZeroTouchGroupOption {
  id: string;
  name: string;
}

export interface ZeroTouchTokenOption {
  id: string;
  name: string;
  group_id: string | null;
  group_name: string | null;
  one_time_use: boolean;
  allow_personal_usage: string | null;
  expires_at: string | null;
  amapi_value: string | null;
}

export interface ZeroTouchOptionsResponse {
  environment: {
    id: string;
    name: string;
    enterprise_name: string | null;
  };
  groups: ZeroTouchGroupOption[];
  active_tokens: ZeroTouchTokenOption[];
}

export const zeroTouchKeys = {
  all: ['zero-touch'] as const,
  options: (environmentId: string) => [...zeroTouchKeys.all, 'options', environmentId] as const,
};

export function useZeroTouchOptions(environmentId?: string) {
  return useQuery({
    queryKey: zeroTouchKeys.options(environmentId ?? ''),
    queryFn: () =>
      apiClient.get<ZeroTouchOptionsResponse>(`/api/environments/zero-touch?environment_id=${environmentId}`),
    enabled: Boolean(environmentId),
  });
}

export function useZeroTouchIframeToken() {
  return useMutation({
    mutationFn: (environment_id: string) =>
      apiClient.post<{ iframe_token: string; iframe_url: string }>('/api/environments/zero-touch', {
        environment_id,
        action: 'create_iframe_token',
      }),
  });
}

export function useZeroTouchCreateEnrollmentToken() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: {
      environment_id: string;
      token_name?: string;
      group_id?: string;
      allow_personal_usage?: string;
    }) =>
      apiClient.post<{
        enrollment_token: {
          token_id: string;
          token: string | null;
          qr_data: string | null;
          amapi_name: string | null;
          group_id: string | null;
          expires_at: string | null;
        };
      }>('/api/environments/zero-touch', {
        ...body,
        action: 'create_enrollment_token_for_zt',
      }),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: zeroTouchKeys.options(variables.environment_id) });
      queryClient.invalidateQueries({ queryKey: enrollmentKeys.list(variables.environment_id) });
    },
  });
}
