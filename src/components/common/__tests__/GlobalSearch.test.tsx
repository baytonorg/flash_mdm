import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import GlobalSearch from '../GlobalSearch';

const mocks = vi.hoisted(() => ({
  environmentId: 'env-1',
  get: vi.fn(),
}));

vi.mock('@/api/client', () => ({
  apiClient: { get: mocks.get },
}));

vi.mock('@/stores/context', () => ({
  useContextStore: () => ({
    activeEnvironment: mocks.environmentId ? { id: mocks.environmentId } : null,
  }),
}));

interface DeferredRequest {
  path: string;
  signal: AbortSignal | undefined;
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
}

const requests: DeferredRequest[] = [];

function emptyResponse(path: string) {
  if (path.includes('/devices/')) return { devices: [] };
  if (path.includes('/policies/')) return { policies: [] };
  if (path.includes('/groups/')) return { groups: [] };
  return { users: [] };
}

function resolveBatch(batch: DeferredRequest[], deviceName?: string) {
  for (const request of batch) {
    if (deviceName && request.path.includes('/devices/')) {
      request.resolve({
        devices: [{
          id: `device-${deviceName}`,
          manufacturer: deviceName,
          model: null,
          serial_number: null,
        }],
      });
    } else {
      request.resolve(emptyResponse(request.path));
    }
  }
}

async function startSearch(value: string) {
  fireEvent.change(screen.getByRole('textbox', { name: /search devices/i }), {
    target: { value },
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(300);
  });
}

async function settle(action: () => void) {
  await act(async () => {
    action();
    await Promise.resolve();
  });
}

function renderSearch(open = true) {
  return render(
    <MemoryRouter>
      <GlobalSearch open={open} onClose={vi.fn()} />
    </MemoryRouter>,
  );
}

describe('GlobalSearch', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mocks.environmentId = 'env-1';
    requests.length = 0;
    mocks.get.mockReset();
    mocks.get.mockImplementation((path: string, options?: { signal?: AbortSignal }) => {
      let resolve!: (value: unknown) => void;
      let reject!: (reason: unknown) => void;
      const promise = new Promise((promiseResolve, promiseReject) => {
        resolve = promiseResolve;
        reject = promiseReject;
      });
      requests.push({ path, signal: options?.signal, resolve, reject });
      return promise;
    });
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  it('publishes only the newest query when responses complete out of order', async () => {
    renderSearch();
    await startSearch('old');
    const oldBatch = requests.slice(0, 4);

    await startSearch('new');
    const newBatch = requests.slice(4, 8);
    expect(oldBatch.every((request) => request.signal?.aborted)).toBe(true);

    await settle(() => resolveBatch(newBatch, 'new'));
    expect(screen.getByText('new')).toBeInTheDocument();

    await settle(() => resolveBatch(oldBatch, 'old'));
    expect(screen.getByText('new')).toBeInTheDocument();
    expect(screen.queryByText('old')).not.toBeInTheDocument();
  });

  it('does not let an obsolete completion clear the current loading state', async () => {
    renderSearch();
    await startSearch('old');
    const oldBatch = requests.slice(0, 4);
    await startSearch('new');

    await settle(() => resolveBatch(oldBatch, 'old'));

    expect(screen.getByRole('status', { name: '' })).toHaveTextContent('Searching');
    expect(document.querySelector('[aria-busy="true"]')).not.toBeNull();
  });

  it('ignores and aborts results from the previous environment', async () => {
    const view = renderSearch();
    await startSearch('tablet');
    const oldEnvironmentBatch = requests.slice(0, 4);

    mocks.environmentId = 'env-2';
    view.rerender(
      <MemoryRouter>
        <GlobalSearch open onClose={vi.fn()} />
      </MemoryRouter>,
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    const newEnvironmentBatch = requests.slice(4, 8);

    expect(oldEnvironmentBatch.every((request) => request.signal?.aborted)).toBe(true);
    expect(newEnvironmentBatch[0].path).toContain('environment_id=env-2');

    await settle(() => resolveBatch(newEnvironmentBatch, 'current'));
    await settle(() => resolveBatch(oldEnvironmentBatch, 'stale'));
    expect(screen.getByText('current')).toBeInTheDocument();
    expect(screen.queryByText('stale')).not.toBeInTheDocument();
  });

  it('aborts pending work and cannot repopulate results after the search closes', async () => {
    const view = renderSearch();
    await startSearch('tablet');
    const pendingBatch = requests.slice(0, 4);

    view.rerender(
      <MemoryRouter>
        <GlobalSearch open={false} onClose={vi.fn()} />
      </MemoryRouter>,
    );
    expect(pendingBatch.every((request) => request.signal?.aborted)).toBe(true);

    await settle(() => resolveBatch(pendingBatch, 'stale'));
    view.rerender(
      <MemoryRouter>
        <GlobalSearch open onClose={vi.fn()} />
      </MemoryRouter>,
    );
    expect(screen.queryByText('stale')).not.toBeInTheDocument();
    expect(screen.getByText(/start typing/i)).toBeInTheDocument();
  });

  it('shows a genuine empty state only when every category succeeds', async () => {
    renderSearch();
    await startSearch('missing');

    await settle(() => resolveBatch(requests.slice(0, 4)));

    expect(screen.getByText(/no results found for/i)).toHaveTextContent('missing');
    expect(screen.queryByText(/search is unavailable/i)).not.toBeInTheDocument();
  });

  it('shows matches and names categories that failed', async () => {
    renderSearch();
    await startSearch('acme');
    const batch = requests.slice(0, 4);

    await settle(() => {
      for (const request of batch) {
        if (request.path.includes('/policies/')) {
          request.reject(new Error('policy search failed'));
        } else if (request.path.includes('/devices/')) {
          resolveBatch([request], 'Acme');
        } else {
          request.resolve(emptyResponse(request.path));
        }
      }
    });

    expect(screen.getByText('Acme')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Some categories could not be searched: Policies.');
    expect(screen.queryByText(/no results found/i)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Retry search' }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    const retryBatch = requests.slice(4, 8);
    await settle(() => resolveBatch(retryBatch, 'Acme recovered'));

    expect(screen.getByText('Acme recovered')).toBeInTheDocument();
    expect(screen.queryByText(/some categories could not be searched/i)).not.toBeInTheDocument();
  });

  it('does not claim no results when a failed category may contain matches', async () => {
    renderSearch();
    await startSearch('unknown');
    const batch = requests.slice(0, 4);

    await settle(() => {
      batch[0].reject(new Error('device search failed'));
      for (const request of batch.slice(1)) request.resolve(emptyResponse(request.path));
    });

    expect(screen.getByRole('status')).toHaveTextContent('No matches in available categories.');
    expect(screen.getByRole('status')).toHaveTextContent('Devices');
    expect(screen.queryByText(/no results found/i)).not.toBeInTheDocument();
  });

  it('shows a retryable unavailable state when every category fails', async () => {
    renderSearch();
    await startSearch('offline');
    const firstBatch = requests.slice(0, 4);

    await settle(() => {
      for (const request of firstBatch) request.reject(new Error('offline'));
    });

    expect(screen.getByRole('alert')).toHaveTextContent('Search is unavailable.');
    expect(screen.queryByText(/no results found/i)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });

    expect(firstBatch.every((request) => request.signal?.aborted)).toBe(true);
    expect(requests).toHaveLength(8);

    await settle(() => resolveBatch(requests.slice(4, 8), 'Recovered'));
    expect(screen.getByText('Recovered')).toBeInTheDocument();
    expect(screen.queryByText(/search is unavailable/i)).not.toBeInTheDocument();
  });
});
