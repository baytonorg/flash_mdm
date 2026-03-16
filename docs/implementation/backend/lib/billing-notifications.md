# `netlify/functions/_lib/billing-notifications.ts`

> Builds billing email content and sends deduplicated billing notifications to workspace admins/owners with delivery tracking.

## Exports

| Name | Type | Description |
|------|------|-------------|
| `QueueAndSendBillingEmailResult` | `interface` | Shape: `{ queued: boolean, sent: boolean, skipped: boolean, reason?: 'duplicate' \| 'missing_table' \| 'no_recipients' }` |
| `buildRenewalEmail` | `(names: WorkspaceNames, seatCount: number, durationMonths: number, invoiceId: string \| null) => { subject: string; html: string }` | Generates subject and HTML for a subscription renewal notification |
| `buildPaymentFailedEmail` | `(names: WorkspaceNames, invoiceId: string \| null, subscriptionId: string \| null) => { subject: string; html: string }` | Generates subject and HTML for a failed payment notification |
| `buildNearExpiryEmail` | `(names: WorkspaceNames, seatCount: number, daysRemaining: number, expiresAt: string) => { subject: string; html: string }` | Generates subject and HTML for an entitlement near-expiry warning |
| `getWorkspaceScopeNames` | `(workspaceId: string, environmentId?: string \| null) => Promise<WorkspaceNames>` | Resolves human-readable workspace and optional environment names from IDs |
| `queueAndSendBillingEmail` | `(input: QueueAndSendBillingEmailInput) => Promise<QueueAndSendBillingEmailResult>` | Deduplicates, queues, sends, and tracks a billing notification email |

## Internal Functions

| Name | Lines | Description |
|------|-------|-------------|
| `buildGenericBillingHtml` | 29-45 | Renders a simple HTML email body with workspace/environment context, title, and message -- all HTML-escaped |
| `getBillingRecipients` | 119-150 | Collects recipient emails: all workspace owners/admins, plus optionally the environment-scoped customer |

## Dependencies (imports from project)

| Import | From | Used for |
|--------|------|----------|
| `execute`, `query`, `queryOne` | `_lib/db.ts` | Database operations for notification queue and recipient lookup |
| `isMissingRelationError` | `_lib/db-errors.ts` | Graceful handling when `workspace_billing_notifications` table does not exist |
| `sendEmail` | `_lib/resend.ts` | Sending emails via the Resend API |
| `escapeHtml` | `_lib/html.ts` | XSS-safe escaping for email template content |

## Key Logic

`queueAndSendBillingEmail` implements an idempotent notification pipeline:

1. **Deduplicate**: Inserts a row into `workspace_billing_notifications` with `ON CONFLICT (workspace_id, dedupe_key) DO NOTHING`. If the row already exists, returns `skipped: true, reason: 'duplicate'`. If the table does not exist, returns `skipped: true, reason: 'missing_table'`.

2. **Resolve recipients**: Queries all workspace members with `owner` or `admin` role. If `includeEnvironmentCustomer` is set and an `environmentId` is provided, also includes the active environment customer's email.

3. **Send**: Sends the email to all recipients in parallel via `sendEmail`. Updates the notification row to `sent` with recipient list and timestamp.

4. **Error handling**: On send failure, updates the notification row to `failed` with the error message. On no recipients, updates to `skipped`.

Email subjects are prefixed with `[Billing]` and include the workspace/environment scope. The scope display format is `WorkspaceName/EnvironmentName` when an environment is involved.
