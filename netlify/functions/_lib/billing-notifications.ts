import { execute, query, queryOne } from './db.js';
import { isMissingRelationError } from './db-errors.js';
import { sendEmail } from './resend.js';
import { escapeHtml } from './html.js';

interface WorkspaceNames {
  workspaceName: string;
  environmentName: string | null;
}

interface QueueAndSendBillingEmailInput {
  workspaceId: string;
  environmentId?: string | null;
  notificationType: string;
  dedupeKey: string;
  subject: string;
  html: string;
  payload?: Record<string, unknown>;
  includeEnvironmentCustomer?: boolean;
}

export interface QueueAndSendBillingEmailResult {
  queued: boolean;
  sent: boolean;
  skipped: boolean;
  reason?: 'duplicate' | 'missing_table' | 'no_recipients';
}

function buildGenericBillingHtml(
  names: WorkspaceNames,
  title: string,
  body: string,
): string {
  const safeWorkspace = escapeHtml(names.workspaceName);
  const safeEnvironment = names.environmentName ? escapeHtml(names.environmentName) : null;
  const safeTitle = escapeHtml(title);
  const safeBody = escapeHtml(body);

  return `
    <p><strong>${safeTitle}</strong></p>
    <p>Workspace: <strong>${safeWorkspace}</strong></p>
    ${safeEnvironment ? `<p>Environment: <strong>${safeEnvironment}</strong></p>` : ''}
    <p>${safeBody}</p>
  `;
}

export function buildRenewalEmail(
  names: WorkspaceNames,
  seatCount: number,
  durationMonths: number,
  invoiceId: string | null,
): { subject: string; html: string } {
  const scope = names.environmentName ? `${names.workspaceName}/${names.environmentName}` : names.workspaceName;
  const subject = `[Billing] Renewal processed for ${scope}`;
  const message = `A renewal has been processed for ${seatCount} seat(s) for ${durationMonths} month(s)${
    invoiceId ? ` (invoice ${invoiceId}).` : '.'
  }`;
  return {
    subject,
    html: buildGenericBillingHtml(names, 'Subscription renewal processed', message),
  };
}

export function buildPaymentFailedEmail(
  names: WorkspaceNames,
  invoiceId: string | null,
  subscriptionId: string | null,
): { subject: string; html: string } {
  const scope = names.environmentName ? `${names.workspaceName}/${names.environmentName}` : names.workspaceName;
  const subject = `[Billing] Payment failed for ${scope}`;
  const message = `A subscription payment failed${invoiceId ? ` (invoice ${invoiceId})` : ''}${
    subscriptionId ? ` for subscription ${subscriptionId}` : ''
  }. Update payment details to avoid enforcement actions.`;
  return {
    subject,
    html: buildGenericBillingHtml(names, 'Payment failed', message),
  };
}

export function buildNearExpiryEmail(
  names: WorkspaceNames,
  seatCount: number,
  daysRemaining: number,
  expiresAt: string,
): { subject: string; html: string } {
  const scope = names.environmentName ? `${names.workspaceName}/${names.environmentName}` : names.workspaceName;
  const subject = `[Billing] Entitlement expires in ${daysRemaining} day(s) for ${scope}`;
  const message = `${seatCount} seat(s) expire on ${new Date(expiresAt).toISOString()}. Renew to avoid overage enforcement.`;
  return {
    subject,
    html: buildGenericBillingHtml(names, 'Entitlement expiry warning', message),
  };
}

export async function getWorkspaceScopeNames(
  workspaceId: string,
  environmentId?: string | null
): Promise<WorkspaceNames> {
  const workspace = await queryOne<{ name: string }>(
    `SELECT name FROM workspaces WHERE id = $1`,
    [workspaceId]
  );

  let environmentName: string | null = null;
  if (environmentId) {
    const environment = await queryOne<{ name: string }>(
      `SELECT name FROM environments WHERE id = $1`,
      [environmentId]
    );
    environmentName = environment?.name ?? null;
  }

  return {
    workspaceName: workspace?.name ?? workspaceId,
    environmentName,
  };
}

async function getBillingRecipients(
  workspaceId: string,
  environmentId: string | null,
  includeEnvironmentCustomer: boolean
): Promise<string[]> {
  const recipients = new Set<string>();

  const admins = await query<{ email: string }>(
    `SELECT DISTINCT u.email
     FROM workspace_memberships wm
     JOIN users u ON u.id = wm.user_id
     WHERE wm.workspace_id = $1
       AND wm.role IN ('owner', 'admin')
       AND COALESCE(u.email, '') <> ''`,
    [workspaceId]
  );
  admins.forEach((row) => recipients.add(row.email));

  if (includeEnvironmentCustomer && environmentId) {
    const customer = await queryOne<{ email: string | null }>(
      `SELECT email
       FROM workspace_customers
       WHERE workspace_id = $1
         AND environment_id = $2
         AND status = 'active'`,
      [workspaceId, environmentId]
    );
    if (customer?.email) recipients.add(customer.email);
  }

  return [...recipients];
}

export async function queueAndSendBillingEmail(
  input: QueueAndSendBillingEmailInput
): Promise<QueueAndSendBillingEmailResult> {
  const payload = input.payload ?? {};
  let insertResult: { rowCount?: number } = {};

  try {
    insertResult = await execute(
      `INSERT INTO workspace_billing_notifications
         (id, workspace_id, environment_id, notification_type, dedupe_key, status, payload, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, 'queued', $6::jsonb, now(), now())
       ON CONFLICT (workspace_id, dedupe_key) DO NOTHING`,
      [
        crypto.randomUUID(),
        input.workspaceId,
        input.environmentId ?? null,
        input.notificationType,
        input.dedupeKey,
        JSON.stringify(payload),
      ]
    );
  } catch (err) {
    if (isMissingRelationError(err)) {
      return { queued: false, sent: false, skipped: true, reason: 'missing_table' };
    }
    throw err;
  }

  if ((insertResult.rowCount ?? 0) === 0) {
    return { queued: false, sent: false, skipped: true, reason: 'duplicate' };
  }

  const recipients = await getBillingRecipients(
    input.workspaceId,
    input.environmentId ?? null,
    input.includeEnvironmentCustomer ?? false
  );
  if (recipients.length === 0) {
    await execute(
      `UPDATE workspace_billing_notifications
       SET status = 'skipped', recipients = '[]'::jsonb, error = 'No recipients', updated_at = now()
       WHERE workspace_id = $1 AND dedupe_key = $2`,
      [input.workspaceId, input.dedupeKey]
    );
    return { queued: true, sent: false, skipped: true, reason: 'no_recipients' };
  }

  try {
    await Promise.all(recipients.map((to) => sendEmail({ to, subject: input.subject, html: input.html })));

    await execute(
      `UPDATE workspace_billing_notifications
       SET status = 'sent',
           recipients = $3::jsonb,
           sent_at = now(),
           updated_at = now()
       WHERE workspace_id = $1
         AND dedupe_key = $2`,
      [input.workspaceId, input.dedupeKey, JSON.stringify(recipients)]
    );
    return { queued: true, sent: true, skipped: false };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await execute(
      `UPDATE workspace_billing_notifications
       SET status = 'failed',
           recipients = $3::jsonb,
           error = $4,
           updated_at = now()
       WHERE workspace_id = $1
         AND dedupe_key = $2`,
      [input.workspaceId, input.dedupeKey, JSON.stringify(recipients), message]
    );
    return { queued: true, sent: false, skipped: false };
  }
}
