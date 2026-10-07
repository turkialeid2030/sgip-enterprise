#!/bin/bash
# Runtime application role — created in a .sh file because postgres only
# performs shell interpolation for *.sh, never for *.sql.
# The API must connect as this role, NEVER as the owner/admin account.
set -euo pipefail
: "${APP_DB_PASSWORD:?APP_DB_PASSWORD must be set — refusing to create a role with an empty password}"

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
    DO \$\$
    BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sgip_app') THEN
            CREATE ROLE sgip_app WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE
                NOBYPASSRLS PASSWORD '$APP_DB_PASSWORD';
        ELSE
            ALTER ROLE sgip_app WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
        END IF;
    END
    \$\$;
EOSQL
# CRITICAL (proven on PostgreSQL 18.4): FORCE ROW LEVEL SECURITY contains the
# table OWNER, but a SUPERUSER or BYPASSRLS role bypasses RLS regardless.
# The account that OWNS the tables must therefore also be NOSUPERUSER.
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-'EOCHECK'
    DO $$
    DECLARE bad int;
    BEGIN
        SELECT count(*) INTO bad FROM pg_roles
         WHERE rolname = 'sgip_app' AND (rolsuper OR rolbypassrls);
        IF bad > 0 THEN
            RAISE EXCEPTION 'SGIP: runtime role sgip_app must be NOSUPERUSER and NOBYPASSRLS';
        END IF;
    END
    $$;
EOCHECK
echo "[SGIP] runtime role sgip_app ensured: NOSUPERUSER NOBYPASSRLS, not table owner"
echo "[SGIP] NOTE: the table-owning account must also be NOSUPERUSER — superusers bypass FORCE RLS"
