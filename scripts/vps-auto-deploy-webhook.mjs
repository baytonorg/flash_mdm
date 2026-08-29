import { execFile } from 'node:child_process';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';

const MAX_BODY_BYTES = 1024 * 1024;

function isPrivateIpv4(address) {
  const octets = address.split('.').map(Number);
  return octets.length === 4 && octets.every((octet) => Number.isInteger(octet) && octet >= 0 && octet <= 255)
    && (octets[0] === 10 || (octets[0] === 192 && octets[1] === 168) || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31));
}

export function readConfig(configPath) {
  return Object.fromEntries(
    readFileSync(configPath, 'utf8')
      .split(/\r?\n/)
      .filter((line) => line && !line.startsWith('#'))
      .map((line) => {
        const index = line.indexOf('=');
        if (index < 1) throw new Error(`Malformed automatic deployment configuration: ${line}`);
        return [line.slice(0, index), JSON.parse(line.slice(index + 1))];
      })
  );
}

export function validateConfig(config) {
  const secret = config.FLASH_AUTO_DEPLOY_WEBHOOK_SECRET;
  const repository = config.FLASH_AUTO_DEPLOY_WEBHOOK_REPOSITORY;
  const configuredRef = config.FLASH_AUTO_DEPLOY_REPO_REF;
  const port = Number(config.FLASH_AUTO_DEPLOY_WEBHOOK_PORT ?? 3101);
  const bindAddress = config.FLASH_AUTO_DEPLOY_WEBHOOK_BIND_ADDRESS ?? '127.0.0.1';
  const externalCaddy = config.FLASH_AUTO_DEPLOY_EXTERNAL_CADDY === 'true';
  if (!secret || !repository || !configuredRef || !bindAddress || !Number.isInteger(port) || port < 1 || port > 65535
    || (externalCaddy && !isPrivateIpv4(bindAddress))) {
    throw new Error('Invalid automatic deployment webhook configuration');
  }
  return {
    bindAddress,
    port,
    repository,
    ref: configuredRef.startsWith('refs/') ? configuredRef : `refs/heads/${configuredRef}`,
    secret,
  };
}

export function signatureIsValid(body, signature, secret) {
  if (typeof signature !== 'string' || !signature.startsWith('sha256=')) return false;
  const expected = Buffer.from(`sha256=${createHmac('sha256', secret).update(body).digest('hex')}`);
  const received = Buffer.from(signature);
  return expected.length === received.length && timingSafeEqual(expected, received);
}

export function isEntrypoint(argvPath = process.argv[1]) {
  return typeof argvPath === 'string' && argvPath.endsWith('/vps-auto-deploy-webhook.mjs');
}

function defaultStartDeployment(sha) {
  execFile('/usr/bin/sudo', ['/usr/local/libexec/flashmdm-auto-deploy-launcher', sha], (error) => {
    if (error) console.error('Could not start Flash MDM deployment:', error.message);
  });
}

export function createWebhookServer(config, { startDeployment = defaultStartDeployment } = {}) {
  const { secret, repository, ref } = validateConfig(config);
  const server = createServer((request, response) => {
    if (request.method !== 'POST' || request.url !== '/api/deploy/webhook') {
      response.writeHead(404).end();
      return;
    }

    const chunks = [];
    let length = 0;
    let tooLarge = false;
    request.on('data', (chunk) => {
      length += chunk.length;
      if (length > MAX_BODY_BYTES) {
        tooLarge = true;
        request.resume();
      } else {
        chunks.push(chunk);
      }
    });
    request.on('end', () => {
      if (tooLarge) {
        response.writeHead(413).end();
        return;
      }
      const body = Buffer.concat(chunks);
      if (!signatureIsValid(body, request.headers['x-hub-signature-256'], secret)) {
        response.writeHead(401).end();
        return;
      }
      if (request.headers['x-github-event'] !== 'push') {
        response.writeHead(204).end();
        return;
      }
      let payload;
      try {
        payload = JSON.parse(body.toString('utf8'));
      } catch {
        response.writeHead(400).end();
        return;
      }
      if (payload.ref !== ref || payload.repository?.full_name !== repository) {
        response.writeHead(204).end();
        return;
      }
      if (typeof payload.after !== 'string' || !/^[0-9a-f]{40}$/i.test(payload.after)) {
        response.writeHead(400).end();
        return;
      }
      startDeployment(payload.after.toLowerCase());
      response.writeHead(202).end();
    });
  });
  server.requestTimeout = 15_000;
  server.headersTimeout = 10_000;
  server.keepAliveTimeout = 5_000;
  return server;
}

if (isEntrypoint()) {
  const configPath = process.env.FLASH_AUTO_DEPLOY_CONFIG_FILE ?? '/etc/flash-mdm/auto-deploy.env';
  const config = readConfig(configPath);
  const { bindAddress, port } = validateConfig(config);
  createWebhookServer(config).listen(port, bindAddress, () => {
    console.log(`Flash MDM deployment webhook listening on ${bindAddress}:${port}`);
  });
}
