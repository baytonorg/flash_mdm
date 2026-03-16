class ApiError extends Error {
  status: number;
  data: unknown;
  constructor(message: string, status: number, data?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.data = data;
  }
}

class ApiClient {
  private baseUrl: string;

  constructor(baseUrl = '') {
    this.baseUrl = baseUrl;
  }

  private async request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const suppress401Redirect =
      path === '/api/auth/session' ||
      path === '/api/auth/login' ||
      path === '/api/auth/magic-link-complete' ||
      path === '/api/auth/password-reset-complete';
    const response = await fetch(url, {
      ...options,
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'XMLHttpRequest',
        ...options.headers,
      },
    });

    if (!response.ok) {
      // Read body as text first to avoid "body stream already read" errors
      const text = await response.text();
      let data: unknown;
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }
      const message = typeof data === 'object' && data !== null && 'error' in data
        ? String((data as Record<string, unknown>).error)
        : text || `Request failed with status ${response.status}`;

      // Preserve auth MFA handshake responses without forcing a global redirect.
      if (
        response.status === 401 &&
        typeof data === 'object' &&
        data !== null &&
        (
          ('needs_totp' in data && (data as Record<string, unknown>).needs_totp === true) ||
          ('needs_mfa' in data && (data as Record<string, unknown>).needs_mfa === true)
        )
      ) {
        throw new ApiError(
          (data as Record<string, unknown>).needs_totp === true ? 'TOTP required' : 'MFA required',
          401,
          data
        );
      }

      if (response.status === 401 && !suppress401Redirect) {
        // Session expired — redirect to login
        if (window.location.pathname !== '/login') {
          window.location.href = `/login?redirect=${encodeURIComponent(window.location.pathname + window.location.search + window.location.hash)}`;
        }
      }

      throw new ApiError(message, response.status, data);
    }

    if (response.status === 204) return {} as T;
    return response.json() as Promise<T>;
  }

  get<T>(path: string): Promise<T> {
    return this.request<T>(path);
  }

  post<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>(path, {
      method: 'POST',
      body: body ? JSON.stringify(body) : undefined,
    });
  }

  put<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>(path, {
      method: 'PUT',
      body: body ? JSON.stringify(body) : undefined,
    });
  }

  patch<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>(path, {
      method: 'PATCH',
      body: body ? JSON.stringify(body) : undefined,
    });
  }

  delete<T>(path: string): Promise<T> {
    return this.request<T>(path, { method: 'DELETE' });
  }
}

export const apiClient = new ApiClient();
