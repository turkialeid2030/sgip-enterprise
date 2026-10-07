/**
 * Governance Signal Monitor — real-time governance health signals.
 * Aggregates anomalies, alerts, and metrics into governance intelligence.
 */
import { GovernanceSignal } from "../../types/observability.types";
import { globalAnomalyDetector } from "../anomaly-detection/anomaly.detector";
import { globalAlertEngine } from "../alerts/alert.engine";
import { globalMetrics } from "../metrics/governance.metrics";

export interface GovernanceHealthSnapshot {
  tenantId:      string;
  timestamp:     string;
  overallScore:  number;   // 0-100 governance health
  activeSignals: GovernanceSignal[];
  activeAlerts:  number;
  keyMetrics: {
    policyBlockRate:        number;
    sodViolations:          number;
    evidenceIntegrityAvg:   number;
    approvalPending:        number;
    controlEffectivenessAvg:number;
    tenantViolations:       number;
  };
  recommendations: string[];
}

export class GovernanceSignalMonitor {
  getHealthSnapshot(tenantId: string): GovernanceHealthSnapshot {
    globalAlertEngine.registerBuiltinRules(tenantId);
    const newAlerts = globalAlertEngine.evaluate(tenantId);

    const activeSignals    = globalAnomalyDetector.getSignals(tenantId, false);
    const activeAlertCount = globalAlertEngine.getActiveAlerts(tenantId).length;

    // Key metrics (5-minute window)
    const get = (name: Parameters<typeof globalMetrics.getAggregate>[1]) =>
      globalMetrics.getAggregate(tenantId, name, 300000).avg;

    const keyMetrics = {
      policyBlockRate:         get("policy_block_rate"),
      sodViolations:           get("sod_violation_count"),
      evidenceIntegrityAvg:    get("evidence_integrity_score"),
      approvalPending:         get("approval_pending_count"),
      controlEffectivenessAvg: get("control_effectiveness_avg"),
      tenantViolations:        get("tenant_isolation_violation_count"),
    };

    // Governance health score (higher = healthier)
    let score = 100;
    score -= keyMetrics.tenantViolations * 20;
    score -= keyMetrics.sodViolations    * 5;
    score -= activeAlertCount             * 10;
    score -= activeSignals.filter(s => s.severity === "critical").length * 15;
    score -= activeSignals.filter(s => s.severity === "high").length     * 8;
    if (keyMetrics.controlEffectivenessAvg > 0 && keyMetrics.controlEffectivenessAvg < 60) score -= 15;
    if (keyMetrics.evidenceIntegrityAvg    > 0 && keyMetrics.evidenceIntegrityAvg    < 80) score -= 10;
    score = Math.max(0, Math.min(100, score));

    const recommendations: string[] = [];
    if (keyMetrics.tenantViolations > 0) recommendations.push("CRITICAL: Investigate cross-tenant access attempts immediately");
    if (keyMetrics.sodViolations    > 3) recommendations.push("Review SoD matrix — multiple violations detected");
    if (activeAlertCount            > 5) recommendations.push("Multiple active alerts — governance attention required");
    if (keyMetrics.controlEffectivenessAvg > 0 && keyMetrics.controlEffectivenessAvg < 60) recommendations.push("Control effectiveness below threshold — schedule testing cycle");

    return { tenantId, timestamp: new Date().toISOString(), overallScore: score, activeSignals, activeAlerts: activeAlertCount, keyMetrics, recommendations };
  }
}

export const globalSignalMonitor = new GovernanceSignalMonitor();
