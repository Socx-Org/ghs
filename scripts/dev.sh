#!/usr/bin/env bash
# ghs#80: `npm run dev` entry point -- idempotent local bootstrap (never
# touches an existing .env, never drops/recreates an existing database,
# never prints a secret value), then starts the API and web dev servers
# together. One script, not a setup script chained via `&&` into a
# separate launch step -- env vars exported by `source .env` below need
# to reach the final `exec concurrently`, and a var exported in a nested
# script process does not propagate back to its parent once that script
# exits, so the sourcing and the launch have to happen in this same
# process.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

ENV_FILE=".env"

if [ ! -f "$ENV_FILE" ]; then
  echo "No .env found -- creating one from .env.example with real local secrets."
  cp .env.example "$ENV_FILE"

  JWT_SECRET="$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")"
  MFA_ENCRYPTION_KEY="$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")"
  DEV_DB_USER="$(whoami)"

  # sed -i.bak ... && rm *.bak -- portable across BSD sed (macOS) and GNU
  # sed (Linux), which differ on bare `-i ''` handling.
  sed -i.bak \
    -e "s/{{YOUR_LOCAL_POSTGRES_ROLE}}/${DEV_DB_USER}/" \
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

if ! psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d postgres -tAc \
    "SELECT 1 FROM pg_database WHERE datname = '${DB_NAME}'" | grep -q 1; then
  echo "Database '${DB_NAME}' does not exist -- creating it."
  createdb -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" "$DB_NAME"
else
  echo "Database '${DB_NAME}' already exists -- leaving it as-is."
fi

exec npx concurrently --kill-others --names api,web -c "blue,green" \
  "npm run dev --workspace apps/api" \
  "npm run dev --workspace apps/web"
