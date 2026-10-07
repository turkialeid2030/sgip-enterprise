/**
 * Agent Governance Type System
 * Every agent is governed by a typed constitution.
 * No agent operates outside these contracts.
 */
import { UGOMType, RiskLevel, AuditEntry } from "./governance.types";

// ── Agent Identity ─────────────────────────────────────────────────────
export type AgentId =
  | 'governance_analyst'   | 'risk_analyst'        | 'compliance_analyst'
  | 'internal_audit_agent' | 'financial_reviewer'  | 'legal_reviewer'
  | 'evidence_validator'   | 'quality_gate_agent'  | 'board_reporter'
  | 'fraud_analyst'        | 'orchestrator';

export type AgentAction =
  | 'read'           | 'write:finding'         | 'write:recommendation'
  | 'write:report'   | 'write:risk_assessment' | 'write:workpaper'
  | 'escalate'       | 'approve'               | 'certify'
  | 'close'          | 'flag'                  | 'override';

export type CostTier = 'low' | 'standard' | 'premium';

// ── Agent Constitution ─────────────────────────────────────────────────
export interface AgentConstitution {
  agentId:                AgentId;
  role:                   string;
  arabicName:             string;
  description:            string;
  scope:                  UGOMType[];          // entity types this agent can access
  allowedActions:         AgentAction[];
  forbiddenActions:       AgentAction[];
  memoryAccess:           UGOMType[] | ['all'];
  toolAccess:             string[];
  confidenceThreshold:    number;              // min confidence to act (0-100)
  escalationThreshold:    number;              // confidence below this -> escalate
  humanApprovalRequired:  string[];            // action names needing human approval
  maxContextTokens:       number;
  costTier:               CostTier;
  hallucinationGuards:    string[];
  auditTrailRequired:     boolean;
  maxAutonomousActions:   number;              // per session
}

// ── Agent Context (passed to every agent call) ─────────────────────────
export interface AgentContext {
  agentId:            AgentId;
  sessionId:          string;
  tenantId:           string;
  userId:             string;
  entityId?:          string;
  entityType?:        UGOMType;
  governanceHealth:   number;
  activeAlerts:       number;
  confidenceScore?:   number;
  orchestrationId:    string;
  isDemo:             boolean;
  timestamp:          string;
}

// ── Agent Action Validation Result ────────────────────────────────────
export interface ActionValidationResult {
  valid:                 boolean;
  requiresHumanApproval: boolean;
  reason?:               string;
  severity?:             RiskLevel;
  approvalNote?:         string;
  blockedBy?:            string;
}

// ── Agent Output ──────────────────────────────────────────────────────
export interface AgentOutput {
  agentId:         AgentId;
  outputId:        string;
  traceId:         string;
  sessionId:       string;
  inputSummary:    string;
  outputType:      string;
  content:         unknown;
  confidenceScore: number;
  evidenceRefs:    string[];
  hallucinationCheckPassed: boolean;
  requiresHumanReview:  boolean;
  reviewerStatus:  'pending' | 'approved' | 'rejected';
  auditEntry:      AuditEntry;
  timestamp:       string;
  modelName:       string;
  promptVersion:   string;
  isDemo:          boolean;
}
