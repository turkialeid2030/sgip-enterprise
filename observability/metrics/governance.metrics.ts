/**
 * Governance Metrics Collector
 * Collects policy evaluation, approval, SoD, and graph metrics.
 * Production: export to Prometheus / Datadog / CloudWatch
 */
import { GovernanceMetric, MetricName } from "../../types/observability.types";

const metricsStore: GovernanceMetric[] = [];
const MAX_METRICS = 10000;

export class GovernanceMetrics {
  record(params: {
    name:     MetricName;
    value:    number;
    unit:     GovernanceMetric["unit"];
    tenantId: string;
    labels?:  Record<string, string>;
  }): void {
    const metric: GovernanceMetric = {
      name:      params.name,
      value:     params.value,
      unit:      params.unit,
      tenantId:  params.tenantId,
      labels:    params.labels ?? {},
      timestamp: Date.now(),
    };
    if (metricsStore.length >= MAX_METRICS) metricsStore.shift();
    metricsStore.push(metric);
  }

  // Convenience methods for common metrics
  recordPolicyEvaluation(tenantId: string, durationMs: number, blocked: boolean): void {
    this.record({ name: "policy_evaluation_duration_ms", value: durationMs, unit: "ms",    tenantId, labels: { blocked: String(blocked) } });
    if (blocked) this.record({ name: "policy_block_rate",  value: 1, unit: "count", tenantId });
  }

  recordSoDViolation(tenantId: string): void {
    this.record({ name: "sod_violation_count", value: 1, unit: "count", tenantId });
  }

  recordApprovalPending(tenantId: string, count: number): void {
    this.record({ name: "approval_pending_count", value: count, unit: "count", tenantId });
  }

  recordApprovalSLABreach(tenantId: string): void {
    this.record({ name: "approval_sla_breach_count", value: 1, unit: "count", tenantId });
  }

  recordGraphTraversal(tenantId: string, durationMs: number): void {
    this.record({ name: "graph_traversal_duration_ms", value: durationMs, unit: "ms", tenantId });
  }

  recordEvidenceIntegrity(tenantId: string, score: number): void {
    this.record({ name: "evidence_integrity_score", value: score, unit: "score", tenantId });
  }

  recordTenantViolation(tenantId: string): void {
    this.record({ name: "tenant_isolation_violation_count", value: 1, unit: "count", tenantId });
  }

  recordControlEffectiveness(tenantId: string, avg: number): void {
    this.record({ name: "control_effectiveness_avg", value: avg, unit: "percent", tenantId });
  }

  getMetrics(tenantId: string, name?: MetricName, windowMs = 3600000): GovernanceMetric[] {
    const cutoff = Date.now() - windowMs;
    return metricsStore.filter(m => m.tenantId === tenantId && m.timestamp >= cutoff && (!name || m.name === name));
  }

  getAggregate(tenantId: string, name: MetricName, windowMs = 3600000): { count: number; sum: number; avg: number; min: number; max: number } {
    const ms = this.getMetrics(tenantId, name, windowMs);
    if (ms.length === 0) return { count: 0, sum: 0, avg: 0, min: 0, max: 0 };
    const vals = ms.map(m => m.value);
    const sum  = vals.reduce((a, b) => a + b, 0);
    return { count: ms.length, sum, avg: sum / ms.length, min: Math.min(...vals), max: Math.max(...vals) };
  }
}

export const globalMetrics = new GovernanceMetrics();
