import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../client';

// --- Interfaces ---

export interface WorkspaceUser {
  id: string;
  email: string;
  role: string;
  access_scope?: 'workspace' | 'scoped';
  environment_assignments?: Array<{
    environment_id: string;
    environment_name: string;
    role: string;
  }>;
  group_assignments?: Array<{
    group_id: string;
    group_name: string;
    role: string;
    environment_id: string;
    environment_name: string;
    parent_group_id?: string | null;
  }>;
  invited_at?: string;
  joined_at?: string;
  [key: string]: unknown;
}

interface UsersResponse {
  users: WorkspaceUser[];
}

interface InviteUserResponse {
  message: string;
}

interface UpdateUserAccessResponse {
  message: string;
}

interface UpdateUserRoleResponse {
  message: string;
}
interface RemoveWorkspaceUserResponse {
  message: string;
}

interface BulkWorkspaceUsersResponse {
  total_targeted: number;
  succeeded: number;
  failed: number;
  results: Array<{ id: string; ok: boolean; error?: string }>;
}

interface InviteUserParams {
  workspace_id: string;
  email: string;
  role?: string;
  environment_ids?: string[];
  group_ids?: string[];
  [key: string]: unknown;
}

interface UpdateUserAccessParams {
  workspace_id: string;
  user_id: string;
  access_scope: 'workspace' | 'scoped';
  scoped_role?: string;
  environment_ids?: string[];
  group_ids?: string[];
  acting_environment_id?: string;
}

interface UpdateUserRoleParams {
  workspace_id: string;
  user_id: string;
  role: string;
}
interface RemoveWorkspaceUserParams {
  workspace_id: string;
  user_id: string;
}

// --- Query Keys ---

export const userKeys = {
  all: ['users'] as const,
  list: (workspaceId: string) => [...userKeys.all, 'list', workspaceId] as const,
};

// --- Hooks ---

export function useWorkspaceUsers(workspaceId: string) {
  return useQuery({
    queryKey: userKeys.list(workspaceId),
    queryFn: () =>
      apiClient.get<UsersResponse>(`/api/workspaces/users?workspace_id=${workspaceId}`),
    select: (data) => data.users,
    enabled: !!workspaceId,
  });
}

export function useInviteUser() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (params: InviteUserParams) =>
      apiClient.post<InviteUserResponse>('/api/workspaces/invite', params),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: userKeys.list(variables.workspace_id) });
    },
  });
}

export function useUpdateWorkspaceUserAccess() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (params: UpdateUserAccessParams) =>
      apiClient.put<UpdateUserAccessResponse>('/api/workspaces/users/access', params),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: userKeys.list(variables.workspace_id) });
    },
  });
}

export function useUpdateWorkspaceUserRole() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (params: UpdateUserRoleParams) =>
      apiClient.put<UpdateUserRoleResponse>('/api/workspaces/users/role', params),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: userKeys.list(variables.workspace_id) });
    },
  });
}

export function useRemoveWorkspaceUser() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ workspace_id, user_id }: RemoveWorkspaceUserParams) =>
      apiClient.delete<RemoveWorkspaceUserResponse>(
        `/api/workspaces/users/${encodeURIComponent(user_id)}?workspace_id=${encodeURIComponent(workspace_id)}`
      ),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: userKeys.list(variables.workspace_id) });
    },
  });
}

export function useBulkWorkspaceUsersAction() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (params: {
      workspace_id: string;
      operation: 'remove' | 'access_overwrite';
      selection: {
        ids?: string[];
        all_matching?: boolean;
        excluded_ids?: string[];
      };
      options?: {
        role?: string;
        access_scope?: 'workspace' | 'scoped';
        environment_ids?: string[];
        group_ids?: string[];
      };
    }) => apiClient.post<BulkWorkspaceUsersResponse>('/api/workspaces/users/bulk', params),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: userKeys.list(variables.workspace_id) });
    },
  });
}
