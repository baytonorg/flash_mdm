import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { request } from 'node:http';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { createWebhookServer, isEntrypoint, validateConfig } from '../vps-auto-deploy-webhook.mjs';

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
