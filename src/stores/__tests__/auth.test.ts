import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useAuthStore } from '../auth';

// Mock the apiClient module
vi.mock('@/api/client', () => ({
  apiClient: {
    get: vi.fn(),
    post: vi.fn(),
  },
}));

import { apiClient } from '@/api/client';

const mockedGet = vi.mocked(apiClient.get);
const mockedPost = vi.mocked(apiClient.post);

function clearStorage() {
  if (typeof localStorage.clear === 'function') {
    localStorage.clear();
    return;
  }
  localStorage.removeItem('flash_context');
  localStorage.removeItem('flashi_chat_open');
}

const mockUser = {
  id: 'user-1',
  email: 'test@example.com',
  first_name: 'Test',
  last_name: 'User',
  is_superadmin: false,
  totp_enabled: false,
  workspace_id: null,
};

beforeEach(() => {
  // Reset store state between tests
  useAuthStore.setState({
    user: null,
    isLoading: true,
    error: null,
  });
  clearStorage();
  vi.clearAllMocks();
});

describe('useAuthStore', () => {
  describe('fetchSession', () => {
    it('sets user on success', async () => {
      mockedGet.mockResolvedValueOnce({ user: mockUser });
      await useAuthStore.getState().fetchSession();

      const state = useAuthStore.getState();
      expect(state.user).toEqual(mockUser);
      expect(state.isLoading).toBe(false);
      expect(state.error).toBeNull();
    });

    it('clears user on failure', async () => {
      mockedGet.mockRejectedValueOnce(new Error('Unauthorized'));
      await useAuthStore.getState().fetchSession();

      const state = useAuthStore.getState();
      expect(state.user).toBeNull();
      expect(state.isLoading).toBe(false);
      expect(state.error).toBeNull();
    });

    it('sets isLoading to false after success', async () => {
      mockedGet.mockResolvedValueOnce({ user: mockUser });
      await useAuthStore.getState().fetchSession();
      expect(useAuthStore.getState().isLoading).toBe(false);
    });

    it('sets isLoading to false after failure', async () => {
      mockedGet.mockRejectedValueOnce(new Error('fail'));
      await useAuthStore.getState().fetchSession();
      expect(useAuthStore.getState().isLoading).toBe(false);
    });

    it('calls GET /api/auth/session', async () => {
      mockedGet.mockResolvedValueOnce({ user: mockUser });
      await useAuthStore.getState().fetchSession();
      expect(mockedGet).toHaveBeenCalledWith('/api/auth/session');
    });
  });

  describe('login', () => {
    it('calls API and sets user on success', async () => {
      mockedPost.mockResolvedValueOnce({ user: mockUser });
      await useAuthStore.getState().login('test@example.com', 'password123');

      expect(mockedPost).toHaveBeenCalledWith('/api/auth/login', {
        email: 'test@example.com',
        password: 'password123',
        totp_code: undefined,
      });
      expect(useAuthStore.getState().user).toEqual(mockUser);
      expect(useAuthStore.getState().error).toBeNull();
    });

    it('passes TOTP code when provided', async () => {
      mockedPost.mockResolvedValueOnce({ user: mockUser });
      await useAuthStore.getState().login('test@example.com', 'pass', '123456');

      expect(mockedPost).toHaveBeenCalledWith('/api/auth/login', {
        email: 'test@example.com',
        password: 'pass',
        totp_code: '123456',
      });
    });

    it('sets error on failure', async () => {
      mockedPost.mockRejectedValueOnce(new Error('Invalid credentials'));

      await expect(
        useAuthStore.getState().login('bad@example.com', 'wrong'),
      ).rejects.toThrow('Invalid credentials');

      expect(useAuthStore.getState().error).toBe('Invalid credentials');
      expect(useAuthStore.getState().user).toBeNull();
    });

    it('clears previous error before login attempt', async () => {
      useAuthStore.setState({ error: 'old error' });
      mockedPost.mockResolvedValueOnce({ user: mockUser });

      await useAuthStore.getState().login('test@example.com', 'pass');
      expect(useAuthStore.getState().error).toBeNull();
    });
  });

  describe('logout', () => {
    it('clears user on successful logout', async () => {
      useAuthStore.setState({ user: mockUser });
      mockedPost.mockResolvedValueOnce({});
      localStorage.setItem('flash_context', JSON.stringify({ workspaceId: 'ws-1' }));

      await useAuthStore.getState().logout();
      expect(useAuthStore.getState().user).toBeNull();
      expect(localStorage.getItem('flash_context')).toBeNull();
    });

    it('clears user even if API call fails', async () => {
      useAuthStore.setState({ user: mockUser });
      mockedPost.mockRejectedValueOnce(new Error('Network error'));
      localStorage.setItem('flash_context', JSON.stringify({ workspaceId: 'ws-1' }));

      // logout uses try/finally — error propagates but user is still cleared
      try {
        await useAuthStore.getState().logout();
      } catch {
        // expected
      }
      expect(useAuthStore.getState().user).toBeNull();
      expect(localStorage.getItem('flash_context')).toBeNull();
    });

    it('calls POST /api/auth/logout', async () => {
      mockedPost.mockResolvedValueOnce({});
      await useAuthStore.getState().logout();
      expect(mockedPost).toHaveBeenCalledWith('/api/auth/logout');
    });
  });

  describe('setUser', () => {
    it('sets the user', () => {
      useAuthStore.getState().setUser(mockUser);
      expect(useAuthStore.getState().user).toEqual(mockUser);
    });

    it('clears the user when null is passed', () => {
      useAuthStore.setState({ user: mockUser });
      useAuthStore.getState().setUser(null);
      expect(useAuthStore.getState().user).toBeNull();
    });
  });
});
