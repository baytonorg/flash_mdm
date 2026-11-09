import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const ALLOWED_ENDPOINTS = new Set([
  'cleanup-scheduled',
  'geofence-check-scheduled',
  'licensing-reconcile-scheduled',
  'sync-reconcile-scheduled',
  'workflow-cron-scheduled',
]);

export async function readEnvValue(envFile, key) {
  const line = (await readFile(envFile, 'utf8'))
    .split(/\r?\n/)
    .find((candidate) => candidate.startsWith(`${key}=`));
  if (!line) throw new Error(`Required runtime setting ${key} is missing`);
  let value = line.slice(key.length + 1).trim();
  if (value.startsWith('"') && value.endsWith('"')) {
    value = value.slice(1, -1).replace(/\\([\\"$`])/g, '$1');
  }
  if (!value) throw new Error(`Required runtime setting ${key} is empty`);
  return value;
}

export async function invokeScheduledEndpoint({
  endpoint,
  responseFile,
  timeoutMs,
  envFile,
  origin = 'http://127.0.0.1:3000',
}) {
  if (!ALLOWED_ENDPOINTS.has(endpoint)) throw new Error('Unknown scheduled endpoint');
  if (!responseFile) throw new Error('Scheduled response file is required');
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 3_600_000) {
    throw new Error('Invalid scheduled request timeout');
  }

  const secret = await readEnvValue(envFile, 'INTERNAL_FUNCTION_SECRET');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  timeout.unref();
  try {
    const response = await fetch(`${origin}/api/${endpoint}`, {
      headers: { 'x-internal-secret': secret },
      redirect: 'error',
      signal: controller.signal,
    });
    const body = await response.text();
    await writeFile(responseFile, body, { mode: 0o600 });
    if (!response.ok) throw new Error(`Scheduled endpoint returned HTTP ${response.status}`);
  } finally {
    clearTimeout(timeout);
  }
}

export function isEntrypoint(argvPath = process.argv[1]) {
  return typeof argvPath === 'string' && argvPath.endsWith('/invoke-vps-scheduled.mjs');
}

if (isEntrypoint()) {
  const [endpoint, responseFile, timeoutSecondsText] = process.argv.slice(2);
  const timeoutSeconds = Number(timeoutSecondsText);
  const envFile = process.env.FLASH_RUNTIME_ENV_FILE
    ?? resolve(import.meta.dirname, '..', '.env');
  try {
    await invokeScheduledEndpoint({
      endpoint,
      responseFile,
      timeoutMs: timeoutSeconds * 1000,
      envFile,
    });
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Scheduled endpoint invocation failed');
    process.exitCode = 1;
  }
}
