import { describe, it, expect, beforeEach, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';

vi.mock('@/api/client', () => ({
  apiClient: {
    get: vi.fn(),
    post: vi.fn(),
  },
}));

import Register from '@/pages/Register';
import { apiClient } from '@/api/client';
import * as redirectUtils from '@/lib/redirect';

const mockedGet = vi.mocked(apiClient.get);
const mockedPost = vi.mocked(apiClient.post);

function renderRegister(initialEntry: string) {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Register />
    </MemoryRouter>,
  );
}

function fillRegisterForm() {
  const firstNameInput = document.querySelector('input[type="text"]') as HTMLInputElement | null;
  const lastNameInput = document.querySelectorAll('input[type="text"]')[1] as HTMLInputElement | null;
  const emailInput = document.querySelector('input[type="email"]') as HTMLInputElement | null;
  const passwordInput = document.querySelector('input[type="password"]') as HTMLInputElement | null;
  const workspaceInput = document.querySelector('input[placeholder="My Organisation"]') as HTMLInputElement | null;

  if (!firstNameInput || !lastNameInput || !emailInput || !passwordInput || !workspaceInput) {
    throw new Error('Register form inputs not found');
  }

  fireEvent.change(firstNameInput, { target: { value: 'Jane' } });
  fireEvent.change(lastNameInput, { target: { value: 'Admin' } });
  fireEvent.change(emailInput, { target: { value: 'jane@example.com' } });
  fireEvent.change(passwordInput, { target: { value: 'Password123!' } });
  fireEvent.change(workspaceInput, { target: { value: 'Acme' } });
}

describe('Register', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedGet.mockResolvedValue({ invite_only_registration: false });
  });

  it('sanitizes external redirect params before sending register redirect_path', async () => {
    mockedPost.mockResolvedValueOnce({ message: 'ok' });

    renderRegister('/register?redirect=https%3A%2F%2Fevil.example%2Fsignup');
    fillRegisterForm();
    fireEvent.click(screen.getByRole('button', { name: /create account/i }));

    await waitFor(() => {
      expect(mockedPost).toHaveBeenCalledWith(
        '/api/auth/register',
        expect.objectContaining({ redirect_path: '/' }),
      );
    });
  });

  it('uses only in-app redirects when backend returns session redirect', async () => {
    const redirectSpy = vi.spyOn(redirectUtils, 'redirectBrowserToInApp').mockImplementation(() => {});
    mockedPost.mockResolvedValueOnce({
      message: 'ok',
      session_set: true,
      redirect: 'https://evil.example/post-register',
    });

    renderRegister('/register?redirect=%2Fdevices');
    fillRegisterForm();
    fireEvent.click(screen.getByRole('button', { name: /create account/i }));

    await waitFor(() => {
      expect(redirectSpy).toHaveBeenCalledWith('https://evil.example/post-register', '/');
    });
  });
});
