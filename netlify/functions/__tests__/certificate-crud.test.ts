import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TEST_CA_PEM, TEST_NON_CA_PEM } from './fixtures/test-certificates.js';

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  queryOne: vi.fn(),
  transaction: vi.fn(),
  requireAuth: vi.fn(),
  requirePermission: vi.fn(),
  logAudit: vi.fn(),
  storeBlob: vi.fn(),
  deleteBlob: vi.fn(),
}));

vi.mock('../_lib/db.js', () => ({ query: mocks.query, queryOne: mocks.queryOne, transaction: mocks.transaction }));
vi.mock('../_lib/auth.js', () => ({ requireAuth: mocks.requireAuth }));
vi.mock('../_lib/rbac.js', () => ({ requireEnvironmentResourcePermission: mocks.requirePermission }));
vi.mock('../_lib/audit.js', () => ({ logAudit: mocks.logAudit }));
vi.mock('../_lib/blobs.js', () => ({ storeBlob: mocks.storeBlob, deleteBlob: mocks.deleteBlob }));

import handler from '../certificate-crud.ts';

function request(path: string, init?: RequestInit) {
  return new Request(`http://localhost${path}`, init);
}

describe('certificate-crud', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAuth.mockResolvedValue({ user: { id: 'user_1' } });
    mocks.requirePermission.mockResolvedValue(undefined);
    mocks.logAudit.mockResolvedValue(undefined);
    mocks.storeBlob.mockResolvedValue(undefined);
    mocks.deleteBlob.mockResolvedValue(undefined);
    mocks.transaction.mockImplementation(async (fn: (client: { query: ReturnType<typeof vi.fn> }) => unknown) => (
      fn({ query: vi.fn().mockResolvedValue({ rows: [], rowCount: 1 }) })
    ));
  });

  it('lists metadata with deterministic ONC GUIDs and never returns certificate data', async () => {
    mocks.query.mockResolvedValueOnce([{
      id: 'cert_1', environment_id: 'env_1', name: 'Corporate Root', cert_type: 'server_ca',
      fingerprint_sha256: 'AA:BB', not_after: '2036-08-25T19:53:58.000Z',
    }]);

    const response = await handler(request('/api/certificates/list?environment_id=env_1'), {} as never);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.certificates[0]).toMatchObject({ id: 'cert_1', onc_guid: 'flash-ca-cert_1' });
    expect(body.certificates[0]).not.toHaveProperty('cert_data');
    expect(String(mocks.query.mock.calls[0]?.[0])).toContain('validated_at IS NOT NULL');
    expect(mocks.requirePermission).toHaveBeenCalledWith(expect.anything(), 'env_1', 'certificate', 'read');
  });

  it('uploads a validated environment-owned server CA', async () => {
    mocks.queryOne.mockResolvedValueOnce(null);
    const clientQuery = vi.fn().mockResolvedValue({ rows: [], rowCount: 1 });
    mocks.transaction.mockImplementationOnce(async (fn: (client: { query: typeof clientQuery }) => unknown) => fn({ query: clientQuery }));

    const response = await handler(request('/api/certificates/upload', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ environment_id: 'env_1', name: 'Corporate Root', cert_data: TEST_CA_PEM }),
    }), {} as never);
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.certificate).toMatchObject({ name: 'Corporate Root', cert_type: 'server_ca' });
    expect(body.certificate.onc_guid).toMatch(/^flash-ca-/);
    expect(mocks.storeBlob).toHaveBeenCalledWith('certificates', expect.stringMatching(/^env_1\/.+\.pem$/), expect.stringContaining('BEGIN CERTIFICATE'), expect.any(Object));
    expect(String(clientQuery.mock.calls[0]?.[0])).toContain('validated_at');
    expect(String(clientQuery.mock.calls[0]?.[0])).toContain("'environment', $2");
  });

  it('rejects a blank name before writing storage', async () => {
    const response = await handler(request('/api/certificates/upload', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ environment_id: 'env_1', name: '   ', cert_data: TEST_CA_PEM }),
    }), {} as never);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: 'name must not be blank' });
    expect(mocks.storeBlob).not.toHaveBeenCalled();
  });

  it('rejects non-CA certificates before writing storage', async () => {
    const response = await handler(request('/api/certificates/upload', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ environment_id: 'env_1', name: 'Leaf', cert_data: TEST_NON_CA_PEM }),
    }), {} as never);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: 'Certificate must be a CA certificate suitable for Wi-Fi server trust' });
    expect(mocks.storeBlob).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it('returns a conflict and removes its blob when a concurrent duplicate wins', async () => {
    mocks.queryOne.mockResolvedValueOnce(null);
    mocks.transaction.mockRejectedValueOnce(Object.assign(new Error('duplicate'), { code: '23505' }));

    const response = await handler(request('/api/certificates/upload', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ environment_id: 'env_1', name: 'Corporate Root', cert_data: TEST_CA_PEM }),
    }), {} as never);

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: 'A certificate with this fingerprint already exists in this environment',
    });
    expect(mocks.deleteBlob).toHaveBeenCalledWith(
      'certificates',
      expect.stringMatching(/^env_1\/.+\.pem$/)
    );
  });

  it('blocks deletion while a Wi-Fi profile references the certificate', async () => {
    mocks.queryOne.mockResolvedValueOnce({ id: 'cert_1', environment_id: 'env_1', blob_key: 'env_1/cert_1.pem', name: 'Root' });
    mocks.query.mockResolvedValueOnce([{
      id: 'net_1', name: 'Enterprise Wi-Fi',
      onc_profile: { NetworkConfigurations: [{ WiFi: { EAP: { ServerCARefs: ['flash-ca-cert_1'] } } }] },
    }]);

    const response = await handler(request('/api/certificates/cert_1', { method: 'DELETE' }), {} as never);

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: 'Certificate is referenced by one or more Wi-Fi profiles',
      references: [{ id: 'net_1', name: 'Enterprise Wi-Fi' }],
    });
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.deleteBlob).not.toHaveBeenCalled();
  });

  it('soft-deletes an unreferenced certificate and removes its blob', async () => {
    mocks.queryOne.mockResolvedValueOnce({ id: 'cert_1', environment_id: 'env_1', blob_key: 'env_1/cert_1.pem', name: 'Root' });
    mocks.query.mockResolvedValueOnce([]);

    const response = await handler(request('/api/certificates/cert_1', { method: 'DELETE' }), {} as never);

    expect(response.status).toBe(200);
    expect(mocks.transaction).toHaveBeenCalledOnce();
    expect(mocks.deleteBlob).toHaveBeenCalledWith('certificates', 'env_1/cert_1.pem');
  });

  it('masks unexpected internal errors with a generic 500 response', async () => {
    mocks.requireAuth.mockRejectedValueOnce(new Error('relation "certificates" does not exist'));
    const response = await handler(request('/api/certificates/list?environment_id=env_1'), {} as never);
    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: 'Internal server error' });
  });
});
