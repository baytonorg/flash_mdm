# `netlify/functions/_lib/postgres-connection.ts`

> Normalizes Postgres connection strings by upgrading weak SSL modes to `verify-full` for security hardening.

## Exports

| Name | Type | Description |
|------|------|-------------|
| `normalizePostgresConnectionString` | `(connectionString?: string \| null) => string \| undefined` | Parses the connection string URL, upgrades `sslmode` values of `prefer`, `require`, or `verify-ca` to `verify-full`, and returns the modified string. Returns the original string unchanged if it is not a Postgres URL, uses libpq compat mode, or has no sslmode / already uses a non-upgradeable mode. Returns `undefined` for falsy input. |

## Key Logic

The function parses the connection string as a URL. It only acts on `postgres:` or `postgresql:` protocols. If the `uselibpqcompat` query parameter is `true`, no transformation is applied (the driver handles SSL natively in that mode).

The set of SSL modes upgraded to `verify-full` is: `prefer`, `require`, and `verify-ca`. These are considered insufficiently strict because they do not verify the server certificate's hostname. The `disable` and `allow` modes are left untouched (they indicate intentional relaxation). Any URL parsing errors are caught and the original string is returned as-is.
