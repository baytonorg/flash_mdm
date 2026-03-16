import { describe, it, expect, beforeEach, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';

const authMocks = vi.hoisted(() => ({
  login: vi.fn(),
  loginWithMagicLink: vi.fn(),
  completeMagicLinkMfa: vi.fn(),
}));

vi.mock('@/stores/auth', () => ({
  useAuthStore: () => ({
    ...authMocks,
    error: null,
  }),
}));

vi.mock('@/api/client', () => ({
  apiClient: {
    get: vi.fn(),
    post: vi.fn(),
  },
}));

import Login from '@/pages/Login';
import { apiClient } from '@/api/client';

const mockedGet = vi.mocked(apiClient.get);

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{`${location.pathname}${location.search}`}</div>;
}

function renderLogin(initialEntry: string) {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route path="/login" element={<><Login /><LocationProbe /></>} />
        <Route path="*" element={<LocationProbe />} />
      </Routes>
    </MemoryRouter>,
  );
}

function fillPasswordLoginForm() {
  const emailInput = document.querySelector('input[type="email"]');
  const passwordInput = document.querySelector('input[type="password"]');
  if (!emailInput || !passwordInput) {
    throw new Error('Password login form inputs not found');
  }
  fireEvent.change(emailInput, { target: { value: 'user@example.com' } });
  fireEvent.change(passwordInput, { target: { value: 'Password123!' } });
}

describe('Login', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedGet.mockResolvedValue({ invite_only_registration: false });
  });

  it('preserves valid in-app redirects after password login', async () => {
    authMocks.login.mockResolvedValueOnce(undefined);

    renderLogin('/login?redirect=%2Fdevices%3Ftab%3Dactive');

    fireEvent.click(screen.getByRole('button', { name: /sign in with password instead/i }));
    fillPasswordLoginForm();
    fireEvent.click(screen.getByRole('button', { name: /^sign in$/i }));

    await waitFor(() => {
      expect(screen.getByTestId('location')).toHaveTextContent('/devices?tab=active');
    });
  });

  it('rejects external redirects and falls back to root after login', async () => {
    authMocks.login.mockResolvedValueOnce(undefined);

    renderLogin('/login?redirect=https%3A%2F%2Fevil.example%2Fphish');

    fireEvent.click(screen.getByRole('button', { name: /sign in with password instead/i }));
    fillPasswordLoginForm();
    fireEvent.click(screen.getByRole('button', { name: /^sign in$/i }));

    await waitFor(() => {
      expect(screen.getByTestId('location')).toHaveTextContent('/');
    });
  });

  it('clears mfa_pending from the URL immediately while preserving token and other params', async () => {
    authMocks.completeMagicLinkMfa.mockResolvedValueOnce(undefined);

    renderLogin('/login?redirect=%2Fsettings&mfa_pending=tok_123&foo=1');

    expect(await screen.findByText(/two-factor authentication/i)).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByTestId('location')).toHaveTextContent('/login?redirect=%2Fsettings&foo=1');
    });

    fireEvent.change(screen.getByPlaceholderText(/6-digit code/i), { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: /verify/i }));

    await waitFor(() => {
      expect(authMocks.completeMagicLinkMfa).toHaveBeenCalledWith('tok_123', '123456');
      expect(screen.getByTestId('location')).toHaveTextContent('/settings');
    });
  });

  it('shows a recovery message when auth_error indicates an expired or used magic link', async () => {
    renderLogin('/login?auth_error=expired_or_used_magic_link');

    expect(await screen.findByText(/invalid or has already been used/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /send magic link/i })).toBeInTheDocument();
  });
});
