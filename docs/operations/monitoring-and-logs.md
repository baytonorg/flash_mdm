# Monitoring & logs

Flash MDM exposes operational signals through:

- Netlify function logs (platform-level)
- In-app server logs (Superadmin UI)
- Audit logs (security and change tracking)

## 1) Where logs live

### Netlify logs
- Function logs are available in the Netlify dashboard under the site's Functions tab.
- Deploy history and rollbacks are managed in Netlify's deploy list.

### In-app server logs
- Flash MDM surfaces server logs in Superadmin pages.
- Useful for support triage and incident correlation.

### Audit log
- Audit log events capture actor, action, resource, and contextual details.
- Visibility-scoped: some events are `privileged`-only (e.g. geofence state changes, reconciliation deletions).
- Distinct from raw server logs; intended for security and compliance use.

## 2) Scheduled functions to monitor

These run on fixed schedules; failures appear in Netlify function logs.

| Function | Schedule | Purpose |
|---|---|---|
| `cleanup-scheduled` | Daily at 03:00 UTC | Session/token expiry, retention enforcement |
| `sync-reconcile-scheduled` | Every 15 minutes | Full AMAPI device and enrollment token reconciliation |
| `geofence-check-scheduled` | Every 10 minutes | Device location vs geofence evaluation |
| `workflow-cron-scheduled` | Every 5 minutes | Time-based workflow trigger dispatch |
| `licensing-reconcile-scheduled` | Every hour | Licensing overage evaluation and enforcement |

## 3) What to monitor

- Elevated auth failures / rate limit hits
- AMAPI error rates and timeouts
- Stripe webhook failures and retries
- Background job queue growth / stuck jobs (`job_queue` table, status `pending` or `dead`)
- Database connection saturation
- Scheduled function errors (search logs for `error` or `fatal error` suffixes)

## 4) Suggested alerts (operator)

- Sustained 5xx rate
- Repeated webhook verification failures
- Scheduled/background function failures
- DB connection errors / pool exhaustion
- Unexpected spikes in destructive device actions (disable/wipe)
