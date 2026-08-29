import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('@/api/client', () => ({
  apiClient: {
    put: vi.fn(),
    post: vi.fn(),
  },
}));

import { apiClient } from '@/api/client';
import { useAuthStore } from '@/stores/auth';
import { ProfileTab } from '../Settings';

const mockPut = vi.mocked(apiClient.put);
const fetchSession = vi.fn().mockResolvedValue(undefined);

beforeEach(() => {
  vi.clearAllMocks();
  useAuthStore.setState({
    user: {
      id: 'user_1',
      email: 'old@example.com',
      first_name: 'Old',
      last_name: 'Name',
      is_superadmin: false,
      totp_enabled: false,
      workspace_id: 'workspace_1',
    },
    isLoading: false,
    error: null,
    fetchSession,
  });
});

describe('ProfileTab', () => {
  it('saves the profile contract and refreshes the session', async () => {
    mockPut.mockResolvedValue({});
    const user = userEvent.setup();
    render(<ProfileTab />);
    const inputs = screen.getAllByRole('textbox');

    await user.clear(inputs[0]);
    await user.type(inputs[0], 'New');
    await user.clear(inputs[1]);
    await user.type(inputs[1], 'Person');
    await user.clear(inputs[2]);
    await user.type(inputs[2], 'new@example.com');
    await user.click(screen.getByRole('button', { name: 'Save Profile' }));

    expect(mockPut).toHaveBeenCalledWith('/api/auth/profile', {
      first_name: 'New',
      last_name: 'Person',
      email: 'new@example.com',
    });
    expect(fetchSession).toHaveBeenCalledOnce();
    expect(await screen.findByText('Profile updated.')).toBeInTheDocument();
  });

  it('shows profile update failures', async () => {
    mockPut.mockRejectedValue(new Error('Email is already in use'));
    const user = userEvent.setup();
    render(<ProfileTab />);

    await user.click(screen.getByRole('button', { name: 'Save Profile' }));

    expect(await screen.findByText('Email is already in use')).toBeInTheDocument();
    expect(fetchSession).not.toHaveBeenCalled();
  });
});
