import { describe, it, expect, beforeEach, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';

vi.mock('@/api/client', () => ({
  apiClient: {
    post: vi.fn(),
  },
}));

import ResetPassword from '@/pages/ResetPassword';
import { apiClient } from '@/api/client';

const mockedPost = vi.mocked(apiClient.post);

function renderResetPassword(initialEntry: string) {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route path="/reset-password" element={<ResetPassword />} />
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
