import { execute } from './db.js';

// Lock the identity while inserting. If offboarding wins, an old request
// cannot issue a sign-in link for a new account using the same email address.
export async function storeSigninLink(userId: string, email: string, hash: string, expiresAt: Date) {
  const result = await execute(
    `INSERT INTO magic_links (token_hash, email, expires_at)
     SELECT $1, u.email, $3 FROM users u WHERE u.id = $4 AND u.email = $2
     FOR KEY SHARE OF u`, [hash, email, expiresAt, userId]);
  return result.rowCount === 1;
}
