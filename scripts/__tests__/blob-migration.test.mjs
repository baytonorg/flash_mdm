import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  createArchive,
  importArchive,
  localBlobPath,
  verifyLocalArchive,
} from '../lib/blob-migration.mjs';

async function tempDir(prefix) {
  return mkdtemp(path.join(os.tmpdir(), prefix));
}

test('exports, dry-runs, imports, and verifies bytes, keys, and metadata', async (t) => {
  const parent = await tempDir('flash-blob-migration-');
  t.after(() => rm(parent, { recursive: true, force: true }));
  const archive = path.join(parent, 'archive');
  const blobRoot = path.join(parent, 'local-blobs');
  const entries = [
    { store: 'exports', key: 'reports/daily.csv', data: Buffer.from('a,b\n1,2\n'), metadata: { format: 'csv' } },
    { store: 'certificates', key: 'org/root.pem', data: Buffer.from([0, 1, 2, 255]), metadata: { kind: 'root' } },
  ];

  assert.deepEqual(await createArchive(archive, entries, '2026-08-30T00:00:00.000Z'), {
    stores: 2,
    objects: 2,
    bytes: 12,
  });
  assert.deepEqual(await importArchive(archive, blobRoot), {
    stores: 2,
    objects: 2,
    bytes: 12,
    executed: false,
  });
  await assert.rejects(readFile(localBlobPath(blobRoot, 'exports', 'reports/daily.csv')));

  await importArchive(archive, blobRoot, { execute: true });
  assert.equal(await readFile(localBlobPath(blobRoot, 'exports', 'reports/daily.csv'), 'utf8'), 'a,b\n1,2\n');
  assert.deepEqual(
    JSON.parse(await readFile(`${localBlobPath(blobRoot, 'exports', 'reports/daily.csv')}.metadata.json`, 'utf8')),
    { format: 'csv' }
  );
  assert.deepEqual(await verifyLocalArchive(archive, blobRoot), { stores: 2, objects: 2, bytes: 12 });
});

test('detects archive corruption and refuses local overwrite', async (t) => {
  const parent = await tempDir('flash-blob-integrity-');
  t.after(() => rm(parent, { recursive: true, force: true }));
  const archive = path.join(parent, 'archive');
  const blobRoot = path.join(parent, 'local-blobs');
  await createArchive(archive, [{ store: 'usage-logs', key: 'one', data: 'original', metadata: {} }]);
  await importArchive(archive, blobRoot, { execute: true });
  await assert.rejects(importArchive(archive, blobRoot, { execute: true }), /existing blob directory/);

  const manifest = JSON.parse(await readFile(path.join(archive, 'manifest.json'), 'utf8'));
  await writeFile(path.join(archive, manifest.stores[0].objects[0].object_path), 'tampered');
  await assert.rejects(verifyLocalArchive(archive, blobRoot), /Checksum mismatch/);
});
