import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// We need to test the ApiClient class, so we re-import fresh each time
// But since apiClient is a singleton, we'll test via the exported instance
// and mock fetch globally.

const mockFetch = vi.fn();

beforeEach(() => {
  vi.stubGlobal('fetch', mockFetch);
  // Mock window.location
  vi.stubGlobal('location', {
    pathname: '/dashboard',
    href: '',
  });
  mockFetch.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// Import after mocking
import { apiClient } from '../client';

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('apiClient', () => {
  describe('GET requests', () => {
    it('sends GET request with correct headers', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ items: [] }));
      await apiClient.get('/api/devices');

      expect(mockFetch).toHaveBeenCalledWith('/api/devices', expect.objectContaining({
        credentials: 'include',
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
          'X-Requested-With': 'XMLHttpRequest',
        }),
      }));
    });

    it('returns parsed JSON response', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ items: [1, 2, 3] }));
      const result = await apiClient.get<{ items: number[] }>('/api/items');
      expect(result).toEqual({ items: [1, 2, 3] });
    });
  });

  describe('POST requests', () => {
    it('sends POST request with JSON body', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ id: '123' }));
      await apiClient.post('/api/devices', { name: 'Test Device' });

      expect(mockFetch).toHaveBeenCalledWith('/api/devices', expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ name: 'Test Device' }),
        credentials: 'include',
      }));
    });

    it('sends POST without body when not provided', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({}));
      await apiClient.post('/api/auth/logout');

      expect(mockFetch).toHaveBeenCalledWith('/api/auth/logout', expect.objectContaining({
        method: 'POST',
        body: undefined,
      }));
    });
  });

  describe('PUT requests', () => {
    it('sends PUT request', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ updated: true }));
      await apiClient.put('/api/devices/1', { name: 'Updated' });

      expect(mockFetch).toHaveBeenCalledWith('/api/devices/1', expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({ name: 'Updated' }),
      }));
    });
  });

  describe('PATCH requests', () => {
    it('sends PATCH request', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ patched: true }));
      await apiClient.patch('/api/devices/1', { status: 'active' });

      expect(mockFetch).toHaveBeenCalledWith('/api/devices/1', expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ status: 'active' }),
      }));
    });
  });

  describe('DELETE requests', () => {
    it('sends DELETE request', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({}));
      await apiClient.delete('/api/devices/1');

      expect(mockFetch).toHaveBeenCalledWith('/api/devices/1', expect.objectContaining({
        method: 'DELETE',
      }));
    });
  });

  describe('error handling', () => {
    it('handles 401 by redirecting to login', async () => {
      mockFetch.mockResolvedValueOnce(new Response('', { status: 401 }));

      await expect(apiClient.get('/api/protected')).rejects.toThrow('Request failed with status 401');
      expect(window.location.href).toContain('/login?redirect=');
    });

    it('does not redirect if already on login page', async () => {
      vi.stubGlobal('location', {
        pathname: '/login',
        href: '/login',
      });
      mockFetch.mockResolvedValueOnce(new Response('', { status: 401 }));

      await expect(apiClient.get('/api/protected')).rejects.toThrow('Request failed with status 401');
      // href should not have been modified to a redirect
      expect(window.location.href).toBe('/login');
    });

    it('handles error responses with JSON error body', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify({ error: 'Device not found' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        }),
      );

      try {
        await apiClient.get('/api/devices/999');
        expect.fail('should have thrown');
      } catch (err: unknown) {
        const apiErr = err as { message: string; status: number; name: string };
        expect(apiErr.message).toBe('Device not found');
        expect(apiErr.status).toBe(404);
        expect(apiErr.name).toBe('ApiError');
      }
    });

    it('handles error responses with non-JSON body', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response('Internal Server Error', { status: 500 }),
      );

      await expect(apiClient.get('/api/broken')).rejects.toThrow();
    });

    it('handles network errors', async () => {
      mockFetch.mockRejectedValueOnce(new TypeError('Failed to fetch'));

      await expect(apiClient.get('/api/offline')).rejects.toThrow('Failed to fetch');
    });
  });

  describe('204 No Content', () => {
    it('returns empty object for 204 responses', async () => {
      mockFetch.mockResolvedValueOnce(new Response(null, { status: 204 }));
      const result = await apiClient.delete('/api/devices/1');
      expect(result).toEqual({});
    });
  });

  describe('auth 401 suppression', () => {
    it('does not redirect for password login TOTP handshake responses', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ needs_totp: true }, 401));

      await expect(
        apiClient.post('/api/auth/login', { email: 'a@example.com', password: 'pw' })
      ).rejects.toMatchObject({
        message: 'TOTP required',
        status: 401,
      });

      expect(window.location.pathname).toBe('/dashboard');
    });

    it('does not redirect for magic-link MFA completion failures', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ error: 'Invalid TOTP code' }, 401));

      await expect(
        apiClient.post('/api/auth/magic-link-complete', { token: 'x', totp_code: '123456' })
      ).rejects.toMatchObject({
        message: 'Invalid TOTP code',
        status: 401,
      });

      expect(window.location.pathname).toBe('/dashboard');
    });

    it('does not redirect for auth session probes', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ error: 'Unauthorized' }, 401));

      await expect(apiClient.get('/api/auth/session')).rejects.toMatchObject({
        message: 'Unauthorized',
        status: 401,
      });

      expect(window.location.pathname).toBe('/dashboard');
    });

    it('does not redirect for password reset MFA handshake responses', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ needs_mfa: true, mfa_pending_token: 'tok' }, 401));

      await expect(
        apiClient.post('/api/auth/password-reset-complete', { token: 'x', new_password: 'Password123!' })
      ).rejects.toMatchObject({
        message: 'MFA required',
        status: 401,
      });

      expect(window.location.pathname).toBe('/dashboard');
    });
  });
});
