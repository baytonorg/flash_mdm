# `netlify/functions/_lib/enterprise-upgrade.ts`

> Normalizes AMAPI enterprise upgrade status fields for storage and API responses.

## Exports

| Name | Type | Description |
|------|------|-------------|
| `EnterpriseUpgradeDetails` | `interface` | Partial AMAPI enterprise type fields read from the enterprise resource |
| `EnterpriseUpgradeStatus` | `interface` | Stored/status response shape for upgrade eligibility and source enterprise type fields |
| `buildEnterpriseUpgradeStatus` | `(enterprise: EnterpriseUpgradeDetails, refreshedAt?: string) => EnterpriseUpgradeStatus` | Converts AMAPI enterprise fields into the local `enterprise_upgrade_status` object |

## Key Logic

`buildEnterpriseUpgradeStatus` defaults a missing AMAPI `enterpriseType` to `ENTERPRISE_TYPE_UNSPECIFIED`, marks only `MANAGED_GOOGLE_PLAY_ACCOUNTS_ENTERPRISE` as upgrade-eligible, carries through the managed Google Play Accounts and managed Google Domain type fields when present, and stamps the status with `refreshed_at`.

## Used By

| Consumer | Purpose |
|----------|---------|
| `netlify/functions/environment-enterprise.ts` | Refreshes and returns upgrade status before generating an upgrade URL |
| `netlify/functions/sync-process-background.ts` | Refreshes cached upgrade status during background processing |

## Evidence

| Claim | Evidence | Confidence |
|---|---|---|
| Only managed Google Play Accounts enterprises are marked upgrade-eligible. | `netlify/functions/_lib/enterprise-upgrade.ts`; `netlify/functions/environment-enterprise.ts` | high |
| Upgrade status is stored in `environments.enterprise_features.enterprise_upgrade_status`. | `netlify/functions/environment-enterprise.ts`; `netlify/functions/sync-process-background.ts` | high |
