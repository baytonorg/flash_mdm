import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../_lib/db.js', () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
  execute: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock('../_lib/auth.js', () => ({
  requireAuth: vi.fn(),
}));

vi.mock('../_lib/rbac.js', () => ({
  getWorkspaceAccessScopeForAuth: vi.fn(),
  requireEnvironmentPermission: vi.fn(),
  requireWorkspaceResourcePermission: vi.fn(),
}));

vi.mock('../_lib/amapi.js', () => ({
  amapiCall: vi.fn(),
  getAmapiErrorHttpStatus: vi.fn(() => null),
}));

vi.mock('../_lib/audit.js', () => ({
  logAudit: vi.fn(),
}));

import { execute, transaction } from '../_lib/db.js';
import { requireAuth } from '../_lib/auth.js';
import { requireWorkspaceResourcePermission } from '../_lib/rbac.js';
import { logAudit } from '../_lib/audit.js';
import handler from '../environment-crud.ts';

const mockExecute = vi.mocked(execute);
const mockTransaction = vi.mocked(transaction);
const mockRequireAuth = vi.mocked(requireAuth);
const mockRequireWorkspaceResourcePermission = vi.mocked(requireWorkspaceResourcePermission);
const mockLogAudit = vi.mocked(logAudit);

const expectedCreateTables = [
  'environments',
  'environment_memberships',
  'groups',
  'group_closures',
  'group_memberships',
  'policies',
  'policy_versions',
  'policy_assignments',
];

function makeCreateRequest() {
  return new Request('http://localhost/api/environments/create', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ workspace_id: 'ws_1', name: 'Transactional Env' }),
  });
}

function insertedTable(sql: unknown): string | null {
  const match = String(sql).match(/INSERT INTO\s+([a-z_]+)/i);
  return match?.[1] ?? null;
}

describe('environment-crud transactional creation', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockExecute.mockReset();
    mockTransaction.mockReset();
    mockRequireAuth.mockReset();
    mockRequireWorkspaceResourcePermission.mockReset();
    mockLogAudit.mockReset();

    mockRequireAuth.mockResolvedValue({
      authType: 'session',
      sessionId: 'sess_1',
      user: {
        id: 'user_1',
        email: 'user@example.com',
        is_superadmin: true,
      },
    } as never);
    mockRequireWorkspaceResourcePermission.mockResolvedValue('owner' as never);
    mockLogAudit.mockResolvedValue(undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  it('commits the complete environment graph before writing the audit entry', async () => {
    const events: string[] = [];
    const committedSql: string[] = [];

    mockTransaction.mockImplementationOnce(async (callback) => {
      const stagedSql: string[] = [];
      const client = {
        query: vi.fn(async (sql: string) => {
          stagedSql.push(sql);
          return { rows: [], rowCount: 1 };
        }),
      };
      const result = await callback(client as never);
      committedSql.push(...stagedSql);
      events.push('commit');
      return result;
    });
    mockLogAudit.mockImplementationOnce(async () => {
      events.push('audit');
    });

    const response = await handler(makeCreateRequest(), {} as never);

    expect(response.status).toBe(201);
    expect(committedSql.map(insertedTable)).toEqual(expectedCreateTables);
    expect(events).toEqual(['commit', 'audit']);
    expect(mockTransaction).toHaveBeenCalledTimes(1);
    expect(mockExecute).not.toHaveBeenCalled();
    expect(mockLogAudit).toHaveBeenCalledWith(expect.objectContaining({
      action: 'environment.created',
      workspace_id: 'ws_1',
      details: {
        name: 'Transactional Env',
        onboarding_setup_create: false,
      },
    }));
  });

  it.each(expectedCreateTables.map((table, index) => ({ table, index })))(
    'rolls back the complete graph when the $table write fails',
    async ({ table, index }) => {
      const committedSql: string[] = [];
      const clientQuery = vi.fn(async (_sql: string, _params?: unknown[]) => {
        if (clientQuery.mock.calls.length === index + 1) {
          throw new Error(`injected create failure at write ${index + 1}`);
        }
        return { rows: [], rowCount: 1 };
      });

      mockTransaction.mockImplementationOnce(async (callback) => {
        const stagedSql: string[] = [];
        const client = {
          query: vi.fn(async (sql: string, params?: unknown[]) => {
            await clientQuery(sql, params);
            stagedSql.push(sql);
            return { rows: [], rowCount: 1 };
          }),
        };

        try {
          const result = await callback(client as never);
          committedSql.push(...stagedSql);
          return result;
        } catch (error) {
          stagedSql.length = 0;
          throw error;
        }
      });

      const response = await handler(makeCreateRequest(), {} as never);

      expect(response.status).toBe(500);
      await expect(response.json()).resolves.toEqual({ error: 'Internal server error' });
      expect(clientQuery).toHaveBeenCalledTimes(index + 1);
      expect(insertedTable(clientQuery.mock.calls[index]?.[0])).toBe(table);
      expect(committedSql).toEqual([]);
      expect(mockLogAudit).not.toHaveBeenCalled();
      expect(mockExecute).not.toHaveBeenCalled();
    }
  );
});
