import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import CommandModal from '../CommandModal';

const mockPost = vi.fn();

vi.mock('@/api/client', () => ({
  apiClient: {
    post: (...args: unknown[]) => mockPost(...args),
  },
}));

function renderModal() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });

  return render(
    <QueryClientProvider client={client}>
      <CommandModal
        open
        onClose={vi.fn()}
        deviceIds={['dev_1', 'dev_2']}
        deviceName="2 selected devices"
        initialCommand="WIPE"
      />
    </QueryClientProvider>
  );
}

function renderBulkPickerModal() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });

  return render(
    <QueryClientProvider client={client}>
      <CommandModal
        open
        onClose={vi.fn()}
        deviceIds={['dev_1', 'dev_2']}
        deviceName="2 selected devices"
      />
    </QueryClientProvider>
  );
}

describe('CommandModal (bulk mode)', () => {
  beforeEach(() => {
    mockPost.mockReset();
    mockPost.mockResolvedValue({ message: 'Bulk command queued' });
  });

  it('queues bulk WIPE with reason and wipe flags using the existing command modal', async () => {
    const user = userEvent.setup();
    renderModal();

    await user.type(screen.getByPlaceholderText(/Optional reason shown to user before wipe/i), 'Retired device');
    await user.click(screen.getByRole('checkbox', { name: /Remove Managed eSIMs/i }));
    await user.click(screen.getByRole('checkbox', { name: /Wipe External Storage/i }));
    await user.click(screen.getByRole('button', { name: /Queue Wipe Device/i }));

    await waitFor(() => {
      expect(mockPost).toHaveBeenCalledWith('/api/devices/bulk', {
        device_ids: ['dev_1', 'dev_2'],
        action: 'WIPE',
        params: {
          wipeReason: 'Retired device',
          wipeDataFlags: ['WIPE_ESIMS', 'WIPE_EXTERNAL_STORAGE'],
        },
      });
    });
  });

  it('supports bulk DELETE from the command picker and queues the bulk endpoint action', async () => {
    const user = userEvent.setup();
    renderBulkPickerModal();

    await user.selectOptions(screen.getByRole('combobox'), 'DELETE');
    await user.click(screen.getByRole('button', { name: /Queue Command/i }));

    await waitFor(() => {
      expect(mockPost).toHaveBeenCalledWith('/api/devices/bulk', {
        device_ids: ['dev_1', 'dev_2'],
        action: 'DELETE',
      });
    });
  });
});
