#!/bin/bash
# Deterministic role bootstrap. Runs BEFORE schema/migrations (05_ prefix).
#
# Role separation (item 10):
#   sgip_owner  — owns schema objects. NOLOGIN, NOSUPERUSER, NOBYPASSRLS.
#                 (proven on PG 18.4: FORCE RLS contains an owner, but a
#                  SUPERUSER bypasses RLS regardless — so the owner must not be one)
#   sgip_migrator — DDL/migrations only. LOGIN.
#   sgip_app    — runtime. LOGIN, DML only, NOSUPERUSER, NOBYPASSRLS, no ownership.
set -euo pipefail
: "${APP_DB_PASSWORD:?APP_DB_PASSWORD must be set}"
: "${MIGRATOR_DB_PASSWORD:=$APP_DB_PASSWORD}"

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
    DO \$\$
    BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='sgip_owner') THEN
            CREATE ROLE sgip_owner NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
        ELSE
            ALTER ROLE sgip_owner NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
        END IF;

        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='sgip_migrator') THEN
            CREATE ROLE sgip_migrator LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS
                PASSWORD '$MIGRATOR_DB_PASSWORD';
        ELSE
            ALTER ROLE sgip_migrator LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
        END IF;
        GRANT sgip_owner TO sgip_migrator;

        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='sgip_app') THEN
            CREATE ROLE sgip_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS
                PASSWORD '$APP_DB_PASSWORD';
        ELSE
            ALTER ROLE sgip_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
        END IF;
    END
    \$\$;
EOSQL
# Extensions require superuser and must exist BEFORE schema creation, because
# the schema owner (sgip_owner) is deliberately NOSUPERUSER.
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-'EOEXT'
    CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
    CREATE EXTENSION IF NOT EXISTS pgcrypto;

    -- PostgreSQL 15+ no longer grants CREATE on schema public to PUBLIC.
    -- The schema owner needs it explicitly, or bootstrap fails with
    -- "permission denied for schema public".
    GRANT USAGE, CREATE ON SCHEMA public TO sgip_owner;
    GRANT USAGE ON SCHEMA public TO sgip_app;
    ALTER DEFAULT PRIVILEGES FOR ROLE sgip_owner IN SCHEMA public
        GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO sgip_app;
    ALTER DEFAULT PRIVILEGES FOR ROLE sgip_owner IN SCHEMA public
        GRANT USAGE, SELECT ON SEQUENCES TO sgip_app;
EOEXT

echo "[SGIP] roles ensured: sgip_owner(NOLOGIN) / sgip_migrator / sgip_app"
echo "[SGIP] extensions ensured by bootstrap superuser"
