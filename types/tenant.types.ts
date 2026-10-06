/**
 * Tenant Types — Multi-Tenant Architecture
 * Every operation in the system MUST carry a TenantContext.
 * No query, no write, no event, no graph traversal without tenant isolation.
 */

// ── Tenant identity ───────────────────────────────────────────
export interface TenantContext {
  tenantId:      string;
  organizationId:string;
  userId:        string;
  userRole:      string;
  sessionId:     string;
  requestId:     string;   // per-request correlation ID
  timestamp:     string;   // ISO 8601
}

export interface TenantConfig {
  id:              string;
  slug:            string;
  name:            string;
  plan:            TenantPlan;
  status:          "active" | "suspended" | "trial" | "terminated";
  maxUsers:        number;
  maxEntities:     number;
  features:        TenantFeature[];
  settings:        TenantSettings;
  createdAt:       string;
  updatedAt:       string;
}

export type TenantPlan    = "free" | "starter" | "professional" | "enterprise";
export type TenantFeature =
  | "multi_user"      | "policy_engine"   | "agent_runtime"
  | "event_streaming" | "graph_advanced"  | "audit_export"
  | "custom_roles"    | "sso"             | "api_access";

export interface TenantSettings {
  riskAppetite:         "conservative" | "moderate" | "aggressive";
  defaultConfidentiality: string;
  auditRetentionDays:   number;
  requireEvidenceForFindings: boolean;
  humanReviewThreshold: number;   // 0-100
  autoEscalateAfterH:   number;   // hours
  timezone:             string;
  locale:               "ar" | "en" | "ar-en";
}

// ── Tenant isolation violation ────────────────────────────────
export interface TenantViolation {
  type:        "cross_tenant_access" | "missing_tenant_context" | "tenant_mismatch";
  sourceId:    string;
  targetId?:   string;
  entityType?: string;
  actorId:     string;
  timestamp:   string;
  blocked:     boolean;
}
