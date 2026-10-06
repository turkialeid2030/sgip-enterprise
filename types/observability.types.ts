/**
 * Observability Types — OpenTelemetry-compatible
 * Structured logs, distributed tracing, governance metrics.
 */

// ── Span (OpenTelemetry-compatible) ───────────────────────────
export interface GovernanceSpan {
  traceId:      string;
  spanId:       string;
  parentSpanId?:string;
  operationName:string;
  tenantId:     string;
  service:      string;
  startTime:    number;         // Unix ms
  endTime?:     number;
  durationMs?:  number;
  status:       "ok" | "error" | "timeout";
  attributes:   Record<string, string | number | boolean>;
  events:       SpanEvent[];
}

export interface SpanEvent {
  name:       string;
  timestamp:  number;
  attributes: Record<string, unknown>;
}

// ── Governance Metrics ────────────────────────────────────────
export type MetricName =
  | "policy_evaluation_duration_ms"
  | "policy_block_rate"
  | "approval_pending_count"
  | "approval_sla_breach_count"
  | "sod_violation_count"
  | "evidence_integrity_score"
  | "graph_traversal_duration_ms"
  | "event_processing_latency_ms"
  | "tenant_isolation_violation_count"
  | "workflow_completion_rate"
  | "agent_confidence_avg"
  | "finding_remediation_days_avg"
  | "control_effectiveness_avg";

export interface GovernanceMetric {
  name:      MetricName;
  value:     number;
  unit:      "ms" | "count" | "percent" | "score" | "days";
  tenantId:  string;
  labels:    Record<string, string>;
  timestamp: number;
}

// ── Structured Log Entry ──────────────────────────────────────
export interface StructuredLogEntry {
  timestamp:     string;       // ISO 8601
  level:         "debug" | "info" | "warn" | "error" | "fatal";
  service:       string;
  operation:     string;
  traceId?:      string;
  spanId?:       string;
  tenantId?:     string;
  userId?:       string;
  correlationId?:string;
  message:       string;
  data?:         Record<string, unknown>;
  error?:        { message: string; stack?: string; code?: string };
  duration?:     number;
}

// ── Governance Signal (anomaly/alert) ─────────────────────────
export type SignalType =
  | "policy_conflict_spike"  | "approval_bottleneck"
  | "sod_violation_pattern"  | "evidence_expiry_wave"
  | "tenant_violation_attempt"| "unusual_access_pattern"
  | "graph_integrity_break"  | "event_replay_attack"
  | "privilege_escalation"   | "control_failure_cluster";

export interface GovernanceSignal {
  id:           string;
  type:         SignalType;
  tenantId:     string;
  severity:     "critical" | "high" | "medium" | "low";
  description:  string;
  data:         Record<string, unknown>;
  detectedAt:   string;
  resolvedAt?:  string;
  resolved:     boolean;
  falsePositive:boolean;
  correlationId:string;
}

// ── Health Check ──────────────────────────────────────────────
export interface ServiceHealth {
  service:     string;
  status:      "healthy" | "degraded" | "unhealthy";
  checks:      HealthCheck[];
  version:     string;
  uptime:      number;
  timestamp:   string;
}

export interface HealthCheck {
  name:      string;
  status:    "pass" | "fail" | "warn";
  latencyMs?:number;
  message?:  string;
}
