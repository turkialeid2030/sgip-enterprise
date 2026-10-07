/**
 * v3 Event Contracts — Standard governance event payloads.
 * Every event MUST include: eventId, tenantId, correlationId, actorId, timestamp, source, payloadVersion.
 * These are the domain events that drive cross-module communication.
 */

// ── Base event envelope ───────────────────────────────────────
export interface GovernanceEvent<TPayload = unknown> {
  eventId:        string;    // uuid v4
  eventType:      GovernanceEventType;
  tenantId:       string;
  correlationId:  string;    // ties related events
  causationId?:   string;    // event that caused this one
  actorId:        string;    // userId or "system"
  actorRole:      string;
  source:         string;    // module name
  timestamp:      string;    // ISO 8601
  payloadVersion: string;    // "1.0"
  payload:        TPayload;
  metadata?:      Record<string, unknown>;
}

// ── Event type registry ───────────────────────────────────────
export type GovernanceEventType =
  // Risk events
  | "RiskCreated"          | "RiskUpdated"          | "RiskApproved"
  | "RiskToleranceBreached"| "RiskAppetiteBreached"
  // Control events
  | "ControlCreated"       | "ControlTested"        | "ControlFailed"
  | "ControlDeficiency"    | "SoDViolationDetected"
  // Finding events
  | "FindingOpened"        | "FindingClosed"        | "FindingEscalated"
  | "FindingReopened"
  // CAPA events
  | "CAPACreated"          | "CAPAOverdue"          | "CAPAClosed"
  // Policy events
  | "PolicyCreated"        | "PolicyApproved"       | "PolicyRejected"
  | "PolicyExpired"        | "PolicyConflictDetected"
  // Compliance events
  | "ComplianceViolation"  | "ObligationDue"        | "ObligationBreach"
  // Evidence events
  | "EvidenceAttached"     | "EvidenceExpired"      | "EvidenceTampered"
  | "LegalHoldApplied"
  // Approval events
  | "ApprovalRequested"    | "ApprovalGranted"      | "ApprovalRejected"
  | "ApprovalEscalated"    | "ApprovalExpired"
  // Agent events
  | "AgentTaskQueued"      | "AgentTaskCompleted"   | "AgentTaskFailed"
  | "AgentOutputPending"   | "AgentOutputApproved"  | "AgentConstitutionViolation"
  // Board/Decision events
  | "BoardDecisionCreated" | "BoardActionOverdue"   | "EscalationToBoard"
  // Tenant events
  | "TenantCreated"        | "TenantSuspended"      | "CrossTenantViolation"
  // Audit events
  | "AuditPlanCreated"     | "AuditEngagementOpened"| "AuditReportIssued";

// ── Typed payloads for key events ────────────────────────────
export interface RiskCreatedPayload {
  riskId:       string;
  code:         string;
  title:        string;
  category:     string;
  inherentScore:number;
  toleranceBreached: boolean;
  appetiteBreached:  boolean;
  owner:        string;
}

export interface ControlFailedPayload {
  controlId:    string;
  code:         string;
  testScore:    number;
  findings:     string[];
  linkedRiskIds:string[];
}

export interface PolicyApprovedPayload {
  policyId:     string;
  code:         string;
  version:      string;
  approvedBy:   string;
  effectiveFrom:string;
  supersedes?:  string;
}

export interface ComplianceViolationPayload {
  obligationId: string;
  regulationId: string;
  regulatorName:string;
  severity:     "critical" | "high" | "medium" | "low";
  penalty?:     string;
  dueDate?:     string;
  detectedBy:   string;
}

export interface AgentTaskCompletedPayload {
  agentId:          string;
  taskId:           string;
  action:           string;
  entityId?:        string;
  confidenceScore:  number;
  requiresHumanReview: boolean;
  outputId:         string;
}

export interface CrossTenantViolationPayload {
  sourceActorId:  string;
  sourceTenantId: string;
  targetTenantId: string;
  attemptedAction:string;
  entityId?:      string;
  blocked:        boolean;
}
