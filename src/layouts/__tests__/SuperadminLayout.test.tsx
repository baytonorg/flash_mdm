import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';

const authState = vi.hoisted((): {
  isLoading: boolean;
  user: { email: string; is_superadmin: boolean } | null;
} => ({
  isLoading: false,
  user: {
    email: 'user@example.com',
    is_superadmin: false,
  },
}));

vi.mock('@/stores/auth', () => ({
  useAuthStore: () => authState,
}));

vi.mock('@/lib/brand', () => ({
  BRAND: { shortName: 'Flash' },
}));

import SuperadminLayout from '@/layouts/SuperadminLayout';

function renderWithRoutes() {
  return render(
    <MemoryRouter initialEntries={['/superadmin']}>
      <Routes>
        <Route path="/" element={<div>Console Home</div>} />
        <Route path="/superadmin" element={<SuperadminLayout />}>
          <Route index element={<div>Secret Dashboard</div>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

describe('SuperadminLayout', () => {
  it('redirects non-superadmins back to the console', () => {
    authState.isLoading = false;
    authState.user = {
      email: 'member@example.com',
      is_superadmin: false,
    };

    renderWithRoutes();

    expect(screen.getByText('Console Home')).toBeInTheDocument();
    expect(screen.queryByText('Secret Dashboard')).not.toBeInTheDocument();
  });

  it('renders the superadmin panel for superadmins', () => {
    authState.isLoading = false;
    authState.user = {
      email: 'root@example.com',
      is_superadmin: true,
    };

    renderWithRoutes();

    expect(screen.getByText('Superadmin Panel')).toBeInTheDocument();
    expect(screen.getByText('Secret Dashboard')).toBeInTheDocument();
  });

  it('waits for auth loading before redirecting', () => {
    authState.isLoading = true;
    authState.user = null;

    renderWithRoutes();

    expect(screen.queryByText('Console Home')).not.toBeInTheDocument();
    expect(screen.queryByText('Secret Dashboard')).not.toBeInTheDocument();
    expect(document.querySelector('.animate-spin')).toBeTruthy();
  });
});
