# Flash MDM

An Android device management platform built on Google's [Android Management API](https://developers.google.com/android/management) (AMAPI). It lets you manage Android devices — set policies, deploy apps, track locations, run automated workflows, and more — all from a web dashboard.

Flash MDM runs on [Netlify](https://netlify.com) with a React frontend and a serverless Node.js backend backed by Postgres.

## What you'll need

Before you start, you'll need accounts on the following services (all have free tiers):

| Service | What it's for | Sign up |
|---------|--------------|---------|
| **Netlify** | Hosts the app, runs the backend, provides the database | [netlify.com](https://netlify.com) |
| **Google Cloud** | Connects to Android devices via the Management API | [console.cloud.google.com](https://console.cloud.google.com) |
| **Resend** | Sends emails (login links, invitations, alerts) | [resend.com](https://resend.com) |
| **Stripe** | Handles billing and licence management (optional) | [stripe.com](https://stripe.com) |

You'll also need **Node.js 20 or newer** installed on your computer. You can download it from [nodejs.org](https://nodejs.org).

## Getting started

### 1. Clone the repository

Open a terminal and run:

```bash
git clone https://github.com/jasonbayton/flash_mdm.git
cd flash_mdm
npm install
```

This downloads the code and installs all dependencies.

### 2. Create your environment file

The app needs several configuration values (API keys, secrets, etc.) to run. These are stored in a file called `.env` which is never committed to the repository.

```bash
cp .env.example .env
```

Now open `.env` in a text editor and fill in the values. Each variable is explained in the file, and they're also listed in the [Environment Variables](#environment-variables) section below.

### 3. Set up the database

**On Netlify (recommended):** The database is provided automatically when you enable Netlify DB on your site. Migrations (database setup scripts) run automatically on each deploy.

**For local development:** If you have a local Postgres database, start the app with `npx netlify dev` and then run migrations via the built-in endpoint:

```bash
curl http://localhost:8888/api/migrate -H "x-migration-secret: $MIGRATION_SECRET"
```

### 4. Run the app

```bash
# Full app (frontend + backend) — requires the Netlify CLI
npx netlify dev

# Or frontend only (useful for UI work)
npm run dev
```

The app will be available at `http://localhost:8888` (full stack) or `http://localhost:5173` (frontend only).

### 5. Create your first admin account

1. Open the app and register a new account — the first user to register is automatically granted **superadmin** access.
2. After registering, you can optionally enable **invite-only registration** in superadmin settings to prevent anyone else from self-registering.

> **Optional:** If you want to protect bootstrap registration with a secret (e.g. on a publicly accessible server), set `BOOTSTRAP_SECRET` in your `.env` before registering. The first registration will then require an `x-bootstrap-secret` HTTP header matching that value — which means you'll need to register via `curl` or an API client rather than the web UI. Remove `BOOTSTRAP_SECRET` after the first user is created.

## Deploying to Netlify

1. Push your fork to GitHub.
2. In Netlify, click **"Add new site" > "Import an existing project"** and select your repository.
3. Netlify will detect `netlify.toml` and configure the build automatically.
4. Go to **Site Settings > Environment Variables** and add all the variables from your `.env` file.
5. Enable **Netlify DB** on your site (Site Settings > Database).
6. Trigger a deploy — the database migrations will run automatically.

For a more detailed walkthrough, see the [step-by-step deployment guide](./docs/deployment/netlify-step-by-step.md).

## Environment variables

Copy `.env.example` to `.env` for local development. On Netlify, set these in **Site Settings > Environment Variables**.

| Variable | Required | What it does |
|----------|----------|--------------|
| `DATABASE_URL` | Automatic on Netlify | Connection string for your Postgres database |
| `ENCRYPTION_MASTER_KEY` | Yes | A secret key used to encrypt sensitive data in the database. Generate one by running: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `RESEND_API_KEY` | Yes | Your API key from [Resend](https://resend.com) (for sending emails) |
| `RESEND_FROM_EMAIL` | No | Custom "from" email address (e.g. `noreply@yourdomain.com`) |
| `STRIPE_SECRET_KEY` | For billing | Your Stripe secret key (starts with `sk_`) |
| `STRIPE_WEBHOOK_SECRET` | For billing | Stripe webhook signing secret (starts with `whsec_`) |
| `MIGRATION_SECRET` | Yes | Secret to authenticate the migration endpoint. Generate one: `node -e "console.log(require('crypto').randomBytes(16).toString('hex'))"` |
| `INTERNAL_FUNCTION_SECRET` | Yes | Secret for internal function-to-function calls. Generate one the same way as `MIGRATION_SECRET` |
| `PUBSUB_SHARED_SECRET` | Recommended | A secret string to authenticate incoming device notifications from Google. Pick any strong random string |
| `VITE_GOOGLE_MAPS_API_KEY` | For geofencing | A Google Maps JavaScript API key (for the map views) |
| `URL` | For non-Netlify | The public URL of your deployment (e.g. `https://mdm.example.com`). Set automatically on Netlify |
| `BOOTSTRAP_SECRET` | First run only | Temporary secret to create the first admin account (remove after setup) |

### Setting up Google Cloud (Android Management API)

This is what connects Flash MDM to your Android devices.

1. Go to [Google Cloud Console](https://console.cloud.google.com) and create a new project (or use an existing one).
2. Enable the **Android Management API** — search for it in the API Library.
3. **Apply for AMAPI access** — after enabling the API, visit the [Permissible Usage](https://developers.google.com/android/management/permissible-usage) page and submit the quota request form. You'll need to describe your business case (what you're managing and why). Google reviews these manually and will grant enrolment quotas once approved. You can't enrol devices until this is done.
4. Go to **IAM & Admin > Service Accounts** and create a new service account.
5. Give it the **Android Management User** role.
6. Create a JSON key for the service account and download it.
7. In Flash MDM, go to **Settings** and upload the JSON key file. It will be encrypted and stored securely in the database.

> **Note:** The JSON key file is sensitive. Don't place it inside the repository folder — it's listed in `.gitignore` as a safety net, but it's best practice to keep it elsewhere.

### Setting up Stripe (optional — for billing)

If you want to charge for device licences:

1. In your [Stripe Dashboard](https://dashboard.stripe.com), create products and prices for your licensing tiers.
2. Go to **Developers > Webhooks** and add an endpoint pointing to `https://your-site.netlify.app/api/stripe/webhook`.
3. Select the events: `checkout.session.completed` and all `customer.subscription.*` events.
4. Copy the **webhook signing secret** and set it as `STRIPE_WEBHOOK_SECRET`.

### Setting up PubSub (device notifications)

PubSub lets Flash MDM receive real-time updates when devices change state (e.g. a device enrolls, a policy is applied, compliance changes).

1. In Google Cloud Console, go to **Pub/Sub** and create a new topic.
2. Create a **push subscription** pointing to `https://your-site.netlify.app/api/pubsub/webhook`.
3. Under the subscription's authentication settings, add an `Authorization` header with the value `Bearer <your PUBSUB_SHARED_SECRET>` (using the same secret you set in your environment variables).
4. In Flash MDM, when creating an environment, paste the full topic name (e.g. `projects/my-project/topics/my-topic`) into the PubSub topic field.

## How the app is organised

```
flash_mdm/
  src/                        # Frontend (what users see in the browser)
    api/                      # Functions that talk to the backend
    components/               # UI building blocks
      common/                 # Shared components (tables, filters, etc.)
      dashboard/              # Dashboard widgets
      devices/                # Device detail views
      policy/                 # Policy editor
      geofencing/             # Map and geofence management
      workflows/              # Workflow builder
      licensing/              # Licence management
    layouts/                  # Page layouts (logged in vs logged out)
    pages/                    # One file per page/route
    stores/                   # App state (logged-in user, selected workspace, etc.)
  netlify/
    functions/                # Backend API endpoints (serverless functions)
      _lib/                   # Shared backend code (auth, database, encryption, etc.)
    migrations/               # Database setup scripts (run in order)
  website/                    # Optional marketing / landing page (Astro)
```

## Useful commands

Run these from the project root:

```bash
npm run dev            # Start the frontend dev server
npm run build          # Build for production
npm run test           # Run all tests
npm run test:watch     # Run tests and re-run when files change
npm run test:coverage  # Run tests with coverage report
npm run lint           # Check code style
```

## Architecture overview

Flash MDM is organised around **workspaces**, **environments**, and **groups**:

```
Workspace (your organisation)
  └── Environment (a Google Cloud project with AMAPI enabled)
       └── Group (folders for organising devices — can be nested)
            ├── Devices
            └── Policies (rules applied to devices)
```

Key concepts:

- **Policy components** — reusable policy building blocks that can be assigned at any level in the hierarchy and are combined automatically by priority.
- **Roles** — four permission levels (workspace owner, admin, operator, viewer) that control what each user can do.
- **Authentication** — password login with optional two-factor authentication (TOTP), plus email magic links.
- **Encryption** — all sensitive data (credentials, certificates, API keys) is encrypted before being stored in the database.

## API reference

All API endpoints live under `/api/` and are documented with Swagger. Once the app is running, visit `/api-docs` for interactive API documentation.

| Path prefix | What it does |
|-------------|-------------|
| `/api/auth/*` | Login, registration, sessions, two-factor auth |
| `/api/workspaces/*` | Workspace management and user invitations |
| `/api/environments/*` | Environment setup and AMAPI connection |
| `/api/groups/*` | Device group hierarchy |
| `/api/devices/*` | Device listing, details, and commands |
| `/api/policies/*` | Policy creation, editing, and version history |
| `/api/components/*` | Policy component management |
| `/api/apps/*` | App search, details, and deployment |
| `/api/enrollment/*` | Enrolment token and QR code generation |
| `/api/certificates/*` | Certificate management |
| `/api/workflows/*` | Automated workflow configuration |
| `/api/geofences/*` | Geofence boundaries and triggers |
| `/api/licenses/*` | Licence status and assignment |
| `/api/stripe/*` | Billing checkout and webhooks |
| `/api/dashboard/*` | Dashboard statistics |
| `/api/audit/*` | Activity audit log |
| `/api/superadmin/*` | Platform administration |

## Website (optional)

The `website/` folder contains a standalone [Astro](https://astro.build) site — a marketing / landing page for Flash MDM. It's entirely optional and isn't required to run the platform.

If you'd like to deploy it:

1. In Netlify, create a **separate site** (don't add it to the main Flash MDM site).
2. Set the **base directory** to `website/` in the site's build settings.
3. Netlify will pick up `website/netlify.toml` automatically — build command and publish directory are already configured.
4. Deploy. That's it.

For local development:

```bash
cd website
npm install
npm run dev
```

If you don't need a landing page, you can safely ignore or delete the `website/` folder — nothing else in the project depends on it.

## Deploy outside of Netlify

Flash MDM is built on Netlify, but the backend code is largely platform-agnostic. Every API handler uses the standard web [Request/Response API](https://developer.mozilla.org/en-US/docs/Web/API/Request) rather than a Netlify- or Express-specific format, which means the core logic runs on any Node.js-compatible runtime with relatively little adaptation.

### Automated installer (recommended)

The fastest way to deploy on a VPS is the one-line installer. It installs all system dependencies, sets up PostgreSQL, builds the frontend, configures Caddy with auto-TLS, creates a systemd service, runs migrations, and sets up cron jobs:

```bash
curl -fsSL https://raw.githubusercontent.com/baytonorg/flash_mdm/main/install.sh | bash
```

The script will interactively ask for your domain, database credentials, Resend API key (required for email delivery), and optional service keys (Stripe, Google Maps, etc.).

For non-interactive/scripted deployments, set environment variables before running:

```bash
export FLASH_DOMAIN=mdm.example.com
export FLASH_DB_PASS=your-db-password
export FLASH_RESEND_API_KEY=re_xxxxx
export FLASH_RESEND_FROM="Flash MDM <noreply@example.com>"
export FLASH_REPO_URL=https://github.com/baytonorg/flash_mdm.git
curl -fsSL https://raw.githubusercontent.com/baytonorg/flash_mdm/main/install.sh | bash
```

All `FLASH_*` variables are optional — the script will prompt for any that aren't provided. See the full list of supported variables in [`install.sh`](install.sh).

### Manual deployment

If you prefer to deploy manually, or want to understand what the installer does, read on.

### What's Netlify-specific

Only three things tie the backend to Netlify:

| Dependency | Where | What it does |
|-----------|-------|-------------|
| `@netlify/functions` | Handler type imports | Provides the `Context` type — most handlers ignore it (`_context`) |
| `@netlify/blobs` | `netlify/functions/_lib/blobs.ts` | Key-value file storage used for report exports |
| `netlify.toml` | Project root | Routing rules, security headers, and redirect configuration |

Everything else — database access, encryption, authentication, RBAC, rate limiting — uses standard Node.js libraries (`pg`, `crypto`, etc.) with no platform lock-in.

### What you'd need to change

#### 1. Install prerequisites

On Ubuntu/Debian:

```bash
# Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# PostgreSQL
sudo apt-get install -y postgresql postgresql-contrib

# Caddy (or nginx)
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt-get update && sudo apt-get install -y caddy

# Build tools (needed for native npm packages)
sudo apt-get install -y build-essential
```

#### 2. Add an HTTP server and route table

Each file in `netlify/functions/` maps to one API route. On a VPS you need a lightweight server to wire them up. Install [Hono](https://hono.dev) and [tsx](https://github.com/privatenumber/tsx) (for running TypeScript directly):

```bash
npm install hono @hono/node-server dotenv tsx
```

Create a `server.ts` in the project root. Each handler exports a default async function that accepts `(Request, Context)` and returns a `Response`.

**Important:** The routes must match the **frontend-facing URLs** defined in the `[[redirects]]` section of `netlify.toml`, not the function filenames. For example, the frontend calls `/api/auth/register` (with slashes), which Netlify rewrites to `/.netlify/functions/auth-register`. Your Hono routes must use the slash-based paths:

```typescript
// server.ts
import 'dotenv/config';
import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import authLogin from './netlify/functions/auth-login.js';
import authRegister from './netlify/functions/auth-register.js';
import deviceList from './netlify/functions/device-list.js';
import deviceGet from './netlify/functions/device-get.js';
// ... import each handler (~90 files)

// Wrap each Netlify handler for Hono. Catches Response objects thrown by
// auth/RBAC guards and returns them as normal responses.
const h = (handler: Function) => async (c: any) => {
  try {
    return await handler(c.req.raw, {} as any);
  } catch (e) {
    if (e instanceof Response) return e;
    throw e;
  }
};

const app = new Hono();

// Routes must match netlify.toml [[redirects]] "from" paths exactly
app.all('/api/auth/login', h(authLogin));
app.all('/api/auth/register', h(authRegister));
app.all('/api/devices/list', h(deviceList));
app.all('/api/devices/*', h(deviceGet));        // catch-all after specific routes
// ... one line per redirect rule

// SPA fallback — serve the built frontend
app.use('/assets/*', serveStatic({ root: './dist' }));
app.get('*', serveStatic({ root: './dist', path: '/index.html' }));

serve({ fetch: app.fetch, port: 3000 });
```

There are roughly 120 redirect rules in `netlify.toml` to replicate. Order matters — specific routes must come before catch-all wildcards (e.g. `/api/devices/list` before `/api/devices/*`). Use `app.all()` since the handlers themselves check HTTP methods internally.

> **Important:** The `URL` environment variable must be set to your public URL (e.g. `https://mdm.example.com`). Behind a reverse proxy, the request URL seen by handlers is `http://localhost:3000`, but the browser sends `Origin: https://mdm.example.com`. The origin-check middleware uses `URL` to validate same-origin requests — without it, all mutating requests will fail with a 500.

#### 3. Replace blob storage

The file `netlify/functions/_lib/blobs.ts` wraps `@netlify/blobs` in five simple functions (`storeBlob`, `getBlob`, `getBlobJson`, `deleteBlob`, `listBlobs`). Replace this single file with an equivalent backed by:

- **Local filesystem** — simplest for a single VPS
- **S3-compatible storage** — MinIO (self-hosted) or AWS S3
- **Any key-value store** — Redis, SQLite, etc.

The interface is small enough to swap in an afternoon.

#### 4. Move security headers to your reverse proxy

The `netlify.toml` file sets Content-Security-Policy, HSTS, X-Frame-Options, and other headers. On a VPS, configure these in **nginx** or **Caddy** instead.

With Caddy, API requests are reverse-proxied to the Hono server, and everything else is served as static files from the frontend build. Save this as `/etc/caddy/Caddyfile`:

```
mdm.example.com {
    handle /api/* {
        reverse_proxy localhost:3000
    }
    handle {
        root * /path/to/flash_mdm/dist
        try_files {path} /index.html
        file_server
    }
    header {
        Strict-Transport-Security "max-age=31536000; includeSubDomains; preload"
        X-Frame-Options "DENY"
        X-Content-Type-Options "nosniff"
        Referrer-Policy "strict-origin-when-cross-origin"
        Content-Security-Policy "default-src 'self'; script-src 'self'; frame-ancestors 'none'; object-src 'none';"
    }
}
```

Replace `mdm.example.com` with your actual domain. Caddy will automatically provision a Let's Encrypt TLS certificate — no extra configuration needed. If you're testing without a domain, use `:80` instead (and set `NODE_ENV=development` in your `.env` so session cookies work over HTTP).

> **Note:** Caddy runs as its own user and needs to traverse the path to your `dist/` directory. If you cloned into a home directory, ensure the parent directories are world-executable: `chmod o+x /home/youruser /home/youruser/flash_mdm`

#### 5. Build and serve the frontend

```bash
npm run build
```

This creates the `dist/` folder. The Caddy config above serves it with a catch-all fallback to `index.html` for client-side routing. If you're using the Hono `serveStatic` middleware instead of Caddy for static files, the server.ts example above includes that too.

#### 6. Replace scheduled functions with cron

Five handlers run on a schedule on Netlify. On a VPS, trigger them with **cron** by calling each endpoint or invoking the function directly:

| Handler | Schedule | What it does |
|---------|----------|-------------|
| `cleanup-scheduled` | Daily at 03:00 | Purges expired sessions and stale data |
| `geofence-check-scheduled` | Every 10 minutes | Evaluates geofence boundary triggers |
| `licensing-reconcile-scheduled` | Every hour | Reconciles licence state with Stripe |
| `sync-reconcile-scheduled` | Every 15 minutes | Syncs device state with AMAPI |
| `workflow-cron-scheduled` | Every 5 minutes | Runs pending workflow automations |

Example crontab entry: `*/15 * * * * curl -s http://localhost:3000/api/sync-reconcile-scheduled`

#### 7. Handle background functions

Some handlers (named `*-background.ts`) run as long-lived background tasks on Netlify. On a VPS these can run as normal handlers (there's no execution time limit), or you can push them onto a job queue (e.g. BullMQ with Redis) if you want async processing.

### Environment variables

On Netlify, environment variables are set in **Site Settings > Environment Variables**. On a VPS, you have several options:

| Method | How | Best for |
|--------|-----|----------|
| **`.env` file** | Copy `.env.example` to `.env` and fill in values. Load with [dotenv](https://www.npmjs.com/package/dotenv) in your server entry point (`import 'dotenv/config'`) | Local development, simple deployments |
| **System environment** | `export DATABASE_URL=postgres://...` in your shell profile, or set them in your systemd service file under `Environment=` | Single-server production |
| **Docker** | Pass with `docker run -e DATABASE_URL=...` or use `env_file` in `docker-compose.yml` | Containerised deployments |
| **Secret manager** | Store in AWS Secrets Manager, HashiCorp Vault, or similar, and inject at startup | Teams and regulated environments |

The variables themselves are identical regardless of platform — see the [Environment Variables](#environment-variables) table and `.env.example` for the full list. A few variables behave differently on a VPS:

| Variable | Why it's needed on a VPS |
|----------|-------------------------|
| `DATABASE_URL` | On Netlify this is provided automatically by Netlify DB. On a VPS, point it at your own Postgres instance (append `?sslmode=disable` for local Postgres without SSL) |
| `URL` | The public URL of your deployment (e.g. `https://mdm.example.com`). Used to generate magic-link emails and other absolute URLs. On Netlify this is set automatically |
| `RESEND_FROM_EMAIL` | The "from" address for outbound emails (e.g. `App Name <noreply@yourdomain.com>`). The domain must be [verified in your Resend account](https://resend.com/docs/dashboard/domains/introduction). If not set, the app falls back to the default in `netlify/functions/_lib/brand.ts`, which uses the Netlify domain and will fail on non-Netlify deployments |
| `NODE_ENV` | Set to `production` when running behind HTTPS. If you're testing over plain HTTP (no TLS), set to `development` — otherwise session cookies will include the `Secure` flag and browsers will silently reject them over HTTP |

### Database

Flash MDM uses PostgreSQL. On a VPS, install Postgres (or use a managed service like Supabase, Neon, or AWS RDS), create a database and user, then run the migrations:

```bash
# Create database and user
sudo -u postgres psql -c "CREATE ROLE flashmdm WITH LOGIN PASSWORD 'your-strong-password';"
sudo -u postgres psql -c "CREATE DATABASE flash_mdm OWNER flashmdm;"
sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE flash_mdm TO flashmdm;"

# Set your connection string
export DATABASE_URL="postgresql://flashmdm:your-strong-password@localhost:5432/flash_mdm?sslmode=disable"
```

Then start the server and run migrations via the built-in migration endpoint:

```bash
# Start the server (if not already running)
npx tsx server.ts &

# Run all migrations (requires MIGRATION_SECRET from your .env)
curl http://localhost:3000/api/migrate -H "x-migration-secret: $MIGRATION_SECRET"
```

The migration endpoint is idempotent — it skips migrations that have already been applied, so it's safe to run on every deploy.

> **Note:** Add `?sslmode=disable` to `DATABASE_URL` when connecting to a local Postgres instance that doesn't have SSL configured. Without it, the Node.js `pg` driver will fail with a `DEPTH_ZERO_SELF_SIGNED_CERT` error.

This is the same process as local development — no Netlify-specific database features are used.

### Running the server

You can run the server directly with:

```bash
npx tsx server.ts
```

For production, set it up as a **systemd service** so it starts automatically and restarts on failure:

```ini
# /etc/systemd/system/flashmdm.service
[Unit]
Description=Flash MDM Server
After=network.target postgresql.service

[Service]
Type=simple
User=youruser
WorkingDirectory=/path/to/flash_mdm
ExecStart=/path/to/flash_mdm/node_modules/.bin/tsx server.ts
Restart=on-failure
RestartSec=5
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

Then enable and start it:

```bash
sudo systemctl daemon-reload
sudo systemctl enable flashmdm
sudo systemctl start flashmdm
```

## Brand customisation

To rename the product or change branding, edit these two files:

- `src/lib/brand.ts` (frontend)
- `netlify/functions/_lib/brand.ts` (backend)

All UI text, email templates, and authenticator app labels pull from these files.

## Documentation

The [`docs/`](./docs/) directory has detailed documentation on every aspect of the platform:

- [Deployment step-by-step](./docs/deployment/netlify-step-by-step.md) — full walkthrough from zero to running instance
- [Security overview](./docs/security/overview.md) — authentication, access control, encryption, and hardening
- [API endpoints reference](./docs/reference/endpoints.md) — full endpoint inventory
- [Environment variables](./docs/reference/environment-variables.md) — complete env var reference

## Licence

This project is licensed under the [GNU General Public License v3.0](./LICENSE). See the `LICENSE` file for the full text.
