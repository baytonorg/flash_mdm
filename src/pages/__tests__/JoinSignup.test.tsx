import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';

vi.mock('@/api/client', () => ({
  apiClient: {
    get: vi.fn(),
    post: vi.fn(),
  },
}));

vi.mock('@/stores/auth', () => ({
  useAuthStore: () => ({
    user: null,
    isLoading: false,
  }),
}));

import { apiClient } from '@/api/client';
import JoinSignup from '@/pages/JoinSignup';

const mockedGet = vi.mocked(apiClient.get);

describe('JoinSignup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows configured public context while hiding internal signup metadata', async () => {
    mockedGet.mockResolvedValueOnce({
      id: 'link_1',
      scope_type: 'workspace',
      scope_id: 'ws_1',
      workspace_name: 'Acme Workspace',
      environment_name: null,
      default_role: 'member',
      allow_environment_creation: false,
      allowed_domains: ['bayton.org', 'example.com'],
      display_name: 'Acme customer onboarding',
      display_description: 'Create an account to begin your managed-device setup.',
      expires_at: null,
      usage_count: 0,
      max_uses: null,
    } as never);

    render(
      <MemoryRouter initialEntries={['/join/test-token']}>
        <Routes>
          <Route path="/join/:token" element={<JoinSignup />} />
        </Routes>
      </MemoryRouter>
    );

    expect(await screen.findByText(/Create your account/i)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Acme customer onboarding' })).toBeInTheDocument();
    expect(screen.getByText('Create an account to begin your managed-device setup.')).toBeInTheDocument();
    expect(screen.queryByText(/Workspace:/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Role:/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Password/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Allowed domains:/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/bayton\.org/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/example\.com/i)).not.toBeInTheDocument();
  });

  it('marks signup-link pages as non-indexable while mounted', async () => {
    mockedGet.mockResolvedValueOnce({
      scope_type: 'workspace',
      workspace_name: null,
      environment_name: null,
      default_role: 'viewer',
      allow_environment_creation: true,
      allowed_domains: [],
      display_name: null,
      display_description: null,
    });

    const { unmount } = render(
      <MemoryRouter initialEntries={['/join/test-token']}>
        <Routes>
          <Route path="/join/:token" element={<JoinSignup />} />
        </Routes>
      </MemoryRouter>
    );

    expect(await screen.findByText(/Create your account/i)).toBeInTheDocument();
    expect(document.head.querySelector('meta[name="robots"]')).toHaveAttribute(
      'content',
      'noindex, nofollow, noarchive'
    );

    unmount();
    expect(document.head.querySelector('meta[name="robots"]')).not.toBeInTheDocument();
  });
});
