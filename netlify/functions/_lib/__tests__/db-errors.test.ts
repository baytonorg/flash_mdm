import { describe, expect, it } from 'vitest';
import {
  databaseUnavailableResponse,
  isDatabaseInfrastructureError,
  markDatabaseError,
} from '../db-errors.js';

describe('database infrastructure error classification', () => {
  it.each([
    [{ code: '08006' }],
    [{ code: '57P01' }],
    [markDatabaseError({ code: 'ECONNREFUSED' })],
    [markDatabaseError(new Error('connection terminated unexpectedly'))],
    [markDatabaseError(new Error('too many connections'))],
    [{ message: 'wrapper', cause: markDatabaseError({ code: 'ETIMEDOUT' }) }],
  ])('recognises availability failures without replaying database work', (error) => {
    expect(isDatabaseInfrastructureError(error)).toBe(true);
  });

  it.each([
    [{ code: '23505', message: 'unique constraint violation' }],
    [{ code: '40P01', message: 'deadlock detected' }],
    [{ code: '57014', message: 'canceling statement due to statement timeout' }],
    [new Error('invalid input syntax for type uuid')],
    [{ code: 'ECONNRESET', message: 'unrelated HTTP request reset' }],
    [new Error('AMAPI error (503): too many connections')],
  ])('does not classify ordinary SQL or application errors as infrastructure failures', (error) => {
    expect(isDatabaseInfrastructureError(error)).toBe(false);
  });

  it('returns a bounded, machine-readable degraded response', async () => {
    const response = databaseUnavailableResponse(999);

    expect(response.status).toBe(503);
    expect(response.headers.get('Retry-After')).toBe('300');
    expect(response.headers.get('X-Flash-Degraded')).toBe('database');
    await expect(response.json()).resolves.toEqual({
      error: 'Database temporarily unavailable. Please retry shortly.',
      code: 'DATABASE_UNAVAILABLE',
    });
  });
});
