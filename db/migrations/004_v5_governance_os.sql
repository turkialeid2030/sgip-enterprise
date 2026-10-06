-- ============================================================
-- Migration 004: SGIP v5 — Enterprise Governance OS
-- Framework Knowledge + Decision Governance + Behavioral Intelligence
-- ============================================================

-- ── 1. Governance Decisions ────────────────────────────────────
CREATE TABLE IF NOT EXISTS "GovernanceDecision" (
  id                  TEXT PRIMARY KEY DEFAULT uuid_generate_v4()::text,
  "tenantId"          TEXT NOT NULL REFERENCES "Tenant"(id),
  code                TEXT NOT NULL,
  title               TEXT NOT NULL,
  description         TEXT NOT NULL,
  "decisionType"      TEXT NOT NULL,
  status              TEXT NOT NULL DEFAULT 'draft',
  owner               TEXT NOT NULL,
  "ownerRole"         TEXT NOT NULL,
  "accountableParty"  TEXT NOT NULL,
  approver            TEXT NOT NULL,
  "approverRole"      TEXT NOT NULL,
  "linkedControls"    TEXT[] DEFAULT '{}',
  "linkedRisks"       TEXT[] DEFAULT '{}',
  "linkedEvidence"    TEXT[] DEFAULT '{}',
  "linkedPolicies"    TEXT[] DEFAULT '{}',
  "linkedRegulations" TEXT[] DEFAULT '{}',
  "policyValidated"   BOOLEAN DEFAULT false,
  "riskValidated"     BOOLEAN DEFAULT false,
  "authorityValidated"BOOLEAN DEFAULT false,
  "sodValidated"      BOOLEAN DEFAULT false,
  "evidenceComplete"  BOOLEAN DEFAULT false,
  "businessImpact"    TEXT NOT NULL,
  "financialImpact"   FLOAT,
  "riskImpact"        TEXT DEFAULT 'unknown',
  urgency             TEXT DEFAULT 'standard',
  "correlationId"     TEXT NOT NULL DEFAULT uuid_generate_v4()::text,
  "immutableRecordId" TEXT,
  "approvedAt"        TIMESTAMPTZ,
  "rejectedAt"        TIMESTAMPTZ,
  "rejectionReason"   TEXT,
  "createdBy"         TEXT NOT NULL,
  version             INTEGER DEFAULT 1,
  "createdAt"         TIMESTAMPTZ DEFAULT NOW(),
  "updatedAt"         TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE("tenantId", code)
);
CREATE INDEX IF NOT EXISTS idx_gov_decision_tenant  ON "GovernanceDecision"("tenantId");
CREATE INDEX IF NOT EXISTS idx_gov_decision_status  ON "GovernanceDecision"("tenantId", status);
ALTER TABLE "GovernanceDecision" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "GovernanceDecision" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_decision_gov ON "GovernanceDecision"
  USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), ''));

-- ── 2. RACI Matrix ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "RACIEntry" (
  id           TEXT PRIMARY KEY DEFAULT uuid_generate_v4()::text,
  "tenantId"   TEXT NOT NULL,
  "entityId"   TEXT NOT NULL,
  "entityType" TEXT NOT NULL,
  "entityTitle"TEXT NOT NULL,
  "userId"     TEXT NOT NULL,
  "userName"   TEXT NOT NULL,
  "userRole"   TEXT NOT NULL,
  "raciRole"   TEXT NOT NULL,
  "assignedAt" TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE("tenantId","entityId","userId","raciRole")
);
CREATE INDEX IF NOT EXISTS idx_raci_tenant ON "RACIEntry"("tenantId");
CREATE INDEX IF NOT EXISTS idx_raci_entity ON "RACIEntry"("entityId");
ALTER TABLE "RACIEntry" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "RACIEntry" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_raci ON "RACIEntry"
  USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), ''));

-- ── 3. Framework Assessments ───────────────────────────────────
CREATE TABLE IF NOT EXISTS "FrameworkAssessment" (
  id                  TEXT PRIMARY KEY DEFAULT uuid_generate_v4()::text,
  "tenantId"          TEXT NOT NULL,
  "frameworkId"       TEXT NOT NULL,
  "overallScore"      FLOAT NOT NULL,
  "currentLevel"      INTEGER NOT NULL,
  "targetLevel"       INTEGER NOT NULL,
  "coverageScore"     FLOAT NOT NULL,
  "riskExposure"      TEXT NOT NULL,
  "implementedControls" TEXT[] DEFAULT '{}',
  "gaps"              JSONB DEFAULT '[]',
  "roadmap"           JSONB DEFAULT '[]',
  "organizationMode"  TEXT DEFAULT 'enterprise',
  "assessedBy"        TEXT NOT NULL,
  "assessedAt"        TIMESTAMPTZ DEFAULT NOW(),
  "nextReviewAt"      TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_assessment_tenant ON "FrameworkAssessment"("tenantId");
CREATE INDEX IF NOT EXISTS idx_assessment_fw     ON "FrameworkAssessment"("tenantId", "frameworkId");
ALTER TABLE "FrameworkAssessment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "FrameworkAssessment" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_assessment ON "FrameworkAssessment"
  USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), ''));

-- ── 4. Culture Signals ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "CultureSignal" (
  id              TEXT PRIMARY KEY DEFAULT uuid_generate_v4()::text,
  "tenantId"      TEXT NOT NULL,
  type            TEXT NOT NULL,
  "actorId"       TEXT,
  "actorRole"     TEXT,
  department      TEXT,
  frequency       INTEGER DEFAULT 1,
  severity        TEXT NOT NULL,
  description     TEXT NOT NULL,
  "firstObserved" TIMESTAMPTZ DEFAULT NOW(),
  "lastObserved"  TIMESTAMPTZ DEFAULT NOW(),
  trend           TEXT DEFAULT 'stable',
  "businessRisk"  TEXT NOT NULL,
  recommendation  TEXT NOT NULL,
  "correlationId" TEXT NOT NULL DEFAULT uuid_generate_v4()::text
);
CREATE INDEX IF NOT EXISTS idx_culture_tenant ON "CultureSignal"("tenantId");
CREATE INDEX IF NOT EXISTS idx_culture_type   ON "CultureSignal"("tenantId", type);
ALTER TABLE "CultureSignal" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CultureSignal" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_culture ON "CultureSignal"
  USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), ''));

-- ── 5. Maturity Scores ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "MaturityScore" (
  id              TEXT PRIMARY KEY DEFAULT uuid_generate_v4()::text,
  "tenantId"      TEXT NOT NULL,
  "frameworkId"   TEXT NOT NULL,
  "overallScore"  FLOAT NOT NULL,
  "currentLevel"  INTEGER NOT NULL,
  "targetLevel"   INTEGER NOT NULL,
  "levelLabel"    TEXT NOT NULL,
  dimensions      JSONB DEFAULT '[]',
  findings        JSONB DEFAULT '[]',
  roadmap         JSONB DEFAULT '[]',
  "benchmarkComp" FLOAT,
  "nextReviewDate"TIMESTAMPTZ,
  "organizationMode" TEXT DEFAULT 'enterprise',
  "assessedAt"    TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_maturity_tenant ON "MaturityScore"("tenantId");
ALTER TABLE "MaturityScore" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "MaturityScore" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_maturity ON "MaturityScore"
  USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), ''));

-- ── 6. Behavioral signals view ─────────────────────────────────
CREATE OR REPLACE VIEW "GovernanceRisks" AS
  SELECT
    d."tenantId",
    'orphan_decision' AS risk_type,
    d.id              AS entity_id,
    d.title           AS entity_title,
    'critical'        AS severity,
    'Decision without evidence or policy validation' AS description
  FROM "GovernanceDecision" d
  WHERE d."evidenceComplete" = false
    AND d.status NOT IN ('draft', 'rejected', 'withdrawn', 'expired')
  UNION ALL
  SELECT
    e."tenantId",
    'missing_raci',
    e.id,
    e.title,
    'high',
    'Entity has no Accountable party in RACI matrix'
  FROM "GovernanceEntity" e
  WHERE NOT EXISTS (
    SELECT 1 FROM "RACIEntry" r
    WHERE r."entityId" = e.id AND r."raciRole" = 'Accountable'
  );

SELECT '004_v5_governance_os: COMPLETE' AS status;
