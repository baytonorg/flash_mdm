import { access, cp, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');

const sourceVsDir = path.join(repoRoot, 'node_modules', 'monaco-editor', 'min', 'vs');
const targetVsDir = path.join(repoRoot, 'public', 'monaco', 'vs');

async function main() {
  try {
    await access(sourceVsDir);
  } catch {
    throw new Error(`Monaco source directory not found: ${sourceVsDir}`);
  }

  await rm(targetVsDir, { recursive: true, force: true });
  await mkdir(path.dirname(targetVsDir), { recursive: true });
  await cp(sourceVsDir, targetVsDir, { recursive: true });

  console.log(`Copied Monaco assets to ${targetVsDir}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
