import type { PoolClient } from 'pg';
import { execute } from './db.js';
import { getCurrentAuditAuthContext } from './request-auth-context.js';
import { traceEvent, traceError, traceContext, setTraceActor } from './operational-trace.js';
import { UUID_PATTERN, responseOutcome } from '../../../shared/trace-contract.js';

interface AuditEntry {
  workspace_id?: string;
  environment_id?: string;
  user_id?: string | null;
  api_key_id?: string | null;
  device_id?: string;
  actor_type?: 'user' | 'system' | 'api_key';
  visibility_scope?: 'standard' | 'privileged';
  action: string;
  custom_workflow_action?: boolean;
  resource_type?: string;
  resource_id?: string;
  details?: Record<string, unknown>;
  ip_address?: string;
}

const SENSITIVE_KEY_PATTERN = /(pass(word)?|secret|token|authorization|api[_-]?key|private[_-]?key|totp|otp|activationcode)/i;
// Only product-defined audit labels may be copied to diagnostics. Custom workflow actions are free text.
const TRACE_ACTIONS = new Set(
  `api_key.created api_key.revoked app.deleted app.deployed app.deployment_deleted app.deployment_updated
app.imported app.scope_config_deleted app.web_token_created auth.backup_code_used auth.login
auth.login_failed auth.magic_link_sent auth.password_change_failed auth.password_changed
auth.password_reset_completed auth.password_reset_requested auth.profile_updated
auth.register.signup_link auth.totp_disabled auth.totp_enabled auth.totp_setup_initiated
certificate.deleted certificate.uploaded component.assigned component.created component.deleted
component.unassigned component.updated deployment.cancel deployment.create
device.command.delivery_uncertain device.command.reconciled device.command.reconciliation_unresolved
device.deleted device.deleted_by_reconciliation device.enrolled device.group_changed
device.operation.cancelled device.policy_reconciled device.policy_reconciliation_skipped device.refreshed
device.renamed enrollment.tokens_synced enrollment_token.create_failed enrollment_token.created
enrollment_token.deleted environment.bind_cancelled environment.bind_started environment.created
environment.deleted environment.device_reconcile_import.queued environment.enterprise_attached
environment.enterprise_bound environment.enterprise_cleanup_failed environment.enterprise_deleted
environment.enterprise_unbound environment.enterprise_upgrade_status_synced environment.renewed
environment.updated environment.upgrade_url_generated environment.zero.touch.dpc.extras.built
environment.zero.touch.enrollment.token.created environment.zero.touch.iframe.token.created
flashagent.chat flashagent.chat_history.cleared flashagent.settings.updated
flashagent.workspace_settings.updated geofence.created geofence.deleted geofence.updated group.created
group.deleted group.moved group.updated license.activated license.assigned license.cancelled
license.invoice.requested license.overage.notification.failed license.overage.notification.queued
license.overage.notification.sent license.payment_failed license.unassigned license.updated
mcp.amapi.call network.deleted network.deployed network.updated policy.assigned policy.cloned
policy.created policy.deleted policy.derivative_decision policy.override_reset policy.override_saved
policy.unassigned policy.updated rbac.environment_permission_matrix.cleared
rbac.environment_permission_matrix.updated rbac.permission_matrix.cleared rbac.permission_matrix.updated
report.downloaded report.exported signin_config.deleted signin_config.updated signin_enrollment.code_sent
signin_enrollment.code_verified signin_enrollment.token_created signin_enrollment.verify_failed
signup_link.create signup_link.delete signup_link.update stripe.checkout.created stripe.portal.created
superadmin.billing.grant.manual superadmin.billing.invoice.cancelled superadmin.billing.invoice.mark_paid
superadmin.billing.subscription.cancelled superadmin.impersonate superadmin.impersonate.stopped
superadmin.migrations.run superadmin.migrations.run_failed superadmin.plan.deleted superadmin.plan.forced
superadmin.platform_settings.updated superadmin.user.deleted superadmin.user.demoted
superadmin.user.promoted superadmin.workspace.disabled superadmin.workspace.enabled
superadmin.workspace.purge_started superadmin.workspace.purged workflow.created workflow.deleted
workflow.disabled workflow.enabled workflow.execution.delivery_uncertain workflow.execution.executed
workflow.execution.failed workflow.execution.skipped workflow.tested workflow.updated workspace.created
workspace.credentials_updated workspace.invite_accepted workspace.invite_resent workspace.invite_sent
workspace.updated workspace.user_access_updated workspace.user_removed workspace.user_role_changed
workspace_billing.checkout.created workspace_billing.config.updated workspace_billing.entitlement.granted
workspace_billing.entitlement.manual_granted workspace_billing.entitlement.renewed
workspace_billing.environment.updated workspace_billing.portal.created workspace_billing.pricing.deleted
workspace_licensing.settings.updated`.split(/\s+/),
);
const TRACE_RESOURCES = new Set(
  `api_key app app_deployment app_scope_config certificate command_operation deployment_job device
enrollment_token environment environment_entitlement flashagent geofence group invite invoice license
license_grant license_overage_notification license_plan mcp network_deployment operation
platform_settings policy policy_assignment policy_component report report_export signin_configuration
signin_verification signup_link user web_token workflow workspace workspace_billing workspace_customer
workspace_licensing_settings workspace_membership workspace_pricing`.split(/\s+/),
);
const REDACTED = '[REDACTED]';

type PgLikeError = {
  code?: string;
  message?: string;
  table?: string;
};

export function sanitizeAuditValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sanitizeAuditValue);
  }

  if (value && typeof value === 'object') {
    const output: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      if (SENSITIVE_KEY_PATTERN.test(key)) {
        output[key] = REDACTED;
      } else {
        output[key] = sanitizeAuditValue(val);
      }
    }
    return output;
  }

  return value;
}

function applyRequestAuthAttribution(entry: AuditEntry): AuditEntry {
  const currentAuth = getCurrentAuditAuthContext();
  if (!currentAuth) return entry;

  if (currentAuth.authType !== 'api_key' || !currentAuth.apiKey) {
    return entry;
  }

  // Preserve explicit actor overrides (e.g. true system events emitted during a request).
  if (entry.actor_type && entry.actor_type !== 'api_key') {
    return entry;
  }

  const authContextDetails = {
    method: 'api_key',
    principal_type: 'api_key',
    principal_id: currentAuth.apiKey.id,
    principal_name: currentAuth.apiKey.name,
    role: currentAuth.apiKey.role,
    scope_type: currentAuth.apiKey.scope_type,
    scope_id: currentAuth.apiKey.scope_id,
    created_by_user_id: currentAuth.apiKey.created_by_user_id,
    created_by_name: currentAuth.apiKey.created_by_name ?? null,
    created_by_email: currentAuth.apiKey.created_by_email ?? null,
  };

  return {
    ...entry,
    actor_type: 'api_key',
    user_id: undefined,
    api_key_id: entry.api_key_id !== undefined ? entry.api_key_id : currentAuth.apiKey.id,
    details: {
      ...(entry.details ?? {}),
      auth_context: {
        ...(entry.details?.auth_context && typeof entry.details.auth_context === 'object'
          ? (entry.details.auth_context as Record<string, unknown>)
          : {}),
        ...authContextDetails,
      },
    },
  };
}

export async function logAudit(entry: AuditEntry, client?: PoolClient): Promise<void> {
  const attributedEntry = applyRequestAuthAttribution(entry);
  const safeDetails = sanitizeAuditValue(attributedEntry.details ?? {}) as Record<string, unknown>;
  const detailsJson = JSON.stringify(safeDetails);

  const traceAction = attributedEntry.custom_workflow_action ? 'workflow.custom_audit'
    : TRACE_ACTIONS.has(attributedEntry.action) ? attributedEntry.action : 'custom';
  const write = client ? async (sql: string, params: unknown[]) => client.query(sql, params) : execute;
  try {
    await write(
      `INSERT INTO audit_log (
         workspace_id, environment_id, user_id, api_key_id, device_id,
         actor_type, visibility_scope,
         action, resource_type, resource_id, details, ip_address
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [
        attributedEntry.workspace_id ?? null,
        attributedEntry.environment_id ?? null,
        attributedEntry.user_id ?? null,
        attributedEntry.api_key_id ?? null,
        attributedEntry.device_id ?? null,
        attributedEntry.actor_type ?? 'user',
        attributedEntry.visibility_scope ?? 'standard',
        attributedEntry.action,
        attributedEntry.resource_type ?? null,
        attributedEntry.resource_id ?? null,
        detailsJson,
        attributedEntry.ip_address ?? null,
      ]
    );
    const ctx = traceContext();
    if (attributedEntry.action === 'auth.login' && attributedEntry.user_id && ctx?.actor.type === 'anonymous') setTraceActor({ type: 'human', id: attributedEntry.user_id });
    traceEvent('audit.write', { action: traceAction, resource_type: TRACE_RESOURCES.has(attributedEntry.resource_type ?? '') ? attributedEntry.resource_type : undefined, resource_id: UUID_PATTERN.test(attributedEntry.resource_id ?? '') ? attributedEntry.resource_id : undefined, user_id: attributedEntry.user_id, workspace_id: attributedEntry.workspace_id, environment_id: attributedEntry.environment_id, durability: client ? 'transaction_pending' : 'committed', ...(attributedEntry.custom_workflow_action ? {} : responseOutcome(attributedEntry.details)) }, attributedEntry.actor_type === 'system' ? { type: 'system' } : ctx?.actor.type === 'anonymous' && attributedEntry.user_id ? { type: 'anonymous', id: attributedEntry.user_id } : undefined);
  } catch (err) {
    traceEvent('audit.failure', { action: traceAction, ...traceError(err) });
    // Lifecycle audit is part of the transaction: failure must roll it back.
    if (client) throw err;
    if (isMissingAuditLogColumnError(err)) {
      try {
        // Compatibility path for databases that have not yet run newer audit_log migrations.
        await execute(
          `INSERT INTO audit_log (
             workspace_id, environment_id, user_id, device_id,
             action, resource_type, resource_id, details, ip_address
           )
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [
            attributedEntry.workspace_id ?? null,
            attributedEntry.environment_id ?? null,
            attributedEntry.user_id ?? null,
            attributedEntry.device_id ?? null,
            attributedEntry.action,
            attributedEntry.resource_type ?? null,
            attributedEntry.resource_id ?? null,
            detailsJson,
            attributedEntry.ip_address ?? null,
          ]
        );
        return;
      } catch (fallbackErr) {
        console.error('Failed to write audit log:', fallbackErr);
        return;
      }
    }
    // Audit logging should never break the main flow
    console.error('Failed to write audit log:', err);
  }
}

export { sanitizeAuditValue as _sanitizeAuditValue };

function isMissingAuditLogColumnError(err: unknown): boolean {
  const pgErr = err as PgLikeError | null | undefined;
  if (!pgErr || pgErr.code !== '42703') return false;
  if (pgErr.table && pgErr.table !== 'audit_log') return false;
  const message = pgErr.message ?? '';
  return /column "(api_key_id|actor_type|visibility_scope)" of relation "audit_log" does not exist/.test(message);
}
