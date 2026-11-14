import { createHash } from 'node:crypto';
import { lstat, mkdir, mkdtemp, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const ARCHIVE_FORMAT = 'flash-mdm-blob-archive-v1';

export function sha256(data) {
  return createHash('sha256').update(data).digest('hex');
}

export function localBlobPath(root, store, key) {
  return path.join(root, storeDirectoryName(store), sha256(key));
}

function storeDirectoryName(store) {
  if (typeof store !== 'string' || !store || store === '.' || store === '..') {
    throw new Error('Invalid blob store name');
  }
  return encodeURIComponent(store);
}

async function privateStagingDirectory(destination) {
  const parent = path.dirname(destination);
  await mkdir(parent, { recursive: true, mode: 0o700 });
  return mkdtemp(path.join(parent, `.${path.basename(destination)}.tmp-`));
}

async function exists(filePath) {
  try {
    await lstat(filePath);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

function assertAbsolute(label, value) {
  if (!path.isAbsolute(value)) throw new Error(`${label} must be an absolute path`);
}

function normalizeMetadata(metadata) {
  if (metadata === null || metadata === undefined) return {};
  if (typeof metadata !== 'object' || Array.isArray(metadata)) throw new Error('Blob metadata must be an object');
  return metadata;
}

export async function createArchive(archiveDir, entries, createdAt = new Date().toISOString()) {
  assertAbsolute('archive directory', archiveDir);
  if (await exists(archiveDir)) throw new Error(`Archive destination already exists: ${archiveDir}`);

  const temporaryDir = await privateStagingDirectory(archiveDir);

  const stores = new Map();
  try {
    await mkdir(path.join(temporaryDir, 'objects'), { mode: 0o700 });
    for await (const entry of entries) {
      if (!entry.store || !entry.key) throw new Error('Every blob must have a store and key');
      storeDirectoryName(entry.store);
      const data = Buffer.from(entry.data);
      const digest = sha256(data);
      const objectPath = `objects/${digest}`;
      const contentPath = path.join(temporaryDir, objectPath);
      if (!(await exists(contentPath))) await writeFile(contentPath, data, { flag: 'wx', mode: 0o600 });

      const objects = stores.get(entry.store) ?? [];
      objects.push({
        key: entry.key,
        sha256: digest,
        size: data.byteLength,
        metadata: normalizeMetadata(entry.metadata),
        object_path: objectPath,
      });
      stores.set(entry.store, objects);
    }

    const manifest = {
      format: ARCHIVE_FORMAT,
      created_at: createdAt,
      stores: [...stores.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([name, objects]) => ({
          name,
          objects: objects.sort((left, right) => left.key.localeCompare(right.key)),
        })),
    };
    await writeFile(path.join(temporaryDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
    await rename(temporaryDir, archiveDir);
    return summarizeManifest(manifest);
  } catch (error) {
    const { rm } = await import('node:fs/promises');
    await rm(temporaryDir, { recursive: true, force: true });
    throw error;
  }
}

export async function loadAndValidateArchive(archiveDir) {
  assertAbsolute('archive directory', archiveDir);
  const manifest = JSON.parse(await readFile(path.join(archiveDir, 'manifest.json'), 'utf8'));
  if (manifest.format !== ARCHIVE_FORMAT || !Array.isArray(manifest.stores)) {
    throw new Error(`Unsupported blob archive format: ${String(manifest.format)}`);
  }

  const seen = new Set();
  for (const store of manifest.stores) {
    if (!Array.isArray(store?.objects)) throw new Error('Invalid store entry in blob manifest');
    storeDirectoryName(store.name);
    for (const object of store.objects) {
      const identity = `${store.name}\0${object.key}`;
      if (!object.key || seen.has(identity)) throw new Error(`Duplicate or empty blob key in ${store.name}`);
      seen.add(identity);
      if (!/^[a-f0-9]{64}$/.test(object.sha256) || object.object_path !== `objects/${object.sha256}`) {
        throw new Error(`Invalid content reference for ${store.name}/${object.key}`);
      }
      normalizeMetadata(object.metadata);
      const data = await readFile(path.join(archiveDir, object.object_path));
      if (data.byteLength !== object.size || sha256(data) !== object.sha256) {
        throw new Error(`Checksum mismatch for ${store.name}/${object.key}`);
      }
    }
  }
  return manifest;
}

export async function importArchive(archiveDir, blobRoot, { execute = false } = {}) {
  assertAbsolute('FLASH_BLOB_DIR', blobRoot);
  const manifest = await loadAndValidateArchive(archiveDir);
  if (await exists(blobRoot)) throw new Error(`Refusing to import into an existing blob directory: ${blobRoot}`);
  const targets = [];

  for (const store of manifest.stores) {
    for (const object of store.objects) {
      const target = localBlobPath(blobRoot, store.name, object.key);
      targets.push({ store: store.name, object, target });
    }
  }

  if (execute) {
    const temporaryRoot = await privateStagingDirectory(blobRoot);
    try {
      for (const { store, object } of targets) {
        const target = localBlobPath(temporaryRoot, store, object.key);
        await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
        const data = await readFile(path.join(archiveDir, object.object_path));
        await writeFile(target, data, { flag: 'wx', mode: 0o600 });
        await writeFile(`${target}.metadata.json`, `${JSON.stringify(object.metadata)}\n`, { flag: 'wx', mode: 0o600 });
      }
      await rename(temporaryRoot, blobRoot);
    } catch (error) {
      const { rm } = await import('node:fs/promises');
      await rm(temporaryRoot, { recursive: true, force: true });
      throw error;
    }
  }

  return { ...summarizeManifest(manifest), executed: execute };
}

export async function verifyLocalArchive(archiveDir, blobRoot) {
  assertAbsolute('FLASH_BLOB_DIR', blobRoot);
  const manifest = await loadAndValidateArchive(archiveDir);
  for (const store of manifest.stores) {
    for (const object of store.objects) {
      const target = localBlobPath(blobRoot, store.name, object.key);
      const data = await readFile(target);
      if (data.byteLength !== object.size || sha256(data) !== object.sha256) {
        throw new Error(`Local blob mismatch for ${store.name}/${object.key}`);
      }
      const metadata = JSON.parse(await readFile(`${target}.metadata.json`, 'utf8'));
      if (JSON.stringify(metadata) !== JSON.stringify(object.metadata)) {
        throw new Error(`Local metadata mismatch for ${store.name}/${object.key}`);
      }
    }
  }
  return summarizeManifest(manifest);
}

export function summarizeManifest(manifest) {
  return {
    stores: manifest.stores.length,
    objects: manifest.stores.reduce((total, store) => total + store.objects.length, 0),
    bytes: manifest.stores.reduce(
      (total, store) => total + store.objects.reduce((storeTotal, object) => storeTotal + object.size, 0),
      0
    ),
  };
}
