import type { Context } from '@netlify/functions';
import { queryOne } from './_lib/db.js';
import { errorResponse, jsonResponse } from './_lib/helpers.js';

function deployedVersion(): string | null {
  return process.env.FLASH_RELEASE_COMMIT?.trim()
    || process.env.COMMIT_REF?.trim()
    || null;
}

export default async function handler(request: Request, _context: Context) {
  if (request.method !== 'GET') return errorResponse('Method not allowed', 405);

  const version = deployedVersion();
  const runtime = process.env.FLASH_RUNTIME?.trim() || 'netlify';

  try {
    await queryOne('SELECT 1 AS ok');
    return jsonResponse(
      { status: 'ok', database: 'ok', version, runtime },
      200,
      { 'Cache-Control': 'no-store' }
    );
  } catch (error) {
    console.error(
      'Health check database error:',
      error instanceof Error ? error.message : 'unknown database error'
    );
    return jsonResponse(
      { status: 'degraded', database: 'unavailable', version, runtime },
      503,
      { 'Cache-Control': 'no-store' }
    );
  }
}
