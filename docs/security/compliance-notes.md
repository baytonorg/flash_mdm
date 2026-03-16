# Compliance notes (SOC2 / Cyber Essentials orientation)

This page is written for IT/security reviewers.

It is **not** a certification statement.

## 1) How to evaluate Flash MDM

Think of Flash MDM as two parts:

1. **The product controls** — what the application implements.
2. **The operator controls** — how you host and operate it.

Both matter for SOC2/Cyber Essentials-style evaluations.

## 2) Product controls (high level)

Based on as-built behaviour and internal QA/security audit reports:

- Access control: role-based (RBAC) with per-workspace permission matrix and minimum floors
- Authentication: password (scrypt) + optional TOTP MFA + magic link flows
- Session management: HttpOnly secure cookies, 256-bit session tokens stored hashed, sliding 14-day expiry
- Request hardening: CSRF checks (Origin + X-Requested-With) on mutations, input validation
- Outbound protection: SSRF mitigations with DNS-resolution-aware blocklist in webhook URL validation
- Secrets: encrypted at rest using AES-256-GCM with domain-specific AAD
- Audit logging: server-side audit log for sensitive operations with sensitive-field redaction

For details on each control, see the relevant pages in this `docs/security/` directory.

## 3) Operator controls (required for serious compliance)

An operator seeking SOC2 / Cyber Essentials alignment typically must implement:

- Identity and access management for Netlify and the database
- Change management (PR reviews, approvals, CI/CD pipeline)
- Centralised logging, retention, and alerting
- Backup schedule, restore testing, documented RPO/RTO
- Endpoint protection and device management for admin machines
- Key management and rotation procedures (especially `ENCRYPTION_MASTER_KEY`)
- Incident response playbooks and post-incident review process

## 4) Evidence you can produce

Flash MDM can support evidence generation via:

- Audit logs (who changed what, when, from which IP)
- Netlify function logs (server-side request logs)
- In-app audit log views (per environment)
- Stripe event logs (if billing is enabled)

The operator must ensure retention and access controls for these sources.
