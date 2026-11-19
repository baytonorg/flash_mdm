import { cleanup, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';
vi.mock('@/api/client', () => ({ apiClient: { get: vi.fn() } }));
vi.mock('@/stores/context', () => ({ useContextStore: () => ({ activeEnvironment: { id: 'synthetic-environment' } }) }));
import { apiClient } from '@/api/client';
import AuditLog from '../AuditLog';
import DeviceAuditLog from '@/components/device/DeviceAuditLog';
import RecentEventsWidget from '@/components/dashboard/RecentEventsWidget';

const custom = { id: 'custom', environment_id: 'synthetic-environment', action: 'workflow.custom_audit', actor: 'System', resource_type: 'workflow', created_at: new Date().toISOString(), details: { custom_workflow_action: true, requested_action: 'auth.login', execution_id: 'synthetic-execution' } };
afterEach(() => { cleanup(); vi.resetAllMocks(); });
it('labels requested custom records separately from native security and workflow engine evidence', async () => {
  vi.mocked(apiClient.get).mockResolvedValue({ entries: [custom, { ...custom, id: 'native', action: 'auth.login', details: {} }, { ...custom, id: 'engine', action: 'workflow.execution.executed', details: {} }], total: 3 });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(<QueryClientProvider client={client}><AuditLog /></QueryClientProvider>);
  expect(await screen.findByRole('cell', { name: 'Custom workflow audit' })).toBeInTheDocument();
  expect(screen.getByRole('cell', { name: 'auth.login' })).toBeInTheDocument();
  expect(screen.getByRole('cell', { name: 'workflow.execution.executed' })).toBeInTheDocument();
  expect(screen.getByRole('option', { name: 'Custom workflow audit' })).toHaveValue('workflow.custom_audit');
  view.unmount(); client.clear();
});
it('uses the same distinct label in device activity and recent events', () => {
  render(<><DeviceAuditLog entries={[custom]} /><RecentEventsWidget events={[custom]} /></>);
  expect(screen.getAllByText('Custom workflow audit')).toHaveLength(2);
  expect(screen.queryByText('Workflow.custom audit')).not.toBeInTheDocument();
});
