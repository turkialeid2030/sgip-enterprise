-- 006_rls_complete.sql
-- AUTHORITATIVE. RLS + FORCE + policy for every tenant-scoped table not already
-- covered by 002/003/004. Table list comes from pg_catalog discovery, not a
-- hand-maintained list.

ALTER TABLE governance_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE governance_snapshots FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_governance_snapshots ON governance_snapshots;
CREATE POLICY tenant_isolation_governance_snapshots ON governance_snapshots
    USING      (tenant_id = current_setting('app.tenant_id', TRUE))
    WITH CHECK (tenant_id = current_setting('app.tenant_id', TRUE));

ALTER TABLE governance_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE governance_events FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_governance_events ON governance_events;
CREATE POLICY tenant_isolation_governance_events ON governance_events
    USING      (tenant_id = current_setting('app.tenant_id', TRUE))
    WITH CHECK (tenant_id = current_setting('app.tenant_id', TRUE));

ALTER TABLE evidence_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE evidence_records FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_evidence_records ON evidence_records;
CREATE POLICY tenant_isolation_evidence_records ON evidence_records
    USING      (tenant_id = current_setting('app.tenant_id', TRUE))
    WITH CHECK (tenant_id = current_setting('app.tenant_id', TRUE));

ALTER TABLE audit_trail ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_trail FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_audit_trail ON audit_trail;
CREATE POLICY tenant_isolation_audit_trail ON audit_trail
    USING      (tenant_id = current_setting('app.tenant_id', TRUE))
    WITH CHECK (tenant_id = current_setting('app.tenant_id', TRUE));

ALTER TABLE "User" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "User" FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_user ON "User";
CREATE POLICY tenant_isolation_user ON "User"
    USING      ("tenantId" = current_setting('app.tenant_id', TRUE))
    WITH CHECK ("tenantId" = current_setting('app.tenant_id', TRUE));

-- Runtime role grants. Role creation lives in 05-create-roles.sh because a
-- password must never be interpolated inside a .sql file.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sgip_app') THEN
        EXECUTE 'GRANT USAGE ON SCHEMA public TO sgip_app';
        EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO sgip_app';
        EXECUTE 'GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO sgip_app';
    END IF;
END $$;
