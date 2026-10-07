#!/bin/bash
# AUTHORITATIVE migration runner.
#
# INTEGRITY RULE (V5.2): the ledger is consulted BEFORE any SQL is executed.
#   version absent               -> execute + record, atomically
#   version present, same hash   -> SKIP (no SQL executed)
#   version present, other hash  -> ABORT BEFORE EXECUTING (exit 1)
# A tampered historical migration must never touch the schema and only then be
# detected — by that point the damage is done.
set -euo pipefail
DIR="${SGIP_MIGRATIONS_DIR:-/docker-entrypoint-initdb.d/migrations}"
PSQL=(psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB")

"${PSQL[@]}" <<-'EOSQL'
    SET ROLE sgip_owner;
    CREATE TABLE IF NOT EXISTS schema_migrations (
        id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        version      TEXT NOT NULL,
        description  TEXT NOT NULL,
        checksum     TEXT NOT NULL,
        source_id    TEXT NOT NULL,
        applied_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        applied_by   TEXT NOT NULL DEFAULT CURRENT_USER,
        duration_ms  INTEGER,
        status       TEXT NOT NULL DEFAULT 'applied',
        CONSTRAINT uq_schema_migrations_version UNIQUE (version)
    );
    RESET ROLE;
EOSQL

for f in $(ls "$DIR"/*.sql | sort); do
  base=$(basename "$f")
  version="${base%%_*}"
  checksum=$(sed 's/--.*$//' "$f" | tr -s '[:space:]' ' ' | sed 's/^ //; s/ $//' | sha256sum | cut -c1-16)

  # ── consult the ledger FIRST — before any SQL runs ──
  stored=$("${PSQL[@]}" -tAc "SELECT checksum FROM schema_migrations WHERE version='$version'")
  stored=$(echo "$stored" | tr -d '[:space:]')

  if [ -n "$stored" ]; then
    if [ "$stored" = "$checksum" ]; then
      echo "[SGIP] SKIP $base (already applied, checksum matches)"
      continue
    fi
    echo "[SGIP] ABORT: $base checksum mismatch — ledger=$stored file=$checksum" >&2
    echo "[SGIP] A historical migration was modified. No SQL was executed." >&2
    exit 1
  fi

  echo "[SGIP] applying $base (version=$version checksum=$checksum)"
  start=$(date +%s%3N)
  "${PSQL[@]}" --single-transaction \
       -c "SET ROLE sgip_owner;" \
       -f "$f" \
       -c "INSERT INTO schema_migrations(version,description,checksum,source_id,duration_ms)
           VALUES ('$version','$base','$checksum','db/migrations/$base',$(( $(date +%s%3N) - start )));"
done
echo "[SGIP] authoritative migrations applied and recorded"
