import { chmodSync, mkdtempSync, mkdirSync, readFileSync, readlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { decryptWithKey, encryptWithKey, parseEncryptionKey } from '../_lib/crypto.js';

const repoRoot = resolve(import.meta.dirname, '../../..');
const installer = join(repoRoot, 'install.sh');
const installerLib = join(repoRoot, 'scripts/vps-install-lib.sh');
const scheduledRunner = join(repoRoot, 'scripts/run-vps-scheduled.sh');

describe('VPS installer operational safety', () => {
  it('reads generated environment values without evaluating shell syntax', () => {
    const dir = mkdtempSync(join(tmpdir(), 'flash-env-'));
    const envFile = join(dir, '.env');
    writeFileSync(envFile, 'MIGRATION_SECRET="sentinel-$HOME-`date`"\n');

    const direct = spawnSync('bash', ['-c', 'source "$1"; read_env_value "$2" MIGRATION_SECRET', '_', installerLib, envFile], {
      encoding: 'utf8',
    });

    expect(direct.status).toBe(0);
    expect(direct.stdout).toBe('sentinel-$HOME-`date`');
  });

  it('preserves an upgrade environment byte-for-byte and keeps an encrypted provider canary readable', () => {
    const dir = mkdtempSync(join(tmpdir(), 'flash-upgrade-env-'));
    const envFile = join(dir, '.env');
    const keyText = 'ab'.repeat(32);
    const before = `DATABASE_URL="postgresql://flash:preserved@localhost/flash_mdm"\nENCRYPTION_MASTER_KEY="${keyText}"\nMIGRATION_SECRET="migration-preserved"\nFLASH_BLOB_DIR="/opt/flash-mdm/data/blobs"\n`;
    writeFileSync(envFile, before, { mode: 0o600 });
    const key = parseEncryptionKey(keyText);
    const providerCanary = encryptWithKey(
      JSON.stringify({ type: 'service_account', client_email: 'flash@example.test' }),
      'workspace:provider-canary',
      key
    );

    const upgradeRead = spawnSync(
      'bash',
      ['-c', 'source "$1"; read_env_value "$2" MIGRATION_SECRET', '_', installerLib, envFile],
      { encoding: 'utf8' }
    );

    expect(upgradeRead.status).toBe(0);
    expect(upgradeRead.stdout).toBe('migration-preserved');
    expect(readFileSync(envFile, 'utf8')).toBe(before);
    expect(JSON.parse(decryptWithKey(providerCanary, 'workspace:provider-canary', key))).toMatchObject({
      client_email: 'flash@example.test',
    });
  });

  it('accepts only machine-readable migration responses with zero errors', () => {
    const ok = spawnSync('bash', ['-c', 'source "$1"; printf %s "$2" | migration_response_ok', '_', installerLib, '{"summary":{"errors":0}}']);
    const failed = spawnSync('bash', ['-c', 'source "$1"; printf %s "$2" | migration_response_ok', '_', installerLib, '{"summary":{"errors":1}}']);
    const malformed = spawnSync('bash', ['-c', 'source "$1"; printf %s "$2" | migration_response_ok', '_', installerLib, 'migration applied']);

    expect(ok.status).toBe(0);
    expect(failed.status).not.toBe(0);
    expect(malformed.status).not.toBe(0);
  });

  it('atomically switches and restores the active release link', () => {
    const dir = mkdtempSync(join(tmpdir(), 'flash-release-'));
    const first = join(dir, 'release-1');
    const second = join(dir, 'release-2');
    const current = join(dir, 'current');
    mkdirSync(first);
    mkdirSync(second);

    const result = spawnSync('bash', [
      '-c',
      'source "$1"; activate_release "$2" "$4"; activate_release "$3" "$4"; activate_release "$2" "$4"',
      '_', installerLib, first, second, current,
    ]);

    expect(result.status).toBe(0);
    expect(readlinkSync(current)).toBe(first);
  });

  it('keeps the installer fail-closed and release-based', () => {
    const source = readFileSync(installer, 'utf8');

    expect(source).toContain('Existing .env preserved byte-for-byte');
    expect(source).toContain('PGPASSWORD');
    expect(source).not.toContain('psql -v ON_ERROR_STOP=1 <<SQL || true');
    expect(source).toContain('RELEASES_DIR="$INSTALL_DIR/releases"');
    expect(source).toContain('activate_release "$RELEASE_DIR" "$CURRENT_LINK"');
    expect(source).toContain('sudo systemctl restart flashmdm');
    expect(source).toContain('migration_response_ok');
    expect(source).toContain('FLASH_EXTERNAL_CADDY');
    expect(source).toContain('Skipping container Caddy configuration');
    expect(source).toContain('normalize_schema_ownership');
    expect(source).toContain('Public schema ownership verified');
    expect(source).toContain('TimeoutStopSec=20');
    expect(source).toContain('RELEASE_COMMIT="$(sudo -u "$INSTALL_USER" git -C "$RELEASE_DIR" rev-parse HEAD)"');
    expect(source).not.toMatch(/grep -qi .*applied/);
  });

  it('runs the automatic deployment installer from the signed target commit', () => {
    const autoDeploy = readFileSync(join(repoRoot, 'scripts/vps-auto-deploy.sh'), 'utf8');

    expect(autoDeploy).toContain('git clone --no-checkout "$FLASH_AUTO_DEPLOY_REPO_URL" "$release_source"');
    expect(autoDeploy).toContain('git -C "$release_source" checkout --detach "$remote_sha"');
    expect(autoDeploy).toContain('[[ "$staged_sha" == "$remote_sha" ]]');
    expect(autoDeploy).toContain('installer="$release_source/install.sh"');
    expect(autoDeploy).not.toContain('installer="$current_link/install.sh"');
  });
});

describe('VPS scheduled runner', () => {
  it('rejects unsuccessful JSON and records an operator-visible log', () => {
    const dir = mkdtempSync(join(tmpdir(), 'flash-cron-'));
    const bin = join(dir, 'bin');
    const log = join(dir, 'logger.log');
    mkdirSync(bin);
    writeFileSync(join(bin, 'flock'), '#!/bin/sh\nexit 0\n');
    writeFileSync(join(bin, 'logger'), '#!/bin/sh\nprintf "%s\\n" "$*" >> "$FLASH_TEST_LOG"\n');
    writeFileSync(join(bin, 'curl'), `#!/bin/sh
while [ "$#" -gt 0 ]; do
  if [ "$1" = "--output" ]; then shift; output="$1"; fi
  shift
done
printf '%s' '{"error":"failed"}' > "$output"
`);
    for (const command of ['flock', 'logger', 'curl']) chmodSync(join(bin, command), 0o755);

    const result = spawnSync('bash', [scheduledRunner, 'cleanup-scheduled'], {
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH}`,
        FLASH_TEST_LOG: log,
        FLASH_CRON_LOCK_DIR: join(dir, 'locks'),
      },
    });

    expect(result.status).not.toBe(0);
    expect(readFileSync(log, 'utf8')).toContain('returned an unsuccessful response');
  });
});
