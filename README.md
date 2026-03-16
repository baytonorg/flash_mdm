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

**For local development:** If you have a local Postgres database, apply the migrations manually:

```bash
for f in netlify/migrations/*.sql; do
  psql "$DATABASE_URL" -f "$f"
done
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

1. In your `.env` file, set `BOOTSTRAP_SECRET` to any random string (e.g. `my-temp-secret-123`).
2. Restart the app.
3. Register a new account — the first user to register will be granted superadmin access.
4. **Remove** `BOOTSTRAP_SECRET` from your `.env` afterwards (it's only needed once).

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
| `PUBSUB_SHARED_SECRET` | Recommended | A secret string to authenticate incoming device notifications from Google. Pick any strong random string |
| `VITE_GOOGLE_MAPS_API_KEY` | For geofencing | A Google Maps JavaScript API key (for the map views) |
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
