import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../client';

// --- Interfaces ---

export interface AuditEntry {
  id: string;
  environment_id: string;
  action: string;
  actor: string;
  target?: string;
  details?: Record<string, unknown>;
  created_at: string;
  [key: string]: unknown;
}

export interface AuditListParams {
  environment_id: string;
  page?: number;
  per_page?: number;
}

interface AuditListResponse {
  entries: AuditEntry[];
  total: number;
}

// --- Query Keys ---

export const auditKeys = {
  all: ['audit'] as const,
  list: (params: AuditListParams) => [...auditKeys.all, 'list', params] as const,
};

// --- Helpers ---

function buildAuditQuery(params: AuditListParams): string {
  const searchParams = new URLSearchParams();
  searchParams.set('environment_id', params.environment_id);
  if (params.page != null) searchParams.set('page', String(params.page));
  if (params.per_page != null) searchParams.set('per_page', String(params.per_page));
  return searchParams.toString();
}

// --- Hooks ---

export function useAuditLog(params: AuditListParams) {
  return useQuery({
    queryKey: auditKeys.list(params),
    queryFn: () =>
      apiClient.get<AuditListResponse>(`/api/audit/log?${buildAuditQuery(params)}`),
    enabled: !!params.environment_id,
    refetchInterval: 30000,
    refetchIntervalInBackground: true,
  });
}
