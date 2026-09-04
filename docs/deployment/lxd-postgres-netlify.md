# LXD/Postgres VPS Migration

This runbook moves Flash MDM from Neon/Netlify DB to a PostgreSQL instance and
Flash runtime running in LXD. The validated target hostname is
`flash-mdm.bayton.org`.

Flash MDM uses the standard `pg` driver and reads `DATABASE_URL`, falling back to `NETLIFY_DATABASE_URL`. No application code change is required if the new database exposes a normal PostgreSQL endpoint.

For the Bayton LXD topology, run the release installer with
`FLASH_EXTERNAL_CADDY=true`. This prevents it from installing, configuring, or
restarting Caddy in the Flash container; `caddy-edge` remains the only public
TLS endpoint. Confirm the edge configuration routes the hostname to the
container's port `3000` before release.

The upgrade path also normalizes ownership of Flash tables and sequences in the
`public` schema to the configured runtime role. This is required after restores
performed as `postgres`; otherwise later application migrations can fail with
`must be owner of table`.

The queue worker stops accepting new polls on `SIGTERM`, lets active handlers
finish, interrupts an in-progress polling/backoff sleep, and closes its PostgreSQL
pool. Systemd still enforces a 20-second bound during release activation. A
forced-stop fallback is safe because the queue reclaims expired worker leases
before retrying work.

During a PostgreSQL restart, the queue and deployment handlers advertise a
database-degraded HTTP 503 with a bounded `Retry-After`. Each worker drain backs
off exponentially with jitter from `FLASH_WORKER_POLL_MS` to a default ceiling of
30 seconds. `FLASH_WORKER_DB_BACKOFF_MAX_MS` can raise or lower that ceiling within
the enforced poll-to-300-second range. A successful poll resets the failure count
immediately. Check `journalctl -u flashmdm-worker` for the single
`event=database_unavailable` and matching `event=database_recovered` messages.

Jobs already claimed when connectivity is lost remain leased and are reclaimed
through the existing 10-minute queue or 15-minute deployment threshold. Those
thresholds are intentionally not shortened: an interrupted database write or
external AMAPI action may have completed even when its acknowledgement was lost.
The worker therefore never applies blanket retries to arbitrary writes or whole
transactions, and a database-unavailable response alone does not mark work dead.

## Recommended shape

Use this shape for production:

- Flash frontend and API runtime run together in an LXD container.
- PostgreSQL runs in the same LXD container or on a private LXD network.
- The host's `caddy-edge` container terminates TLS for `flash-mdm.bayton.org`
  and reverse-proxies every request to the Flash runtime on port `3000`.
- PostgreSQL is not published publicly.
- Optional GitHub deployment webhooks terminate at `caddy-edge` and proxy only
  `/api/deploy/webhook` to the Flash container's private address on port `3101`.
  The listener binds to that RFC1918 private address inside the Flash container;
  it is never published through an LXD proxy device or host firewall rule.

Use this DNS record:

```text
flash-mdm.bayton.org -> 31.120.224.179
```

The local production connection string should look like:

```text
postgresql://flashmdm:<password>@localhost:5432/flash_mdm?sslmode=disable
```

## Netlify source IP allowlisting

Do not assume ordinary Netlify Functions have a single stable outgoing IP address. Netlify's current documented option for static allowlisting is **Private Connectivity**. For functions, it is only available in supported regions such as `cmh`, `fra`, and `lhr`, and Netlify provides multiple static IP addresses per region that must all be allowlisted.

If Private Connectivity is not available on your Netlify plan, choose one of these instead:

- Put a static-egress proxy between Netlify Functions and Postgres, then allowlist the proxy IP.
- Move the Flash backend off Netlify and onto the same LXD host/VPS as Postgres, then keep Postgres private.
- Temporarily open TCP `5432` to the internet while relying on TLS, strong password auth, and Postgres `pg_hba.conf` restrictions. Treat this as a short-lived migration/testing state only.

References:

- [Netlify Private Connectivity](https://docs.netlify.com/manage/security/private-connectivity/)
- [Netlify Functions regions](https://docs.netlify.com/build/functions/configuration/#region)

## Firewall ports

For the database-only migration:

| Port | Direction | Source | Purpose |
| --- | --- | --- | --- |
| TCP `5432` | inbound to LXD host/container | Netlify Private Connectivity function IPs, or static proxy IPs | PostgreSQL |
| TCP `22` | inbound to LXD host | your admin IPs only | SSH administration |
| TCP `80` | inbound to LXD host | Let's Encrypt validation only, if using HTTP-01 | certificate issuance/renewal |
| TCP `443` | inbound to LXD host | optional | certificate issuance/renewal or admin tooling |

You do not need to expose LXD's management API (`8443`) to Netlify.

If the backend is later moved off Netlify and onto the same host as Postgres, do not publish Postgres publicly. Bind Postgres to the private LXD bridge/container network and expose only HTTPS (`443`) for the app.

For the fully VPS-hosted deployment, expose only:

- TCP `80` and `443` to the Caddy container for HTTP-01 and HTTPS.
- TCP `22` only to trusted admin IPs/VPN.

Do not expose:

- TCP `5432` for PostgreSQL.
- TCP `3000` for the Flash Node runtime.
- TCP `8443` for the LXD API.
- TCP `3101` on the host public interface. Caddy reaches it over the private LXD
  network only; do not create an LXD proxy device or a public firewall rule for it.

## Optional webhook deployment

When enabling automatic releases, add the route to the root-managed Caddyfile in
`caddy-edge` before registering the GitHub webhook. It must precede the
catch-all proxy to the Flash runtime:

```caddyfile
handle /api/deploy/webhook {
    reverse_proxy <flash-container-private-address>:3101
}
```

Validate and reload Caddy as its administrator, then confirm `GET
/api/deploy/webhook` returns `404` through the public hostname. GitHub sends an
HMAC-signed `POST`; unsigned requests are rejected. See [VPS webhook
deployment](./vps-auto-deploy.md) for deploy-key, known-host verification, and
GitHub configuration.

## Secret handoff from Netlify

Netlify's CLI can return the managed database URLs, including
`NETLIFY_DATABASE_URL_UNPOOLED`, but manually stored secret values are masked on
read. In practice, commands such as `netlify env:get ENCRYPTION_MASTER_KEY`
return placeholder asterisks, not the original value.

Do not copy masked values into the VPS `.env`. A masked
`ENCRYPTION_MASTER_KEY` will let the app boot but will break decryption of
stored AMAPI/workspace credentials.

Before cutover, collect the original unmasked values from the secret manager or
the person who created them:

```text
ENCRYPTION_MASTER_KEY
INTERNAL_FUNCTION_SECRET
MIGRATION_SECRET
RESEND_API_KEY
RESEND_FROM_EMAIL
STRIPE_SECRET_KEY
STRIPE_WEBHOOK_SECRET
VITE_GOOGLE_MAPS_API_KEY
PUBSUB_SHARED_SECRET, if configured
OPENAI_API_KEY, if Flash Agent is enabled
```

Validate the final `.env` before enabling scheduled jobs:

```bash
grep -E '^[A-Z0-9_]+=' /opt/flash-mdm/.env | cut -d= -f1
node -r dotenv/config -e "const k=process.env.ENCRYPTION_MASTER_KEY; if (!/^[0-9a-f]{64}$/i.test(k ?? '')) process.exit(1)"
```

## Create the LXD container

On the LXD host:

```bash
lxc launch ubuntu:24.04 flash-postgres
lxc exec flash-postgres -- bash
```

Inside the container, install PostgreSQL 17. Neon currently exports from PostgreSQL 17,
and using the same major version avoids dump/restore incompatibilities such as
`transaction_timeout` appearing in the archive:

```bash
apt-get update
apt-get install -y curl ca-certificates gnupg
install -d /usr/share/postgresql-common/pgdg
curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc \
  | gpg --batch --yes --dearmor -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.gpg
echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.gpg] https://apt.postgresql.org/pub/repos/apt noble-pgdg main" \
  > /etc/apt/sources.list.d/pgdg.list
apt-get update
apt-get install -y postgresql-17 postgresql-contrib-17
systemctl enable --now postgresql
```

Create the database and role:

```bash
DB_PASS='<generate-a-long-random-password>'

sudo -u postgres psql -v ON_ERROR_STOP=1 -v db_pass="$DB_PASS" <<'SQL'
CREATE ROLE flashmdm WITH LOGIN PASSWORD :'db_pass';
CREATE DATABASE flash_mdm OWNER flashmdm;
GRANT ALL PRIVILEGES ON DATABASE flash_mdm TO flashmdm;
SQL
```

## Configure Postgres networking

Find the installed PostgreSQL major version:

```bash
pg_lsclusters
```

The examples below use PostgreSQL `17`. Adjust the path if your version differs.

Edit `/etc/postgresql/17/main/postgresql.conf`:

```conf
listen_addresses = '*'
ssl = on
ssl_cert_file = '/etc/postgresql/17/main/server.crt'
ssl_key_file = '/etc/postgresql/17/main/server.key'
```

Edit `/etc/postgresql/17/main/pg_hba.conf` and add one line per allowed Netlify/static proxy CIDR:

```conf
hostssl flash_mdm flashmdm <allowed-source-cidr> scram-sha-256
```

Do not add a broad `0.0.0.0/0` rule for production. If you must add one briefly for migration testing, remove it immediately after confirming the final source IP path.

Reload Postgres after changes:

```bash
systemctl reload postgresql
```

## Add a trusted TLS certificate

Because Flash MDM sets `ssl: { rejectUnauthorized: true }` in production, the database certificate must be trusted by Node.js and match the hostname in `DATABASE_URL`.

One practical approach is:

1. Point `db.flash.example.com` at the LXD host public IP.
2. Issue a Let's Encrypt certificate on the host or in the container.
3. Copy or mount the full-chain certificate and private key into the Postgres container.
4. Set the files to `postgres:postgres` with key mode `0600`.
5. Reload Postgres.

Example file permissions inside the container:

```bash
install -o postgres -g postgres -m 0644 /path/to/fullchain.pem /etc/postgresql/17/main/server.crt
install -o postgres -g postgres -m 0600 /path/to/privkey.pem /etc/postgresql/17/main/server.key
systemctl reload postgresql
```

Add a certificate renewal hook that repeats the copy and reload after every renewal.

## Expose the container port

Prefer forwarding only the database port from the host public interface to the container.

Example LXD proxy device:

```bash
lxc config device add flash-postgres pgsql proxy \
  listen=tcp:0.0.0.0:5432 \
  connect=tcp:127.0.0.1:5432
```

If Postgres is listening on the container's private address instead of loopback, set `connect=tcp:<container-ip>:5432`.

## Host firewall examples

With UFW on the LXD host:

```bash
ufw default deny incoming
ufw allow from <your-admin-ip> to any port 22 proto tcp
ufw allow from <netlify-or-proxy-cidr-1> to any port 5432 proto tcp
ufw allow from <netlify-or-proxy-cidr-2> to any port 5432 proto tcp
ufw enable
ufw status verbose
```

If you use Let's Encrypt HTTP-01 validation on this host, also allow TCP `80` from anywhere or use DNS-01 validation instead:

```bash
ufw allow 80/tcp
```

## Migrate data from Neon

From a trusted workstation or the LXD host, set both connection strings:

```bash
export OLD_DATABASE_URL='<neon-connection-string>'
export NEW_DATABASE_URL='postgresql://flashmdm:<password>@localhost:5432/flash_mdm?sslmode=disable'
```

Take a backup:

```bash
BACKUP_FILE="flash_mdm_$(date +%Y%m%d_%H%M%S).dump"

pg_dump "$OLD_DATABASE_URL" \
  --format=custom \
  --no-owner \
  --no-acl \
  --file="$BACKUP_FILE"
```

If the Neon database includes platform telemetry extensions such as
`pg_stat_statements`, exclude them from the application restore list:

```bash
pg_restore --list "$BACKUP_FILE" \
  | grep -v 'pg_stat_statements' \
  > restore-list.txt
```

Restore it:

```bash
pg_restore \
  --use-list=restore-list.txt \
  --dbname="$NEW_DATABASE_URL" \
  --no-owner \
  --no-acl \
  --clean \
  --if-exists \
  "$BACKUP_FILE"
```

Verify:

```bash
psql "$NEW_DATABASE_URL" -c '\dt'
psql "$NEW_DATABASE_URL" -c 'select count(*) from _migrations;'
```

## Cut over to VPS

1. Put the site into a maintenance window or otherwise stop writes.
2. Stop `flashmdm` on the VPS.
3. Run a final `pg_dump` from Neon and restore it into the local PostgreSQL 17
   database.
4. Populate `/opt/flash-mdm/.env` with real unmasked production secrets.
5. Start `flashmdm`.
6. Confirm Caddy routes `flash-mdm.bayton.org` to the Flash container and has a
   valid certificate.
7. Run the migration endpoint:

```bash
curl https://flash-mdm.bayton.org/api/migrate \
  -H "x-migration-secret: <MIGRATION_SECRET value>"
```

8. Run the VPS validator:

```bash
./scripts/validate-vps-flash.sh
```

9. Smoke test login, dashboard load, device list, policy read/write, and any
   webhook-dependent flows.
10. Enable scheduled jobs only after the real secrets are installed and
   decryption-dependent flows pass.
11. Keep Neon read-only or retained until backups and smoke tests are verified.

## Ongoing operations

- Schedule `pg_dump` or filesystem/LXD snapshots.
- Test restore into staging before relying on backups.
- Monitor disk, memory, connection count, TLS certificate expiry, and Postgres logs.
- Rotate `flashmdm` credentials after any temporary broad firewall rule or migration workstation access is removed.
