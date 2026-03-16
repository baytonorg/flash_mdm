import { create } from 'zustand';
import { apiClient } from '@/api/client';
import { resetClientSessionState } from '@/lib/sessionReset';

interface User {
  id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  is_superadmin: boolean;
  totp_enabled: boolean;
  workspace_id: string | null;
  needs_environment_setup?: boolean;
  impersonation?: {
    active: boolean;
    mode: 'full' | 'read_only';
    by_user_id: string;
    by_email: string | null;
    parent_session_id: string | null;
    support_reason: string | null;
    support_ticket_ref: string | null;
    customer_notice_acknowledged_at: string | null;
  };
}

interface AuthState {
  user: User | null;
  isLoading: boolean;
  error: string | null;
  fetchSession: () => Promise<void>;
  login: (email: string, password: string, totpCode?: string) => Promise<void>;
  loginWithMagicLink: (email: string, redirectPath?: string) => Promise<void>;
  completeMagicLinkMfa: (token: string, totpCode: string) => Promise<void>;
  logout: () => Promise<void>;
  setUser: (user: User | null) => void;
}

const initialAuthState = {
  user: null,
  isLoading: false,
  error: null,
} satisfies Pick<AuthState, 'user' | 'isLoading' | 'error'>;

function fullSessionReset(set: (state: Partial<AuthState>) => void): void {
  set({ ...initialAuthState });
  resetClientSessionState();
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  isLoading: true,
  error: null,

  fetchSession: async () => {
    try {
      const data = await apiClient.get<{ user: User }>('/api/auth/session');
      if (!data?.user) {
        fullSessionReset(set);
        return;
      }
      set({ user: data.user, isLoading: false, error: null });
    } catch {
      fullSessionReset(set);
    }
  },

  login: async (email, password, totpCode) => {
    set({ error: null });
    try {
      const data = await apiClient.post<{ user: User }>('/api/auth/login', { email, password, totp_code: totpCode });
      fullSessionReset(set);
      set({ user: data.user, error: null });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Login failed';
      set({ error: message });
      throw err;
    }
  },

  loginWithMagicLink: async (email, redirectPath) => {
    set({ error: null });
    try {
      await apiClient.post('/api/auth/magic-link-start', { email, redirect_path: redirectPath });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to send magic link';
      set({ error: message });
      throw err;
    }
  },

  completeMagicLinkMfa: async (token, totpCode) => {
    set({ error: null });
    try {
      const data = await apiClient.post<{ user: User }>('/api/auth/magic-link-complete', {
        token,
        totp_code: totpCode,
      });
      set({ user: data.user, error: null });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'MFA verification failed';
      set({ error: message });
      throw err;
    }
  },

  logout: async () => {
    try {
      await apiClient.post('/api/auth/logout');
    } finally {
      fullSessionReset(set);
    }
  },

  setUser: (user) => set({ user }),
}));
