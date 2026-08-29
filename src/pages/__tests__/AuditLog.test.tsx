import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mocks = vi.hoisted(() => ({
  useAuditLog: vi.fn(() => ({
    data: { entries: [], total: 52 },
    isLoading: false,
    dataUpdatedAt: Date.now(),
  })),
}));

vi.mock('@/api/queries/audit', () => ({ useAuditLog: mocks.useAuditLog }));
vi.mock('@/components/common/DataTable', () => ({
  default: () => <div data-testid="audit-table" />,
}));
vi.mock('@/components/common/Pagination', () => ({
  default: ({ total }: { total: number }) => <div data-testid="audit-total">{total}</div>,
}));
vi.mock('@/components/common/LivePageIndicator', () => ({ default: () => null }));

import { useContextStore } from '@/stores/context';
import AuditLog from '../AuditLog';

beforeEach(() => {
  vi.clearAllMocks();
  useContextStore.setState({
    activeEnvironment: {
      id: 'env_1',
      workspace_id: 'workspace_1',
      name: 'Production',
      enterprise_name: 'enterprises/e1',
      enterprise_display_name: 'Enterprise',
    },
  });
});

describe('AuditLog', () => {
  it('sends action filtering to the API and keeps the server total', async () => {
    const user = userEvent.setup();
    render(<AuditLog />);

    await user.selectOptions(screen.getByRole('combobox'), 'device.delete');

    expect(mocks.useAuditLog).toHaveBeenLastCalledWith({
      environment_id: 'env_1',
      page: 1,
      per_page: 25,
      action: 'device.delete',
    });
    expect(screen.getByTestId('audit-total')).toHaveTextContent('52');
  });
});
