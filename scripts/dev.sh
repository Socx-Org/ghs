#!/usr/bin/env bash
# ghs#80: `npm run dev` entry point -- idempotent local bootstrap (never
# touches an existing .env, never drops/recreates an existing database,
# never prints a secret value), then starts the API, web, and worker dev
# servers together. One script, not a setup script chained via `&&` into
# a separate launch step -- env vars exported by `source .env` below need
# to reach the final `exec concurrently`, and a var exported in a nested
# script process does not propagate back to its parent once that script
# exits, so the sourcing and the launch have to happen in this same
# process.
#
# ghs#127: apps/worker joined the workspace under Phase 4 (#5, the real
# notification-delivery worker) after this script was first written, and
# was never added here -- confirmed directly: without it, nothing ever
# consumes notification_outbox in local dev, so activation/password-reset
# emails never actually reach the locally-configured Mailpit instance
# even though EMAIL_PROVIDER=mailpit is correctly set. It needs no env
# vars beyond what's already sourced below (WorkerConfig reuses apps/api's
# own loadDatabaseConfig()/loadEmailConfig(), and APP_BASE_URL has a
# working local-dev default of its own).
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

# A fresh shell without nvm's version applied falls back to whatever
# system Node is on PATH -- this repo's CI baseline (and apps/api's
# `node --watch src/index.ts`, which relies on Node's native TypeScript
# execution) is Node 24. Checked explicitly, with a clear message,
# rather than letting a too-old Node fail cryptically deep inside one of
# concurrently's own dependencies (found for real: Node 19 crashes
# inside yargs-parser with an error that doesn't mention Node version at
# all unless you already know to suspect it).
REQUIRED_NODE_MAJOR=24
NODE_VERSION="$(node -v)"
NODE_MAJOR="${NODE_VERSION#v}"
NODE_MAJOR="${NODE_MAJOR%%.*}"
if [ "$NODE_MAJOR" -lt "$REQUIRED_NODE_MAJOR" ]; then
  echo "GHS requires Node ${REQUIRED_NODE_MAJOR}+ (this repo's CI baseline) -- detected ${NODE_VERSION}." >&2
  echo "If you use nvm: run 'nvm use' in the repo root (a .nvmrc is provided), or 'nvm install ${REQUIRED_NODE_MAJOR}' first." >&2
  exit 1
fi

ENV_FILE=".env"

if [ ! -f "$ENV_FILE" ]; then
  echo "No .env found -- creating one from .env.example with real local secrets."
  cp .env.example "$ENV_FILE"

  JWT_SECRET="$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")"
  MFA_ENCRYPTION_KEY="$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")"
  DEV_DB_USER="$(whoami)"
  # whoami's output is virtually always plain alphanumeric, but isn't
  # guaranteed to be -- a literal "/" would break the s/// delimiter and
  # a literal "&" would expand to "whole match" in sed's replacement
  # text. Escaped defensively rather than assumed safe (review finding,
  # PR #81).
  DEV_DB_USER_ESCAPED="$(printf '%s' "$DEV_DB_USER" | sed -e 's/[&/\]/\\&/g')"

  # sed -i.bak ... && rm *.bak -- portable across BSD sed (macOS) and GNU
  # sed (Linux), which differ on bare `-i ''` handling.
  sed -i.bak \
    -e "s/{{YOUR_LOCAL_POSTGRES_ROLE}}/${DEV_DB_USER_ESCAPED}/" \
    -e "s/{{GENERATE_LOCALLY_DO_NOT_COMMIT}}/localdev/" \
    "$ENV_FILE"
  rm -f "${ENV_FILE}.bak"

  # The pass above replaced every {{GENERATE_LOCALLY_DO_NOT_COMMIT}}
  # occurrence (DB_PASSWORD, JWT_SECRET, MFA_ENCRYPTION_KEY) with the same
  # "localdev" placeholder -- fine for DB_PASSWORD (local Postgres trust
  # auth ignores it), but JWT_SECRET/MFA_ENCRYPTION_KEY need their own
  # distinct real values, so overwrite those two lines explicitly here.
  sed -i.bak \
    -e "s/^JWT_SECRET=.*/JWT_SECRET=${JWT_SECRET}/" \
    -e "s/^MFA_ENCRYPTION_KEY=.*/MFA_ENCRYPTION_KEY=${MFA_ENCRYPTION_KEY}/" \
    "$ENV_FILE"
  rm -f "${ENV_FILE}.bak"

  echo "Created .env (DB_USER=${DEV_DB_USER}, real JWT_SECRET/MFA_ENCRYPTION_KEY generated -- values not printed)."
fi

set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

# PGPASSWORD, not -W/interactive -- password-auth Postgres setups would
# otherwise prompt or hang here with no terminal to answer it (review
# finding, PR #81). Captured as its own step so a real connection/auth
# failure fails fast with a clear message instead of being treated as
# "database doesn't exist" and masked behind a confusing createdb
# attempt -- the previous `if ! psql ... | grep -q 1` piped the failure
# through grep, which can't distinguish "connected, found nothing" from
# "never connected at all".
export PGPASSWORD="$DB_PASSWORD"
db_exists="$(psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d postgres -tAc \
  "SELECT 1 FROM pg_database WHERE datname = '${DB_NAME}'")" || {
  echo "Could not connect to Postgres at ${DB_HOST}:${DB_PORT} as ${DB_USER} -- check it's running and that DB_USER/DB_PASSWORD in .env are correct." >&2
  exit 1
}

if [ "$db_exists" = "1" ]; then
  echo "Database '${DB_NAME}' already exists -- leaving it as-is."
else
  echo "Database '${DB_NAME}' does not exist -- creating it."
  createdb -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" "$DB_NAME"
fi

exec npx concurrently --kill-others --names api,web,worker -c "blue,green,magenta" \
  "npm run dev --workspace apps/api" \
  "npm run dev --workspace apps/web" \
  "npm run dev --workspace apps/worker"
