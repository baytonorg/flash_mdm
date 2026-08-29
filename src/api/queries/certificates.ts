import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/api/client';

export interface TrustedCaCertificate {
  id: string;
  environment_id: string;
  name: string;
  cert_type: 'server_ca';
  onc_guid: string;
  fingerprint_sha256: string;
  not_after: string;
  subject: string;
  issuer_name: string;
  created_at: string;
}

export const certificateKeys = {
  trustedCas: (environmentId: string) => ['certificates', 'trusted-cas', environmentId] as const,
};

export function useTrustedCaCertificates(environmentId?: string) {
  return useQuery({
    queryKey: certificateKeys.trustedCas(environmentId ?? ''),
    queryFn: async () => {
      const response = await apiClient.get<{ certificates: TrustedCaCertificate[] }>(
        `/api/certificates/list?environment_id=${environmentId}`
      );
      return response.certificates;
    },
    enabled: !!environmentId,
  });
}

export function useUploadTrustedCa() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: { environment_id: string; name: string; cert_data: string }) =>
      apiClient.post<{ certificate: TrustedCaCertificate; message: string }>('/api/certificates/upload', body),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: certificateKeys.trustedCas(variables.environment_id) });
    },
  });
}

export function useDeleteTrustedCa() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: { id: string; environment_id: string }) =>
      apiClient.delete<{ message: string }>(`/api/certificates/${body.id}`),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: certificateKeys.trustedCas(variables.environment_id) });
    },
  });
}
