# Security overview

Flash MDM is enterprise-facing and implements a number of baseline controls expected of modern SaaS platforms.

This documentation describes the current posture **as built**, plus the operator responsibilities required to run it safely.

## 1) What’s in place (as-built)

Key security controls:

- Password hashing via scrypt (N=16384, r=8, p=1)
- Optional TOTP MFA + backup codes
- Postgres-backed token-bucket rate limiting
- Tenant isolation checks across core CRUD and device endpoints
- CSRF protections (Origin + X-Requested-With on mutations)
- SSRF protections for webhook/outbound URL validation (DNS-resolution-aware)
- Secrets at rest encrypted using AES-256-GCM
- Timing-safe comparisons (password hashing, internal auth)
- Session tokens generated with 256-bit entropy and stored hashed
- Comprehensive audit logging with sensitive-field redaction

## 2) Operator responsibilities

Because the platform is operator-hosted, the operator must provide:

- Restricted access to Netlify and the database
- Backup schedule and restore testing
- Monitoring and alerting
- Vulnerability management process
- Access reviews and audit log retention policies
- Incident response process

See also:

- [Compliance notes](./compliance-notes.md)
- [Hardening](./hardening.md)
- [Audit logging](./audit-logging.md)
