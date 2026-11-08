#!/usr/bin/env bash
# Unsent (self-hosted email service) installer.
#
#   ./install.sh                 full setup: install deps, create the D1 database, migrate, generate
#                                secrets, upload them to Cloudflare, deploy
#   ./install.sh --local-only    install deps and set up the local dev database only (no Cloudflare account)
#   ./install.sh --skip-deploy   do everything except the final deploy
#   ./install.sh --yes           never prompt; take the defaults
#
# Options (each also has an interactive prompt):
#   --worker-name NAME   Cloudflare Worker name, default "unsent" (becomes <name>.workers.dev)
#   --domain HOST        custom domain to serve from; pass '' to use the *.workers.dev URL
#   --admin-user NAME    dashboard login name, default "admin"
#   --db-name NAME       D1 database name, default "reportary-email-db"
#
# Run it from a checkout, or let it clone the repository for you:
#   curl -fsSL https://raw.githubusercontent.com/Rishi-Bhati/Serverless-email-service/main/install.sh | bash
#
# The script is idempotent: an existing .env is never touched, and an existing D1 database is reused
# instead of created again.
set -euo pipefail

REPO_URL="https://github.com/Rishi-Bhati/Serverless-email-service.git"
DB_NAME="reportary-email-db"
LOCAL_ONLY=0
SKIP_DEPLOY=0
ASSUME_YES=0
WORKDIR=""
OPT_WORKER_NAME=""
OPT_ADMIN_USER=""
CUSTOM_DOMAIN=""
WORKER_NAME=""
ACCOUNT_ID=""

# ---------------------------------------------------------------- output helpers
if [ -t 1 ]; then
  BOLD=$(printf '\033[1m'); DIM=$(printf '\033[2m'); RED=$(printf '\033[31m')
  GREEN=$(printf '\033[32m'); YELLOW=$(printf '\033[33m'); RESET=$(printf '\033[0m')
else
  BOLD=""; DIM=""; RED=""; GREEN=""; YELLOW=""; RESET=""
fi

step()  { printf '\n%s==>%s %s%s%s\n' "$GREEN" "$RESET" "$BOLD" "$1" "$RESET"; }
info()  { printf '    %s\n' "$1"; }
dim()   { printf '    %s%s%s\n' "$DIM" "$1" "$RESET"; }
warn()  { printf '%s  !%s %s\n' "$YELLOW" "$RESET" "$1" >&2; }
die()   { printf '\n%s  x%s %s\n\n' "$RED" "$RESET" "$1" >&2; exit 1; }

trap 'printf "\n%s  x%s Installation interrupted.\n\n" "$RED" "$RESET" >&2' INT

usage() {
  sed -n '2,/^set -euo/p' "$0" | sed '$d' | sed 's/^# \{0,1\}//'
  exit 0
}

# ---------------------------------------------------------------- arguments
while [ $# -gt 0 ]; do
  case "$1" in
    --local-only) LOCAL_ONLY=1 ;;
    --skip-deploy) SKIP_DEPLOY=1 ;;
    -y|--yes) ASSUME_YES=1 ;;
    --db-name) [ $# -ge 2 ] || die "--db-name needs a value"; DB_NAME="$2"; shift ;;
    --worker-name) [ $# -ge 2 ] || die "--worker-name needs a value"; OPT_WORKER_NAME="$2"; shift ;;
    --domain) [ $# -ge 2 ] || die "--domain needs a value (use --domain '' for none)"; OPT_DOMAIN="$2"; shift ;;
    --admin-user) [ $# -ge 2 ] || die "--admin-user needs a value"; OPT_ADMIN_USER="$2"; shift ;;
    -h|--help) usage ;;
    *) die "Unknown option: $1 (try --help)" ;;
  esac
  shift
done

# ---------------------------------------------------------------- prompts
# Reads an answer into REPLY. Non-interactive runs (or --yes) take the default.
ask() {
  local prompt="$1" default="$2"
  REPLY="$default"
  if [ "$ASSUME_YES" -eq 1 ] || [ ! -t 0 ]; then
    printf '    %s %s%s%s\n' "$prompt" "$DIM" "${default:-<empty>}" "$RESET"
    return
  fi
  if [ -n "$default" ]; then
    printf '    %s [%s]: ' "$prompt" "$default"
  else
    printf '    %s: ' "$prompt"
  fi
  read -r REPLY || REPLY="$default"
  [ -z "$REPLY" ] && REPLY="$default"
  return 0
}

confirm() {
  local prompt="$1"
  if [ "$ASSUME_YES" -eq 1 ] || [ ! -t 0 ]; then
    info "$prompt yes"
    return 0
  fi
  printf '    %s [Y/n]: ' "$prompt"
  local reply=""
  read -r reply || reply="y"
  case "$reply" in ""|y|Y|yes|YES) return 0 ;; *) return 1 ;; esac
}

# ---------------------------------------------------------------- locate or clone the project
find_project_root() {
  local dir="$PWD"
  while [ "$dir" != "/" ]; do
    if [ -f "$dir/package.json" ] && grep -q '"name": *"reportary-email-service"' "$dir/package.json" 2>/dev/null; then
      printf '%s\n' "$dir"
      return 0
    fi
    dir=$(dirname "$dir")
  done
  return 1
}

bootstrap() {
  step "Fetching the Unsent source"
  command -v git >/dev/null 2>&1 || die "git is required to download the project. Install git and try again."
  WORKDIR="$(pwd)/Serverless-email-service"
  if [ -d "$WORKDIR/.git" ]; then
    info "Using the existing checkout at $WORKDIR"
    git -C "$WORKDIR" pull --ff-only || warn "Could not update the existing checkout; continuing with it as is."
  else
    info "Cloning into $WORKDIR"
    git clone --depth 1 "$REPO_URL" "$WORKDIR" || die "Could not clone $REPO_URL"
  fi
  cd "$WORKDIR"
}

# ---------------------------------------------------------------- prerequisites
check_node() {
  step "Checking prerequisites"
  if ! command -v node >/dev/null 2>&1; then
    die "Node.js is not installed. Install Node.js 18 or newer (https://nodejs.org) and run this script again."
  fi
  if ! command -v npm >/dev/null 2>&1; then
    die "npm is not installed. It ships with Node.js; reinstall Node.js 18 or newer."
  fi

  local major
  major=$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)
  if [ "${major:-0}" -lt 18 ]; then
    die "Node.js $(node -v) is too old. This project needs Node.js 18 or newer."
  fi
  info "Node.js $(node -v), npm $(npm -v)"
}

# ---------------------------------------------------------------- dependencies
install_deps() {
  step "Installing dependencies"
  if [ -d node_modules ] && [ -f node_modules/worker-mailer/package.json ]; then
    info "Dependencies already present; refreshing from the lockfile"
  fi
  # NODE_ENV=production would skip devDependencies (wrangler, typescript), which the setup needs.
  NODE_ENV=dev npm install --include=dev --no-audit --no-fund
  info "Dependencies installed"
}

# ---------------------------------------------------------------- secrets
random_hex() {
  local bytes="$1"
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex "$bytes"
  else
    node -e 'process.stdout.write(require("crypto").randomBytes('"$bytes"').toString("hex"))'
  fi
}

master_env() {
  # Reuse a value only if the caller deliberately exported it; say so, because inheriting ambient
  # credentials silently is how the wrong deployment's keys end up in .env. The warning goes to stderr:
  # this function is called in a command substitution, whose stdout becomes the value.
  local name="$1"
  local value="${!name:-}"
  if [ -n "$value" ]; then
    warn "$name was already set in your environment; using that value instead of generating one" >&2
  fi
  printf '%s' "$value"
}

configure_env() {
  step "Configuring secrets (.env)"

  if [ -f .env ]; then
    warn "An .env already exists and was left untouched, so your current credentials are unchanged."
    info "To generate a fresh .env, move the old one away (mv .env .env.old) and run this script again."
    return
  fi

  ask "Admin dashboard username" "${OPT_ADMIN_USER:-admin}"; local admin_user="$REPLY"
  ask "Cloudflare Worker name (used in the URL)" "${OPT_WORKER_NAME:-unsent}"; WORKER_NAME="$REPLY"
  if [ "${OPT_DOMAIN+set}" = set ]; then
    CUSTOM_DOMAIN="$OPT_DOMAIN"
  else
    ask "Custom domain (blank for the *.workers.dev URL)" ""; CUSTOM_DOMAIN="$REPLY"
  fi
  CUSTOM_DOMAIN="${CUSTOM_DOMAIN#https://}"
  CUSTOM_DOMAIN="${CUSTOM_DOMAIN#http://}"
  CUSTOM_DOMAIN="${CUSTOM_DOMAIN%%/}"

  local admin_password api_key api_secret encryption_key
  admin_password="$(master_env ADMIN_PASSWORD)"
  api_key="$(master_env API_KEY)"
  api_secret="$(master_env API_SECRET)"
  encryption_key="$(master_env ENCRYPTION_KEY)"
  [ -n "$admin_password" ] || admin_password=$(random_hex 16)
  [ -n "$api_key" ]        || api_key="sk_$(random_hex 24)"
  [ -n "$api_secret" ]     || api_secret=$(random_hex 32)
  [ -n "$encryption_key" ] || encryption_key=$(random_hex 32)

  local smtp_host="" smtp_user="" smtp_pass="" smtp_from="" smtp_from_name="Unsent"
  if [ "$LOCAL_ONLY" -eq 0 ]; then
    dim "Optional: a fallback SMTP account, used when no provider is configured in the dashboard."
    dim "Leave these blank to configure email providers in the dashboard instead."
    ask "SMTP host (blank to skip)" "";            smtp_host="$REPLY"
    if [ -n "$smtp_host" ]; then
      ask "SMTP username" "";                      smtp_user="$REPLY"
      if [ -n "$smtp_user" ]; then
        if [ -t 0 ] && [ "$ASSUME_YES" -eq 0 ]; then
          printf '    SMTP password (input hidden): '
          read -rs smtp_pass || true
          printf '\n'
        fi
      fi
      ask "From address" "$smtp_user";             smtp_from="$REPLY"
      ask "From display name" "Unsent";            smtp_from_name="$REPLY"
    fi
  fi

  umask 077
  {
    printf '# Generated by install.sh on %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    printf '# Keep this file private. It holds the credentials for your deployment.\n\n'
    printf '# API clients authenticate with these two values.\n'
    printf 'API_KEY=%s\n' "$api_key"
    printf 'API_SECRET=%s\n\n' "$api_secret"
    printf '# full | signed | api-key-only\n'
    printf 'SECURITY_MODE=full\n'
    printf 'NONCE_TTL_SECONDS=300\n\n'
    printf '# Server-only key for provider credentials at rest. Never share it with API clients.\n'
    printf 'ENCRYPTION_KEY=%s\n\n' "$encryption_key"
    printf '# Dashboard login.\n'
    printf 'ADMIN_USERNAME=%s\n' "$admin_user"
    printf 'ADMIN_PASSWORD=%s\n\n' "$admin_password"
    printf '# How long idempotency keys are remembered (hours, 1-720).\n'
    printf 'IDEMPOTENCY_TTL_HOURS=24\n'
    if [ -n "$smtp_host" ]; then
      printf '\n# Fallback SMTP account.\n'
      printf 'SMTP_HOST=%s\n' "$smtp_host"
      printf 'SMTP_PORT=587\n'
      printf 'SMTP_SECURE=false\n'
      printf 'SMTP_STARTTLS=true\n'
      printf 'SMTP_USERNAME=%s\n' "$smtp_user"
      printf 'SMTP_PASSWORD=%s\n' "$smtp_pass"
      printf 'SMTP_FROM_EMAIL=%s\n' "$smtp_from"
      printf 'SMTP_FROM_NAME=%s\n' "$smtp_from_name"
      printf 'SMTP_THROTTLE_DELAY_MS=1000\n'
    fi
  } > .env
  chmod 600 .env
  umask 022

  info "Wrote .env (permissions 600) with newly generated keys"
}

# ---------------------------------------------------------------- database id + worker name
patch_wrangler_toml() {
  local db_id="$1" worker_name="$2" account_id="${3:-}"

  step "Updating wrangler.toml"
  if [ ! -f wrangler.toml ]; then
    die "wrangler.toml is missing; the checkout looks incomplete."
  fi

  DB_ID="$db_id" WORKER_NAME="$worker_name" ACCOUNT_ID="$account_id" CUSTOM_DOMAIN="${CUSTOM_DOMAIN:-}" node - <<'NODE'
const fs = require('fs');
const path = 'wrangler.toml';
let text = fs.readFileSync(path, 'utf8');
const { DB_ID, WORKER_NAME, ACCOUNT_ID, CUSTOM_DOMAIN } = process.env;

if (WORKER_NAME) {
  if (/^name\s*=/m.test(text)) text = text.replace(/^name\s*=.*$/m, `name = "${WORKER_NAME}"`);
  else text = `name = "${WORKER_NAME}"\n` + text;
}
if (DB_ID) {
  if (/^database_id\s*=/m.test(text)) text = text.replace(/^database_id\s*=.*$/m, `database_id = "${DB_ID}"`);
}
if (ACCOUNT_ID) {
  if (/^account_id\s*=/m.test(text)) text = text.replace(/^account_id\s*=.*$/m, `account_id = "${ACCOUNT_ID}"`);
  else text = text.replace(/^(name\s*=.*)$/m, `$1\naccount_id = "${ACCOUNT_ID}"`);
}

// `routes` names a zone the operator must own. The checked-in value points at this repository's own
// domain, which would fail for everyone else, so replace it: keep a domain the operator supplied and
// otherwise remove the block so the Worker uses its *.workers.dev URL.
const routeBlock = /^routes\s*=\s*\[[\s\S]*?^\]\s*\n?/m;
if (CUSTOM_DOMAIN) {
  const block = `routes = [\n  { pattern = "${CUSTOM_DOMAIN}", custom_domain = true }\n]\n`;
  text = routeBlock.test(text) ? text.replace(routeBlock, block) : text + '\n' + block;
} else if (routeBlock.test(text)) {
  text = text.replace(routeBlock, '');
}
text = text.replace(/\n{3,}/g, '\n\n');
fs.writeFileSync(path, text);
NODE

  info "database_id set to $db_id"
  [ -n "$worker_name" ] && info "Worker name set to $worker_name"
  if [ -n "${CUSTOM_DOMAIN:-}" ]; then
    info "Custom domain set to $CUSTOM_DOMAIN"
  else
    dim "No custom domain: the Worker will be served from its *.workers.dev URL"
  fi
}

# ---------------------------------------------------------------- Cloudflare
# Use the project's pinned wrangler; fall back to npx only if it is missing.
wrangler() {
  if [ -x node_modules/.bin/wrangler ]; then
    node_modules/.bin/wrangler "$@"
  else
    npx --yes wrangler "$@"
  fi
}

cloudflare_login() {
  step "Authenticating with Cloudflare"

  local whoami=""
  whoami="$(wrangler whoami 2>/dev/null || true)"

  if ! printf '%s' "$whoami" | grep -qi "You are logged in"; then
    info "A browser window will ask you to authorise wrangler"
    if ! wrangler login; then
      die "Cloudflare login failed. Run 'npx wrangler login' and try again, or use --local-only."
    fi
    whoami="$(wrangler whoami 2>/dev/null || true)"
  fi

  if printf '%s' "$whoami" | grep -qi "not authenticated\|not logged in"; then
    die "wrangler is not authenticated. Run 'npx wrangler login' and try again, or use --local-only."
  fi
  info "Logged in to Cloudflare"

  # `wrangler whoami` prints a table of accounts; the first 32-hex token is the account id.
  ACCOUNT_ID="$(printf '%s' "$whoami" | grep -oE '[0-9a-f]{32}' | head -n1 || true)"
  if [ -n "${ACCOUNT_ID:-}" ]; then
    info "Cloudflare account: $ACCOUNT_ID"
  else
    dim "Could not read the account id; wrangler will use the default account."
  fi

  # The deployed account must match wrangler.toml, or every API call goes to the wrong place.
  local toml_account
  toml_account="$(grep -E '^account_id\s*=' wrangler.toml 2>/dev/null | sed -E 's/.*"([^"]*)".*/\1/' || true)"
  if [ -n "$toml_account" ] && [ -n "${ACCOUNT_ID:-}" ] && [ "$toml_account" != "$ACCOUNT_ID" ]; then
    warn "wrangler.toml targets account $toml_account but you are logged in to $ACCOUNT_ID; updating it."
  fi
}

provision_database() {
  step "Provisioning the D1 database ($DB_NAME)"

  local existing
  existing="$(wrangler d1 list 2>/dev/null | grep -F "$DB_NAME" || true)"
  if [ -n "$existing" ]; then
    local id
    id="$(printf '%s\n' "$existing" | grep -oE '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' | head -n1 || true)"
    if [ -n "$id" ]; then
      info "Reusing the existing database ($id)"
      patch_wrangler_toml "$id" "${WORKER_NAME:-}" "${ACCOUNT_ID:-}"
      return
    fi
  fi

  local out
  if ! out="$(wrangler d1 create "$DB_NAME" 2>&1)"; then
    printf '%s\n' "$out" >&2
    die "Could not create the D1 database. If it already exists under another account, copy its database_id into wrangler.toml and run this script again."
  fi
  printf '%s\n' "$out" | sed 's/^/    /'

  local id
  id="$(printf '%s\n' "$out" | grep -oE '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' | head -n1 || true)"
  [ -n "$id" ] || die "Created the database but could not read its id from the output. Copy it into wrangler.toml manually."
  patch_wrangler_toml "$id" "${WORKER_NAME:-}" "${ACCOUNT_ID:-}"
}

# ---------------------------------------------------------------- migrations
apply_migrations() {
  step "Applying database migrations"
  if [ "$LOCAL_ONLY" -eq 1 ]; then
    npm run db:migrate:local
    info "Local database ready (.wrangler/state)"
  else
    npm run db:migrate:local
    npm run db:migrate:prod
    info "Local and production schemas are up to date"
  fi
}

# ---------------------------------------------------------------- secrets upload
deploy_secrets() {
  step "Uploading secrets to Cloudflare"
  npm run secrets:deploy -- --prod
  info "Secrets uploaded"
}

# ---------------------------------------------------------------- deploy
do_deploy() {
  step "Deploying the Worker"
  npm run deploy

  if [ -n "${CUSTOM_DOMAIN:-}" ]; then
    info "Deployed. Your Worker is reachable at https://${CUSTOM_DOMAIN}"
  else
    local name
    name="$(grep -E '^name\s*=' wrangler.toml | head -n1 | sed -E 's/.*=\s*"([^"]*)".*/\1/')"
    info "Deployed. Your Worker is reachable at https://${name:-unsent}.<your-subdomain>.workers.dev"
    dim "The exact URL was printed by wrangler above."
  fi
  dim "Open the dashboard there and sign in with the ADMIN_USERNAME / ADMIN_PASSWORD from .env"
}

# ---------------------------------------------------------------- main
main() {
  printf '\n%sUnsent installer%s\n' "$BOLD" "$RESET"

  if root=$(find_project_root); then
    cd "$root"
    dim "Using the checkout at $root"
  else
    bootstrap
  fi

  check_node
  install_deps
  configure_env

  if [ "$LOCAL_ONLY" -eq 1 ]; then
    apply_migrations
    step "Done"
    info "Start the service locally with: npm run dev"
    info "Local dashboard: http://localhost:8787 (credentials are in .env)"
    printf '\n'
    return
  fi

  cloudflare_login
  provision_database
  apply_migrations
  deploy_secrets

  if [ "$SKIP_DEPLOY" -eq 1 ]; then
    step "Done (deploy skipped)"
    info "Deploy when ready with: npm run deploy"
  else
    do_deploy
  fi

  step "Credentials"
  dim "Saved in .env (mode 600). Keep them private."
  if [ -f .env ]; then
    grep -E '^(API_KEY|API_SECRET|ADMIN_USERNAME|ADMIN_PASSWORD)=' .env | sed 's/^/    /' || true
  fi
  printf '\n'
}

main "$@"
