import type { PoolClient } from 'pg';
import { errorResponse } from './helpers.js';

// Caller holds the signup-link reference lock, then the workspace ownership lock.
export async function deleteEnvironmentData(client: PoolClient, environmentId: string, confirmAccessCleanup: boolean) {
  let accessCleanup = { keys_deleted: 0, signup_links_deleted: 0, shared_links_updated: 0 };
  // Lock the parent before checking credentials so new FK-backed keys
  // cannot appear between the preflight and the cascade.
  await client.query('SELECT id FROM environments WHERE id = $1 FOR UPDATE', [environmentId]);
  const dependencies = await client.query<{ has_keys: boolean; has_signup_links: boolean }>(
    `SELECT EXISTS (SELECT 1 FROM api_keys WHERE environment_id = $1) AS has_keys,
            EXISTS (SELECT 1 FROM signup_links
              WHERE (scope_type = 'environment' AND scope_id = $1)
                 OR auto_assign_environment_ids @> jsonb_build_array($1::text)
                 OR EXISTS (SELECT 1 FROM groups g WHERE g.environment_id = $1
                   AND ((signup_links.scope_type = 'group' AND signup_links.scope_id = g.id)
                     OR signup_links.auto_assign_group_ids @> jsonb_build_array(g.id::text)))) AS has_signup_links`,
    [environmentId]
  );
  if ((dependencies.rows[0]?.has_keys || dependencies.rows[0]?.has_signup_links) && !confirmAccessCleanup) {
    throw errorResponse('Confirm deletion of this environment\'s API keys and dedicated signup links, and removal of its shared-link assignments, before deleting the environment.', 409);
  }
  if (confirmAccessCleanup) {
    const keys = await client.query('DELETE FROM api_keys WHERE environment_id = $1', [environmentId]);
    const links = await client.query(`DELETE FROM signup_links WHERE (scope_type = 'environment' AND scope_id = $1)
      OR (scope_type = 'group' AND scope_id IN (SELECT id FROM groups WHERE environment_id = $1))`, [environmentId]);
    const shared = await client.query(`UPDATE signup_links SET
      auto_assign_environment_ids = COALESCE((SELECT jsonb_agg(value) FROM jsonb_array_elements(COALESCE(auto_assign_environment_ids, '[]'::jsonb)) WHERE value <> to_jsonb($1::text)), '[]'::jsonb),
      auto_assign_group_ids = COALESCE((SELECT jsonb_agg(value) FROM jsonb_array_elements(COALESCE(auto_assign_group_ids, '[]'::jsonb)) WHERE value NOT IN (SELECT to_jsonb(id::text) FROM groups WHERE environment_id = $1::uuid)), '[]'::jsonb),
      updated_at = now()
      WHERE auto_assign_environment_ids @> jsonb_build_array($1::text)
         OR EXISTS (SELECT 1 FROM groups g WHERE g.environment_id = $1::uuid AND signup_links.auto_assign_group_ids @> jsonb_build_array(g.id::text))`, [environmentId]);
    accessCleanup = { keys_deleted: keys.rowCount ?? 0, signup_links_deleted: links.rowCount ?? 0, shared_links_updated: shared.rowCount ?? 0 };
  }
  // Legacy tables from early schema versions do not cascade on environment delete.
  // Clear those references explicitly to avoid FK violations for valid deletes.
  const cleanupStatements = [
    `UPDATE audit_log SET details = COALESCE(details, '{}'::jsonb) || jsonb_build_object('deleted_environment_id', environment_id),
       environment_id = NULL WHERE environment_id = $1`,
    `UPDATE audit_log SET details = COALESCE(details, '{}'::jsonb) || jsonb_build_object('deleted_device_id', device_id),
       device_id = NULL WHERE device_id IN (SELECT id FROM devices WHERE environment_id = $1)`,
    'DELETE FROM pubsub_events WHERE environment_id = $1',
    'DELETE FROM job_queue WHERE environment_id = $1',
  ];

  for (const sql of cleanupStatements) {
    await client.query('SAVEPOINT environment_cleanup');
    try {
      await client.query(sql, [environmentId]);
    } catch (cleanupErr) {
      // Some older databases may not have every legacy table/column.
      // Missing relation/column should not block environment deletion.
      if (isMissingRelationOrColumnError(cleanupErr)) {
        await client.query('ROLLBACK TO SAVEPOINT environment_cleanup');
        console.warn('environment-crud delete legacy cleanup skipped:', {
          environment_id: environmentId,
          sql,
          code: getPgCode(cleanupErr),
        });
      } else {
        throw cleanupErr;
      }
    }
    await client.query('RELEASE SAVEPOINT environment_cleanup');
  }

  await client.query('DELETE FROM environments WHERE id = $1', [environmentId]);
  return accessCleanup;
}
function getPgCode(error: unknown): string | undefined {
  return error && typeof error === 'object' && 'code' in error ? String(error.code) : undefined;
}
function isMissingRelationOrColumnError(error: unknown) { return ['42P01', '42703'].includes(getPgCode(error) ?? ''); }
