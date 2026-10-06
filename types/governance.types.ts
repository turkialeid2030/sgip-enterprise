/**
 * SGIP Enterprise — Core Governance Type System
 * SINGLE SOURCE OF TRUTH for all modules, agents, graph nodes.
 * No local re-definitions permitted anywhere in the codebase.
 */

// ── Primitive Enums ────────────────────────────────────────────────────
export type RiskLevel    = 'critical' | 'high' | 'medium' | 'low' | 'info';
export type ImpactLevel  = 'critical' | 'high' | 'medium' | 'low';
export type Priority     = 'critical' | 'high' | 'medium' | 'low';
export type ConfLevel    = 'highly_confidential' | 'confidential' | 'restricted' | 'internal' | 'public';
export type EntityStatus = 'draft' | 'active' | 'under_review' | 'approved' | 'rejected'
                         | 'closed' | 'escalated' | 'overdue' | 'blocked' | 'archived';
export type TrendDir     = 'improving' | 'stable' | 'worsening' | 'unknown';
export type MaturityLevel = 1 | 2 | 3 | 4 | 5;
export type LineOfDefense = 'first' | 'second' | 'third' | 'external';

// ── UGOM Entity Types ──────────────────────────────────────────────────
export type UGOMType =
  | 'organization'          | 'entity'              | 'department'
  | 'board'                 | 'committee'           | 'policy'
  | 'procedure'             | 'risk'                | 'control'
  | 'compliance_obligation' | 'audit_finding'       | 'external_finding'
  | 'financial_review'      | 'legal_review'        | 'capa'
  | 'incident'              | 'evidence'            | 'board_resolution'
  | 'committee_decision'    | 'kpi'                 | 'kri'
  | 'kci'                   | 'regulatory_requirement' | 'contract'
  | 'litigation'            | 'fraud_case'          | 'whistleblowing_case'
  | 'ipo_gap'               | 'agent_action'        | 'assurance_activity'
  | 'decision'              | 'vendor'              | 'strategic_objective'
  | 'regulation';

// ── Graph Relationship Types ───────────────────────────────────────────
export type RelationshipType =
  | 'mitigates'     | 'requires'       | 'governs'        | 'enforced_by'
  | 'supports'      | 'creates_risk'   | 'triggers'       | 'addresses'
  | 'validated_by'  | 'escalates_to'   | 'approved_by'    | 'owned_by'
  | 'linked_to'     | 'creates_obligation' | 'produces_finding' | 'resolved_by'
  | 'measured_by'   | 'depends_on'     | 'contradicts'    | 'supersedes'
  | 'implements'    | 'maps_to'        | 'bypassed_by'    | 'evidenced_by';

// ── Financial Impact ───────────────────────────────────────────────────
export interface FinancialImpact {
  currency:    'SAR' | 'USD' | 'EUR';
  amount?:     number;
  description: string;
  isEstimate:  boolean;
}

// ── Escalation Step ────────────────────────────────────────────────────
export interface EscalationStep {
  order:         number;
  escalateTo:    string;   // role or entity ID
  triggerAfterH: number;   // hours
  condition?:    string;
}

// ── Approval Step ──────────────────────────────────────────────────────
export interface GovernanceApprovalStep {
  order:      number;
  approver:   string;
  role:       string;
  required:   boolean;
  approvedAt?: string;
  approvedBy?: string;
  notes?:     string;
}

// ── Audit Entry ────────────────────────────────────────────────────────
export interface AuditEntry {
  id:             string;
  entityId:       string;
  entityType:     UGOMType | string;  // allow string for flexibility
  action:         string;
  performedBy:    string;
  role:           string;
  timestamp:      string;   // ISO 8601
  previousValue?: unknown;
  newValue?:      unknown;
  traceId:        string;
  tenantId:       string;
  isImmutable:    boolean;
}

// ── Base Governance Object ─────────────────────────────────────────────
export interface BaseGovernanceObject {
  id:                  string;
  type:                UGOMType;
  title:               string;
  description?:        string;
  owner:               string;
  ownerId?:            string;
  department?:         string;
  departmentId?:       string;
  status:              EntityStatus;
  priority:            Priority;
  riskLevel:           RiskLevel;
  impactLevel:         ImpactLevel;

  // Graph edge IDs — resolved at runtime by SKG
  linkedPolicies:      string[];
  linkedRisks:         string[];
  linkedControls:      string[];
  linkedEvidence:      string[];
  linkedRegulations:   string[];
  linkedFindings:      string[];
  linkedCAPAs:         string[];
  linkedDecisions:     string[];
  linkedObligations:   string[];

  // Impact dimensions
  financialImpact?:    FinancialImpact;
  legalImpact?:        string;
  complianceImpact?:   string;
  reputationalImpact?: string;

  // Lifecycle
  reviewDate?:         string;
  dueDate?:            string;
  closedDate?:         string;

  // Governance chains
  escalationPath:      EscalationStep[];
  approvalChain:       GovernanceApprovalStep[];

  // Audit & Security
  auditTrail:          AuditEntry[];
  confidentiality:     ConfLevel;
  evidenceSufficiency?: number;  // 0-100
  confidenceScore?:    number;   // 0-100

  // Tenant isolation
  tenantId:            string;
  organizationId:      string;

  // Versioning
  version:             number;
  createdAt:           string;
  updatedAt:           string;
  createdBy:           string;
  updatedBy:           string;
  tags:                string[];
}
