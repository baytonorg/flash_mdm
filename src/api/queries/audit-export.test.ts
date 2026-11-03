import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../client', () => ({ apiClient: { get: vi.fn() } }));
import { apiClient } from '../client';
import { collectEnvironmentAuditExport } from './audit';
const get = vi.mocked(apiClient.get);
beforeEach(() => get.mockReset());
describe('environment audit export', () => {
  it('downloads every page with the same cutoff and environment', async () => {
    get.mockResolvedValueOnce({ entries: [{ id: 'first' }], total: 2 }).mockResolvedValueOnce({ entries: [{ id: 'second' }], total: 2 });
    const result = await collectEnvironmentAuditExport('env_1', 'Example');
    expect(result.entries.map((entry) => entry.id)).toEqual(['first', 'second']);
    const urls = get.mock.calls.map(([path]) => new URL(path, 'http://localhost'));
    expect(urls.map((url) => url.searchParams.get('page'))).toEqual(['1', '2']);
    for (const url of urls) {
      expect(url.searchParams.get('environment_id')).toBe('env_1');
      expect(url.searchParams.get('date_to')).toBe(result.through);
      expect(url.searchParams.get('export')).toBe('true');
    }
  });
  it('fails instead of producing a partial export on a failed page', async () => {
    get.mockResolvedValueOnce({ entries: [{ id: 'first' }], total: 2 }).mockRejectedValueOnce(new Error('Network failure'));
    await expect(collectEnvironmentAuditExport('env_1', 'Example')).rejects.toThrow('Network failure');
  });
  it('fails when history changes during pagination', async () => {
    get.mockResolvedValueOnce({ entries: [{ id: 'first' }], total: 2 }).mockResolvedValueOnce({ entries: [], total: 1 });
    await expect(collectEnvironmentAuditExport('env_1', 'Example')).rejects.toThrow('changed during export');
  });
});
