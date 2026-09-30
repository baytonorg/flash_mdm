import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import TokenCreator from '../TokenCreator';

const post = vi.fn();

vi.mock('@/api/client', () => ({ apiClient: { post: (...args: unknown[]) => post(...args) } }));
vi.mock('@/stores/context', () => ({
  useContextStore: () => ({
    activeEnvironment: { id: 'env-1' },
    groups: [],
  }),
}));

function renderCreator(onClose = vi.fn()) {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <TokenCreator open onClose={onClose} onCreated={vi.fn()} />
    </QueryClientProvider>,
  );
}

describe('TokenCreator', () => {
  beforeEach(() => {
    post.mockReset();
    post.mockResolvedValue({ enrollment_token: { name: 'test' } });
  });

  it('masks the Wi-Fi password by default and supports intentional reveal and hide', async () => {
    const user = userEvent.setup();
    renderCreator();
    const input = screen.getByLabelText('Wi-Fi Password');
    expect(input).toHaveAttribute('type', 'password');
    expect(input).toHaveAttribute('autocomplete', 'new-password');

    await user.click(screen.getByRole('button', { name: 'Show Wi-Fi password' }));
    expect(input).toHaveAttribute('type', 'text');
    await user.click(screen.getByRole('button', { name: 'Hide Wi-Fi password' }));
    expect(input).toHaveAttribute('type', 'password');
  });

  it('disables the password for an open network and resets reveal state on close', async () => {
    const user = userEvent.setup();
    renderCreator();
    await user.click(screen.getByRole('button', { name: 'Show Wi-Fi password' }));
    await user.selectOptions(screen.getByLabelText('Wi-Fi Security'), 'NONE');
    expect(screen.getByLabelText('Wi-Fi Password')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Hide Wi-Fi password' })).toBeDisabled();

    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByLabelText('Wi-Fi Password')).toHaveAttribute('type', 'password');
  });

  it('submits the explicit AMAPI maximum duration', async () => {
    const user = userEvent.setup();
    renderCreator();
    await user.selectOptions(
      screen.getByLabelText('Token duration'),
      'maximum',
    );
    expect(screen.queryByLabelText('Expiry days')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Create Token' }));

    await waitFor(() => {
      expect(post).toHaveBeenCalledWith('/api/enrolment/create', expect.objectContaining({
        duration: '315576000000s',
      }));
    });
    expect(post.mock.calls[0]?.[1]).not.toHaveProperty('expiry_days');
  });

  it('submits secured Wi-Fi values unchanged', async () => {
    const user = userEvent.setup();
    post.mockResolvedValueOnce({
      qr_data: '{"android.app.extra.PROVISIONING_ENROLLMENT_TOKEN":"redacted-token"}',
    });
    renderCreator();
    await user.type(screen.getByLabelText('Wi-Fi SSID'), 'Setup network');
    await user.type(screen.getByLabelText('Wi-Fi Password'), 'not-a-real-secret');
    await user.click(screen.getByRole('button', { name: 'Create Token' }));

    await waitFor(() => expect(post).toHaveBeenCalled());
    expect(post.mock.calls[0]?.[1]).toEqual(expect.objectContaining({
      provisioning_extras: expect.objectContaining({
        wifiSsid: 'Setup network',
        wifiPassword: 'not-a-real-secret',
        wifiSecurityType: 'WPA',
      }),
    }));
    expect(screen.getByText(/PROVISIONING_WIFI_PASSWORD/)).toHaveTextContent('[hidden]');
    expect(screen.queryByText(/not-a-real-secret/)).not.toBeInTheDocument();
  });
});
