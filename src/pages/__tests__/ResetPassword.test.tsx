import { describe, it, expect, beforeEach, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';

vi.mock('@/api/client', () => ({
  apiClient: {
    post: vi.fn(),
  },
}));

import ResetPassword from '@/pages/ResetPassword';
import { apiClient } from '@/api/client';

const mockedPost = vi.mocked(apiClient.post);

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{`${location.pathname}${location.search}`}</div>;
}

function renderResetPassword(initialEntry: string) {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route path="/reset-password" element={<><ResetPassword /><LocationProbe /></>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('ResetPassword', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('requests a reset link when no token is present', async () => {
    mockedPost.mockResolvedValueOnce({
      message: 'If an account exists, a password reset link has been sent.',
    });

    renderResetPassword('/reset-password');

    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'user@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: /send reset link/i }));

    await waitFor(() => {
      expect(mockedPost).toHaveBeenCalledWith('/api/auth/password-reset-start', { email: 'user@example.com' });
      expect(screen.getByText(/password reset link has been sent/i)).toBeInTheDocument();
    });
  });

  it('captures the reset token and immediately removes it from the URL while preserving other parameters', async () => {
    renderResetPassword('/reset-password?token=reset-token&campaign=operator');

    expect(screen.getByRole('heading', { name: /choose a new password/i })).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByTestId('location')).toHaveTextContent('/reset-password?campaign=operator');
    });
    expect(mockedPost).not.toHaveBeenCalled();
  });

  it('removes every duplicate token parameter even when the first value is empty', async () => {
    renderResetPassword('/reset-password?token=&token=synthetic-bearer&campaign=operator');

    expect(screen.getByRole('heading', { name: /reset your password/i })).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByTestId('location')).toHaveTextContent('/reset-password?campaign=operator');
    });
    expect(mockedPost).not.toHaveBeenCalled();
  });

  it('clears the captured token after a successful reset and keeps a terminal confirmation view', async () => {
    mockedPost.mockResolvedValueOnce({
      message: 'Password reset successful. Please sign in again.',
    });

    renderResetPassword('/reset-password?token=reset-token');
    const passwordInputs = screen.getAllByLabelText(/password/i);
    fireEvent.change(passwordInputs[0], { target: { value: 'Password123!' } });
    fireEvent.change(passwordInputs[1], { target: { value: 'Password123!' } });
    fireEvent.click(screen.getByRole('button', { name: /^reset password$/i }));

    expect(await screen.findByRole('heading', { name: /password reset complete/i })).toBeInTheDocument();
    expect(screen.getByText(/password reset successful/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^reset password$/i })).not.toBeInTheDocument();
  });

  it('clears a terminal invalid token and returns to the safe reset-request flow', async () => {
    mockedPost.mockRejectedValueOnce(Object.assign(new Error('Invalid or expired reset link'), {
      status: 400,
      data: { error: 'Invalid or expired reset link' },
    }));

    renderResetPassword('/reset-password?token=invalid-token');
    const passwordInputs = screen.getAllByLabelText(/password/i);
    fireEvent.change(passwordInputs[0], { target: { value: 'Password123!' } });
    fireEvent.change(passwordInputs[1], { target: { value: 'Password123!' } });
    fireEvent.click(screen.getByRole('button', { name: /^reset password$/i }));

    expect(await screen.findByText(/invalid or expired reset link/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /send reset link/i })).toBeInTheDocument();
    expect(screen.getByTestId('location')).toHaveTextContent('/reset-password');
  });

  it('continues TOTP-protected reset via MFA handshake and completion endpoint', async () => {
    mockedPost
      .mockRejectedValueOnce({
        message: 'MFA required',
        status: 401,
        data: { needs_mfa: true, mfa_pending_token: 'mfa_pending_123' },
      })
      .mockResolvedValueOnce({
        message: 'Password reset successful. Please sign in again.',
      });

    renderResetPassword('/reset-password?token=reset-token');

    await waitFor(() => {
      expect(screen.getByTestId('location')).toHaveTextContent('/reset-password');
    });

    const passwordInputs = screen.getAllByLabelText(/password/i);
    fireEvent.change(passwordInputs[0], { target: { value: 'Password123!' } });
    fireEvent.change(passwordInputs[1], { target: { value: 'Password123!' } });
    fireEvent.click(screen.getByRole('button', { name: /^reset password$/i }));

    expect(await screen.findByText(/verify reset/i)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/authenticator code/i), { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: /verify and reset password/i }));

    await waitFor(() => {
      expect(mockedPost).toHaveBeenNthCalledWith(1, '/api/auth/password-reset-complete', {
        token: 'reset-token',
        new_password: 'Password123!',
      });
      expect(mockedPost).toHaveBeenNthCalledWith(2, '/api/auth/magic-link-complete', {
        token: 'mfa_pending_123',
        totp_code: '123456',
      });
      expect(screen.getByText(/password reset successful/i)).toBeInTheDocument();
    });
  });
});
