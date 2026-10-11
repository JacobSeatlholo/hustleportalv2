#!/usr/bin/env bash
# HustlePortal — embedded Postgres bootstrap (sandbox dev database)
# Port 54329, trust auth, datadir ./pgdata (gitignored), binaries in ./pgtools (gitignored).
# Idempotent: safe to run repeatedly. Usage: bash scripts/bootstrap_db.sh
set -u

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT="${HP_PG_PORT:-54329}"
PGDATA="$ROOT/pgdata"
BIN="$ROOT/pgtools/node_modules/@embedded-postgres/linux-x64/native/bin"
LOG="$ROOT/pgtools/pg.log"
PGUSER=postgres
DB=hustleportal

mkdir -p "$PGDATA" "$(dirname "$LOG")"

# 1. Ensure binaries exist (first run on a fresh sandbox).
if [ ! -x "$BIN/postgres" ]; then
  echo "[bootstrap] pgtools missing — installing embedded-postgres..."
  mkdir -p "$ROOT/pgtools"
  (cd "$ROOT/pgtools" && npm init -y >/dev/null 2>&1 && npm i --no-audit --no-fund --no-save embedded-postgres pg >/dev/null 2>&1)
fi

if [ ! -x "$BIN/postgres" ]; then
  echo "[bootstrap] FATAL: postgres binary not available at $BIN" >&2
  exit 1
fi

is_running() { "$BIN/pg_ctl" -D "$PGDATA" status >/dev/null 2>&1; }

# 2. Init datadir if needed.
if [ ! -f "$PGDATA/PG_VERSION" ]; then
  echo "[bootstrap] initdb → $PGDATA"
  "$BIN/initdb" -D "$PGDATA" -U "$PGUSER" --auth=trust -E UTF8 >>"$LOG" 2>&1
fi

# 3. Start server if not running.
if ! is_running; then
  echo "[bootstrap] starting postgres on 127.0.0.1:$PORT"
  "$BIN/pg_ctl" -D "$PGDATA" -o "-p $PORT -h 127.0.0.1 -k /tmp" -l "$LOG" start >/dev/null
  # wait for readiness
  for i in $(seq 1 30); do
    if node "$ROOT/scripts/db_admin.mjs ping" >/dev/null 2>&1; then break; fi
    sleep 0.5
  done
fi

# 4. Ensure the hustleportal database exists.
node "$ROOT/scripts/db_admin.mjs createdb" "$DB" >/dev/null 2>&1 || true

if is_running; then
  echo "[bootstrap] OK — postgres://$PGUSER@127.0.0.1:$PORT/$DB"
  exit 0
else
  echo "[bootstrap] FATAL: postgres did not start (see $LOG)" >&2
  exit 1
fi
