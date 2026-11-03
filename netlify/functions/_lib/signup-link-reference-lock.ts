import { withClient } from './db.js';

// Serialises signup-link reference validation/writes with environment deletion.
// The two-key form keeps this lock in a dedicated advisory-lock namespace.
const LOCK_KEY_1 = 1179404627;
const LOCK_KEY_2 = 1936289387;

export async function withSignupLinkReferenceLock<T>(fn: () => Promise<T>): Promise<T> {
  for (;;) {
    const attempt = await withClient(async (client): Promise<
      { acquired: false } | { acquired: true; value: T }
    > => {
      const result = await client.query<{ locked: boolean }>(
        'SELECT pg_try_advisory_lock($1::integer, $2::integer) AS locked',
        [LOCK_KEY_1, LOCK_KEY_2]
      );
      if (!result.rows[0]?.locked) return { acquired: false };
      try {
        return { acquired: true, value: await fn() };
      } finally {
        await client.query('SELECT pg_advisory_unlock($1::integer, $2::integer)', [LOCK_KEY_1, LOCK_KEY_2]);
      }
    });
    if (attempt.acquired) return attempt.value;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
