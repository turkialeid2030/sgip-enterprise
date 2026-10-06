/**
 * Continuous Control Monitoring Runtime
 * Automated monitoring of controls, KRIs, policies, AI risk, cyber posture.
 * Generates governance signals and executive alerts in real-time.
 */
import { v4 as uuidv4 } from "uuid";
import { TenantContext } from "../../types/tenant.types";
import { getGraphRuntime } from "../../graph/runtime/governance.graph.runtime";
import { getEvidenceEngine } from "../../evidence/lineage/evidence.lineage.engine";
import { globalMetrics } from "../../observability/metrics/governance.metrics";
import { globalAnomalyDetector } from "../../observability/anomaly-detection/anomaly.detector";

export type MonitoringCheckType =
  | "control_test"      | "kri_threshold"    | "policy_violation"
  | "evidence_expiry"   | "sla_breach"       | "graph_integrity"
  | "vendor_risk_drift" | "ai_risk"          | "cyber_posture"
  | "compliance_drift"  | "orphan_detection" | "evidence_completeness";

export interface MonitoringResult {
  checkId:          string;
  tenantId:         string;
  type:             MonitoringCheckType;
  status:           "pass" | "warn" | "fail";
  score:            number;         // 0-100
  findings:         string[];
  affectedEntityIds:string[];
  executedAt:       string;
  executionMs:      number;
  nextCheckAt:      string;
  alertTriggered:   boolean;
}

export interface MonitoringDashboard {
  tenantId:         string;
  overallHealth:    number;         // 0-100
  lastRunAt:        string;
  results:          MonitoringResult[];
  failedChecks:     number;
  warnChecks:       number;
  alerts:           string[];
  trending:         "improving" | "stable" | "deteriorating";
  dataSufficiency:  "sufficient"|"insufficient";
}

const monitoringHistory: MonitoringResult[] = [];

export class ContinuousMonitoringRuntime {
  constructor(private readonly tenantId: string) {}

  runAllChecks(ctx?: TenantContext): MonitoringResult[] {
    const results = [
      this.checkGraphIntegrity(),
      this.checkEvidenceExpiry(),
      this.checkOrphans(),
      this.checkControlMonitoring(),
    ];
    monitoringHistory.push(...results);
    return results;
  }

  private checkGraphIntegrity(): MonitoringResult {
    const start   = Date.now();
    const graph   = getGraphRuntime(this.tenantId);
    const stats   = graph.getStats();
    const orphans = graph.detectOrphans();
    const cycles  = graph.detectCycles();
    const score   = Math.max(0, 100 - orphans.length * 10 - cycles.length * 15);
    const findings = [
      ...(orphans.length > 0 ? [`${orphans.length} orphan nodes detected`] : []),
      ...(cycles.length  > 0 ? [`${cycles.length} cyclic dependencies`]    : []),
    ];
    globalMetrics.recordControlEffectiveness(this.tenantId, score);
    return { checkId:uuidv4(), tenantId:this.tenantId, type:"graph_integrity", status: score >= 80 ? "pass" : score >= 50 ? "warn" : "fail", score, findings, affectedEntityIds:orphans.map(n=>n.id), executedAt:new Date().toISOString(), executionMs:Date.now()-start, nextCheckAt:new Date(Date.now()+3600000).toISOString(), alertTriggered:score<50 };
  }

  private checkEvidenceExpiry(): MonitoringResult {
    const start   = Date.now();
    const ev      = getEvidenceEngine(this.tenantId);
    const records = ev.findRecords({ tenantId:this.tenantId });
    const now     = new Date().toISOString();
    const expired = records.filter(r => r.expiresAt && r.expiresAt < now);
    const expiring= records.filter(r => r.expiresAt && r.expiresAt < new Date(Date.now()+30*86400000).toISOString() && r.expiresAt >= now);
    const score   = records.length > 0 ? Math.max(0, 100 - (expired.length * 20) - (expiring.length * 5)) : 100;
    return { checkId:uuidv4(), tenantId:this.tenantId, type:"evidence_expiry", status: expired.length===0 ? "pass" : expired.length<=2 ? "warn" : "fail", score, findings:[...expired.map(r=>`Evidence expired: ${r.code}`),...expiring.map(r=>`Expiring soon: ${r.code}`)], affectedEntityIds:expired.map(r=>r.entityId), executedAt:new Date().toISOString(), executionMs:Date.now()-start, nextCheckAt:new Date(Date.now()+86400000).toISOString(), alertTriggered:expired.length>0 };
  }

  private checkOrphans(): MonitoringResult {
    const start   = Date.now();
    const graph   = getGraphRuntime(this.tenantId);
    const orphans = graph.detectOrphans();
    const score   = orphans.length === 0 ? 100 : Math.max(0, 100 - orphans.length * 8);
    if (orphans.length > 0) globalAnomalyDetector.checkApprovalBottleneck(this.tenantId, orphans.length);
    return { checkId:uuidv4(), tenantId:this.tenantId, type:"orphan_detection", status: orphans.length===0 ? "pass" : orphans.length<=3 ? "warn" : "fail", score, findings:orphans.map(n=>`Orphan: ${n.label} (${n.type})`), affectedEntityIds:orphans.map(n=>n.id), executedAt:new Date().toISOString(), executionMs:Date.now()-start, nextCheckAt:new Date(Date.now()+3600000).toISOString(), alertTriggered:orphans.length>5 };
  }

  private checkControlMonitoring(): MonitoringResult {
    const start = Date.now();
    const graph = getGraphRuntime(this.tenantId);
    const stats = graph.getStats();
    const controlCount = stats.byType["control"] ?? 0;
    const riskCount    = stats.byType["risk"] ?? 0;
    // Check unmitigated risks
    const unmitigated  = riskCount > 0 && controlCount === 0 ? riskCount : 0;
    const score        = unmitigated > 0 ? Math.max(0, 100 - unmitigated * 20) : 100;
    return { checkId:uuidv4(), tenantId:this.tenantId, type:"control_test", status: unmitigated===0 ? "pass" : "warn", score, findings: unmitigated > 0 ? [`${unmitigated} risks without mitigating controls`] : [], affectedEntityIds:[], executedAt:new Date().toISOString(), executionMs:Date.now()-start, nextCheckAt:new Date(Date.now()+7200000).toISOString(), alertTriggered:false };
  }

  getDashboard(): MonitoringDashboard {
    const tenantResults = monitoringHistory.filter(r => r.tenantId === this.tenantId);
    // Get most recent run per check type
    const latestByType = new Map<MonitoringCheckType, MonitoringResult>();
    for (const r of tenantResults) {
      const existing = latestByType.get(r.type);
      if (!existing || r.executedAt > existing.executedAt) latestByType.set(r.type, r);
    }
    const results     = [...latestByType.values()];
    const failedChecks= results.filter(r => r.status === "fail").length;
    const warnChecks  = results.filter(r => r.status === "warn").length;
    const overallHealth = results.length > 0 ? Math.round(results.reduce((s,r)=>s+r.score,0)/results.length) : 0;
    const alerts = results.length===0 ? ["No monitoring checks have run — health is unassessed/fail-closed"] : results.filter(r => r.alertTriggered).map(r => `Alert: ${r.type} — ${r.findings[0] ?? "issue detected"}`);
    const lastRunAt = results.length > 0 ? results.sort((a,b)=>b.executedAt.localeCompare(a.executedAt))[0].executedAt : new Date().toISOString();
    return { tenantId:this.tenantId, overallHealth, lastRunAt, results, failedChecks, warnChecks, alerts, trending:"stable", dataSufficiency:results.length>0?"sufficient":"insufficient" };
  }
}

const monitorCache = new Map<string, ContinuousMonitoringRuntime>();
export function getMonitoringRuntime(tenantId: string): ContinuousMonitoringRuntime {
  if (!monitorCache.has(tenantId)) monitorCache.set(tenantId, new ContinuousMonitoringRuntime(tenantId));
  return monitorCache.get(tenantId)!;
}
