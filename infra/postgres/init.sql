-- RETIRED as a schema source. Authoritative path: db/migrations/*.sql
-- Kept for historical reference only; not mounted in any compose file.
-- Schema objects are owned by sgip_owner (NOLOGIN, NOSUPERUSER, NOBYPASSRLS).
-- Extensions are created earlier by the bootstrap superuser in 05-create-roles.sh,
-- because sgip_owner deliberately lacks the privilege to create them.
DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='sgip_owner') THEN SET ROLE sgip_owner; END IF; END $$;
-- SGIP Sovereign GRC OS — PostgreSQL Schema
-- Run via docker-entrypoint-initdb.d

-- Enable extensions





-- Set session defaults
SET timezone = 'UTC';

-- ── Core governance events (immutable, append-only) ──────────
CREATE TABLE IF NOT EXISTS governance_events (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id         TEXT NOT NULL,
    entity_type       TEXT NOT NULL,
    entity_id         TEXT NOT NULL,
    version           INTEGER NOT NULL DEFAULT 1,
    topic             TEXT NOT NULL,
    payload           JSONB NOT NULL DEFAULT '{}',
    idempotency_key   TEXT,
    actor_id          TEXT NOT NULL,
    actor_role        TEXT NOT NULL,
    correlation_id    TEXT NOT NULL DEFAULT gen_random_uuid()::TEXT,
    causation_id      TEXT,
    hash              TEXT NOT NULL,
    previous_hash     TEXT NOT NULL DEFAULT 'GENESIS',
    sequence_number   BIGSERIAL,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(tenant_id, idempotency_key)
);

-- Prevent updates and deletes (immutable ledger)
CREATE RULE governance_events_no_update AS ON UPDATE TO governance_events DO INSTEAD NOTHING;
CREATE RULE governance_events_no_delete AS ON DELETE TO governance_events DO INSTEAD NOTHING;

-- ── Governance snapshots ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS governance_snapshots (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id         TEXT NOT NULL,
    snapshot_type     TEXT NOT NULL,
    event_seq         BIGINT NOT NULL,
    state_checksum    TEXT NOT NULL,
    metadata          JSONB NOT NULL DEFAULT '{}',
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Audit trail ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS audit_trail (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id         TEXT NOT NULL,
    actor_id          TEXT NOT NULL,
    actor_role        TEXT NOT NULL,
    action            TEXT NOT NULL,
    resource_type     TEXT NOT NULL,
    resource_id       TEXT,
    details           JSONB NOT NULL DEFAULT '{}',
    ip_address        INET,
    user_agent        TEXT,
    session_id        TEXT,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Schema migrations tracking ────────────────────────────────
CREATE TABLE IF NOT EXISTS schema_migrations (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    version           TEXT NOT NULL UNIQUE,
    description       TEXT NOT NULL,
    checksum          TEXT NOT NULL,
    applied_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    applied_by        TEXT NOT NULL DEFAULT 'system'
);

-- ── Indexes ───────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_ge_tenant_topic    ON governance_events(tenant_id, topic);
CREATE INDEX IF NOT EXISTS idx_ge_tenant_entity   ON governance_events(tenant_id, entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_ge_tenant_seq      ON governance_events(tenant_id, sequence_number);
CREATE INDEX IF NOT EXISTS idx_ge_correlation     ON governance_events(tenant_id, correlation_id);
CREATE INDEX IF NOT EXISTS idx_at_tenant_actor    ON audit_trail(tenant_id, actor_id);
CREATE INDEX IF NOT EXISTS idx_snap_tenant        ON governance_snapshots(tenant_id, snapshot_type);

-- Record initial migration
INSERT INTO schema_migrations(version, description, checksum, applied_by)
VALUES('001', 'Initial schema — governance events + snapshots + audit', 'sha256:init', 'docker-init')
ON CONFLICT(version) DO NOTHING;

-- evidence_records: required by infra/postgres/rls.sql.
-- Previously rls.sql applied RLS to a table init.sql never created — a
-- deterministic bootstrap failure. Created here so ordering is 01_init -> 02_rls.
CREATE TABLE IF NOT EXISTS evidence_records (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id         TEXT NOT NULL,
    requirement_id    TEXT,
    evidence_type     TEXT NOT NULL,
    storage_ref       TEXT,
    content_hash      TEXT,
    metadata          JSONB NOT NULL DEFAULT '{}',
    valid_from        TIMESTAMPTZ,
    valid_to          TIMESTAMPTZ,
    approved_by       TEXT,
    approved_at       TIMESTAMPTZ,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_evidence_records_tenant ON evidence_records (tenant_id);
CREATE INDEX IF NOT EXISTS idx_evidence_records_req    ON evidence_records (tenant_id, requirement_id);
