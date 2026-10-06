/**
 * Policy Engine Types
 * Defines the typed contracts for the Governance Policy Engine.
 */
import { TenantContext } from "./tenant.types";

// ── Policy lifecycle ──────────────────────────────────────────
export type PolicyStatus =
  | "draft" | "pending_approval" | "approved" | "active"
  | "suspended" | "superseded" | "retired";

export type PolicyCategory =
  | "governance" | "risk" | "compliance" | "security" | "financial"
  | "legal" | "hr" | "operational" | "ai" | "privacy" | "data";

export interface PolicyVersion {
  version:      string;   // semver: "2.1.0"
  effectiveFrom:string;   // ISO datetime
  effectiveTo?: string;
  changedBy:    string;
  changeReason: string;
  diff?:        string;   // summary of changes
  approvedBy?:  string;
  approvedAt?:  string;
}

export interface GovernancePolicy {
  id:              string;
  tenantId:        string;
  code:            string;   // POL-GOV-001
  title:           string;
  description:     string;
  category:        PolicyCategory;
  status:          PolicyStatus;
  currentVersion:  string;
  versions:        PolicyVersion[];
  parentPolicyId?: string;   // inheritance
  childPolicyIds:  string[];
  linkedRegulations: string[];
  linkedControls:  string[];
  linkedRisks:     string[];
  scope:           PolicyScope;
  rules:           PolicyRule[];
  approvalChain:   ApprovalStep[];
  effectiveFrom:   string;
  effectiveTo?:    string;
  reviewCycle:     "monthly" | "quarterly" | "semi_annual" | "annual";
  nextReviewAt:    string;
  freshnessScore:  number;    // 0-100
  hasConflicts:    boolean;
  conflictsWith:   string[];  // policy IDs
  createdBy:       string;
  updatedBy:       string;
  createdAt:       string;
  updatedAt:       string;
}

export interface PolicyScope {
  entityTypes:    string[];   // which UGOM entity types this policy governs
  departments:    string[];   // empty = all
  roles:          string[];   // empty = all
  riskLevels:     string[];   // only applies when risk >= level
  conditions:     PolicyCondition[];
}

export interface PolicyCondition {
  field:    string;
  operator: "eq" | "neq" | "gt" | "gte" | "lt" | "lte" | "in" | "not_in" | "contains";
  value:    unknown;
  logicOp?: "AND" | "OR";
}

export interface PolicyRule {
  id:          string;
  description: string;
  trigger:     PolicyTrigger;
  action:      PolicyAction;
  priority:    number;   // 1 = highest
  isHard:      boolean;  // hard = block; soft = warn
}

export type PolicyTrigger =
  | { type: "entity_created"; entityType: string }
  | { type: "entity_updated"; entityType: string; field?: string }
  | { type: "status_change";  from: string; to: string }
  | { type: "risk_threshold"; level: string }
  | { type: "action_requested"; action: string }
  | { type: "scheduled"; cronExpression: string };

export type PolicyAction =
  | { type: "require_approval"; approvers: string[] }
  | { type: "require_evidence"; evidenceTypes: string[] }
  | { type: "block"; reason: string }
  | { type: "notify"; recipients: string[]; template: string }
  | { type: "escalate"; to: string; afterH: number }
  | { type: "auto_tag"; tags: string[] }
  | { type: "set_field"; field: string; value: unknown };

// ── Policy evaluation ─────────────────────────────────────────
export interface PolicyEvaluationRequest {
  context:      TenantContext;
  entityType:   string;
  entityId?:    string;
  action:       string;
  entityData:   Record<string, unknown>;
  actorRole:    string;
  actorId:      string;
}

export interface PolicyEvaluationResult {
  allowed:        boolean;
  blocked:        boolean;
  warnings:       string[];
  requiredActions: PolicyAction[];
  appliedRules:   string[];         // rule IDs that fired
  policyRefs:     string[];         // policy IDs evaluated
  confidenceScore:number;
  evaluatedAt:    string;
  traceId:        string;
}

// ── Approval runtime ──────────────────────────────────────────
export type ApprovalStatus =
  | "pending" | "approved" | "rejected" | "escalated"
  | "expired" | "withdrawn" | "delegated";

export interface ApprovalStep {
  order:        number;
  approver:     string;    // userId or role
  approverType: "user" | "role" | "committee";
  required:     boolean;
  slaHours:     number;
  delegateTo?:  string;
  approvedAt?:  string;
  approvedBy?:  string;
  status:       ApprovalStatus;
  notes?:       string;
}

export interface ApprovalRequest {
  id:            string;
  tenantId:      string;
  entityId:      string;
  entityType:    string;
  action:        string;
  requestedBy:   string;
  steps:         ApprovalStep[];
  currentStep:   number;
  status:        ApprovalStatus;
  slaDeadline:   string;
  policyRef:     string;
  correlationId: string;
  createdAt:     string;
  updatedAt:     string;
}

// ── Segregation of Duties ─────────────────────────────────────
export interface SoDConflict {
  id:          string;
  name:        string;
  description: string;
  action1:     string;
  action2:     string;
  severity:    "critical" | "high" | "medium";
  mitigations: string[];
}

export interface SoDViolation {
  userId:      string;
  conflictId:  string;
  action1:     string;
  action2:     string;
  detectedAt:  string;
  entityId:    string;
  tenantId:    string;
  blocked:     boolean;
}
