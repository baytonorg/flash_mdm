import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { request } from 'node:http';
import { chmodSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { createWebhookServer, isEntrypoint, readConfig, validateConfig } from '../vps-auto-deploy-webhook.mjs';

const secret = 'test-webhook-secret';
const config = {
  FLASH_AUTO_DEPLOY_WEBHOOK_SECRET: secret,
  FLASH_AUTO_DEPLOY_WEBHOOK_REPOSITORY: 'baytonorg/flash_mdm',
  FLASH_AUTO_DEPLOY_REPO_REF: 'main',
};

function sign(body) {
  return `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
}

async function withWebhook(run) {
  const deployments = [];
  const server = createWebhookServer(config, { startDeployment: (sha) => deployments.push(sha) });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    await run(server.address().port, deployments);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

async function withFailingWebhook(run) {
  const server = createWebhookServer(config, { startDeployment: async () => { throw new Error('systemd unavailable'); } });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    await run(server.address().port);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

function post(port, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = request({
      host: '127.0.0.1', port, method: 'POST', path: '/api/deploy/webhook',
      headers: { 'content-length': body.length, ...headers },
    }, (response) => {
      response.resume();
      response.on('end', () => resolve(response.statusCode));
    });
    req.on('error', reject);
    req.end(body);
  });
}

test('rejects an invalid signature', async () => withWebhook(async (port, deployments) => {
  const body = Buffer.from('{}');
  assert.equal(await post(port, body, { 'x-hub-signature-256': 'sha256=incorrect' }), 401);
  assert.deepEqual(deployments, []);
}));

test('ignores pushes outside the configured repository and branch', async () => withWebhook(async (port, deployments) => {
  const body = Buffer.from(JSON.stringify({ ref: 'refs/heads/feature', repository: { full_name: 'other/flash_mdm' } }));
  assert.equal(await post(port, body, {
    'x-github-event': 'push', 'x-hub-signature-256': sign(body),
  }), 204);
  assert.deepEqual(deployments, []);
}));

test('starts only the exact signed pushed SHA', async () => withWebhook(async (port, deployments) => {
  const sha = 'a'.repeat(40);
  const body = Buffer.from(JSON.stringify({
    ref: 'refs/heads/main', after: sha, repository: { full_name: 'baytonorg/flash_mdm' },
  }));
  assert.equal(await post(port, body, {
    'x-github-event': 'push', 'x-hub-signature-256': sign(body),
  }), 202);
  assert.deepEqual(deployments, [sha]);
}));

test('returns a retryable error when deployment handoff fails', async () => withFailingWebhook(async (port) => {
  const sha = 'b'.repeat(40);
  const body = Buffer.from(JSON.stringify({
    ref: 'refs/heads/main', after: sha, repository: { full_name: 'baytonorg/flash_mdm' },
  }));
  assert.equal(await post(port, body, {
    'x-github-event': 'push', 'x-hub-signature-256': sign(body),
  }), 503);
}));

test('requires a valid after SHA and bounds request bodies', async () => withWebhook(async (port, deployments) => {
  const malformed = Buffer.from('{');
  assert.equal(await post(port, malformed, {
    'x-github-event': 'push', 'x-hub-signature-256': sign(malformed),
  }), 400);
  const oversized = Buffer.alloc(1024 * 1024 + 1, 'x');
  assert.equal(await post(port, oversized, { 'x-hub-signature-256': sign(oversized) }), 413);
  assert.deepEqual(deployments, []);
}));

test('requires an RFC1918 bind address with external Caddy', () => {
  assert.throws(() => validateConfig({ ...config,
    FLASH_AUTO_DEPLOY_EXTERNAL_CADDY: 'true', FLASH_AUTO_DEPLOY_WEBHOOK_BIND_ADDRESS: '0.0.0.0',
  }));
  assert.equal(validateConfig({ ...config,
    FLASH_AUTO_DEPLOY_EXTERNAL_CADDY: 'true', FLASH_AUTO_DEPLOY_WEBHOOK_BIND_ADDRESS: '10.88.0.45',
  }).bindAddress, '10.88.0.45');
});

test('recognises a symlinked systemd entrypoint path', () => {
  assert.equal(isEntrypoint('/opt/flash-mdm/current/scripts/vps-auto-deploy-webhook.mjs'), true);
  assert.equal(isEntrypoint('/tmp/vps-auto-deploy-webhook.test.mjs'), false);
});

test('root launcher rejects non-SHA arguments before invoking systemctl', () => {
  const launcher = fileURLToPath(new URL('../vps-auto-deploy-launcher.sh', import.meta.url));
  const result = spawnSync('bash', [launcher, 'not-a-sha']);
  assert.equal(result.status, 64);
});


test('automatic release verification preserves the protected file and rejects invalid or changed inputs', () => {
  const installer = readFileSync(new URL('../../install.sh', import.meta.url), 'utf8');
  const start = installer.indexOf('verify_auto_deploy_config() {');
  const end = installer.indexOf('\n}\n', start);
  assert.ok(start >= 0 && end > start, 'installer must define the verification function');
  const verify = installer.slice(start, end + 2);
  const directory = mkdtempSync(join(tmpdir(), 'flash-deploy-config-test-'));
  const file = join(directory, 'auto-deploy.env');
  const link = join(directory, 'linked.env');
  const original = 'FLASH_AUTO_DEPLOY_WEBHOOK_SECRET="fixture-only"\n';
  const run = (candidate = file, expected = original, uid = process.getuid()) => spawnSync(
    'bash',
    ['-c', `${verify}
expected_configuration="$4"
render_auto_deploy_config() { printf '%s' "$expected_configuration"; }
verify_auto_deploy_config "$1" "$2" "$3"`, 'fixture', candidate, String(uid), String(process.getgid()), expected],
    { encoding: 'utf8' },
  );
  try {
    chmodSync(directory, 0o750);
    writeFileSync(file, original, { mode: 0o640 });
    const before = statSync(file, { bigint: true });
    assert.equal(run().status, 0);
    assert.equal(run(file, 'other synthetic configuration').status, 1);
    assert.equal(run(file, original, process.getuid() + 1).status, 1);
    assert.equal(run(join(directory, 'missing.env')).status, 1);
    symlinkSync(file, link);
    assert.equal(run(link).status, 1);
    const after = statSync(file, { bigint: true });
    assert.equal(after.ino, before.ino);
    assert.equal(after.mtimeNs, before.mtimeNs);
    assert.equal(after.ctimeNs, before.ctimeNs);
    assert.equal(readFileSync(file, 'utf8'), original);
    chmodSync(file, 0o644);
    assert.equal(run().status, 1);
    chmodSync(file, 0o640);
    chmodSync(directory, 0o755);
    assert.equal(run().status, 1);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});


test('configuration syntax errors do not include stored values', () => {
  const directory = mkdtempSync(join(tmpdir(), 'flash-deploy-parse-test-'));
  const file = join(directory, 'auto-deploy.env');
  try {
    for (const malformed of ['fixture-value-without-assignment', 'FIELD=fixture-value-without-quotes']) {
      writeFileSync(file, malformed, { mode: 0o640 });
      assert.throws(() => readConfig(file), { message: 'Malformed automatic deployment configuration' });
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
