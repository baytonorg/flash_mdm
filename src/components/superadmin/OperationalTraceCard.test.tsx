import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { apiClient } from '@/api/client';
import OperationalTraceCard from './OperationalTraceCard';
vi.mock('@/api/client', () => ({ apiClient: { get: vi.fn() } }));
const renderCard = () => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><OperationalTraceCard /></QueryClientProvider>);
beforeEach(() => vi.resetAllMocks());
describe('superadmin operational trace card', () => {
  it('stays cheap while collapsed, then exposes filters, outcomes and the protected download', async () => {
    vi.mocked(apiClient.get).mockImplementation(async path => path.includes('events=true') ? { events: [{ time: '2026-11-03T13:00:00Z', event: 'http.end', actor: { type: 'human', email: 'fixture@example.invalid' }, route: '/api/policies/list', data: { status: 403 } }], scan_limited: true } as never : { enabled: true, current_window: '2026-11-03', retained_windows: ['2026-11-03'], rotation: '09:00 Europe/London', collection: { accepting: true }, writers: [] } as never);
    renderCard(); expect(apiClient.get).not.toHaveBeenCalled();
    await userEvent.click(screen.getByText('Operational trace'));
    expect(await screen.findByText('fixture@example.invalid')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Download window' })).toHaveAttribute('href', '/api/superadmin/operational-trace?window=2026-11-03&download=ndjson');
    expect(screen.getByText(/scan is limited/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('checkbox', { name: 'Problems only' }));
    await screen.findByText('http.end');
    expect(apiClient.get).toHaveBeenCalledWith(expect.stringContaining('outcome=problems'));
  });
  it('makes storage gaps visible instead of presenting a healthy empty log', async () => {
    vi.mocked(apiClient.get).mockResolvedValue({ enabled: true, current_window: '2026-11-03', retained_windows: ['2026-11-03'], collection: { accepting: true }, writers: [{ window: '2026-11-03', dropped: 2, write_errors: 0, budget_evictions: 0 }], events: [] } as never);
    renderCard(); await userEvent.click(screen.getByText('Operational trace'));
    expect(await screen.findByText('Collecting with gaps')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('dropped events');
  });
});
