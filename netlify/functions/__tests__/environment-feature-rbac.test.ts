import { beforeEach, expect, it, vi } from 'vitest';
vi.mock('../_lib/db.js', () => ({ queryOne: vi.fn(), execute: vi.fn(), query: vi.fn(), transaction: vi.fn() }));
vi.mock('../_lib/auth.js', () => ({ requireAuth: vi.fn() }));
vi.mock('../_lib/rbac.js', async original => ({ ...await original<typeof import('../_lib/rbac.js')>(), requireEnvironmentPermission: vi.fn() }));
vi.mock('../_lib/audit.js', () => ({ logAudit: vi.fn() }));
import { queryOne, execute } from '../_lib/db.js';
import { requireAuth } from '../_lib/auth.js';
import handler from '../environment-crud.js';
import { environmentFeaturesPreservingRbac } from '../_lib/environment-features.js';

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireAuth).mockResolvedValue({ authType: 'session', user: { id: 'fixture-admin' } } as never);
  vi.mocked(queryOne).mockResolvedValue({ workspace_id: 'fixture-workspace', name: 'Fixture', enterprise_name: null } as never);
});

it.each([
  { feature: true },
  { feature: true, rbac: { permission_matrix: { policy: { assign: 'admin' } } } },
])('uses current-row RBAC preservation for generic feature saves %j', async features => {
  const response = await handler(new Request('http://localhost/api/environments/update', { method: 'PUT', body: JSON.stringify({ id: 'fixture-environment', enterprise_features: features }) }), {} as never);
  expect(response.status).toBe(200);
  expect(execute).toHaveBeenCalledWith(`UPDATE environments SET enterprise_features = ${environmentFeaturesPreservingRbac(1)}, updated_at = now() WHERE id = $2`, [JSON.stringify(features), 'fixture-environment']);
});
