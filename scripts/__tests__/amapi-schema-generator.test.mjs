import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import test from 'node:test';

const generator = resolve('scripts/generate-amapi-policy-schema.mjs');

function discovery(revision, propertyName) {
  return {
    id: 'androidmanagement:v1',
    revision,
    schemas: {
      Policy: {
        type: 'object',
        properties: {
          [propertyName]: { type: 'boolean' },
        },
      },
    },
  };
}

async function withDiscoveryServer(responses, callback) {
  let requestIndex = 0;
  const server = createServer((_request, response) => {
    const body = responses[requestIndex % responses.length];
    requestIndex += 1;
    if (body.httpStatus) {
      response.writeHead(body.httpStatus);
      response.end();
      return;
    }
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify(body));
  });
  await new Promise((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
  try {
    const address = server.address();
    assert(address && typeof address === 'object');
    await callback(`http://127.0.0.1:${address.port}/discovery`);
  } finally {
    await new Promise((resolveClose) => server.close(resolveClose));
  }
}

function runGenerator(args, url, attempts) {
  return new Promise((resolveRun) => {
    const child = spawn(process.execPath, [generator, ...args], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        AMAPI_DISCOVERY_URL: url,
        AMAPI_DISCOVERY_FETCH_ATTEMPTS: String(attempts),
      },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('close', (status) => resolveRun({ status, stdout, stderr }));
  });
}

test('selects the highest revision during a rolling Discovery rollout', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'flash-amapi-schema-'));
  const output = join(directory, 'schema.ts');
  try {
    await withDiscoveryServer([
      { httpStatus: 503 },
      discovery('20260917', 'olderField'),
      discovery('20260928', 'newerField'),
    ], async (url) => {
      const result = await runGenerator(['--output', output], url, 6);
      assert.equal(result.status, 0, result.stderr);
      const generated = await readFile(output, 'utf8');
      assert.match(generated, /"revision": "20260928"/);
      assert.match(generated, /"newerField"/);
      assert.doesNotMatch(generated, /"olderField"/);
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('does not fail or downgrade when sampled responses lag the checked-in revision', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'flash-amapi-schema-'));
  const output = join(directory, 'schema.ts');
  try {
    await withDiscoveryServer([discovery('20260928', 'newerField')], async (url) => {
      const update = await runGenerator(['--output', output], url, 2);
      assert.equal(update.status, 0, update.stderr);
    });
    const before = await readFile(output, 'utf8');

    await withDiscoveryServer([discovery('20260917', 'olderField')], async (url) => {
      const check = await runGenerator(['--check', '--output', output], url, 2);
      assert.equal(check.status, 0, check.stderr);
      assert.match(check.stdout, /refusing to downgrade/);

      const update = await runGenerator(['--output', output], url, 2);
      assert.equal(update.status, 0, update.stderr);
      assert.match(update.stdout, /refusing to downgrade/);
    });

    assert.equal(await readFile(output, 'utf8'), before);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
