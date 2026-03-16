import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../_lib/db.js', () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock('../_lib/auth.js', () => ({
  requireAuth: vi.fn(),
}));

vi.mock('../_lib/rbac.js', () => ({
  requireEnvironmentPermission: vi.fn(),
}));

vi.mock('../_lib/amapi.js', () => ({
  amapiCall: vi.fn(),
}));

vi.mock('../_lib/audit.js', () => ({
  logAudit: vi.fn(),
}));

import { query, queryOne, transaction } from '../_lib/db.js';
import { requireAuth } from '../_lib/auth.js';
import { requireEnvironmentPermission } from '../_lib/rbac.js';
import { amapiCall } from '../_lib/amapi.js';
import { logAudit } from '../_lib/audit.js';
import handler from '../enrollment-sync.ts';

const mockQuery = vi.mocked(query);
const mockQueryOne = vi.mocked(queryOne);
const mockTransaction = vi.mocked(transaction);
const mockRequireAuth = vi.mocked(requireAuth);
const mockRequireEnvironmentPermission = vi.mocked(requireEnvironmentPermission);
const mockAmapiCall = vi.mocked(amapiCall);
const mockLogAudit = vi.mocked(logAudit);

describe('enrollment-sync stale token handling', () => {
  let txClient: { query: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    mockQuery.mockReset();
    mockQueryOne.mockReset();
    mockTransaction.mockReset();
    mockRequireAuth.mockReset();
    mockRequireEnvironmentPermission.mockReset();
    mockAmapiCall.mockReset();
    mockLogAudit.mockReset();

    mockRequireAuth.mockResolvedValue({ user: { id: 'user_1' } } as never);
    mockRequireEnvironmentPermission.mockResolvedValue('admin' as never);
    mockQueryOne
      .mockResolvedValueOnce({
        id: 'env_1',
        workspace_id: 'ws_1',
        enterprise_name: 'enterprises/e1',
      } as never)
      .mockResolvedValueOnce({ gcp_project_id: 'proj_1' } as never);
    mockAmapiCall.mockResolvedValue({ enrollmentTokens: [], nextPageToken: undefined } as never);
    mockQuery.mockResolvedValue([{ id: 'tok_1', amapi_name: 'enterprises/e1/enrollmentTokens/t1' }] as never);
    txClient = { query: vi.fn().mockResolvedValue({ rows: [], rowCount: 1 }) };
    mockTransaction.mockImplementation(async (cb: any) => {
      return cb(txClient);
    });
    mockLogAudit.mockResolvedValue(undefined as never);
  });

  it('retires stale local tokens instead of deleting them immediately', async () => {
    const res = await handler(
      new Request('http://localhost/.netlify/functions/enrolment/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ environment_id: 'env_1' }),
      })
    );

    expect(res.status).toBe(200);

    const sqlCalls = txClient.query.mock.calls.map((call) => String(call[0]));
    expect(sqlCalls.some((sql) => sql.startsWith('DELETE FROM enrollment_tokens'))).toBe(false);

    const retireCall = txClient.query.mock.calls.find((call) =>
      String(call[0]).includes('UPDATE enrollment_tokens') &&
      String(call[0]).includes('amapi_value = NULL') &&
      String(call[0]).includes('expires_at = COALESCE(LEAST(expires_at, now()), now())')
    );
    expect(retireCall).toBeDefined();
  });
});
