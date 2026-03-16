# `netlify/functions/_lib/blobs.ts`

> Thin wrapper around Netlify Blobs providing typed get/set/delete operations with eventual consistency.

## Exports

| Name | Type | Description |
|------|------|-------------|
| `getBlobStore` | `(name: string) => Store` | Returns a Netlify Blob store instance with `eventual` consistency for the given store name |
| `storeBlob` | `(storeName: string, key: string, data: string \| Buffer, metadata?: Record<string, string>) => Promise<void>` | Writes a blob with optional metadata |
| `getBlob` | `(storeName: string, key: string) => Promise<string \| null>` | Reads a blob as text; returns null if not found |
| `getBlobJson` | `<T>(storeName: string, key: string) => Promise<T \| null>` | Reads a blob and parses it as JSON with generic type parameter |
| `deleteBlob` | `(storeName: string, key: string) => Promise<void>` | Deletes a blob by store name and key |

## Dependencies (imports from project)

| Import | From | Used for |
|--------|------|----------|
| `getStore` | `@netlify/blobs` | Netlify Blobs SDK for blob storage operations |

## Key Logic

All stores are created with `consistency: 'eventual'` mode. The module abstracts store instantiation so callers only need to provide a store name string rather than configuring options each time. `getBlobJson` composes `getBlob` with `JSON.parse` for convenience when storing structured data.
