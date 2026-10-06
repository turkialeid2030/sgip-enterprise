/**
 * Governance Culture Signal Engine
 * Detects behavioral patterns that indicate governance health or risks:
 * - ignored controls, delayed approvals, repeated violations
 * - policy bypass attempts, executive override frequency
 * - governance fatigue, control resistance
 */
import { v4 as uuidv4 } from "uuid";
import { globalMetrics } from "../../observability/metrics/governance.metrics";
import { globalAnomalyDetector } from "../../observability/anomaly-detection/anomaly.detector";

export type CultureSignalType =
  | "control_bypass_attempt"   | "repeated_sod_violation"    | "approval_avoidance"
  | "policy_resistance"         | "governance_fatigue"         | "executive_override"
  | "late_attestation"          | "evidence_gap_pattern"       | "escalation_avoidance"
  | "shadow_approval"           | "accountability_diffusion"   | "control_abandonment";

export interface CultureSignal {
  id:            string;
  type:          CultureSignalType;
  tenantId:      string;
  actorId?:      string;
  actorRole?:    string;
  department?:   string;
  frequency:     number;
  severity:      "critical" | "high" | "medium" | "low";
  description:   string;
  firstObserved: string;
  lastObserved:  string;
  trend:         "increasing" | "stable" | "decreasing";
  businessRisk:  string;
  recommendation:string;
  correlationId: string;
}

export interface CultureHealthReport {
  tenantId:       string;
  healthScore:    number;   // 0-100 (100 = healthy culture)
  signals:        CultureSignal[];
  riskAreas:      string[];
  strengths:      string[];
  recommendations:string[];
  departmentsAtRisk:string[];
  generatedAt:    string;
}

const signalStore: CultureSignal[] = [];
const actionCounters = new Map<string, { count: number; firstAt: string; lastAt: string }>();

export class CultureSignalEngine {
  constructor(private readonly tenantId: string) {}

  recordAction(actorId: string, actorRole: string, action: string, entityType: string): void {
    const key = `${this.tenantId}:${actorId}:${action}`;
    const existing = actionCounters.get(key);
    if (existing) {
      existing.count++;
      existing.lastAt = new Date().toISOString();
    } else {
      actionCounters.set(key, { count: 1, firstAt: new Date().toISOString(), lastAt: new Date().toISOString() });
    }
    this.analyzeForSignals(actorId, actorRole, action, entityType);
  }

  private analyzeForSignals(actorId: string, actorRole: string, action: string, entityType: string): void {
    const key   = `${this.tenantId}:${actorId}:${action}`;
    const count = actionCounters.get(key)?.count ?? 0;

    // Control bypass detection
    if (action === "bypass_control" && count >= 2) {
      this.emit({ type:"control_bypass_attempt", actorId, actorRole, frequency:count, severity:count>=5?"critical":"high", description:`${actorId} bypassed controls ${count} times`, businessRisk:"Uncontrolled risk exposure", recommendation:"Investigate and enforce controls" });
    }
    // Approval avoidance
    if (action === "skip_approval" && count >= 1) {
      this.emit({ type:"approval_avoidance", actorId, actorRole, frequency:count, severity:count>=3?"critical":"high", description:`Approval workflow bypassed ${count} times by ${actorId}`, businessRisk:"Unauthorized decisions", recommendation:"Enforce approval gates" });
    }
    // Governance fatigue (many repeated submissions)
    if (action.startsWith("late_") && count >= 3) {
      this.emit({ type:"governance_fatigue", actorId, actorRole, frequency:count, severity:"medium", description:`${count} late governance actions by ${actorId} — possible fatigue`, businessRisk:"Governance breakdown over time", recommendation:"Reduce governance burden or provide training" });
    }
    // Executive override tracking
    if (action === "executive_override") {
      this.emit({ type:"executive_override", actorId, actorRole, frequency:count, severity:count>=3?"critical":"high", description:`Executive override used ${count} times`, businessRisk:"Governance framework undermined", recommendation:"Review override policy and require board awareness" });
    }
  }

  generateReport(): CultureHealthReport {
    const tenantSignals = signalStore.filter(s => s.tenantId === this.tenantId);
    const criticalCount = tenantSignals.filter(s => s.severity === "critical").length;
    const highCount     = tenantSignals.filter(s => s.severity === "high").length;

    let healthScore = 100;
    healthScore -= criticalCount * 20;
    healthScore -= highCount     * 10;
    healthScore -= tenantSignals.filter(s => s.severity === "medium").length * 5;
    healthScore  = Math.max(0, Math.min(100, healthScore));

    const riskAreas      = [...new Set(tenantSignals.map(s => s.type as string))];
    const recommendations = tenantSignals.slice(0, 5).map(s => s.recommendation);
    const strengths      = healthScore >= 80 ? ["Strong compliance culture", "Consistent governance adoption"] : [];

    // Departments at risk
    const deptCounts  = new Map<string, number>();
    for (const s of tenantSignals) {
      if (s.department) deptCounts.set(s.department, (deptCounts.get(s.department) ?? 0) + 1);
    }
    const departmentsAtRisk = [...deptCounts.entries()]
      .filter(([, c]) => c >= 2).map(([d]) => d);

    return { tenantId: this.tenantId, healthScore, signals: tenantSignals, riskAreas, strengths, recommendations, departmentsAtRisk, generatedAt: new Date().toISOString() };
  }

  getSignals(type?: CultureSignalType): CultureSignal[] {
    return signalStore.filter(s => s.tenantId === this.tenantId && (!type || s.type === type));
  }

  private emit(params: { type:CultureSignalType; actorId?:string; actorRole?:string; frequency:number; severity:CultureSignal["severity"]; description:string; businessRisk:string; recommendation:string }): void {
    const now = new Date().toISOString();
    // Update existing or create new
    const existing = signalStore.find(s => s.tenantId === this.tenantId && s.type === params.type && s.actorId === params.actorId);
    if (existing) {
      existing.frequency     = params.frequency;
      existing.lastObserved  = now;
      existing.trend         = "increasing";
      existing.severity      = params.severity;
    } else {
      signalStore.push({ id:uuidv4(), tenantId:this.tenantId, firstObserved:now, lastObserved:now, trend:"stable", correlationId:uuidv4(), department:undefined, ...params });
    }
    globalMetrics.recordSoDViolation(this.tenantId);
  }
}

const cultureCache = new Map<string, CultureSignalEngine>();
export function getCultureEngine(tenantId: string): CultureSignalEngine {
  if (!cultureCache.has(tenantId)) cultureCache.set(tenantId, new CultureSignalEngine(tenantId));
  return cultureCache.get(tenantId)!;
}
