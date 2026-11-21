// Fixed product vocabulary, never facets derived from tenant or workflow text.
export const AUDIT_ACTION_FAMILIES = [
  { id: 'devices', label: 'Devices', prefixes: ['device.'] },
  { id: 'device_commands', label: 'Device commands', prefixes: ['device.command.', 'device.bulk.'] },
  { id: 'policies', label: 'Policies and components', prefixes: ['policy.', 'component.'] },
  { id: 'groups', label: 'Groups', prefixes: ['group.'] },
  { id: 'authentication', label: 'Authentication', prefixes: ['auth.'] },
  { id: 'access', label: 'Access and membership', prefixes: ['rbac.', 'signup_link.', 'workspace.invite_'], actions: ['workspace.user_removed', 'workspace.user_role_changed', 'workspace.user_access_updated', 'superadmin.impersonate', 'superadmin.impersonate.stopped', 'superadmin.user.deleted', 'superadmin.user.promoted', 'superadmin.user.demoted'] },
  { id: 'flashi', label: 'Flashi', prefixes: ['flashagent.'] },
  { id: 'api_keys', label: 'API keys', prefixes: ['api_key.'] },
  { id: 'billing', label: 'Billing and licensing', prefixes: ['license.', 'workspace_billing.', 'workspace_licensing.', 'superadmin.billing.', 'superadmin.plan.', 'stripe.'] },
  { id: 'enrolment', label: 'Enrolment', prefixes: ['enrollment_token.', 'enrollment.', 'signin_enrollment.', 'signin_config.', 'environment.zero.touch.'], actions: ['device.enrolled'] },
  { id: 'networks', label: 'Networks and certificates', prefixes: ['network.', 'certificate.'] },
  { id: 'applications', label: 'Applications', prefixes: ['app.', 'deployment.'] },
  { id: 'lifecycle', label: 'Workspace and environment lifecycle', prefixes: ['workspace.', 'environment.', 'superadmin.workspace.'] },
  { id: 'workflows', label: 'Workflows and geofences', prefixes: ['workflow.', 'geofence.'] },
  { id: 'reports', label: 'Reports', prefixes: ['report.'] },
] as const;

export const AUDIT_EXACT_ACTIONS = [
  { action: 'auth.login', label: 'Sign in' },
  { action: 'workflow.custom_audit', label: 'Custom workflow audit' },
] as const;

export function auditActionFamily(id: string): { prefixes: readonly string[]; actions?: readonly string[] } | undefined {
  return AUDIT_ACTION_FAMILIES.find(family => family.id === id);
}

export function isProductAuditAction(action: string): boolean {
  return action.length <= 128 && /^[a-z][a-z0-9_]*(?:\.[a-z0-9_]+)+$/.test(action);
}
