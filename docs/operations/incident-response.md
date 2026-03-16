# Incident response basics

## Common incident types

- Auth abuse / credential stuffing
- Tenant data exposure suspicion
- AMAPI outage or prolonged sync failure
- Stripe webhook failures / billing mismatch
- Background job runaway or scheduled function failure
- Destructive device action (disable/wipe) triggered unexpectedly

## Minimum process

1. **Detect** — identify via alerts, log review, or user report
2. **Contain** — limit blast radius; options include:
   - Revoke compromised API keys (`api_keys` table, or via Superadmin UI)
   - Disable affected user accounts
   - Roll back a deploy via Netlify deploy history
   - Temporarily restrict access at the network/DNS layer
3. **Eradicate** — remove root cause (e.g. rotate secrets, patch code, close the misconfiguration)
4. **Recover** — restore normal service; verify via logs and monitoring
5. **Post-incident review** — document timeline, impact, root cause, and corrective actions

## Investigation starting points

- **Audit log** — filter by actor, action, or resource to establish who did what and when; review `privileged`-scope events for system-originated actions (reconciliation deletes, geofence triggers)
- **Netlify function logs** — correlate errors to time windows; search for `error` or `fatal error` log lines from scheduled functions
- **Job queue** — check for stuck jobs (status `dead`) that may indicate a runaway or broken background process
- **API keys** — review `revoked_at` and `last_used_at` for suspicious usage patterns

## Related

- [Monitoring & logs](./monitoring-and-logs.md)
- [Audit logging](../security/audit-logging.md)
- [Backup & restore](./backup-and-restore.md)
