-- ============================================================
-- Migration 002: Multi-Tenant RLS + Tenant Hardening
-- SGIP Governance Runtime Foundation v3
-- ============================================================
-- Adds Row-Level Security to ALL tables containing tenant data.
-- Sets up tenant configuration and violation log tables.
-- ============================================================

-- ── 1. Tenant configuration table ────────────────────────────
CREATE TABLE IF NOT EXISTS "TenantConfig" (
  id                TEXT PRIMARY KEY DEFAULT uuid_generate_v4()::text,
  slug              TEXT NOT NULL UNIQUE,
  name              TEXT NOT NULL,
  plan              TEXT NOT NULL DEFAULT 'starter',
  status            TEXT NOT NULL DEFAULT 'active',
  "maxUsers"        INTEGER DEFAULT 50,
  "maxEntities"     INTEGER DEFAULT 10000,
  features          TEXT[] DEFAULT '{}',
  settings          JSONB  DEFAULT '{}',
  "createdAt"       TIMESTAMPTZ DEFAULT NOW(),
  "updatedAt"       TIMESTAMPTZ DEFAULT NOW()
);

-- Insert default from existing Tenant table if present
INSERT INTO "TenantConfig" (id, slug, name, plan, status)
SELECT t.id, t.slug, t.name, 'starter', 'active'
FROM "Tenant" t
ON CONFLICT (id) DO NOTHING;

-- ── 2. Tenant violation log (immutable) ──────────────────────
CREATE TABLE IF NOT EXISTS "TenantViolation" (
  id              TEXT PRIMARY KEY DEFAULT uuid_generate_v4()::text,
  type            TEXT NOT NULL,
  "sourceId"      TEXT NOT NULL,
  "targetId"      TEXT,
  "entityType"    TEXT,
  "actorId"       TEXT NOT NULL,
  "tenantId"      TEXT NOT NULL,
  blocked         BOOLEAN DEFAULT true,
  metadata        JSONB DEFAULT '{}',
  "createdAt"     TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_violation_tenant ON "TenantViolation"("tenantId");
CREATE INDEX IF NOT EXISTS idx_violation_actor  ON "TenantViolation"("actorId");

-- ── 3. Policy Engine tables ───────────────────────────────────
CREATE TABLE IF NOT EXISTS "GovernancePolicy" (
  id                TEXT PRIMARY KEY DEFAULT uuid_generate_v4()::text,
  "tenantId"        TEXT NOT NULL REFERENCES "Tenant"(id),
  code              TEXT NOT NULL,
  title             TEXT NOT NULL,
  description       TEXT,
  category          TEXT NOT NULL DEFAULT 'governance',
  status            TEXT NOT NULL DEFAULT 'draft',
  "currentVersion"  TEXT NOT NULL DEFAULT '1.0.0',
  versions          JSONB NOT NULL DEFAULT '[]',
  "parentPolicyId"  TEXT,
  "childPolicyIds"  TEXT[]  DEFAULT '{}',
  "linkedRegulations" TEXT[] DEFAULT '{}',
  "linkedControls"  TEXT[]  DEFAULT '{}',
  "linkedRisks"     TEXT[]  DEFAULT '{}',
  scope             JSONB   DEFAULT '{}',
  rules             JSONB   DEFAULT '[]',
  "approvalChain"   JSONB   DEFAULT '[]',
  "effectiveFrom"   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "effectiveTo"     TIMESTAMPTZ,
  "reviewCycle"     TEXT    DEFAULT 'annual',
  "nextReviewAt"    TIMESTAMPTZ,
  "freshnessScore"  FLOAT   DEFAULT 100,
  "hasConflicts"    BOOLEAN DEFAULT false,
  "conflictsWith"   TEXT[]  DEFAULT '{}',
  "createdBy"       TEXT    NOT NULL,
  "updatedBy"       TEXT    NOT NULL,
  "createdAt"       TIMESTAMPTZ DEFAULT NOW(),
  "updatedAt"       TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE("tenantId", code)
);
CREATE INDEX IF NOT EXISTS idx_policy_tenant        ON "GovernancePolicy"("tenantId");
CREATE INDEX IF NOT EXISTS idx_policy_tenant_status ON "GovernancePolicy"("tenantId", status);
CREATE INDEX IF NOT EXISTS idx_policy_parent        ON "GovernancePolicy"("parentPolicyId");

-- ── 4. Approval requests table ────────────────────────────────
CREATE TABLE IF NOT EXISTS "ApprovalRequest" (
  id             TEXT PRIMARY KEY DEFAULT uuid_generate_v4()::text,
  "tenantId"     TEXT NOT NULL REFERENCES "Tenant"(id),
  "entityId"     TEXT NOT NULL,
  "entityType"   TEXT NOT NULL,
  action         TEXT NOT NULL,
  "requestedBy"  TEXT NOT NULL,
  steps          JSONB NOT NULL DEFAULT '[]',
  "currentStep"  INTEGER DEFAULT 0,
  status         TEXT NOT NULL DEFAULT 'pending',
  "slaDeadline"  TIMESTAMPTZ NOT NULL,
  "policyRef"    TEXT,
  "correlationId"TEXT NOT NULL DEFAULT uuid_generate_v4()::text,
  notes          TEXT,
  "createdAt"    TIMESTAMPTZ DEFAULT NOW(),
  "updatedAt"    TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_approval_tenant  ON "ApprovalRequest"("tenantId");
CREATE INDEX IF NOT EXISTS idx_approval_entity  ON "ApprovalRequest"("entityId");
CREATE INDEX IF NOT EXISTS idx_approval_status  ON "ApprovalRequest"("tenantId", status);

-- ── 5. SoD violations table ───────────────────────────────────
CREATE TABLE IF NOT EXISTS "SoDViolation" (
  id           TEXT PRIMARY KEY DEFAULT uuid_generate_v4()::text,
  "tenantId"   TEXT NOT NULL,
  "userId"     TEXT NOT NULL,
  "conflictId" TEXT NOT NULL,
  action1      TEXT NOT NULL,
  action2      TEXT NOT NULL,
  "entityId"   TEXT NOT NULL,
  blocked      BOOLEAN DEFAULT true,
  "detectedAt" TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_sod_tenant ON "SoDViolation"("tenantId");
CREATE INDEX IF NOT EXISTS idx_sod_user   ON "SoDViolation"("userId");

-- ── 6. Policy evaluation audit log ───────────────────────────
CREATE TABLE IF NOT EXISTS "PolicyEvaluation" (
  id              TEXT PRIMARY KEY DEFAULT uuid_generate_v4()::text,
  "tenantId"      TEXT NOT NULL,
  "entityType"    TEXT NOT NULL,
  "entityId"      TEXT,
  action          TEXT NOT NULL,
  "actorId"       TEXT NOT NULL,
  "actorRole"     TEXT NOT NULL,
  allowed         BOOLEAN NOT NULL,
  blocked         BOOLEAN NOT NULL,
  warnings        TEXT[] DEFAULT '{}',
  "appliedRules"  TEXT[] DEFAULT '{}',
  "policyRefs"    TEXT[] DEFAULT '{}',
  "confidenceScore" FLOAT DEFAULT 100,
  "traceId"       TEXT NOT NULL,
  "evaluatedAt"   TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_policy_eval_tenant ON "PolicyEvaluation"("tenantId");
CREATE INDEX IF NOT EXISTS idx_policy_eval_entity ON "PolicyEvaluation"("entityId");
CREATE INDEX IF NOT EXISTS idx_policy_eval_blocked ON "PolicyEvaluation"("tenantId", blocked);

-- ── 7. Enable Row-Level Security on all tenant tables ─────────
-- Application sets: SET LOCAL app.tenant_id = '<uuid>'
-- Each policy checks: tenantId = current_setting('app.tenant_id', true)

ALTER TABLE "GovernanceEntity" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "GovernanceEntity" FORCE ROW LEVEL SECURITY;
ALTER TABLE "GraphEdge"         ENABLE ROW LEVEL SECURITY;
ALTER TABLE "GraphEdge" FORCE ROW LEVEL SECURITY;
ALTER TABLE "AuditLog"          ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AuditLog" FORCE ROW LEVEL SECURITY;
ALTER TABLE "MemoryEntry"        ENABLE ROW LEVEL SECURITY;
ALTER TABLE "MemoryEntry" FORCE ROW LEVEL SECURITY;
ALTER TABLE "AgentOutput"        ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AgentOutput" FORCE ROW LEVEL SECURITY;
ALTER TABLE "GovernancePolicy"   ENABLE ROW LEVEL SECURITY;
ALTER TABLE "GovernancePolicy" FORCE ROW LEVEL SECURITY;
ALTER TABLE "ApprovalRequest"    ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ApprovalRequest" FORCE ROW LEVEL SECURITY;
ALTER TABLE "SoDViolation"       ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SoDViolation" FORCE ROW LEVEL SECURITY;
ALTER TABLE "PolicyEvaluation"   ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PolicyEvaluation" FORCE ROW LEVEL SECURITY;
ALTER TABLE "TenantViolation"    ENABLE ROW LEVEL SECURITY;
ALTER TABLE "TenantViolation" FORCE ROW LEVEL SECURITY;

-- ── 8. RLS policies — tenant isolation ────────────────────────
-- Pattern: app can only see rows where tenantId matches session variable
-- BYPASSRLS applies to sgip_admin superuser during migrations/seeding

CREATE POLICY tenant_isolation_entity ON "GovernanceEntity"
  USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), ''));

CREATE POLICY tenant_isolation_edge ON "GraphEdge"
  USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), ''));

CREATE POLICY tenant_isolation_audit ON "AuditLog"
  USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), ''));

CREATE POLICY tenant_isolation_memory ON "MemoryEntry"
  USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), ''));

CREATE POLICY tenant_isolation_agent_output ON "AgentOutput"
  USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), ''));

CREATE POLICY tenant_isolation_policy ON "GovernancePolicy"
  USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), ''));

CREATE POLICY tenant_isolation_approval ON "ApprovalRequest"
  USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), ''));

CREATE POLICY tenant_isolation_sod ON "SoDViolation"
  USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), ''));

CREATE POLICY tenant_isolation_eval ON "PolicyEvaluation"
  USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), ''));

CREATE POLICY tenant_isolation_violation ON "TenantViolation"
  USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), ''));

-- ── 9. Helper function: set tenant context for RLS ────────────
CREATE OR REPLACE FUNCTION set_tenant_context(p_tenant_id TEXT)
RETURNS void AS $$
BEGIN
  PERFORM set_config('app.tenant_id', p_tenant_id, true);  -- true = local to transaction
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ── 10. Graph isolation: prevent cross-tenant edge traversal ──
CREATE OR REPLACE VIEW "TenantGraphEdge" AS
  SELECT ge.*
  FROM "GraphEdge" ge
  JOIN "GovernanceEntity" src ON ge."fromId" = src.id
  JOIN "GovernanceEntity" dst ON ge."toId"   = dst.id
  WHERE src."tenantId" = dst."tenantId"
    AND src."tenantId" = NULLIF(current_setting('app.tenant_id', true), '');

SELECT '002_rls_tenant_hardening: COMPLETE' AS status;
