#!/usr/bin/env bash
# Rebuild a throwaway database, apply every migration in order, then run the
# SQL suites against it. Same commands a contributor runs by hand.
set -euo pipefail

HOST="${PGHOST:-/tmp/pgrun}"
PORT="${PGPORT:-5433}"
USER="${PGUSER:-pg}"
DB="${PGDATABASE:-app_test}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"

psql -h "$HOST" -p "$PORT" -U "$USER" -d postgres -q -c "drop database if exists $DB" >/dev/null
psql -h "$HOST" -p "$PORT" -U "$USER" -d postgres -q -c "create database $DB" >/dev/null

run() { psql -h "$HOST" -p "$PORT" -U "$USER" -d "$DB" -v ON_ERROR_STOP=1 -q -t -f "$1"; }

run "$ROOT/tests/db/harness.sql" >/dev/null
for m in "$ROOT"/supabase/migrations/*.sql; do
  echo "-- applying $(basename "$m")"
  run "$m" >/dev/null
done

# `run` exits non-zero on the first failed assertion because every suite is
# applied with ON_ERROR_STOP and every assertion raises. Piping through grep
# would hide that behind grep's own status, so the output is captured first.
failed=0
for suite in "$ROOT"/tests/db/*.test.sql; do
  echo "-- running $(basename "$suite")"
  if out="$(run "$suite" 2>&1)"; then
    printf '%s\n' "$out" | grep -E "NOTICE|PASSED" | sed 's/^psql:[^ ]* //'
  else
    printf '%s\n' "$out" | sed 's/^psql:[^ ]* //'
    failed=1
  fi
done
exit "$failed"
