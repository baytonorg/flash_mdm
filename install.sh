#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
#  Flash MDM — VPS Installer
#
#  Interactive:
#    curl -fsSL https://flash.bayton.net/install.sh | bash
#    bash install.sh
#
#  Non-interactive (set env vars before running):
#    export FLASH_DOMAIN=mdm.example.com
#    export FLASH_DB_PASS=supersecret
#    export FLASH_REPO_URL=https://github.com/baytonorg/flash_mdm.git
#    bash install.sh
#
#  All FLASH_* env vars are optional overrides; the script will skip
#  the corresponding prompt when they are set.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

# ── TTY handling ─────────────────────────────────────────────────────────────
# When piped via curl | bash, stdin is the pipe, not the terminal.
# We reopen /dev/tty so interactive prompts still work.
HAS_TTY=false
if [[ -t 0 ]]; then
  HAS_TTY=true
elif [[ -r /dev/tty ]] && (echo < /dev/tty) 2>/dev/null; then
  # stdin is piped (e.g. curl | bash) but a TTY is available
  exec </dev/tty
  HAS_TTY=true
fi
# If no TTY is available (e.g. non-interactive SSH), prompts will use
# defaults or FLASH_* env var overrides. Missing required values will fail.

# ── Colours & helpers ────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'

info()    { printf "${CYAN}▸${NC} %s\n" "$*"; }
success() { printf "${GREEN}✔${NC} %s\n" "$*"; }
warn()    { printf "${YELLOW}⚠${NC} %s\n" "$*"; }
fail()    { printf "${RED}✖ %s${NC}\n" "$*" >&2; exit 1; }

# ask PROMPT DEFAULT VARNAME — skips prompt if FLASH_VARNAME is set
ask() {
  local prompt="$1" default="${2:-}" var="$3" value env_key="FLASH_$3"
  # Check for env var override
  if [[ -n "${!env_key:-}" ]]; then
    eval "$var=\${!env_key}"
    info "$prompt → ${!env_key} (from $env_key)"
    return
  fi
  # No TTY and no env override — use default or fail
  if [[ "$HAS_TTY" != "true" ]]; then
    if [[ -n "$default" ]]; then
      eval "$var=\$default"
      info "$prompt → $default (default, no TTY)"
      return
    else
      fail "No TTY available and $env_key not set. Cannot prompt for: $prompt"
    fi
  fi
  if [[ -n "$default" ]]; then
    printf "${BOLD}%s${NC} [%s]: " "$prompt" "$default"
  else
    printf "${BOLD}%s${NC}: " "$prompt"
  fi
  read -r value
  value="${value:-$default}"
  [[ -z "$value" ]] && fail "A value is required for: $prompt"
  eval "$var=\$value"
}

# ask_secret PROMPT VARNAME — skips prompt if FLASH_VARNAME is set
ask_secret() {
  local prompt="$1" var="$2" value env_key="FLASH_$2"
  if [[ -n "${!env_key:-}" ]]; then
    eval "$var=\${!env_key}"
    info "$prompt → ••••••• (from $env_key)"
    return
  fi
  if [[ "$HAS_TTY" != "true" ]]; then
    fail "No TTY available and $env_key not set. Cannot prompt for: $prompt"
  fi
  printf "${BOLD}%s${NC}: " "$prompt"
  read -rs value
  echo
  [[ -z "$value" ]] && fail "A value is required for: $prompt"
  eval "$var=\$value"
}

ask_yn() {
  local prompt="$1" default="${2:-y}" answer
  # If no TTY, skip optional prompts (default to "n")
  # Users can enable features via FLASH_* env vars instead
  if [[ "$HAS_TTY" != "true" ]]; then
    answer="n"
    return 1
  fi
  printf "${BOLD}%s${NC} [%s]: " "$prompt" "$default"
  read -r answer
  answer="${answer:-$default}"
  [[ "$answer" =~ ^[Yy] ]]
}

gen_hex() {
  # Use node if available, otherwise openssl, otherwise /dev/urandom
  if command -v node >/dev/null 2>&1; then
    node -e "console.log(require('crypto').randomBytes($1).toString('hex'))"
  elif command -v openssl >/dev/null 2>&1; then
    openssl rand -hex "$1"
  else
    head -c "$1" /dev/urandom | xxd -p | tr -d '\n'
    echo
  fi
}

env_value() {
  local value="${1:-}"
  value="${value//\\/\\\\}"
  value="${value//\"/\\\"}"
  value="${value//\$/\\$}"
  value="${value//\`/\\\`}"
  printf '"%s"' "$value"
}

read_env_value() {
  local env_file="$1" key="$2"
  node - "$env_file" "$key" <<'NODE'
const fs = require('fs');
const [envFile, key] = process.argv.slice(2);
const line = fs.readFileSync(envFile, 'utf8')
  .split(/\r?\n/)
  .find((candidate) => candidate.startsWith(`${key}=`));
if (!line) process.exit(2);
let value = line.slice(key.length + 1).trim();
if (value.startsWith('"') && value.endsWith('"')) {
  value = value.slice(1, -1).replace(/\\([\\"$`])/g, '$1');
}
process.stdout.write(value);
NODE
}

migration_response_ok() {
  node -e '
    let body = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => { body += chunk; });
    process.stdin.on("end", () => {
      try {
        const parsed = JSON.parse(body);
        const summary = parsed && parsed.summary;
        process.exit(summary && Number(summary.errors) === 0 ? 0 : 1);
      } catch {
        process.exit(1);
      }
    });
  '
}

activate_release() {
  local release_dir="$1" current_link="$2"
  local next_link="${current_link}.next"
  node - "$release_dir" "$current_link" "$next_link" <<'NODE'
const fs = require('fs');
const [releaseDir, currentLink, nextLink] = process.argv.slice(2);
try { fs.unlinkSync(nextLink); } catch (err) { if (err.code !== 'ENOENT') throw err; }
fs.symlinkSync(releaseDir, nextLink);
fs.renameSync(nextLink, currentLink);
NODE
}

validate_database_identifier() {
  local label="$1" value="$2"
  [[ "$value" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] \
    || fail "$label must contain only letters, numbers, and underscores and cannot start with a number."
}

normalize_schema_ownership() {
  local database_name="$1" owner="$2"
  validate_database_identifier "Database username" "$owner"
  sudo -u postgres psql -d "$database_name" -Atqc \
    "SELECT 1 FROM pg_roles WHERE rolname = '$owner'" | grep -qx '1' \
    || return 1
  sudo -u postgres psql -d "$database_name" -Atqc "
    SELECT format(
      'ALTER %s %I.%I OWNER TO %I;',
      CASE c.relkind WHEN 'S' THEN 'SEQUENCE' ELSE 'TABLE' END,
      n.nspname,
      c.relname,
      '$owner'
    )
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind IN ('r', 'p', 'S')
      AND pg_get_userbyid(c.relowner) <> '$owner'
  " | sudo -u postgres psql -d "$database_name" -v ON_ERROR_STOP=1
}

# ── Banner ───────────────────────────────────────────────────────────────────
clear 2>/dev/null || true
cat << 'BANNER'

  ███████╗██╗      █████╗ ███████╗██╗  ██╗    ███╗   ███╗██████╗ ███╗   ███╗
  ██╔════╝██║     ██╔══██╗██╔════╝██║  ██║    ████╗ ████║██╔══██╗████╗ ████║
  █████╗  ██║     ███████║███████╗███████║    ██╔████╔██║██║  ██║██╔████╔██║
  ██╔══╝  ██║     ██╔══██║╚════██║██╔══██║    ██║╚██╔╝██║██║  ██║██║╚██╔╝██║
  ██║     ███████╗██║  ██║███████║██║  ██║    ██║ ╚═╝ ██║██████╔╝██║ ╚═╝ ██║
  ╚═╝     ╚══════╝╚═╝  ╚═╝╚══════╝╚═╝  ╚═╝    ╚═╝     ╚═╝╚═════╝ ╚═╝     ╚═╝

  VPS Installer

BANNER

# ── Pre-flight checks ───────────────────────────────────────────────────────
[[ $EUID -eq 0 ]] && fail "Do not run as root. The script will use sudo when needed."
command -v sudo >/dev/null || fail "sudo is required but not found."

info "Detecting OS..."
if [[ -f /etc/os-release ]]; then
  . /etc/os-release
  info "Detected: $PRETTY_NAME"
else
  warn "Could not detect OS. This script targets Ubuntu/Debian."
fi

# ── Gather configuration ────────────────────────────────────────────────────
echo
printf "${BOLD}${CYAN}── Configuration ──────────────────────────────────────────${NC}\n"
echo

ask "Domain for Flash MDM (e.g. mdm.example.com)" "" DOMAIN
ask "Install directory" "/opt/flash-mdm" INSTALL_DIR

USE_EXTERNAL_CADDY=false
case "${FLASH_EXTERNAL_CADDY:-false}" in
  true|TRUE|1|yes|YES) USE_EXTERNAL_CADDY=true ;;
  false|FALSE|0|no|NO|"") ;;
  *) fail "FLASH_EXTERNAL_CADDY must be true or false" ;;
esac
if [[ "$USE_EXTERNAL_CADDY" == "true" ]]; then
  info "TLS proxy:       external Caddy (container Caddy disabled)"
fi

ENV_FILE="$INSTALL_DIR/.env"
CURRENT_LINK="$INSTALL_DIR/current"
IS_UPGRADE=false
if [[ -f "$ENV_FILE" ]]; then
  IS_UPGRADE=true
  info "Existing installation detected; environment and database credentials will be preserved"
fi

echo
printf "${BOLD}${CYAN}── Database ───────────────────────────────────────────────${NC}\n"
echo

DB_NAME="flash_mdm"
DB_USER="flashmdm"
DB_PASS=""
if [[ "$IS_UPGRADE" != "true" ]]; then
  ask "PostgreSQL database name" "flash_mdm" DB_NAME
  ask "PostgreSQL username"      "flashmdm"  DB_USER
fi
POSTGRES_MAJOR="${FLASH_POSTGRES_MAJOR:-17}"
if [[ -n "${FLASH_POSTGRES_MAJOR:-}" ]]; then
  info "PostgreSQL major version → $POSTGRES_MAJOR (from FLASH_POSTGRES_MAJOR)"
else
  info "PostgreSQL major version → $POSTGRES_MAJOR (default)"
fi

if [[ "$IS_UPGRADE" != "true" ]]; then
  while [[ -z "$DB_PASS" ]]; do
    ask_secret "PostgreSQL password (will be created)" DB_PASS
  done
fi

echo
printf "${BOLD}${CYAN}── Email (Resend) ─────────────────────────────────────────${NC}\n"
echo

RESEND_API_KEY=""
RESEND_FROM=""
if [[ "$IS_UPGRADE" == "true" ]]; then
  info "Resend configuration → preserved from existing environment"
elif [[ -n "${FLASH_RESEND_API_KEY:-}" ]]; then
  RESEND_API_KEY="$FLASH_RESEND_API_KEY"
  RESEND_FROM="${FLASH_RESEND_FROM:-}"
  info "Resend API key → ••••••• (from FLASH_RESEND_API_KEY)"
  [[ -n "$RESEND_FROM" ]] && info "Resend from → $RESEND_FROM (from FLASH_RESEND_FROM)"
else
  info "Flash MDM requires Resend (https://resend.com) for transactional email."
  info "Registration, magic links, and invitations all depend on email delivery."
  ask_secret "Resend API key" RESEND_API_KEY
  ask "Resend from address (e.g. Flash MDM <noreply@example.com>)" "" RESEND_FROM
fi

echo
printf "${BOLD}${CYAN}── Optional services ──────────────────────────────────────${NC}\n"
echo

STRIPE_SECRET=""
STRIPE_WEBHOOK=""
if [[ "$IS_UPGRADE" == "true" ]]; then
  info "Stripe → preserved from existing environment"
elif [[ -n "${FLASH_STRIPE_SECRET:-}" ]]; then
  STRIPE_SECRET="$FLASH_STRIPE_SECRET"
  STRIPE_WEBHOOK="${FLASH_STRIPE_WEBHOOK:-}"
  info "Stripe → configured (from env)"
elif ask_yn "Configure Stripe for billing?" "n"; then
  ask_secret "Stripe secret key" STRIPE_SECRET
  ask_secret "Stripe webhook secret" STRIPE_WEBHOOK
fi

GOOGLE_MAPS_KEY=""
if [[ "$IS_UPGRADE" == "true" ]]; then
  info "Google Maps → preserved from existing environment"
elif [[ -n "${FLASH_GOOGLE_MAPS_KEY:-}" ]]; then
  GOOGLE_MAPS_KEY="$FLASH_GOOGLE_MAPS_KEY"
  info "Google Maps → configured (from env)"
elif ask_yn "Configure Google Maps for geofencing?" "n"; then
  ask_secret "Google Maps API key" GOOGLE_MAPS_KEY
fi

BOOTSTRAP_SECRET=""
if [[ "$IS_UPGRADE" == "true" ]]; then
  info "Bootstrap configuration → preserved from existing environment"
elif [[ -n "${FLASH_BOOTSTRAP_SECRET:-}" ]]; then
  BOOTSTRAP_SECRET="$FLASH_BOOTSTRAP_SECRET"
  info "Bootstrap secret → set (from env)"
elif ask_yn "Set a bootstrap secret for first-user registration?" "y"; then
  ask_secret "Bootstrap secret (required to register the first admin)" BOOTSTRAP_SECRET
fi

PUBSUB_SECRET=""
if [[ "$IS_UPGRADE" == "true" ]]; then
  info "Pub/Sub configuration → preserved from existing environment"
elif [[ -n "${FLASH_PUBSUB_SECRET:-}" ]]; then
  PUBSUB_SECRET="$FLASH_PUBSUB_SECRET"
  info "Pub/Sub secret → set (from env)"
elif ask_yn "Configure Google Pub/Sub shared secret?" "n"; then
  ask_secret "Pub/Sub shared secret" PUBSUB_SECRET
fi

REPO_URL=""
ask "Git repository URL" "https://github.com/baytonorg/flash_mdm.git" REPO_URL

# ── Summary ──────────────────────────────────────────────────────────────────
echo
printf "${BOLD}${CYAN}── Summary ────────────────────────────────────────────────${NC}\n"
echo
info "Domain:          $DOMAIN"
info "Install dir:     $INSTALL_DIR"
if [[ "$IS_UPGRADE" == "true" ]]; then
  info "Configuration:   preserving existing $ENV_FILE"
else
  info "Database:        $DB_NAME (user: $DB_USER)"
  info "Resend:          $(if [[ -n "$RESEND_API_KEY" ]]; then echo configured; else echo skipped; fi)"
  info "Stripe:          $(if [[ -n "$STRIPE_SECRET" ]]; then echo configured; else echo skipped; fi)"
  info "Google Maps:     $(if [[ -n "$GOOGLE_MAPS_KEY" ]]; then echo configured; else echo skipped; fi)"
  info "Bootstrap:       ${BOOTSTRAP_SECRET:+set}${BOOTSTRAP_SECRET:-not set (first user auto-promoted)}"
fi
echo

if [[ "$HAS_TTY" == "true" ]]; then
  if ! ask_yn "Proceed with installation?" "y"; then
    info "Aborted."
    exit 0
  fi
fi

# ── 1. Install system dependencies ──────────────────────────────────────────
echo
printf "${BOLD}${CYAN}── Step 1/9: System dependencies ──────────────────────────${NC}\n"
echo

info "Updating package index..."
sudo DEBIAN_FRONTEND=noninteractive apt-get update -qq

info "Installing build essentials, git, curl..."
sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq git curl build-essential ca-certificates gnupg util-linux > /dev/null

# Node.js 20
if command -v node >/dev/null && [[ "$(node -v)" == v20.* || "$(node -v)" == v22.* ]]; then
  success "Node.js $(node -v) already installed"
else
  info "Installing Node.js 20..."
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - > /dev/null 2>&1
  sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq nodejs > /dev/null
  success "Node.js $(node -v) installed"
fi

# PostgreSQL
if command -v psql >/dev/null && psql --version | grep -q " ${POSTGRES_MAJOR}\\."; then
  success "PostgreSQL $(psql --version | awk '{print $3}') already installed"
else
  info "Installing PostgreSQL ${POSTGRES_MAJOR}..."
  sudo install -d /usr/share/postgresql-common/pgdg
  curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc \
    | sudo gpg --batch --yes --dearmor -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.gpg
  echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.gpg] https://apt.postgresql.org/pub/repos/apt ${VERSION_CODENAME:-bookworm}-pgdg main" \
    | sudo tee /etc/apt/sources.list.d/pgdg.list > /dev/null
  sudo DEBIAN_FRONTEND=noninteractive apt-get update -qq
  sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq "postgresql-${POSTGRES_MAJOR}" "postgresql-contrib-${POSTGRES_MAJOR}" > /dev/null
  sudo systemctl enable --now postgresql
  success "PostgreSQL ${POSTGRES_MAJOR} installed and started"
fi

if [[ "$USE_EXTERNAL_CADDY" == "true" ]]; then
  info "Skipping container Caddy; external proxy must route $DOMAIN to port 3000"
else
  if command -v caddy >/dev/null; then
    success "Caddy already installed"
  else
    info "Installing Caddy..."
    sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq debian-keyring debian-archive-keyring apt-transport-https > /dev/null 2>&1
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg 2>/dev/null
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list > /dev/null
    sudo DEBIAN_FRONTEND=noninteractive apt-get update -qq
    sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq caddy > /dev/null
    success "Caddy installed"
  fi
fi

# ── 2. PostgreSQL setup ─────────────────────────────────────────────────────
echo
printf "${BOLD}${CYAN}── Step 2/9: Database setup ───────────────────────────────${NC}\n"
echo

info "Creating PostgreSQL role and database..."
if [[ "$IS_UPGRADE" == "true" ]]; then
  DATABASE_URL=$(read_env_value "$ENV_FILE" DATABASE_URL) \
    || fail "Existing environment does not contain a readable DATABASE_URL"
  PGPASSWORD="" psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -Atqc 'SELECT 1' > /dev/null \
    || fail "Existing DATABASE_URL cannot connect; the environment file was left unchanged"
  success "Existing database connection verified"
  info "Normalizing public schema ownership for the runtime database role..."
  normalize_schema_ownership "$DB_NAME" "$DB_USER" \
    || fail "Could not normalize public schema ownership for the runtime database role"
  success "Public schema ownership verified for $DB_USER"
else
  validate_database_identifier "Database name" "$DB_NAME"
  validate_database_identifier "Database username" "$DB_USER"
  DB_PASS_SQL=${DB_PASS//\'/\'\'}
  sudo -u postgres psql -v ON_ERROR_STOP=1 <<SQL
DO \$\$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '${DB_USER}') THEN
    CREATE ROLE ${DB_USER} WITH LOGIN PASSWORD '${DB_PASS_SQL}';
  ELSE
    ALTER ROLE ${DB_USER} WITH LOGIN PASSWORD '${DB_PASS_SQL}';
  END IF;
END
\$\$;
SELECT 'CREATE DATABASE ${DB_NAME} OWNER ${DB_USER}'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = '${DB_NAME}')\gexec
GRANT ALL PRIVILEGES ON DATABASE ${DB_NAME} TO ${DB_USER};
SQL

  DB_PASS_URL=$(printf '%s' "$DB_PASS" | node -e '
    let value = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => { value += chunk; });
    process.stdin.on("end", () => process.stdout.write(encodeURIComponent(value)));
  ')
  DATABASE_URL="postgresql://${DB_USER}:${DB_PASS_URL}@localhost:5432/${DB_NAME}?sslmode=disable"
  PGPASSWORD="$DB_PASS" psql -h localhost -U "$DB_USER" -d "$DB_NAME" \
    -v ON_ERROR_STOP=1 -Atqc 'SELECT 1' > /dev/null \
    || fail "Generated database credentials could not connect"
  success "Database '$DB_NAME' ready and connection verified"
fi

# ── 3. Clone repository ─────────────────────────────────────────────────────
echo
printf "${BOLD}${CYAN}── Step 3/9: Clone repository ─────────────────────────────${NC}\n"
echo

RELEASE_ID="$(date -u +%Y%m%dT%H%M%SZ)-$(gen_hex 4)"
RELEASES_DIR="$INSTALL_DIR/releases"
RELEASE_DIR="$RELEASES_DIR/$RELEASE_ID"
PREVIOUS_RELEASE=""

if [[ -L "$CURRENT_LINK" ]]; then
  PREVIOUS_RELEASE=$(readlink -f "$CURRENT_LINK")
elif [[ -d "$INSTALL_DIR/.git" ]]; then
  # Legacy installs ran directly from INSTALL_DIR. Keep that checkout as the first
  # rollback target while moving subsequent releases behind the current symlink.
  PREVIOUS_RELEASE="$INSTALL_DIR"
fi

info "Cloning candidate release to $RELEASE_DIR..."
sudo mkdir -p "$RELEASES_DIR"
sudo chown "$USER:$USER" "$INSTALL_DIR" "$RELEASES_DIR"
git clone "$REPO_URL" "$RELEASE_DIR"
if [[ -n "${FLASH_RELEASE_REF:-}" ]]; then
  git -C "$RELEASE_DIR" checkout --detach "$FLASH_RELEASE_REF"
fi
cd "$RELEASE_DIR"
success "Candidate source ready at $RELEASE_DIR"

# ── 4. Generate secrets & write .env ────────────────────────────────────────
echo
printf "${BOLD}${CYAN}── Step 4/9: Environment configuration ────────────────────${NC}\n"
echo

if [[ "$IS_UPGRADE" == "true" ]]; then
  MIGRATION_SECRET=$(read_env_value "$ENV_FILE" MIGRATION_SECRET) \
    || fail "Existing environment does not contain a readable MIGRATION_SECRET"
  success "Existing .env preserved byte-for-byte"
else
  ENCRYPTION_KEY=$(gen_hex 32)
  MIGRATION_SECRET=$(gen_hex 16)
  INTERNAL_SECRET=$(gen_hex 16)

  cat > "$ENV_FILE" <<ENVFILE
# ── Flash MDM — Generated by installer on $(date -Iseconds) ──
DATABASE_URL=$(env_value "$DATABASE_URL")
ENCRYPTION_MASTER_KEY=$(env_value "$ENCRYPTION_KEY")
RESEND_API_KEY=$(env_value "$RESEND_API_KEY")
RESEND_FROM_EMAIL=$(env_value "$RESEND_FROM")
STRIPE_SECRET_KEY=$(env_value "$STRIPE_SECRET")
STRIPE_WEBHOOK_SECRET=$(env_value "$STRIPE_WEBHOOK")
MIGRATION_SECRET=$(env_value "$MIGRATION_SECRET")
INTERNAL_FUNCTION_SECRET=$(env_value "$INTERNAL_SECRET")
LICENSING_ENFORCEMENT_ENABLED=false
LICENSING_DRY_RUN=true
PUBSUB_SHARED_SECRET=$(env_value "$PUBSUB_SECRET")
VITE_GOOGLE_MAPS_API_KEY=$(env_value "$GOOGLE_MAPS_KEY")
URL=$(env_value "https://${DOMAIN}")
NODE_ENV=production
FLASH_BLOB_DIR=$(env_value "${INSTALL_DIR}/data/blobs")
ENVFILE

  if [[ -n "$BOOTSTRAP_SECRET" ]]; then
    echo "BOOTSTRAP_SECRET=$(env_value "$BOOTSTRAP_SECRET")" >> "$ENV_FILE"
  fi

  chmod 600 "$ENV_FILE"
  success ".env written (mode 600)"
fi

ln -s "$ENV_FILE" "$RELEASE_DIR/.env"

# ── 5. Install npm dependencies & build ─────────────────────────────────────
echo
printf "${BOLD}${CYAN}── Step 5/9: Dependencies & build ─────────────────────────${NC}\n"
echo

cd "$RELEASE_DIR"

info "Installing npm dependencies (this may take a minute)..."
npm ci 2>&1 | tail -1
success "npm packages installed"

info "Installing VPS runtime dependencies..."
missing_runtime_deps=()
for dep in hono @hono/node-server dotenv tsx; do
  if ! node -e "import.meta.resolve('${dep}')" >/dev/null 2>&1; then
    missing_runtime_deps+=("$dep")
  fi
done
if (( ${#missing_runtime_deps[@]} > 0 )); then
  fail "Candidate release is missing required VPS packages: ${missing_runtime_deps[*]}"
else
  success "VPS runtime packages already declared"
fi

info "Building frontend (this may take a minute)..."
npm run build 2>&1 | tail -5
success "Frontend built to dist/"

# ── 6. Generate server.ts ────────────────────────────────────────────────────
echo
printf "${BOLD}${CYAN}── Step 6/9: Generate server entrypoint ───────────────────${NC}\n"
echo

cat > "$RELEASE_DIR/server.ts" << 'SERVEREOF'
import 'dotenv/config';
import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';

// ── Handler imports ─────────────────────────────────────────────────────────
import authConfig from './netlify/functions/auth-config.js';
import authLogin from './netlify/functions/auth-login.js';
import authLogout from './netlify/functions/auth-logout.js';
import authRegister from './netlify/functions/auth-register.js';
import authSession from './netlify/functions/auth-session.js';
import authProfile from './netlify/functions/auth-profile.js';
import authMagicLinkStart from './netlify/functions/auth-magic-link-start.js';
import authMagicLinkVerify from './netlify/functions/auth-magic-link-verify.js';
import authMagicLinkComplete from './netlify/functions/auth-magic-link-complete.js';
import authPasswordChange from './netlify/functions/auth-password-change.js';
import authPasswordResetStart from './netlify/functions/auth-password-reset-start.js';
import authPasswordResetComplete from './netlify/functions/auth-password-reset-complete.js';
import authTotpSetup from './netlify/functions/auth-totp-setup.js';
import authTotpVerify from './netlify/functions/auth-totp-verify.js';
import workspaceUsers from './netlify/functions/workspace-users.js';
import workspaceInvite from './netlify/functions/workspace-invite.js';
import workspaceCrud from './netlify/functions/workspace-crud.js';
import environmentBind from './netlify/functions/environment-bind.js';
import environmentRenew from './netlify/functions/environment-renew.js';
import environmentEnterprise from './netlify/functions/environment-enterprise.js';
import environmentZeroTouch from './netlify/functions/environment-zero-touch.js';
import environmentCrud from './netlify/functions/environment-crud.js';
import groupCrud from './netlify/functions/group-crud.js';
import deviceList from './netlify/functions/device-list.js';
import deviceBulk from './netlify/functions/device-bulk.js';
import deviceCommand from './netlify/functions/device-command.js';
import deviceOperations from './netlify/functions/device-operations.js';
import deviceGet from './netlify/functions/device-get.js';
import policyAssign from './netlify/functions/policy-assign.js';
import policyOverrides from './netlify/functions/policy-overrides.js';
import policyClone from './netlify/functions/policy-clone.js';
import policyVersions from './netlify/functions/policy-versions.js';
import policyCrud from './netlify/functions/policy-crud.js';
import componentAssign from './netlify/functions/component-assign.js';
import componentCrud from './netlify/functions/component-crud.js';
import appList from './netlify/functions/app-list.js';
import appSearch from './netlify/functions/app-search.js';
import appDeploy from './netlify/functions/app-deploy.js';
import appWebToken from './netlify/functions/app-web-token.js';
import appCrud from './netlify/functions/app-crud.js';
import appFeedback from './netlify/functions/app-feedback.js';
import networkList from './netlify/functions/network-list.js';
import networkDeploy from './netlify/functions/network-deploy.js';
import networkCrud from './netlify/functions/network-crud.js';
import auditLog from './netlify/functions/audit-log.js';
import signinConfig from './netlify/functions/signin-config.js';
import signinEnroll from './netlify/functions/signin-enroll.js';
import enrollmentCreate from './netlify/functions/enrollment-create.js';
import enrollmentList from './netlify/functions/enrollment-list.js';
import enrollmentSync from './netlify/functions/enrollment-sync.js';
import enrollmentCrud from './netlify/functions/enrollment-crud.js';
import certificateCrud from './netlify/functions/certificate-crud.js';
import deploymentJobs from './netlify/functions/deployment-jobs.js';
import deploymentJobsBackground from './netlify/functions/deployment-jobs-background.js';
import pubsubWebhook from './netlify/functions/pubsub-webhook.js';
import workflowCrud from './netlify/functions/workflow-crud.js';
import geofenceCrud from './netlify/functions/geofence-crud.js';
import licenseStatus from './netlify/functions/license-status.js';
import licenseSettings from './netlify/functions/license-settings.js';
import licensePlans from './netlify/functions/license-plans.js';
import licenseGrants from './netlify/functions/license-grants.js';
import licenseAssign from './netlify/functions/license-assign.js';
import stripeCheckout from './netlify/functions/stripe-checkout.js';
import stripePortal from './netlify/functions/stripe-portal.js';
import stripeWebhook from './netlify/functions/stripe-webhook.js';
import workspaceBillingWebhook from './netlify/functions/workspace-billing-webhook.js';
import workspaceBilling from './netlify/functions/workspace-billing.js';
import licensingReconcile from './netlify/functions/licensing-reconcile.js';
import dashboardData from './netlify/functions/dashboard-data.js';
import superadminActions from './netlify/functions/superadmin-actions.js';
import superadminSettings from './netlify/functions/superadmin-settings.js';
import superadminStats from './netlify/functions/superadmin-stats.js';
import superadminUsers from './netlify/functions/superadmin-users.js';
import superadminWorkspaces from './netlify/functions/superadmin-workspaces.js';
import superadminBilling from './netlify/functions/superadmin-billing.js';
import reportExport from './netlify/functions/report-export.js';
import reportDownload from './netlify/functions/report-download.js';
import signupLinkResolve from './netlify/functions/signup-link-resolve.js';
import signupLinkCrud from './netlify/functions/signup-link-crud.js';
import apiKeyCrud from './netlify/functions/api-key-crud.js';
import rolesRbac from './netlify/functions/roles-rbac.js';
import migrate from './netlify/functions/migrate.js';
import mcpAmapi from './netlify/functions/mcp-amapi.js';
import flashagentChat from './netlify/functions/flashagent-chat.js';
import flashagentChatHistory from './netlify/functions/flashagent-chat-history.js';
import flashagentSettings from './netlify/functions/flashagent-settings.js';
import flashagentDownload from './netlify/functions/flashagent-download.js';
import flashagentWorkspaceSettings from './netlify/functions/flashagent-workspace-settings.js';
// Scheduled functions (called via cron)
import cleanupScheduled from './netlify/functions/cleanup-scheduled.js';
import geofenceCheckScheduled from './netlify/functions/geofence-check-scheduled.js';
import licensingReconcileScheduled from './netlify/functions/licensing-reconcile-scheduled.js';
import syncReconcileScheduled from './netlify/functions/sync-reconcile-scheduled.js';
import syncProcessBackground from './netlify/functions/sync-process-background.js';
import workflowCronScheduled from './netlify/functions/workflow-cron-scheduled.js';
import workflowEvaluateBackground from './netlify/functions/workflow-evaluate-background.js';

// ── Wrapper ─────────────────────────────────────────────────────────────────
// Netlify handlers export default(request, context) => Response.
// The h() wrapper adapts them for Hono and catches thrown Responses
// (used by auth/RBAC guards throughout the codebase).
const h = (handler: any) => async (c: any) => {
  try {
    const resp = await handler(c.req.raw, {} as any);
    return resp ?? new Response(null, { status: 204 });
  } catch (e: unknown) {
    if (e instanceof Response) return e;
    console.error('[server] Unhandled error:', e);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};

const app = new Hono();

// ── Auth ────────────────────────────────────────────────────────────────────
app.all('/api/auth/config', h(authConfig));
app.all('/api/auth/login', h(authLogin));
app.all('/api/auth/logout', h(authLogout));
app.all('/api/auth/register', h(authRegister));
app.all('/api/auth/session', h(authSession));
app.all('/api/auth/profile', h(authProfile));
app.all('/api/auth/magic-link-start', h(authMagicLinkStart));
app.all('/api/auth/magic-link-verify', h(authMagicLinkVerify));
app.all('/api/auth/magic-link-complete', h(authMagicLinkComplete));
app.all('/api/auth/password-change', h(authPasswordChange));
app.all('/api/auth/password-reset-start', h(authPasswordResetStart));
app.all('/api/auth/password-reset-complete', h(authPasswordResetComplete));
app.all('/api/auth/totp-setup', h(authTotpSetup));
app.all('/api/auth/totp-verify', h(authTotpVerify));
app.all('/api/auth/totp-verify/verify', h(authTotpVerify));
app.all('/api/auth/totp-verify/disable', h(authTotpVerify));

// ── Workspaces (specific before catch-all) ──────────────────────────────────
app.all('/api/workspaces/users', h(workspaceUsers));
app.all('/api/workspaces/users/*', h(workspaceUsers));
app.all('/api/workspaces/invite', h(workspaceInvite));
app.all('/api/invites/*', h(workspaceInvite));
app.all('/api/workspaces/*', h(workspaceCrud));

// ── Environments ────────────────────────────────────────────────────────────
app.all('/api/environments/bind', h(environmentBind));
app.all('/api/environments/renew', h(environmentRenew));
app.all('/api/environments/enterprise', h(environmentEnterprise));
app.all('/api/environments/zero-touch', h(environmentZeroTouch));
app.all('/api/environments/*', h(environmentCrud));

// ── Groups ──────────────────────────────────────────────────────────────────
app.all('/api/groups/*', h(groupCrud));

// ── Devices (specific before catch-all) ─────────────────────────────────────
app.all('/api/devices/list', h(deviceList));
app.all('/api/devices/bulk', h(deviceBulk));
app.all('/api/devices/command', h(deviceCommand));
app.all('/api/devices/operations', h(deviceOperations));
app.all('/api/devices/operations/*', h(deviceOperations));
app.all('/api/devices/*', h(deviceGet));

// ── Policies (specific before catch-all) ────────────────────────────────────
app.all('/api/policies/assign', h(policyAssign));
app.all('/api/policies/unassign', h(policyAssign));
app.all('/api/policies/assignments', h(policyAssign));
app.all('/api/policies/effective', h(policyAssign));
app.all('/api/policies/overrides', h(policyOverrides));
app.all('/api/policies/overrides/*', h(policyOverrides));
app.all('/api/policies/clone', h(policyClone));
app.all('/api/policies/*/versions', h(policyVersions));
app.all('/api/policies/*/versions/*', h(policyVersions));
app.all('/api/policies/*', h(policyCrud));

// ── Components ──────────────────────────────────────────────────────────────
app.all('/api/components/assign', h(componentAssign));
app.all('/api/components/unassign', h(componentAssign));
app.all('/api/components/policy/*', h(componentAssign));
app.all('/api/components/*', h(componentCrud));

// ── Apps (specific before catch-all) ────────────────────────────────────────
app.all('/api/apps/list', h(appList));
app.all('/api/apps/search', h(appSearch));
app.all('/api/apps/deploy', h(appDeploy));
app.all('/api/apps/web-token', h(appWebToken));
app.all('/api/apps/catalog', h(appCrud));
app.all('/api/apps/import', h(appCrud));
app.all('/api/apps/deployments/*', h(appCrud));
app.all('/api/apps/*/configs', h(appCrud));
app.all('/api/apps/*/configs/*', h(appCrud));
app.all('/api/apps/*', h(appCrud));
app.all('/api/app-feedback/*', h(appFeedback));
app.all('/api/app-feedback', h(appFeedback));

// ── Networks ────────────────────────────────────────────────────────────────
app.all('/api/networks/list', h(networkList));
app.all('/api/networks/deploy', h(networkDeploy));
app.all('/api/networks/*', h(networkCrud));

// ── Audit ───────────────────────────────────────────────────────────────────
app.all('/api/audit-log', h(auditLog));
app.all('/api/audit/log', h(auditLog));

// ── Sign-in enrollment ─────────────────────────────────────────────────────
app.all('/api/signin/config', h(signinConfig));
app.all('/api/signin/enroll', h(signinEnroll));

// ── Enrolment ───────────────────────────────────────────────────────────────
app.all('/api/enrolment/create', h(enrollmentCreate));
app.all('/api/enrolment/list', h(enrollmentList));
app.all('/api/enrolment/sync', h(enrollmentSync));
app.all('/api/enrolment/*', h(enrollmentCrud));

// ── Certificates ────────────────────────────────────────────────────────────
app.all('/api/certificates/*', h(certificateCrud));

// ── Deployments ─────────────────────────────────────────────────────────────
app.all('/api/deployments', h(deploymentJobs));
app.all('/api/deployments/*', h(deploymentJobs));

// ── Pub/Sub ─────────────────────────────────────────────────────────────────
app.all('/api/pubsub/webhook', h(pubsubWebhook));

// ── Workflows ───────────────────────────────────────────────────────────────
app.all('/api/workflows/*', h(workflowCrud));

// ── Geofences ───────────────────────────────────────────────────────────────
app.all('/api/geofences/*', h(geofenceCrud));

// ── Licenses ────────────────────────────────────────────────────────────────
app.all('/api/licenses/status', h(licenseStatus));
app.all('/api/licenses/settings', h(licenseSettings));
app.all('/api/licenses/plans', h(licensePlans));
app.all('/api/licenses/grants', h(licenseGrants));
app.all('/api/licenses/grants/*', h(licenseGrants));
app.all('/api/licenses/assign', h(licenseAssign));
app.all('/api/licenses/unassign', h(licenseAssign));

// ── Stripe ──────────────────────────────────────────────────────────────────
app.all('/api/stripe/checkout', h(stripeCheckout));
app.all('/api/stripe/portal', h(stripePortal));
app.all('/api/stripe/webhook', h(stripeWebhook));

// ── Workspace billing ───────────────────────────────────────────────────────
app.all('/api/workspace-billing/webhook', h(workspaceBillingWebhook));
app.all('/api/workspace-billing/*', h(workspaceBilling));

// ── Licensing reconcile ─────────────────────────────────────────────────────
app.all('/api/licensing/reconcile', h(licensingReconcile));

// ── Dashboard ───────────────────────────────────────────────────────────────
app.all('/api/dashboard/data', h(dashboardData));

// ── Superadmin ──────────────────────────────────────────────────────────────
app.all('/api/superadmin/actions', h(superadminActions));
app.all('/api/superadmin/settings', h(superadminSettings));
app.all('/api/superadmin/stats', h(superadminStats));
app.all('/api/superadmin/users', h(superadminUsers));
app.all('/api/superadmin/workspaces', h(superadminWorkspaces));
app.all('/api/superadmin/workspaces/*', h(superadminWorkspaces));
app.all('/api/superadmin/billing/*', h(superadminBilling));

// ── Reports ─────────────────────────────────────────────────────────────────
app.all('/api/reports/export', h(reportExport));
app.all('/api/reports/download', h(reportDownload));

// ── Signup links ────────────────────────────────────────────────────────────
app.all('/api/signup-links/resolve/*', h(signupLinkResolve));
app.all('/api/signup-links/*', h(signupLinkCrud));
app.all('/api/signup-links', h(signupLinkCrud));

// ── API keys ────────────────────────────────────────────────────────────────
app.all('/api/api-keys/*', h(apiKeyCrud));

// ── Roles ───────────────────────────────────────────────────────────────────
app.all('/api/roles/rbac', h(rolesRbac));

// ── Migrate ─────────────────────────────────────────────────────────────────
app.all('/api/migrate', h(migrate));

// ── MCP AMAPI ───────────────────────────────────────────────────────────────
app.all('/api/mcp/amapi', h(mcpAmapi));

// ── Flash Agent ─────────────────────────────────────────────────────────────
app.all('/api/flashagent/chat', h(flashagentChat));
app.all('/api/flashagent/chat-history', h(flashagentChatHistory));
app.all('/api/flashagent/settings', h(flashagentSettings));
app.all('/api/flashagent/download', h(flashagentDownload));
app.all('/api/flashagent/workspace-settings', h(flashagentWorkspaceSettings));

// ── Scheduled (cron endpoints) ──────────────────────────────────────────────
app.all('/api/cleanup-scheduled', h(cleanupScheduled));
app.all('/api/geofence-check-scheduled', h(geofenceCheckScheduled));
app.all('/api/licensing-reconcile-scheduled', h(licensingReconcileScheduled));
app.all('/api/sync-reconcile-scheduled', h(syncReconcileScheduled));
app.all('/api/workflow-cron-scheduled', h(workflowCronScheduled));

// ── Netlify-compatible internal function paths ─────────────────────────────
app.all('/.netlify/functions/deployment-jobs-background', h(deploymentJobsBackground));
app.all('/.netlify/functions/sync-process-background', h(syncProcessBackground));
app.all('/.netlify/functions/workflow-evaluate-background', h(workflowEvaluateBackground));

// ── Static assets & SPA fallback ────────────────────────────────────────────
app.use('/assets/*', serveStatic({ root: './dist' }));
app.use('/favicon.ico', serveStatic({ root: './dist' }));
app.get('*', serveStatic({ root: './dist', path: '/index.html' }));

// ── Start ───────────────────────────────────────────────────────────────────
const port = parseInt(process.env.PORT || '3000', 10);
console.log(`Flash MDM server listening on http://localhost:${port}`);
serve({ fetch: app.fetch, port });
SERVEREOF

success "server.ts generated with all routes"

cat > "$RELEASE_DIR/worker.ts" << 'WORKEREOF'
import 'dotenv/config';
import syncProcessBackground from './netlify/functions/sync-process-background.js';
import deploymentJobsBackground from './netlify/functions/deployment-jobs-background.js';

const configuredPollMs = Number.parseInt(process.env.FLASH_WORKER_POLL_MS || '2000', 10);
const pollMs = Number.isFinite(configuredPollMs) ? Math.max(250, configuredPollMs) : 2000;
const secret = process.env.INTERNAL_FUNCTION_SECRET ?? '';
let stopping = false;

process.once('SIGINT', () => { stopping = true; });
process.once('SIGTERM', () => { stopping = true; });

function internalRequest(functionName: string, body?: Record<string, unknown>): Request {
  return new Request(`http://127.0.0.1:3000/.netlify/functions/${functionName}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-internal-secret': secret,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}

async function sleep(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, pollMs));
}

async function runLoop(name: string, work: () => Promise<Response | undefined>): Promise<void> {
  while (!stopping) {
    try {
      const response = await work();
      if (response && !response.ok) {
        console.error(`[worker:${name}] HTTP ${response.status}: ${await response.text()}`);
      }
    } catch (error) {
      console.error(`[worker:${name}]`, error);
    }
    if (!stopping) await sleep();
  }
}

await Promise.all([
  runLoop('queue', () => syncProcessBackground(
    internalRequest('sync-process-background'),
    {} as never
  )),
  runLoop('deployments', () => deploymentJobsBackground(
    internalRequest('deployment-jobs-background', {}),
    {} as never
  )),
]);
WORKEREOF

success "worker.ts generated with queue and deployment drains"

# ── 7. Configure Caddy ──────────────────────────────────────────────────────
if [[ "$USE_EXTERNAL_CADDY" == "true" ]]; then
  info "Skipping container Caddy configuration; external proxy owns TLS and static routing"
else
  echo
  printf "${BOLD}${CYAN}── Step 7/9: Caddy reverse proxy ──────────────────────────${NC}\n"
  echo

  sudo tee /etc/caddy/Caddyfile > /dev/null <<CADDYEOF
${DOMAIN} {
    handle /api/* {
        reverse_proxy localhost:3000
    }

    handle /.netlify/functions/* {
        reverse_proxy localhost:3000
    }

    handle {
        root * ${CURRENT_LINK}/dist
        try_files {path} /index.html
        file_server
    }

    header {
        Strict-Transport-Security "max-age=31536000; includeSubDomains; preload"
        X-Frame-Options "DENY"
        X-Content-Type-Options "nosniff"
        Referrer-Policy "strict-origin-when-cross-origin"
        Content-Security-Policy "default-src 'self'; script-src 'self' 'unsafe-eval' https://apis.google.com https://www.gstatic.com https://ssl.gstatic.com; style-src 'self' 'unsafe-inline'; font-src 'self' data:; img-src 'self' data: https:; connect-src 'self' https://accounts.google.com https://oauth2.googleapis.com https://androidmanagement.googleapis.com; media-src 'self' blob:; worker-src 'self' blob:; frame-src https://play.google.com https://accounts.google.com https://enterprise.google.com; frame-ancestors 'none'; object-src 'none'; base-uri 'self'; form-action 'self' https://accounts.google.com;"
    }
}
CADDYEOF

  sudo caddy validate --config /etc/caddy/Caddyfile > /dev/null \
    || fail "Generated Caddy configuration is invalid; the active release was not changed"

  # Ensure Caddy can read the dist directory
  sudo chmod o+x "$INSTALL_DIR" 2>/dev/null || true
  sudo chmod o+x "$(dirname "$INSTALL_DIR")" 2>/dev/null || true

  success "Caddyfile written for $DOMAIN"
fi

# ── 8. Systemd service ──────────────────────────────────────────────────────
echo
printf "${BOLD}${CYAN}── Step 8/9: Systemd service ──────────────────────────────${NC}\n"
echo

TSX_BIN="$CURRENT_LINK/node_modules/.bin/tsx"

sudo tee /etc/systemd/system/flashmdm.service > /dev/null <<UNITEOF
[Unit]
Description=Flash MDM Server
After=network.target postgresql.service
Wants=postgresql.service

[Service]
Type=simple
User=${USER}
WorkingDirectory=${CURRENT_LINK}
ExecStart=${TSX_BIN} server.ts
Restart=on-failure
RestartSec=5
Environment=NODE_ENV=production
Environment=FLASH_RUNTIME=vps
Environment=FLASH_INTERNAL_ORIGIN=http://127.0.0.1:3000
EnvironmentFile=${ENV_FILE}

[Install]
WantedBy=multi-user.target
UNITEOF

sudo tee /etc/systemd/system/flashmdm-worker.service > /dev/null <<UNITEOF
[Unit]
Description=Flash MDM Durable Queue Worker
After=network.target postgresql.service
Wants=postgresql.service

[Service]
Type=simple
User=${USER}
WorkingDirectory=${CURRENT_LINK}
ExecStart=${TSX_BIN} worker.ts
Restart=always
RestartSec=5
KillMode=control-group
TimeoutStopSec=20
Environment=NODE_ENV=production
Environment=FLASH_RUNTIME=vps
Environment=FLASH_INTERNAL_ORIGIN=http://127.0.0.1:3000
EnvironmentFile=${ENV_FILE}

[Install]
WantedBy=multi-user.target
UNITEOF

sudo systemctl daemon-reload
sudo systemctl enable flashmdm
sudo systemctl enable flashmdm-worker
success "flashmdm.service and flashmdm-worker.service created and enabled"

# ── 9. Start services & run migrations ───────────────────────────────────────
echo
printf "${BOLD}${CYAN}── Step 9/9: Start & migrate ──────────────────────────────${NC}\n"
echo

info "Activating candidate release..."
sudo systemctl stop flashmdm-worker 2>/dev/null || true
if ! activate_release "$RELEASE_DIR" "$CURRENT_LINK"; then
  sudo systemctl start flashmdm-worker 2>/dev/null || true
  fail "Candidate release could not be activated; the previous release remains selected"
fi

rollback_release() {
  local reason="$1"
  if [[ -n "$PREVIOUS_RELEASE" ]]; then
    warn "$reason; restoring previous release $PREVIOUS_RELEASE"
    activate_release "$PREVIOUS_RELEASE" "$CURRENT_LINK"
    sudo systemctl restart flashmdm || true
    sudo systemctl restart flashmdm-worker || true
    if [[ "$USE_EXTERNAL_CADDY" != "true" ]]; then
      sudo systemctl restart caddy || true
    fi
  fi
  fail "$reason"
}

info "Restarting Flash MDM on release $RELEASE_ID..."
if ! sudo systemctl restart flashmdm; then
  rollback_release "Candidate service could not be started"
fi
sleep 3

# Verify server is responding
if curl -sf http://localhost:3000/api/auth/config > /dev/null 2>&1; then
  success "Server is running on port 3000"
else
    warn "Server may still be starting up, waiting a few more seconds..."
  sleep 5
  if curl -sf http://localhost:3000/api/auth/config > /dev/null 2>&1; then
    success "Server is running on port 3000"
  else
      rollback_release "Candidate server failed its readiness check"
  fi
fi

info "Running database migrations..."
MIGRATE_RESP=""
if MIGRATE_RESP=$(printf 'x-migration-secret: %s\n' "$MIGRATION_SECRET" \
  | curl -fsS -H @- http://localhost:3000/api/migrate) \
  && printf '%s' "$MIGRATE_RESP" | migration_response_ok; then
  success "Migrations complete"
else
  rollback_release "Database migration failed; inspect the service logs before retrying"
fi

info "Starting durable queue worker..."
if ! sudo systemctl restart flashmdm-worker; then
  rollback_release "Candidate durable worker could not be started"
fi
success "Durable queue worker started"

if [[ "$USE_EXTERNAL_CADDY" == "true" ]]; then
  success "External Caddy remains responsible for TLS and routing"
else
  info "Starting Caddy..."
  if ! sudo systemctl restart caddy; then
    rollback_release "Caddy could not load the candidate release"
  fi
  success "Caddy started (TLS will auto-provision for $DOMAIN)"
fi

# ── Cron jobs for scheduled functions ────────────────────────────────────────
info "Setting up cron jobs for scheduled functions..."

# Ensure cron is installed (Debian minimal doesn't include it)
if ! command -v crontab >/dev/null 2>&1; then
  sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq cron > /dev/null
fi
sudo systemctl enable --now cron

CRON_LOCK_DIR="$INSTALL_DIR/data/cron"
mkdir -p "$CRON_LOCK_DIR"
chmod 700 "$CRON_LOCK_DIR"

CRON_BLOCK="# Flash MDM scheduled functions
*/5 * * * * FLASH_CRON_LOCK_DIR=${CRON_LOCK_DIR} /bin/bash ${CURRENT_LINK}/scripts/run-vps-scheduled.sh workflow-cron-scheduled
*/10 * * * * FLASH_CRON_LOCK_DIR=${CRON_LOCK_DIR} /bin/bash ${CURRENT_LINK}/scripts/run-vps-scheduled.sh geofence-check-scheduled
*/15 * * * * FLASH_CRON_LOCK_DIR=${CRON_LOCK_DIR} /bin/bash ${CURRENT_LINK}/scripts/run-vps-scheduled.sh sync-reconcile-scheduled
0 * * * * FLASH_CRON_LOCK_DIR=${CRON_LOCK_DIR} /bin/bash ${CURRENT_LINK}/scripts/run-vps-scheduled.sh licensing-reconcile-scheduled
0 3 * * * FLASH_CRON_LOCK_DIR=${CRON_LOCK_DIR} /bin/bash ${CURRENT_LINK}/scripts/run-vps-scheduled.sh cleanup-scheduled"

# Add cron jobs if not already present
existing_crontab=$(crontab -l 2>/dev/null || true)
filtered_crontab=$(printf '%s\n' "$existing_crontab" | sed '/# Flash MDM scheduled functions/,/^0 3 \* \* \*/d')
printf '%s\n\n%s\n' "$filtered_crontab" "$CRON_BLOCK" | crontab -
success "Cron jobs installed with overlap protection, timeouts, and retained failure logs"

# ── Done ─────────────────────────────────────────────────────────────────────
echo
printf "${BOLD}${GREEN}══════════════════════════════════════════════════════════════${NC}\n"
printf "${BOLD}${GREEN}  Flash MDM installed successfully!${NC}\n"
printf "${BOLD}${GREEN}══════════════════════════════════════════════════════════════${NC}\n"
echo
info "URL:             https://${DOMAIN}"
info "Install root:    ${INSTALL_DIR}"
info "Active release:  ${RELEASE_DIR}"
info "Service:         sudo systemctl {start|stop|restart|status} flashmdm"
info "Server logs:     journalctl -u flashmdm -f"
info "Caddy logs:      journalctl -u caddy -f"
echo

if [[ -n "$BOOTSTRAP_SECRET" ]]; then
  echo
  printf "${YELLOW}── Next steps ─────────────────────────────────────────────${NC}\n"
  echo
  info "1. Navigate to https://${DOMAIN}/register"
  info "2. Register your admin account"
  info "   (The bootstrap secret is required for the first registration)"
  info "3. After registering, remove BOOTSTRAP_SECRET from .env and restart:"
  info "     sudo systemctl restart flashmdm"
else
  echo
  printf "${YELLOW}── Next steps ─────────────────────────────────────────────${NC}\n"
  echo
  info "1. Navigate to https://${DOMAIN}/register"
  info "2. The first user to register is automatically promoted to superadmin"
fi

echo
info "Documentation: https://github.com/baytonorg/flash_mdm#deploy-outside-of-netlify-vps--bare-metal"
echo
