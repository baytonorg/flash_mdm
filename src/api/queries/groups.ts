import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../client';

// --- Interfaces ---

export interface Group {
  id: string;
  environment_id: string;
  name: string;
  parent_id: string | null;
  parent_group_id?: string | null;
  depth: number;
  policy_id?: string | null;
  created_at: string;
  updated_at: string;
  [key: string]: unknown;
}

interface GroupsResponse {
  groups: Group[];
}

interface CreateGroupResponse {
  group: Group;
}

interface UpdateGroupResponse {
  message: string;
}

interface DeleteGroupResponse {
  message: string;
}

interface BulkGroupResponse {
  total_targeted: number;
  succeeded: number;
  failed: number;
  results: Array<{ id: string; ok: boolean; error?: string }>;
}

interface CreateGroupParams {
  environment_id: string;
  name: string;
  parent_id?: string;
  parent_group_id?: string;
  [key: string]: unknown;
}

interface UpdateGroupParams {
  id: string;
  name?: string;
  parent_id?: string | null;
  parent_group_id?: string | null;
  [key: string]: unknown;
}

// --- Query Keys ---

export const groupKeys = {
  all: ['groups'] as const,
  list: (environmentId: string) => [...groupKeys.all, 'list', environmentId] as const,
  descendants: (groupId: string) => [...groupKeys.all, 'descendants', groupId] as const,
};

// --- Hooks ---

export function useGroups(environmentId: string) {
  return useQuery({
    queryKey: groupKeys.list(environmentId),
    queryFn: () =>
      apiClient.get<GroupsResponse>(`/api/groups/list?environment_id=${environmentId}`),
    select: (data) =>
      data.groups.map((g) => ({
        ...g,
        parent_id: (g.parent_id ?? g.parent_group_id ?? null) as string | null,
        parent_group_id: (g.parent_group_id ?? g.parent_id ?? null) as string | null,
      })),
    enabled: !!environmentId,
  });
}

export function useGroupDescendants(groupId: string) {
  return useQuery({
    queryKey: groupKeys.descendants(groupId),
    queryFn: () =>
      apiClient.get<GroupsResponse>(`/api/groups/descendants?group_id=${groupId}`),
    select: (data) =>
      data.groups.map((g) => ({
        ...g,
        parent_id: (g.parent_id ?? g.parent_group_id ?? null) as string | null,
        parent_group_id: (g.parent_group_id ?? g.parent_id ?? null) as string | null,
      })),
    enabled: !!groupId,
  });
}

export function useCreateGroup() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (params: CreateGroupParams) =>
      apiClient.post<CreateGroupResponse>('/api/groups/create', {
        ...params,
        parent_group_id: params.parent_group_id ?? params.parent_id,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: groupKeys.all });
      queryClient.invalidateQueries({ queryKey: ['devices'] });
      queryClient.invalidateQueries({ queryKey: ['policies'] });
      queryClient.invalidateQueries({ queryKey: ['enrollment'] });
    },
  });
}

export function useUpdateGroup() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (params: UpdateGroupParams) =>
      apiClient.put<UpdateGroupResponse>('/api/groups/update', {
        ...params,
        parent_group_id: params.parent_group_id ?? params.parent_id,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: groupKeys.all });
      queryClient.invalidateQueries({ queryKey: ['devices'] });
      queryClient.invalidateQueries({ queryKey: ['policies'] });
      queryClient.invalidateQueries({ queryKey: ['enrollment'] });
    },
  });
}

export function useDeleteGroup() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiClient.delete<DeleteGroupResponse>(`/api/groups/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: groupKeys.all });
      queryClient.invalidateQueries({ queryKey: ['devices'] });
      queryClient.invalidateQueries({ queryKey: ['policies'] });
      queryClient.invalidateQueries({ queryKey: ['enrollment'] });
    },
  });
}

export function useBulkGroupAction() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (params: {
      environment_id: string;
      operation: 'delete' | 'move';
      selection: {
        ids?: string[];
        all_matching?: boolean;
        excluded_ids?: string[];
      };
      options?: {
        target_parent_id?: string | null;
        clear_direct_assignments?: boolean;
      };
    }) => apiClient.post<BulkGroupResponse>('/api/groups/bulk', params),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: groupKeys.all });
      queryClient.invalidateQueries({ queryKey: ['devices'] });
      queryClient.invalidateQueries({ queryKey: ['policies'] });
      queryClient.invalidateQueries({ queryKey: ['enrollment'] });
    },
  });
}
