import 'dotenv/config';
import type { Context } from '@netlify/functions';
import migrate from '../netlify/functions/migrate.js';

// Run the candidate manifest before activation. Secrets stay in process memory
// and are passed directly to the handler, never through argv or output.
const secret = process.env.MIGRATION_SECRET;
if (!secret) throw new Error('Migration configuration is unavailable');
const response = await migrate(new Request('http://localhost/api/migrate', {
  headers: { 'x-migration-secret': secret },
}), {} as Context);
const result = await response.json() as { summary?: { applied?: number; skipped?: number; errors?: number } };
if (!response.ok || !result.summary || result.summary.errors !== 0) {
  throw new Error('Candidate database migration failed; release was not activated');
}
console.log(`Candidate migrations complete: ${result.summary.applied ?? 0} applied, ${result.summary.skipped ?? 0} already present`);
