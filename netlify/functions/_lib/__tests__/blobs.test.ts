import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cpSync, existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';

const originalCwd = process.cwd();
const originalEnv = { ...process.env };

function resetEnv() {
  process.env = { ...originalEnv };
  delete process.env.FLASH_BLOB_DIR;
  delete process.env.NETLIFY;
  delete process.env.NETLIFY_LOCAL;
}

async function importBlobs() {
  vi.resetModules();
  return import('../blobs.js');
}

describe('blob storage runtime selection', () => {
  let tmpDirs: string[] = [];

  beforeEach(() => {
    resetEnv();
    vi.doUnmock('@netlify/blobs');
  });

  afterEach(() => {
    process.chdir(originalCwd);
    resetEnv();
    vi.resetModules();
    vi.clearAllMocks();
    for (const dir of tmpDirs) {
      rmSync(dir, { recursive: true, force: true });
    }
    tmpDirs = [];
  });

  function tempDir(prefix: string): string {
    const dir = mkdtempSync(path.join(os.tmpdir(), prefix));
    tmpDirs.push(dir);
    return dir;
  }

  it('uses an absolute FLASH_BLOB_DIR without nesting it under process.cwd()', async () => {
    const cwd = tempDir('flash-blob-cwd-');
    const blobRoot = tempDir('flash-blob-root-');
    process.chdir(cwd);
    process.env.NODE_ENV = 'production';
    process.env.FLASH_BLOB_DIR = blobRoot;

    const { deleteBlob, getBlob, storeBlob } = await importBlobs();
    await storeBlob('exports', 'reports/daily.csv', 'report-body', { format: 'csv' });

    const expectedPath = path.join(
      blobRoot,
      'exports',
      createHash('sha256').update('reports/daily.csv').digest('hex')
    );
    expect(existsSync(expectedPath)).toBe(true);
    expect(existsSync(path.join(cwd, blobRoot.replace(/^\/+/, '')))).toBe(false);
    await expect(getBlob('exports', 'reports/daily.csv')).resolves.toBe('report-body');

    await deleteBlob('exports', 'reports/daily.csv');
    await expect(getBlob('exports', 'reports/daily.csv')).resolves.toBeNull();
  });

  it('defaults to local file blobs for non-Netlify production installs', async () => {
    const cwd = tempDir('flash-blob-production-');
    process.chdir(cwd);
    process.env.NODE_ENV = 'production';

    const { getBlob, storeBlob } = await importBlobs();
    await storeBlob('certificates', 'cert.pem', 'pem-body');

    expect(readdirSync(path.join(cwd, '.flash-blobs', 'certificates'))).toHaveLength(1);
    await expect(getBlob('certificates', 'cert.pem')).resolves.toBe('pem-body');
  });

  it('restores local blob data and metadata from a directory backup', async () => {
    const sourceRoot = tempDir('flash-blob-source-');
    const backupParent = tempDir('flash-blob-backup-');
    const restoreParent = tempDir('flash-blob-restore-');
    const backupRoot = path.join(backupParent, 'flash-blobs');
    const restoredRoot = path.join(restoreParent, 'flash-blobs');
    process.env.NODE_ENV = 'production';
    process.env.FLASH_BLOB_DIR = sourceRoot;

    const source = await importBlobs();
    await source.storeBlob('exports', 'reports/monthly.csv', 'restorable-report', { format: 'csv' });
    cpSync(sourceRoot, backupRoot, { recursive: true, preserveTimestamps: true });
    cpSync(backupRoot, restoredRoot, { recursive: true, preserveTimestamps: true });

    process.env.FLASH_BLOB_DIR = restoredRoot;
    const restored = await importBlobs();
    await expect(restored.getBlob('exports', 'reports/monthly.csv')).resolves.toBe('restorable-report');

    const restoredObject = path.join(
      restoredRoot,
      'exports',
      createHash('sha256').update('reports/monthly.csv').digest('hex')
    );
    expect(existsSync(`${restoredObject}.metadata.json`)).toBe(true);
  });

  it('keeps Netlify runtime on Netlify Blobs when no local blob dir is configured', async () => {
    const set = vi.fn();
    const get = vi.fn().mockResolvedValue('from-netlify');
    const del = vi.fn();
    const getStore = vi.fn(() => ({ set, get, delete: del }));
    vi.doMock('@netlify/blobs', () => ({ getStore }));
    process.env.NODE_ENV = 'production';
    process.env.NETLIFY = 'true';

    const { deleteBlob, getBlob, storeBlob } = await importBlobs();

    await storeBlob('exports', 'key', 'body');
    await expect(getBlob('exports', 'key')).resolves.toBe('from-netlify');
    await deleteBlob('exports', 'key');

    expect(getStore).toHaveBeenCalledWith({ name: 'exports', consistency: 'eventual' });
    expect(set).toHaveBeenCalledWith('key', 'body', { metadata: undefined });
    expect(get).toHaveBeenCalledWith('key', { type: 'text' });
    expect(del).toHaveBeenCalledWith('key');
  });
});
