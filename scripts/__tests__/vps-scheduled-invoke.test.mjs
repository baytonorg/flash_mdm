import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { invokeScheduledEndpoint, readEnvValue } from '../invoke-vps-scheduled.mjs';

async function withServer(handler, run) {
  const server = createServer(handler);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    await run(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test('loads only the protected internal secret and authenticates the scheduled request', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'flash-scheduled-'));
  const envFile = join(directory, '.env');
  const responseFile = join(directory, 'response.json');
  await writeFile(envFile, 'INTERNAL_FUNCTION_SECRET="fixture-secret"\nOTHER_VALUE="ignored"\n', { mode: 0o600 });
  try {
    await withServer((request, response) => {
      assert.equal(request.url, '/api/sync-reconcile-scheduled');
      assert.equal(request.headers['x-internal-secret'], 'fixture-secret');
      response.setHeader('content-type', 'application/json');
      response.end('{"message":"ok","stats":{"errors":0}}');
    }, async (origin) => {
      await invokeScheduledEndpoint({
        endpoint: 'sync-reconcile-scheduled',
        responseFile,
        timeoutMs: 1000,
        envFile,
        origin,
      });
    });
    assert.equal(await readFile(responseFile, 'utf8'), '{"message":"ok","stats":{"errors":0}}');
    assert.equal(await readEnvValue(envFile, 'INTERNAL_FUNCTION_SECRET'), 'fixture-secret');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('fails closed before HTTP when the internal secret is missing', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'flash-scheduled-'));
  const envFile = join(directory, '.env');
  const responseFile = join(directory, 'response.json');
  await writeFile(envFile, 'OTHER_VALUE="fixture"\n', { mode: 0o600 });
  try {
    await assert.rejects(
      invokeScheduledEndpoint({
        endpoint: 'cleanup-scheduled',
        responseFile,
        timeoutMs: 1000,
        envFile,
        origin: 'http://127.0.0.1:1',
      }),
      /Required runtime setting INTERNAL_FUNCTION_SECRET is missing/
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('rejects unknown endpoints without loading or sending a credential', async () => {
  await assert.rejects(
    invokeScheduledEndpoint({
      endpoint: '../health',
      responseFile: '/tmp/unused-flash-scheduled-response',
      timeoutMs: 1000,
      envFile: '/tmp/unused-flash-scheduled-env',
    }),
    /Unknown scheduled endpoint/
  );
});

test('refuses redirects without forwarding the internal credential', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'flash-scheduled-'));
  const envFile = join(directory, '.env');
  const responseFile = join(directory, 'response.json');
  let redirectedRequestSeen = false;
  await writeFile(envFile, 'INTERNAL_FUNCTION_SECRET="fixture-secret"\n', { mode: 0o600 });
  try {
    await withServer((request, response) => {
      if (request.url === '/redirect-target') {
        redirectedRequestSeen = true;
        response.end('unexpected');
        return;
      }
      response.statusCode = 302;
      response.setHeader('location', '/redirect-target');
      response.end();
    }, async (origin) => {
      await assert.rejects(
        invokeScheduledEndpoint({
          endpoint: 'sync-reconcile-scheduled',
          responseFile,
          timeoutMs: 1000,
          envFile,
          origin,
        }),
        /fetch failed/
      );
    });
    assert.equal(redirectedRequestSeen, false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
