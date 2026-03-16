# `netlify/functions/_lib/resend.ts`

> Email sending via the Resend API with pre-built HTML templates for magic links, verification codes, and workspace invites.

## Exports

| Name | Type | Description |
|------|------|-------------|
| `sendEmail` | `(options: { to: string, subject: string, html: string, from?: string }) => Promise<void>` | Sends an email via the Resend REST API; throws on missing API key or non-OK response |
| `magicLinkEmail` | `(url: string) => { subject: string; html: string }` | Generates subject and HTML body for a magic link sign-in email (15-minute expiry) |
| `signinVerificationEmail` | `(code: string) => { subject: string; html: string }` | Generates subject and HTML body for a device work profile verification code email (10-minute expiry) |
| `inviteEmail` | `(url: string, workspaceName: string, inviterName: string) => { subject: string; html: string }` | Generates subject and HTML body for a workspace invitation email (7-day expiry) |

## Dependencies (imports from project)

| Import | From | Used for |
|--------|------|----------|
| `BRAND` | `_lib/brand.ts` | Brand name and default `emailFrom` address |
| `escapeHtml` | `_lib/html.ts` | XSS-safe HTML escaping for dynamic content in email templates |

## Key Logic

`sendEmail` reads `RESEND_API_KEY` from environment variables (required) and `RESEND_FROM_EMAIL` as an optional override, falling back to `BRAND.emailFrom`. It POSTs to `https://api.resend.com/emails` with bearer auth.

All template functions (`magicLinkEmail`, `signinVerificationEmail`, `inviteEmail`) apply `escapeHtml` to every dynamic value before embedding it in the HTML template to prevent injection. Templates use inline CSS for email client compatibility.
