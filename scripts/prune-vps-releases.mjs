#!/usr/bin/env node

import { readdir, realpath, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const [releasesDir, currentLink] = process.argv.slice(2);
if (!releasesDir || !currentLink) {
  console.error('Usage: prune-vps-releases.mjs <releases-dir> <current-link>');
  process.exit(2);
}

const releasesRoot = await realpath(releasesDir);
const activeRelease = await realpath(currentLink);
if (dirname(activeRelease) !== releasesRoot) {
  throw new Error(`Active release is outside the release root: ${activeRelease}`);
}

for (const entry of await readdir(releasesRoot, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const candidate = join(releasesRoot, entry.name);
  const resolvedCandidate = await realpath(candidate);
  if (dirname(resolvedCandidate) !== releasesRoot) {
    throw new Error(`Refusing to remove a release outside the release root: ${resolvedCandidate}`);
  }
  if (resolvedCandidate === activeRelease) continue;
  await rm(candidate, { recursive: true, force: false, maxRetries: 3, retryDelay: 250 });
  console.log(`Removed superseded release ${entry.name}`);
}
