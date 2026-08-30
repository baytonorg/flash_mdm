#!/usr/bin/env node
import { getStore, listStores } from '@netlify/blobs';
import path from 'node:path';
import process from 'node:process';
import {
  createArchive,
  importArchive,
  loadAndValidateArchive,
  verifyLocalArchive,
} from './lib/blob-migration.mjs';

function usage() {
  console.error('Usage: node scripts/migrate-netlify-blobs.mjs <export|import|verify> --archive <absolute-path> [--blob-dir <absolute-path>] [--execute]');
}

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const options = { command, execute: false };
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    if (arg === '--execute') options.execute = true;
    else if (arg === '--archive') options.archive = rest[++index];
    else if (arg === '--blob-dir') options.blobDir = rest[++index];
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!['export', 'import', 'verify'].includes(command) || !options.archive) throw new Error('Invalid command');
  if (!path.isAbsolute(options.archive)) throw new Error('--archive must be an absolute path');
  if (options.blobDir && !path.isAbsolute(options.blobDir)) throw new Error('--blob-dir must be an absolute path');
  return options;
}

async function* netlifyEntries(siteID, token) {
  for await (const storePage of listStores({ siteID, token, paginate: true })) {
    for (const storeName of storePage.stores) {
      const store = getStore({ name: storeName, siteID, token, consistency: 'strong' });
      for await (const blobPage of store.list({ paginate: true })) {
        for (const blob of blobPage.blobs) {
          const result = await store.getWithMetadata(blob.key, { type: 'arrayBuffer', consistency: 'strong' });
          if (!result) throw new Error(`Blob disappeared during export: ${storeName}/${blob.key}`);
          yield { store: storeName, key: blob.key, data: Buffer.from(result.data), metadata: result.metadata };
        }
      }
    }
  }
}

async function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    usage();
    throw error;
  }

  if (options.command === 'export') {
    const siteID = process.env.NETLIFY_SITE_ID;
    const token = process.env.NETLIFY_API_TOKEN;
    if (!siteID || !token) throw new Error('NETLIFY_SITE_ID and NETLIFY_API_TOKEN are required for export');
    const result = await createArchive(options.archive, netlifyEntries(siteID, token));
    console.log(`Export verified: ${result.stores} stores, ${result.objects} objects, ${result.bytes} bytes`);
    return;
  }

  const blobDir = options.blobDir ?? process.env.FLASH_BLOB_DIR;
  if (!blobDir || !path.isAbsolute(blobDir)) throw new Error('An absolute --blob-dir or FLASH_BLOB_DIR is required');
  if (options.command === 'import') {
    const result = await importArchive(options.archive, blobDir, { execute: options.execute });
    console.log(`${result.executed ? 'Import complete' : 'Dry run complete'}: ${result.stores} stores, ${result.objects} objects, ${result.bytes} bytes`);
    return;
  }

  const result = await verifyLocalArchive(options.archive, blobDir);
  await loadAndValidateArchive(options.archive);
  console.log(`Verification complete: ${result.stores} stores, ${result.objects} objects, ${result.bytes} bytes`);
}

main().catch((error) => {
  console.error(`Blob migration failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
