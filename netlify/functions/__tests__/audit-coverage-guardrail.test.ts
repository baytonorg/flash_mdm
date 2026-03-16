import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const FUNCTIONS_DIR = path.resolve(process.cwd(), 'netlify/functions');

const EXEMPT_MUTATING_HANDLERS = new Map<string, string>([
  ['auth-logout.ts', 'Session cookie/session row invalidation; optional auth.logout audit not yet implemented.'],
  ['auth-session.ts', 'Session metadata flag clear endpoint; low-risk metadata mutation, optional audit.'],
  ['deployment-jobs-background.ts', 'Internal background worker trigger delegates to processDeploymentJob; operational status mutations are tracked on deployment_jobs rows.'],
  ['licensing-reconcile.ts', 'Internal-only reconcile trigger delegates to scheduled licensing workflow and persists system-generated enforcement actions.'],
  ['pubsub-webhook.ts', 'Operational ingestion pipeline uses pubsub_events/job_queue tracking; no audit_log entry by design (for now).'],
]);

function listFunctionFiles(dir: string): string[] {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    if (entry.name === '__tests__') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...listFunctionFiles(full));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith('.ts')) {
      files.push(full);
    }
  }
  return files.sort();
}

function isMutatingHandlerSource(source: string): boolean {
  if (!source.includes('request.method')) return false;
  return ['POST', 'PUT', 'PATCH', 'DELETE'].some((method) => source.includes(`'${method}'`) || source.includes(`"${method}"`));
}

function hasAuditWrite(source: string): boolean {
  return source.includes('logAudit(') || source.includes('INSERT INTO audit_log');
}

describe('audit coverage guardrail', () => {
  it('limits mutating handlers without audit writes to the explicit exemption list', () => {
    const files = listFunctionFiles(FUNCTIONS_DIR)
      .filter((file) => !file.includes(`${path.sep}_lib${path.sep}`));

    const mutatingWithoutAudit = files
      .map((file) => ({
        file,
        source: fs.readFileSync(file, 'utf8'),
      }))
      .filter(({ source }) => isMutatingHandlerSource(source))
      .filter(({ source }) => !hasAuditWrite(source))
      .map(({ file }) => path.basename(file))
      .sort();

    expect(mutatingWithoutAudit).toEqual([...EXEMPT_MUTATING_HANDLERS.keys()].sort());
  });
});
