import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { apiClient, ApiError } from '../client';

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

export function isAuditAccessDenied(error: unknown): error is ApiError {
  return error instanceof ApiError && (error.status === 401 || error.status === 403);
}

// Per-client ordering keeps a late response from an older request from
// overriding a more recently started request that has already succeeded.
const auditRequestOrder = new WeakMap<QueryClient, {
  next: number;
  success: Map<string, number>;
  denied: Map<string, { order: number; error: ApiError }>;
}>();

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
  const client = useQueryClient();
  return useQuery({
    queryKey: auditKeys.list(params),
    queryFn: async () => {
      let order = auditRequestOrder.get(client);
      if (!order) {
        order = { next: 0, success: new Map(), denied: new Map() };
        auditRequestOrder.set(client, order);
      }
      const requestOrder = ++order.next;
      try {
        const result = await apiClient.get<AuditListResponse>(`/api/audit/log?${buildAuditQuery(params)}`);
        const denied = order.denied.get(params.environment_id);
        if (denied && requestOrder < denied.order) throw denied.error;
        // Keep the denial watermark after recovery: a newer successful filter
        // cannot authorise an older outstanding response in another filter.
        order.success.set(params.environment_id, Math.max(requestOrder, order.success.get(params.environment_id) ?? 0));
        return result;
      } catch (error) {
        // The current observer receives the failure. Other filter/page variants
        // must obtain a new result before redisplaying this environment's rows.
        client.removeQueries({
          queryKey: auditKeys.all,
          type: 'inactive',
          predicate: query => query.queryKey[1] === 'list'
            && (query.queryKey[2] as AuditListParams | undefined)?.environment_id === params.environment_id,
        });
        if (isAuditAccessDenied(error) && requestOrder >= (order.success.get(params.environment_id) ?? 0)) {
          if (requestOrder > (order.denied.get(params.environment_id)?.order ?? 0)) {
            order.denied.set(params.environment_id, { order: requestOrder, error });
          }
          for (const query of client.getQueryCache().findAll({ queryKey: auditKeys.all, type: 'active' })) {
            const sibling = query.queryKey[2] as AuditListParams | undefined;
            if (query.queryKey[1] !== 'list' || sibling?.environment_id !== params.environment_id
              || query.queryHash === client.getQueryCache().find({ queryKey: auditKeys.list(params), exact: true })?.queryHash) continue;
            // A genuine denial is environment-wide, including a sibling that
            // became active while this request was outstanding. Preserve any
            // in-flight refresh so its later authoritative result can settle.
            query.setState({ data: undefined, dataUpdatedAt: 0, error, errorUpdatedAt: Date.now(), status: 'error' });
          }
        }
        throw error;
      }
    },
    retry: (failureCount, error) => !isAuditAccessDenied(error) && failureCount < 1,
    enabled: !!params.environment_id,
    refetchInterval: 30000,
    refetchIntervalInBackground: true,
  });
}
