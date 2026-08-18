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

exec npx concurrently --kill-others --names api,web -c "blue,green" \
  "npm run dev --workspace apps/api" \
  "npm run dev --workspace apps/web"
