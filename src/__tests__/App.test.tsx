import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Outlet } from 'react-router';

const authState = vi.hoisted(() => ({
  user: null as null | { id: string; email: string; is_superadmin: boolean },
  isLoading: false,
  fetchSession: vi.fn(),
}));

vi.mock('@/stores/auth', () => ({
  useAuthStore: (selector?: (state: typeof authState) => unknown) =>
    typeof selector === 'function' ? selector(authState) : authState,
}));

vi.mock('@/components/common/ErrorBoundary', () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('@/components/common/NotFound', () => ({
  default: () => <div>Not Found</div>,
}));

vi.mock('@/layouts/MainLayout', () => ({
  default: () => <Outlet />,
}));

vi.mock('@/layouts/GuestLayout', () => ({
  default: () => <Outlet />,
}));

vi.mock('@/layouts/SuperadminLayout', () => ({
  default: () => <Outlet />,
}));

vi.mock('@/pages/ResetPassword', () => ({
  default: () => <div>Reset Password Page</div>,
}));

import App from '@/App';

function renderApp(initialEntry: string) {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <App />
    </MemoryRouter>,
  );
}

describe('App routes', () => {
  beforeEach(() => {
    authState.fetchSession.mockReset();
    authState.user = null;
    authState.isLoading = false;
  });

  it('renders /reset-password for unauthenticated users', async () => {
    renderApp('/reset-password');

    expect(await screen.findByText('Reset Password Page')).toBeInTheDocument();
    expect(authState.fetchSession).toHaveBeenCalledOnce();
  });

  it('renders /reset-password for authenticated users without redirecting away', async () => {
    authState.user = { id: 'u1', email: 'user@example.com', is_superadmin: false };

    renderApp('/reset-password?token=abc');

    expect(await screen.findByText('Reset Password Page')).toBeInTheDocument();
  });
});
