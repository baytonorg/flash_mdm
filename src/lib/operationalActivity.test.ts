import { afterEach, expect, it, vi } from 'vitest';
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
it('keeps queued browser evidence from crossing login, logout or impersonation identities', async () => {
  vi.useFakeTimers();
  const batches: Array<{ events: Array<{ kind: string }>; dropped: number }> = [];
  vi.stubGlobal('fetch', vi.fn(async (path: string, init?: RequestInit) => {
    if (path === '/api/auth/config') return Response.json({ operational_trace_enabled: true });
    batches.push(JSON.parse(String(init?.body))); return new Response(null, { status: 204 });
  }));
  const { installOperationalActivity, recordActivity, withActivityIdentityBoundary } = await import('./operationalActivity');
  installOperationalActivity();
  await vi.advanceTimersByTimeAsync(0);
  recordActivity('change');
  let finish!: () => void;
  const boundary = withActivityIdentityBoundary(async () => { await new Promise<void>(resolve => { finish = resolve; }); return 'unchanged-result'; });
  recordActivity('submit');
  finish(); expect(await boundary).toBe('unchanged-result');
  recordActivity('click');
  await vi.advanceTimersByTimeAsync(5000);
  expect(batches[0].events.some(event => event.kind === 'change')).toBe(true);
  expect(batches[1].events.map(event => event.kind)).toEqual(['click']);
  expect(batches[1].dropped).toBe(1);
});
