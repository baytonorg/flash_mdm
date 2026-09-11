import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mocks = vi.hoisted(() => ({
  useDeviceOperations: vi.fn(),
  useCancelOperation: vi.fn(),
  mutate: vi.fn(),
  reset: vi.fn(),
  fetchNextPage: vi.fn(),
}));

vi.mock('@/api/queries/device-operations', () => ({
  useDeviceOperations: mocks.useDeviceOperations,
  useCancelOperation: mocks.useCancelOperation,
}));

import DeviceOperations from '../DeviceOperations';

const operationName = 'enterprises/e1/operations/op_1';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.useDeviceOperations.mockReturnValue({
    data: { operations: [{ name: operationName, done: false }] },
    isLoading: false,
    isError: false,
    hasNextPage: false,
    fetchNextPage: mocks.fetchNextPage,
    isFetchingNextPage: false,
  });
  mocks.useCancelOperation.mockReturnValue({
    mutate: mocks.mutate,
    reset: mocks.reset,
    isPending: false,
    isError: false,
    variables: undefined,
    error: null,
  });
});

describe('DeviceOperations cancellation', () => {
  it('requires confirmation before requesting cancellation', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    const user = userEvent.setup();
    render(<DeviceOperations deviceId="device_1" />);

    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(mocks.mutate).not.toHaveBeenCalled();
  });

  it('submits a confirmed cancellation for the selected operation', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const user = userEvent.setup();
    render(<DeviceOperations deviceId="device_1" />);

    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(mocks.reset).toHaveBeenCalledOnce();
    expect(mocks.mutate).toHaveBeenCalledWith(operationName);
  });

  it('shows pending and failure state on the affected row', () => {
    mocks.useCancelOperation.mockReturnValue({
      mutate: mocks.mutate,
      reset: mocks.reset,
      isPending: false,
      isError: true,
      variables: operationName,
      error: new Error('Operation already completed'),
    });
    render(<DeviceOperations deviceId="device_1" />);

    expect(screen.getByRole('alert')).toHaveTextContent('Operation already completed');
  });
});

describe('DeviceOperations reconciliation', () => {
  it('shows persistent reconciliation progress without offering command cancellation', () => {
    mocks.useDeviceOperations.mockReturnValue({
      data: {
        operations: [{
          name: 'ledger/command-1',
          done: false,
          ledgerStatus: 'reconciling',
          error: { code: 0, message: 'Command delivery is uncertain; read-only reconciliation is in progress.' },
          reconciliation: { pagesScanned: 140 },
          metadata: { type: 'REBOOT', createTime: '2026-09-10T08:00:00Z' },
        }],
      },
      isLoading: false,
      isError: false,
      hasNextPage: false,
      fetchNextPage: mocks.fetchNextPage,
      isFetchingNextPage: false,
    });

    render(<DeviceOperations deviceId="device_1" />);

    expect(screen.getByText('Reconciling')).toBeInTheDocument();
    expect(screen.getByText(/scanned 140 AMAPI pages/i)).toHaveTextContent('never replayed');
    expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument();
  });

  it('loads older operation pages on demand', async () => {
    mocks.useDeviceOperations.mockReturnValue({
      data: { operations: [{ name: operationName, done: true }] },
      isLoading: false,
      isError: false,
      hasNextPage: true,
      fetchNextPage: mocks.fetchNextPage,
      isFetchingNextPage: false,
    });
    const user = userEvent.setup();
    render(<DeviceOperations deviceId="device_1" />);

    await user.click(screen.getByRole('button', { name: 'Load older operations' }));

    expect(mocks.fetchNextPage).toHaveBeenCalledOnce();
  });
});
