-- ============================================================
-- Migration 003: Graph Evidence Hardening + Immutable Records
-- SGIP Governance Runtime Foundation v4
-- ============================================================

-- ── 1. Evidence records table ────────────────────────────────
CREATE TABLE IF NOT EXISTS "EvidenceRecord" (
  id                TEXT PRIMARY KEY DEFAULT uuid_generate_v4()::text,
  "tenantId"        TEXT NOT NULL,
  code              TEXT NOT NULL,
  title             TEXT NOT NULL,
  "sourceType"      TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'pending',
  "contentHash"     TEXT NOT NULL,
  "chainHash"       TEXT NOT NULL,
  "previousHash"    TEXT,
  "integrityScore"  FLOAT NOT NULL DEFAULT 100,
  "collectedBy"     TEXT NOT NULL,
  "collectedAt"     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "sourceSystem"    TEXT,
  "sourceRef"       TEXT,
  "entityId"        TEXT NOT NULL,
  "entityType"      TEXT NOT NULL,
  "correlationId"   TEXT NOT NULL,
  "retentionDays"   INTEGER DEFAULT 365,
  "expiresAt"       TIMESTAMPTZ,
  "legalHold"       BOOLEAN DEFAULT false,
  "legalHoldReason" TEXT,
  "verifiedBy"      TEXT,
  "verifiedAt"      TIMESTAMPTZ,
  "verificationNotes" TEXT,
  version           INTEGER DEFAULT 1,
  "createdAt"       TIMESTAMPTZ DEFAULT NOW(),
  "updatedAt"       TIMESTAMPTZ DEFAULT NOW()
);
-- Append-only: no UPDATE / DELETE via application
CREATE INDEX IF NOT EXISTS idx_evidence_tenant    ON "EvidenceRecord"("tenantId");
CREATE INDEX IF NOT EXISTS idx_evidence_entity    ON "EvidenceRecord"("entityId");
CREATE INDEX IF NOT EXISTS idx_evidence_legal_hold ON "EvidenceRecord"("legalHold") WHERE "legalHold" = true;

-- ── 2. Attestations ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "Attestation" (
  id                TEXT PRIMARY KEY DEFAULT uuid_generate_v4()::text,
  "tenantId"        TEXT NOT NULL,
  "entityId"        TEXT NOT NULL,
  "entityType"      TEXT NOT NULL,
  "attestedBy"      TEXT NOT NULL,
  "attestedByRole"  TEXT NOT NULL,
  statement         TEXT NOT NULL,
  confidence        FLOAT NOT NULL,
  "evidenceIds"     TEXT[] DEFAULT '{}',
  "policyRef"       TEXT,
  "signatureHash"   TEXT NOT NULL,
  timestamp         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "expiresAt"       TIMESTAMPTZ,
  "isRevoked"       BOOLEAN DEFAULT false,
  "revokedReason"   TEXT,
  "correlationId"   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_attestation_tenant ON "Attestation"("tenantId");
CREATE INDEX IF NOT EXISTS idx_attestation_entity ON "Attestation"("entityId");

-- ── 3. Immutable decision records ────────────────────────────
CREATE TABLE IF NOT EXISTS "ImmutableDecision" (
  id                TEXT PRIMARY KEY DEFAULT uuid_generate_v4()::text,
  "tenantId"        TEXT NOT NULL,
  "decisionType"    TEXT NOT NULL,
  "entityId"        TEXT NOT NULL,
  "entityType"      TEXT NOT NULL,
  "actorId"         TEXT NOT NULL,
  "actorRole"       TEXT NOT NULL,
  outcome           TEXT NOT NULL,
  rationale         TEXT NOT NULL,
  "evidenceRefs"    TEXT[] DEFAULT '{}',
  "policyRefs"      TEXT[] DEFAULT '{}',
  "approvalRefs"    TEXT[] DEFAULT '{}',
  "sodChecked"      BOOLEAN DEFAULT false,
  "sodViolations"   INTEGER DEFAULT 0,
  "policyAllowed"   BOOLEAN DEFAULT true,
  "integrityHash"   TEXT NOT NULL,
  "correlationId"   TEXT NOT NULL,
  timestamp         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "isSealed"        BOOLEAN DEFAULT true
  -- No updatedAt — immutable by design
);
CREATE INDEX IF NOT EXISTS idx_decision_tenant ON "ImmutableDecision"("tenantId");
CREATE INDEX IF NOT EXISTS idx_decision_entity ON "ImmutableDecision"("entityId");

-- ── 4. Graph edge enhancements ────────────────────────────────
-- Add edgeType (v4 typed) and evidenceId to existing GraphEdge
ALTER TABLE "GraphEdge"
  ADD COLUMN IF NOT EXISTS "edgeType"    TEXT,
  ADD COLUMN IF NOT EXISTS "evidenceId"  TEXT;

-- ── 5. RLS on new tables ──────────────────────────────────────
ALTER TABLE "EvidenceRecord"   ENABLE ROW LEVEL SECURITY;
ALTER TABLE "EvidenceRecord" FORCE ROW LEVEL SECURITY;
ALTER TABLE "Attestation"      ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Attestation" FORCE ROW LEVEL SECURITY;
ALTER TABLE "ImmutableDecision" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ImmutableDecision" FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_evidence   ON "EvidenceRecord"    USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), ''));
CREATE POLICY tenant_isolation_attestation ON "Attestation"      USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), ''));
CREATE POLICY tenant_isolation_decision   ON "ImmutableDecision" USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), ''));

-- ── 6. Governance query materialization helper views ──────────
-- View: risks with no controlling controls
CREATE OR REPLACE VIEW "UnmitigatedRisks" AS
  SELECT e.id, e.title, e."riskLevel", e."tenantId", e."createdAt"
  FROM "GovernanceEntity" e
  WHERE e.type = 'risk'
    AND e.status != 'archived'
    AND NOT EXISTS (
      SELECT 1 FROM "GraphEdge" g
      WHERE g."toId" = e.id
        AND g."tenantId" = e."tenantId"
        AND g.relationship IN ('mitigates', 'enforced_by', 'CONTROL_ADDRESSES_RISK')
    );

-- View: evidence expiring in next 30 days
CREATE OR REPLACE VIEW "ExpiringEvidence" AS
  SELECT id, title, "entityId", "expiresAt", "tenantId"
  FROM "EvidenceRecord"
  WHERE "expiresAt" IS NOT NULL
    AND "expiresAt" BETWEEN NOW() AND NOW() + INTERVAL '30 days'
    AND "legalHold" = false;

-- View: overdue CAPAs
CREATE OR REPLACE VIEW "OverdueCapas" AS
  SELECT id, title, owner, "dueDate", "tenantId"
  FROM "GovernanceEntity"
  WHERE type = 'capa'
    AND status != 'closed'
    AND "dueDate" < NOW();

SELECT '003_graph_evidence_hardening: COMPLETE' AS status;
