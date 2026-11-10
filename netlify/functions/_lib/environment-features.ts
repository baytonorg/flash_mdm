/** Executed in the row UPDATE so a concurrent RBAC save cannot be overwritten. */
export function environmentFeaturesPreservingRbac(parameter: number): string {
  return `($${parameter}::jsonb - 'rbac') || CASE WHEN enterprise_features ? 'rbac'
    THEN jsonb_build_object('rbac', enterprise_features->'rbac') ELSE '{}'::jsonb END`;
}

/** Roles saves own only RBAC; preserve unrelated current feature settings. */
export const ENVIRONMENT_RBAC_SAVE_SQL = `UPDATE environments SET enterprise_features =
  jsonb_set(COALESCE(enterprise_features, '{}'::jsonb), '{rbac}', $1::jsonb),
  updated_at = now() WHERE id = $2`;

export const ENVIRONMENT_RBAC_CLEAR_SQL = `UPDATE environments SET
  enterprise_features = COALESCE(enterprise_features, '{}'::jsonb)
    #- '{rbac,permission_matrix}' #- '{rbac,updated_at}' #- '{rbac,updated_by_user_id}',
  updated_at = now() WHERE id = $1`;
