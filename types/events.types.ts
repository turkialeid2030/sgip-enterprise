/**
 * Event-Driven Architecture — Type Definitions
 * All cross-module communication via typed events.
 * Modules publish events; other modules subscribe — no direct coupling.
 */
import { UGOMType, EntityStatus, RiskLevel } from "./governance.types";

export type SGIPEventType =
  // Entity lifecycle
  | 'entity.created'       | 'entity.updated'        | 'entity.status_changed'
  | 'entity.deleted'       | 'entity.escalated'      | 'entity.closed'
  // Graph events
  | 'graph.edge_created'   | 'graph.edge_removed'    | 'graph.impact_detected'
  | 'graph.blind_spot'     | 'graph.cycle_detected'
  // Risk events
  | 'risk.tolerance_breach'| 'risk.appetite_breach'  | 'risk.appetite_exceeded'
  | 'risk.new_identified'  | 'risk.treatment_updated'
  // Control events
  | 'control.failure'      | 'control.test_completed'| 'control.sod_violation'
  | 'control.deficiency'
  // Audit events
  | 'audit.finding_raised' | 'audit.finding_closed'  | 'audit.capa_overdue'
  | 'audit.evidence_expired'| 'audit.workpaper_completed'
  // Compliance events
  | 'compliance.breach'    | 'compliance.drift'      | 'compliance.obligation_due'
  | 'compliance.regulation_updated'
  // Agent events
  | 'agent.output_ready'   | 'agent.conflict_detected'| 'agent.quality_gate_failed'
  | 'agent.human_review_required'
  // Governance memory
  | 'memory.pattern_detected' | 'memory.lesson_learned' | 'memory.precedent_found'
  // Board events
  | 'board.action_overdue' | 'board.escalation_required' | 'board.pack_generated';

export interface SGIPEvent<T = unknown> {
  id:          string;
  type:        SGIPEventType;
  source:      string;          // module that emitted
  entityId?:   string;
  entityType?: UGOMType;
  payload:     T;
  tenantId:    string;
  timestamp:   string;
  traceId:     string;
  correlationId?: string;
  severity?:   RiskLevel;
  handled:     boolean;
}

// Typed payloads for key events
export interface EntityStatusChangedPayload {
  entityId:    string;
  entityType:  UGOMType;
  fromStatus:  EntityStatus;
  toStatus:    EntityStatus;
  changedBy:   string;
  reason?:     string;
}

export interface RiskBreachPayload {
  riskId:      string;
  riskCode:    string;
  breachType:  'tolerance' | 'appetite' | 'capacity';
  actualScore: number;
  threshold:   number;
  escalateTo:  string[];
}

export interface QualityGateFailedPayload {
  outputId:    string;
  agentId:     string;
  failedGates: string[];
  blockers:    string[];
  score:       number;
}
