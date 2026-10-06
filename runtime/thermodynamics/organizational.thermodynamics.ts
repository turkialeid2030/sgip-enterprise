/**
 * Organizational Thermodynamics — SCEOS Layer 7
 * Measures institutional pressure, entropy, and drag.
 * Answers: "How hot is this organization running right now?"
 */
import { v4 as uuidv4 } from "uuid";
import { getKernel } from "../institutional-kernel/institutional.kernel";
import { getPatternEngine } from "../../sovereign-memory/patterns/institutional.pattern.engine";

export interface ThermoMetrics {
  tenantId:              string;
  measuredAt:            string;
  executionHeat:         number;   // 0-100
  governanceLoad:        number;   // 0-100
  decisionCongestion:    number;   // 0-100
  approvalLatency:       number;   // 0-100
  policyFriction:        number;   // 0-100
  controlOverload:       number;   // 0-100
  auditFatigue:          number;   // 0-100
  teamCapacityPressure:  number;   // 0-100
  entropyScore:          number;   // 0-100
  organizationalDrag:    number;   // 0-100
  overallTemperature:    number;   // weighted average 0-100
}

export interface ThermoReport {
  tenantId:              string;
  generatedAt:           string;
  metrics:               ThermoMetrics;
  criticalPressurePoints:string[];
  heatmap:               Record<string, number>;
  executiveSummary:      string;
  immediateActions:      string[];
  boardWarnings:         string[];
}

export class OrganizationalThermodynamics {
  constructor(private readonly tenantId: string) {}

  measure(): ThermoMetrics {
    const kernel   = getKernel(this.tenantId);
    const patterns = getPatternEngine(this.tenantId);

    const health   = kernel.computeHealthState();
    const patReport= patterns.generateReport();

    const executionHeat        = Math.min(100, health.governancePressureIndex + patReport.criticalCount * 10);
    const governanceLoad       = Math.min(100, health.orphanEntities * 8 + patReport.highCount * 12);
    const decisionCongestion   = Math.min(100, health.pendingDecisions * 5 + health.governancePressureIndex * 0.4);
    const approvalLatency      = Math.min(100, 50 + (100 - health.accountabilityCoverageScore) * 0.5);
    const policyFriction       = Math.min(100, (100 - health.decisionConfidenceScore) * 0.8);
    const controlOverload      = Math.min(100, health.evidenceGaps * 3 + patReport.criticalCount * 20);
    const auditFatigue         = Math.min(100, patReport.patterns.length * 8);
    const teamCapacityPressure = Math.min(100, health.governancePressureIndex * 0.6 + health.executionFrictionIndex * 0.4);
    const entropyScore         = Math.min(100, health.orphanEntities * 6 + (100 - health.evidenceCompletenessScore) * 0.5);
    const organizationalDrag   = Math.min(100, (100 - health.overallHealthScore) * 0.7 + entropyScore * 0.3);

    const overallTemperature = Math.round([
      executionHeat, governanceLoad, decisionCongestion, approvalLatency,
      policyFriction, controlOverload, auditFatigue, teamCapacityPressure,
      entropyScore, organizationalDrag,
    ].reduce((s, v) => s + v, 0) / 10);

    return {
      tenantId:this.tenantId, measuredAt:new Date().toISOString(),
      executionHeat, governanceLoad, decisionCongestion, approvalLatency,
      policyFriction, controlOverload, auditFatigue, teamCapacityPressure,
      entropyScore, organizationalDrag, overallTemperature,
    };
  }

  generateReport(): ThermoReport {
    const metrics = this.measure();
    const heatmap: Record<string, number> = {
      "Execution Heat":       metrics.executionHeat,
      "Governance Load":      metrics.governanceLoad,
      "Decision Congestion":  metrics.decisionCongestion,
      "Approval Latency":     metrics.approvalLatency,
      "Policy Friction":      metrics.policyFriction,
      "Control Overload":     metrics.controlOverload,
      "Audit Fatigue":        metrics.auditFatigue,
      "Capacity Pressure":    metrics.teamCapacityPressure,
      "Entropy":              metrics.entropyScore,
      "Org Drag":             metrics.organizationalDrag,
    };

    const criticalPressurePoints = Object.entries(heatmap).filter(([,v]) => v >= 70).map(([k]) => k);
    const highPressurePoints     = Object.entries(heatmap).filter(([,v]) => v >= 50 && v < 70).map(([k]) => k);

    const immediateActions: string[] = [];
    if (metrics.decisionCongestion >= 70) immediateActions.push("Clear decision backlog — assign or escalate pending decisions");
    if (metrics.approvalLatency    >= 70) immediateActions.push("Review approval workflows — SLA breaches detected");
    if (metrics.controlOverload    >= 70) immediateActions.push("Rationalize control portfolio — remove low-value controls");
    if (metrics.entropyScore       >= 70) immediateActions.push("Assign ownership to orphan entities — reduce governance entropy");

    const boardWarnings: string[] = [];
    if (metrics.overallTemperature >= 80) boardWarnings.push(`CRITICAL: Organization running at ${metrics.overallTemperature}°G (Governance Temperature) — immediate intervention required`);
    if (metrics.governanceLoad     >= 75) boardWarnings.push("Board: Governance system overloaded — structural reform needed");

    const executiveSummary = metrics.overallTemperature >= 80
      ? `Organization is in critical stress (${metrics.overallTemperature}°G). ${criticalPressurePoints.length} pressure points at critical level.`
      : metrics.overallTemperature >= 60
      ? `Organization running warm (${metrics.overallTemperature}°G). ${highPressurePoints.length} areas require attention.`
      : `Organization healthy (${metrics.overallTemperature}°G). Standard monitoring recommended.`;

    return { tenantId:this.tenantId, generatedAt:new Date().toISOString(), metrics, criticalPressurePoints, heatmap, executiveSummary, immediateActions, boardWarnings };
  }
}

const thermoCache = new Map<string, OrganizationalThermodynamics>();
export function getThermodynamics(tenantId: string): OrganizationalThermodynamics {
  if (!thermoCache.has(tenantId)) thermoCache.set(tenantId, new OrganizationalThermodynamics(tenantId));
  return thermoCache.get(tenantId)!;
}
