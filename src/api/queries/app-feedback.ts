import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/api/client';

export interface AppFeedbackItem {
  id: string;
  environment_id: string;
  device_id: string | null;
  device_name?: string | null;
  device_amapi_name?: string | null;
  package_name: string;
  feedback_key: string;
  severity: string | null;
  message: string | null;
  data_json: Record<string, unknown> | null;
  first_reported_at: string;
  last_reported_at: string;
  last_update_time: string | null;
  status: string;
}

export const appFeedbackKeys = {
  all: ['app-feedback'] as const,
  list: (environmentId: string, filterKey: string) => [...appFeedbackKeys.all, 'list', environmentId, filterKey] as const,
};

function buildFilterQuery(filters: {
  environment_id: string;
  package_name?: string;
  device_id?: string;
  severity?: string;
  status?: string;
  limit?: number;
}) {
  const params = new URLSearchParams({ environment_id: filters.environment_id });
  if (filters.package_name) params.set('package_name', filters.package_name);
  if (filters.device_id) params.set('device_id', filters.device_id);
  if (filters.severity) params.set('severity', filters.severity);
  if (filters.status) params.set('status', filters.status);
  if (typeof filters.limit === 'number') params.set('limit', String(filters.limit));
  return params.toString();
}

export function useAppFeedbackList(filters: {
  environment_id?: string;
  package_name?: string;
  device_id?: string;
  severity?: string;
  status?: string;
  limit?: number;
}) {
  const environmentId = filters.environment_id ?? '';
  const filterKey = JSON.stringify(filters);
  return useQuery({
    queryKey: appFeedbackKeys.list(environmentId, filterKey),
    queryFn: () =>
      apiClient.get<{ items: AppFeedbackItem[] }>(
        `/api/app-feedback?${buildFilterQuery({
          environment_id: environmentId,
          package_name: filters.package_name,
          device_id: filters.device_id,
          severity: filters.severity,
          status: filters.status,
          limit: filters.limit,
        })}`
      ),
    enabled: Boolean(filters.environment_id),
  });
}
