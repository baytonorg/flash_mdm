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
  action?: string;
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

export function buildAuditQuery(params: AuditListParams): string {
  const searchParams = new URLSearchParams();
  searchParams.set('environment_id', params.environment_id);
  if (params.page != null) searchParams.set('page', String(params.page));
  if (params.per_page != null) searchParams.set('per_page', String(params.per_page));
  if (params.action) searchParams.set('action', params.action);
  return searchParams.toString();
}

// Use a fixed upper timestamp so new audit events cannot shift later pages.
// Do not create a download until every authorised page has loaded successfully.
export async function collectEnvironmentAuditExport(environmentId: string, environmentName: string) {
  const cutoff = new Date().toISOString();
  const entries: AuditEntry[] = [];
  let page = 1;
  let total = 0;
  let expectedTotal: number | undefined;
  do {
    const params = new URLSearchParams({ environment_id: environmentId, per_page: '100', page: String(page), date_to: cutoff, export: 'true' });
    const result = await apiClient.get<AuditListResponse>(`/api/audit/log?${params}`);
    expectedTotal ??= result.total;
    if (result.total !== expectedTotal) throw new Error('Audit history changed during export. Please retry before deleting the environment.');
    total = result.total;
    if (result.entries.length === 0 && entries.length < total) throw new Error('Audit export was incomplete. Please retry before deleting the environment.');
    entries.push(...result.entries);
    page += 1;
  } while (entries.length < total);
  return { environment_id: environmentId, environment_name: environmentName, exported_at: cutoff, through: cutoff, total: entries.length, entries };
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
