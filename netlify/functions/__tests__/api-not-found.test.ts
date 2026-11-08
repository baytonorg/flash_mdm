import { describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { serveStatic } from '@hono/node-server/serve-static';

vi.mock('../_lib/db.js', () => ({ queryOne: vi.fn() }));

import { queryOne } from '../_lib/db.js';
import apiNotFound from '../api-not-found.ts';
import health from '../health.ts';

const mockQueryOne = vi.mocked(queryOne);

function createRouteOrderFixture() {
  const app = new Hono();
  const notFound = async (request: Request) => apiNotFound(request, {} as never);
  app.use('/api/docs', serveStatic({ root: './public' }));
  app.use('/api/docs/*', serveStatic({ root: './public' }));
  app.all('/api', (c) => notFound(c.req.raw));
  app.all('/api/*', (c) => notFound(c.req.raw));
  app.get('*', (c) => c.html('<!doctype html><title>Flash SPA</title>'));
  return app;
}

describe('API namespace fallback', () => {
  it.each(['GET', 'POST', 'PUT', 'PATCH', 'DELETE'])(
    'returns the same JSON 404 for an unknown %s request',
    async (method) => {
      const response = await createRouteOrderFixture().request('/api/unknown-route', { method });

      expect(response.status).toBe(404);
      expect(response.headers.get('content-type')).toContain('application/json');
      await expect(response.json()).resolves.toEqual({ error: 'Not found' });
    }
  );

  it('rejects the bare API namespace without falling through to the SPA', async () => {
    const response = await createRouteOrderFixture().request('/api');

    expect(response.status).toBe(404);
    expect(response.headers.get('content-type')).toContain('application/json');
    await expect(response.json()).resolves.toEqual({ error: 'Not found' });
  });

  it('does not replace a valid API handler', async () => {
    mockQueryOne.mockResolvedValueOnce({ ok: 1 });
    const response = await health(
      new Request('https://flash.example/api/health'),
      {} as never
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('application/json');
  });

  it('preserves method handling on a known endpoint', async () => {
    const response = await health(
      new Request('https://flash.example/api/health', { method: 'POST' }),
      {} as never
    );

    expect(response.status).toBe(405);
    await expect(response.json()).resolves.toEqual({ error: 'Method not allowed' });
  });

  it('serves the API documentation before the namespace fallback', async () => {
    const app = createRouteOrderFixture();

    const page = await app.request('/api/docs');
    expect(page.status).toBe(200);
    expect(page.headers.get('content-type')).toContain('text/html');
    expect(await page.text()).toContain('<title>Flash MDM API Docs</title>');

    const asset = await app.request('/api/docs/swagger-ui.css');
    expect(asset.status).toBe(200);
    expect(asset.headers.get('content-type')).toContain('text/css');
  });

  it('keeps ordinary browser routes on the SPA fallback', async () => {
    const response = await createRouteOrderFixture().request('/settings/example');

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/html');
    expect(await response.text()).toContain('<title>Flash SPA</title>');
  });
});
