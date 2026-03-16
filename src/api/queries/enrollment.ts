import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../client';

// --- Interfaces ---

export interface EnrollmentToken {
  id: string;
  environment_id: string;
  name?: string | null;
  value?: string;
  one_time_use?: boolean;
  expiry?: string | null;
  expires_at?: string;
  created_at: string;
  qr_data?: string | null;
  token_value?: string | null;
  policy_id?: string | null;
  policy_name?: string | null;
  group_id?: string | null;
  group_name?: string | null;
  [key: string]: unknown;
}

interface EnrollmentTokensResponse {
  tokens: EnrollmentToken[];
}

interface CreateEnrollmentTokenResponse {
  token: EnrollmentToken;
}

interface DeleteEnrollmentTokenResponse {
  message: string;
}

interface BulkEnrollmentResponse {
  total_targeted: number;
  succeeded: number;
  failed: number;
  results: Array<{ id: string; ok: boolean; error?: string }>;
}

interface CreateEnrollmentTokenParams {
  environment_id: string;
  policy_id?: string;
  name?: string;
  [key: string]: unknown;
}

// --- Query Keys ---

export const enrollmentKeys = {
  all: ['enrollment'] as const,
  list: (environmentId: string) => [...enrollmentKeys.all, 'list', environmentId] as const,
};

// --- Hooks ---

export function useEnrollmentTokens(environmentId: string) {
  return useQuery({
    queryKey: enrollmentKeys.list(environmentId),
    queryFn: () =>
      apiClient.get<EnrollmentTokensResponse>(`/api/enrolment/list?environment_id=${environmentId}`),
    select: (data) => data.tokens,
    enabled: !!environmentId,
  });
}

export function useCreateEnrollmentToken() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (params: CreateEnrollmentTokenParams) =>
      apiClient.post<CreateEnrollmentTokenResponse>('/api/enrolment/create', params),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: enrollmentKeys.all });
    },
  });
}

export function useSyncEnrollmentTokens() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (environment_id: string) =>
      apiClient.post<{ imported: number; invalidated: number; total_amapi: number; total_local: number }>(
        '/api/enrolment/sync',
        { environment_id }
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: enrollmentKeys.all });
    },
  });
}

export function useDeleteEnrollmentToken() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiClient.delete<DeleteEnrollmentTokenResponse>(`/api/enrolment/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: enrollmentKeys.all });
    },
  });
}

export function useBulkEnrollmentAction() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (params: {
      environment_id: string;
      operation: 'delete';
      selection: {
        ids?: string[];
        all_matching?: boolean;
        excluded_ids?: string[];
      };
    }) => apiClient.post<BulkEnrollmentResponse>('/api/enrolment/bulk', params),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: enrollmentKeys.all });
    },
  });
}
