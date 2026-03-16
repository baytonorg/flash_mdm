import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../client';

export type WorkspaceRole = 'viewer' | 'member' | 'admin' | 'owner';
export type PermissionMatrix = Record<string, Record<string, WorkspaceRole>>;

export interface RbacMatrixMeta {
  roles: WorkspaceRole[];
  resource_order: string[];
  action_order: string[];
}

export interface WorkspaceRbacResponse {
  workspace_id: string;
  environment_id?: string;
  defaults: PermissionMatrix;
  matrix: PermissionMatrix;
  has_override: boolean;
  environment_has_override?: boolean;
  view_scope?: 'workspace' | 'environment';
  can_manage?: boolean;
  meta: RbacMatrixMeta;
}

const rbacKeys = {
  all: ['rbac'] as const,
  workspaceMatrix: (workspaceId: string, environmentId?: string) =>
    [...rbacKeys.all, 'workspace-matrix', workspaceId, environmentId ?? 'none'] as const,
};

export function useWorkspaceRbacMatrix(workspaceId?: string, environmentId?: string) {
  return useQuery({
    queryKey: workspaceId ? rbacKeys.workspaceMatrix(workspaceId, environmentId) : [...rbacKeys.all, 'workspace-matrix', 'none'],
    enabled: Boolean(workspaceId),
    queryFn: () =>
      apiClient.get<WorkspaceRbacResponse>(
        `/api/roles/rbac?workspace_id=${encodeURIComponent(workspaceId!)}${environmentId ? `&environment_id=${encodeURIComponent(environmentId)}` : ''}`
      ),
  });
}

export function useUpdateWorkspaceRbacMatrix() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (params: { workspace_id: string; environment_id?: string; matrix: PermissionMatrix }) =>
      apiClient.put<WorkspaceRbacResponse & { message: string }>('/api/roles/rbac', params),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: rbacKeys.workspaceMatrix(variables.workspace_id) });
      if (variables.environment_id) {
        queryClient.invalidateQueries({ queryKey: rbacKeys.workspaceMatrix(variables.workspace_id, variables.environment_id) });
      }
    },
  });
}

export function useClearWorkspaceRbacOverride() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (params: { workspace_id: string; environment_id?: string }) => {
      const qs = new URLSearchParams({ workspace_id: params.workspace_id });
      if (params.environment_id) qs.set('environment_id', params.environment_id);
      return apiClient.delete<WorkspaceRbacResponse & { message: string }>(
        `/api/roles/rbac?${qs.toString()}`
      );
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: rbacKeys.workspaceMatrix(variables.workspace_id) });
      if (variables.environment_id) {
        queryClient.invalidateQueries({ queryKey: rbacKeys.workspaceMatrix(variables.workspace_id, variables.environment_id) });
      }
    },
  });
}
