-- RETIRED as a schema source. Authoritative path: db/migrations/*.sql
-- Kept for historical reference only; not mounted in any compose file.
-- ============================================================
-- SGIP — Row Level Security hardening
-- P0 CORRECTIONS APPLIED:
--  1. Removed backslash-escaped quotes (\') — the previous file was
--     syntactically invalid and NEVER executed. Policies were not applied.
--  2. Removed ${APP_DB_PASSWORD} from raw SQL. postgres runs *.sql through
--     psql WITHOUT shell interpolation, so the literal string would have
--     become the password. Role creation moved to 20-create-app-role.sh.
--  3. Added FORCE ROW LEVEL SECURITY so the TABLE OWNER cannot bypass RLS.
-- ============================================================

ALTER TABLE governance_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE governance_snapshots FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_snapshots ON governance_snapshots;
CREATE POLICY tenant_isolation_snapshots ON governance_snapshots
    USING      (tenant_id = current_setting('app.tenant_id', TRUE))
    WITH CHECK (tenant_id = current_setting('app.tenant_id', TRUE));

ALTER TABLE governance_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE governance_events FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_events ON governance_events;
CREATE POLICY tenant_isolation_events ON governance_events
    USING      (tenant_id = current_setting('app.tenant_id', TRUE))
    WITH CHECK (tenant_id = current_setting('app.tenant_id', TRUE));

ALTER TABLE evidence_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE evidence_records FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_evidence ON evidence_records;
CREATE POLICY tenant_isolation_evidence ON evidence_records
    USING      (tenant_id = current_setting('app.tenant_id', TRUE))
    WITH CHECK (tenant_id = current_setting('app.tenant_id', TRUE));

-- Runtime role privileges only. Role creation is in 20-create-app-role.sh
-- because a password must never be interpolated inside a .sql file.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sgip_app') THEN
        EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO sgip_app';
        EXECUTE 'GRANT USAGE ON SCHEMA public TO sgip_app';
        EXECUTE 'GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO sgip_app';
    END IF;
END $$;

COMMENT ON TABLE governance_snapshots
    IS 'RLS + FORCE RLS. SET LOCAL app.tenant_id is required before any DML.';

-- audit_trail: discovered by pg_catalog scan as tenant-scoped but unprotected.
-- Found by the V2 gate, not by any hand-maintained list.
ALTER TABLE audit_trail ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_trail FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_audit_trail ON audit_trail;
CREATE POLICY tenant_isolation_audit_trail ON audit_trail
    USING      (tenant_id = current_setting('app.tenant_id', TRUE))
    WITH CHECK (tenant_id = current_setting('app.tenant_id', TRUE));
