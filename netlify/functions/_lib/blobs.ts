import { getStore } from '@netlify/blobs';
import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

const isNetlifyRuntime = Boolean(process.env.NETLIFY || process.env.NETLIFY_LOCAL);
const fileBlobRoot = process.env.FLASH_BLOB_DIR
  || (!isNetlifyRuntime && process.env.NODE_ENV === 'production' ? '.flash-blobs' : '');
const resolvedFileBlobRoot = fileBlobRoot ? path.resolve(fileBlobRoot) : '';

function fileBlobPath(storeName: string, key: string): string {
  const safeStoreName = encodeURIComponent(storeName);
  const hashedKey = createHash('sha256').update(key).digest('hex');
  return path.join(resolvedFileBlobRoot, safeStoreName, hashedKey);
}

export function getBlobStore(name: string) {
  return getStore({ name, consistency: 'eventual' });
}

export async function storeBlob(
  storeName: string,
  key: string,
  data: string | Buffer,
  metadata?: Record<string, string>
): Promise<void> {
  if (fileBlobRoot) {
    const filePath = fileBlobPath(storeName, key);
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, data);
    if (metadata) {
      await writeFile(`${filePath}.metadata.json`, JSON.stringify(metadata));
    }
    return;
  }

  const store = getBlobStore(storeName);
  await store.set(key, data, { metadata });
}

export async function getBlob(
  storeName: string,
  key: string
): Promise<string | null> {
  if (fileBlobRoot) {
    try {
      return await readFile(fileBlobPath(storeName, key), 'utf8');
    } catch (err) {
      if (typeof err === 'object' && err !== null && 'code' in err && err.code === 'ENOENT') {
        return null;
      }
      throw err;
    }
  }

  const store = getBlobStore(storeName);
  return store.get(key, { type: 'text' });
}

export async function getBlobJson<T = unknown>(
  storeName: string,
  key: string
): Promise<T | null> {
  const text = await getBlob(storeName, key);
  if (!text) return null;
  return JSON.parse(text) as T;
}

export async function deleteBlob(
  storeName: string,
  key: string
): Promise<void> {
  if (fileBlobRoot) {
    const filePath = fileBlobPath(storeName, key);
    await rm(filePath, { force: true });
    await rm(`${filePath}.metadata.json`, { force: true });
    return;
  }

  const store = getBlobStore(storeName);
  await store.delete(key);
}
