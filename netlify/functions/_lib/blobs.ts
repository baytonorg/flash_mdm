import { getStore } from '@netlify/blobs';

export function getBlobStore(name: string) {
  return getStore({ name, consistency: 'eventual' });
}

export async function storeBlob(
  storeName: string,
  key: string,
  data: string | Buffer,
  metadata?: Record<string, string>
): Promise<void> {
  const store = getBlobStore(storeName);
  await store.set(key, data, { metadata });
}

export async function getBlob(
  storeName: string,
  key: string
): Promise<string | null> {
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
  const store = getBlobStore(storeName);
  await store.delete(key);
}
