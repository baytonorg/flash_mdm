import { create } from 'zustand';
import { apiClient } from '@/api/client';

const STORAGE_KEY = 'flash_context';

interface Workspace {
  id: string;
  name: string;
  gcp_project_id: string | null;
  has_google_credentials?: boolean;
  default_pubsub_topic?: string | null;
  user_role?: string;
  access_scope?: string;
}

interface Environment {
  id: string;
  workspace_id: string;
  name: string;
  user_role?: 'owner' | 'admin' | 'member' | 'viewer' | null;
  enterprise_name: string | null;
  enterprise_display_name: string | null;
  pubsub_topic?: string | null;
}

interface Group {
  id: string;
  environment_id: string;
  parent_group_id: string | null;
  name: string;
  description: string | null;
  depth?: number;
}

interface SavedContext {
  workspaceId?: string;
  environmentId?: string;
  groupId?: string;
}

function loadSaved(): SavedContext {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveContext(ws?: string, env?: string, grp?: string) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      workspaceId: ws,
      environmentId: env,
      groupId: grp,
    }));
  } catch {
    // ignore storage errors
  }
}

interface ContextState {
  workspaces: Workspace[];
  activeWorkspace: Workspace | null;
  environments: Environment[];
  activeEnvironment: Environment | null;
  groups: Group[];
  activeGroup: Group | null;
  isLoading: boolean;

  fetchWorkspaces: () => Promise<void>;
  switchWorkspace: (workspaceId: string) => Promise<void>;
  fetchEnvironments: (workspaceId: string) => Promise<void>;
  switchEnvironment: (environmentId: string) => Promise<void>;
  fetchGroups: (environmentId: string) => Promise<void>;
  switchGroup: (groupId: string) => Promise<void>;
  reset: () => void;
}

const initialContextState = {
  workspaces: [],
  activeWorkspace: null,
  environments: [],
  activeEnvironment: null,
  groups: [],
  activeGroup: null,
  isLoading: false,
} satisfies Pick<
  ContextState,
  'workspaces' | 'activeWorkspace' | 'environments' | 'activeEnvironment' | 'groups' | 'activeGroup' | 'isLoading'
>;

export const useContextStore = create<ContextState>((set, get) => ({
  ...initialContextState,

  fetchWorkspaces: async () => {
    set({ isLoading: true });
    try {
      const data = await apiClient.get<{ workspaces: Workspace[] }>('/api/workspaces/list');
      const workspaces = data.workspaces;
      const currentActiveWorkspaceId = get().activeWorkspace?.id;
      const refreshedActiveWorkspace = currentActiveWorkspaceId
        ? workspaces.find((w) => w.id === currentActiveWorkspaceId) ?? null
        : null;
      set({ workspaces, activeWorkspace: refreshedActiveWorkspace ?? get().activeWorkspace, isLoading: false });

      // Auto-select: restore saved workspace or pick the first one
      if (workspaces.length > 0 && !get().activeWorkspace) {
        const saved = loadSaved();
        const targetId = saved.workspaceId && workspaces.find((w) => w.id === saved.workspaceId)
          ? saved.workspaceId
          : workspaces[0].id;
        await get().switchWorkspace(targetId);

        // Restore saved environment after workspace loads
        const savedEnvId = saved.environmentId;
        const envs = get().environments;
        if (savedEnvId && envs.find((e) => e.id === savedEnvId)) {
          await get().switchEnvironment(savedEnvId);

          // Restore saved group after environment loads
          const savedGroupId = saved.groupId;
          const grps = get().groups;
          if (savedGroupId && grps.find((g) => g.id === savedGroupId)) {
            get().switchGroup(savedGroupId);
          }
        } else if (envs.length > 0) {
          // Auto-select first environment if no saved one
          await get().switchEnvironment(envs[0].id);
        }
      }
    } catch {
      set({ isLoading: false });
    }
  },

  switchWorkspace: async (workspaceId: string) => {
    const ws = get().workspaces.find((w) => w.id === workspaceId);
    if (!ws) return;
    set({ activeWorkspace: ws, environments: [], activeEnvironment: null, groups: [], activeGroup: null });
    saveContext(workspaceId);
    await get().fetchEnvironments(workspaceId);
    const envs = get().environments;
    if (envs.length === 1) {
      await get().switchEnvironment(envs[0].id);
    }
  },

  fetchEnvironments: async (workspaceId: string) => {
    try {
      const data = await apiClient.get<{ environments: Environment[] }>(`/api/environments/list?workspace_id=${workspaceId}`);
      const environments = data.environments;
      const currentActiveEnvironmentId = get().activeEnvironment?.id;
      const refreshedActiveEnvironment = currentActiveEnvironmentId
        ? environments.find((e) => e.id === currentActiveEnvironmentId) ?? null
        : null;
      set({
        environments,
        activeEnvironment: currentActiveEnvironmentId
          ? refreshedActiveEnvironment
          : get().activeEnvironment,
      });
    } catch {
      // ignore
    }
  },

  switchEnvironment: async (environmentId: string) => {
    const env = get().environments.find((e) => e.id === environmentId);
    if (!env) return;
    set({ activeEnvironment: env, groups: [], activeGroup: null });
    saveContext(get().activeWorkspace?.id, environmentId);
    await get().fetchGroups(environmentId);
    const grps = get().groups;
    if (grps.length === 1) {
      await get().switchGroup(grps[0].id);
    }
  },

  fetchGroups: async (environmentId: string) => {
    try {
      const data = await apiClient.get<{ groups: Group[] }>(`/api/groups/list?environment_id=${environmentId}`);
      set({ groups: data.groups });
    } catch {
      // ignore
    }
  },

  switchGroup: async (groupId: string) => {
    if (!groupId) {
      set({ activeGroup: null });
      saveContext(get().activeWorkspace?.id, get().activeEnvironment?.id, undefined);
      return;
    }
    const group = get().groups.find((g) => g.id === groupId);
    if (group) {
      set({ activeGroup: group });
      saveContext(get().activeWorkspace?.id, get().activeEnvironment?.id, groupId);
    }
  },

  reset: () => {
    set({ ...initialContextState });
  },
}));
