CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS "Tenant" (
  id TEXT PRIMARY KEY DEFAULT uuid_generate_v4()::text,
  name TEXT NOT NULL, slug TEXT NOT NULL UNIQUE,
  "isActive" BOOLEAN DEFAULT true,
  "createdAt" TIMESTAMPTZ DEFAULT NOW(), "updatedAt" TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS "User" (
  id TEXT PRIMARY KEY, email TEXT NOT NULL, "passwordHash" TEXT NOT NULL,
  "nameAr" TEXT NOT NULL, role TEXT NOT NULL, "isActive" BOOLEAN DEFAULT true,
  "tenantId" TEXT NOT NULL REFERENCES "Tenant"(id),
  "createdAt" TIMESTAMPTZ DEFAULT NOW(), "updatedAt" TIMESTAMPTZ DEFAULT NOW(),
  "lastLoginAt" TIMESTAMPTZ, UNIQUE(email, "tenantId")
);

CREATE TABLE IF NOT EXISTS "GovernanceEntity" (
  id TEXT PRIMARY KEY DEFAULT uuid_generate_v4()::text,
  type TEXT NOT NULL, title TEXT NOT NULL, description TEXT,
  owner TEXT NOT NULL, "ownerId" TEXT, department TEXT, "departmentId" TEXT,
  status TEXT DEFAULT 'draft', priority TEXT DEFAULT 'medium',
  "riskLevel" TEXT DEFAULT 'medium', "impactLevel" TEXT DEFAULT 'medium',
  "financialImpactJson" JSONB, "legalImpact" TEXT, "complianceImpact" TEXT,
  "reputationalImpact" TEXT, "reviewDate" TIMESTAMPTZ, "dueDate" TIMESTAMPTZ,
  "closedDate" TIMESTAMPTZ, "escalationPathJson" JSONB DEFAULT '[]',
  "approvalChainJson" JSONB DEFAULT '[]', confidentiality TEXT DEFAULT 'internal',
  "evidenceSufficiency" FLOAT, "confidenceScore" FLOAT, "dataJson" JSONB DEFAULT '{}',
  "linkedPolicies" TEXT[] DEFAULT '{}', "linkedRisks" TEXT[] DEFAULT '{}',
  "linkedControls" TEXT[] DEFAULT '{}', "linkedEvidence" TEXT[] DEFAULT '{}',
  "linkedRegulations" TEXT[] DEFAULT '{}', "linkedFindings" TEXT[] DEFAULT '{}',
  "linkedCAPAs" TEXT[] DEFAULT '{}', "linkedDecisions" TEXT[] DEFAULT '{}',
  "linkedObligations" TEXT[] DEFAULT '{}', tags TEXT[] DEFAULT '{}',
  version INTEGER DEFAULT 1, "tenantId" TEXT NOT NULL REFERENCES "Tenant"(id),
  "organizationId" TEXT DEFAULT 'default', "createdBy" TEXT NOT NULL,
  "updatedBy" TEXT NOT NULL, "createdAt" TIMESTAMPTZ DEFAULT NOW(),
  "updatedAt" TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_entity_tenant_type ON "GovernanceEntity"("tenantId", type);
CREATE INDEX IF NOT EXISTS idx_entity_tenant_status ON "GovernanceEntity"("tenantId", status);

CREATE TABLE IF NOT EXISTS "GraphEdge" (
  id TEXT PRIMARY KEY DEFAULT uuid_generate_v4()::text,
  "fromId" TEXT NOT NULL REFERENCES "GovernanceEntity"(id) ON DELETE CASCADE,
  "fromType" TEXT NOT NULL, "toId" TEXT NOT NULL REFERENCES "GovernanceEntity"(id) ON DELETE CASCADE,
  "toType" TEXT NOT NULL, relationship TEXT NOT NULL, weight FLOAT DEFAULT 5,
  "propertiesJson" JSONB DEFAULT '{}', "isInferred" BOOLEAN DEFAULT false,
  "tenantId" TEXT NOT NULL, "createdBy" TEXT NOT NULL, "createdAt" TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE("fromId", "toId", relationship)
);
CREATE INDEX IF NOT EXISTS idx_edge_from ON "GraphEdge"("fromId");
CREATE INDEX IF NOT EXISTS idx_edge_to ON "GraphEdge"("toId");

CREATE TABLE IF NOT EXISTS "AuditLog" (
  id TEXT PRIMARY KEY, "entityId" TEXT, "entityType" TEXT, action TEXT NOT NULL,
  "performedBy" TEXT NOT NULL, role TEXT DEFAULT 'system',
  "previousValue" JSONB, "newValue" JSONB, "traceId" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL, "createdAt" TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_audit_tenant ON "AuditLog"("tenantId");
CREATE INDEX IF NOT EXISTS idx_audit_entity ON "AuditLog"("entityId");

CREATE TABLE IF NOT EXISTS "MemoryEntry" (
  id TEXT PRIMARY KEY DEFAULT uuid_generate_v4()::text, type TEXT NOT NULL,
  title TEXT NOT NULL, summary TEXT NOT NULL, source TEXT NOT NULL,
  "sourceEntityId" TEXT, "sourceEntityType" TEXT, "relatedEntityIds" TEXT[] DEFAULT '{}',
  importance TEXT DEFAULT 'medium', tags TEXT[] DEFAULT '{}',
  "confidenceScore" FLOAT DEFAULT 75, "retrievalCount" INTEGER DEFAULT 0,
  version INTEGER DEFAULT 1, "expiresAt" TIMESTAMPTZ, "tenantId" TEXT NOT NULL,
  "isArchived" BOOLEAN DEFAULT false, "createdAt" TIMESTAMPTZ DEFAULT NOW(),
  "updatedAt" TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS "AgentOutput" (
  id TEXT PRIMARY KEY, "agentId" TEXT NOT NULL, "outputType" TEXT NOT NULL,
  "inputSummary" TEXT NOT NULL, "outputJson" JSONB NOT NULL,
  "confidenceScore" FLOAT NOT NULL, "evidenceRefs" TEXT[] DEFAULT '{}',
  "hallucinationCheckPassed" BOOLEAN DEFAULT false, "requiresHumanReview" BOOLEAN DEFAULT false,
  "reviewerStatus" TEXT DEFAULT 'pending', "reviewedBy" TEXT, "reviewedAt" TIMESTAMPTZ,
  "modelName" TEXT NOT NULL, "promptVersion" TEXT DEFAULT '1.0',
  "traceId" TEXT NOT NULL, "sessionId" TEXT NOT NULL, "tenantId" TEXT NOT NULL,
  "createdAt" TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_agent_output_review ON "AgentOutput"("tenantId", "reviewerStatus");

SELECT 'Migration 001 completed' AS status;
