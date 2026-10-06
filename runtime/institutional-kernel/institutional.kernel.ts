/**
 * Institutional Runtime Kernel — SCEOS Layer 2
 * The central nervous system. Binds memory, ontology, graph, authority,
 * evidence, decisions, and indicators into a unified enterprise health state.
 */
import { v4 as uuidv4 } from "uuid";
import { getSovereignMemory } from "../../sovereign-memory/core/sovereign.memory.engine";
import { getGovernanceOntology } from "../../sovereign-memory/ontology/governance.ontology.engine";
import { getPatternEngine } from "../../sovereign-memory/patterns/institutional.pattern.engine";
import { getGraphRuntime } from "../../graph/runtime/governance.graph.runtime";
import { getEvidenceEngine } from "../../evidence/lineage/evidence.lineage.engine";
import { getEventFabric } from "../event-fabric/unified.event.fabric";
import { getKRIKPIEngine } from "../../modules/kri-kpi/kri.kpi.engine";

export interface EnterpriseHealthState {
  tenantId:                  string;
  snapshotAt:                string;
  overallHealthScore:        number;   // 0-100

  // Sub-scores
  governancePressureIndex:   number;   // 0-100 (100=max pressure)
  executionFrictionIndex:    number;   // 0-100
  accountabilityCoverageScore:number;  // 0-100 (100=full coverage)
  evidenceCompletenessScore: number;   // 0-100
  decisionConfidenceScore:   number;   // 0-100

  // Counts
  openRisks:        number;
  activeIncidents:  number;
  pendingDecisions: number;
  orphanEntities:   number;
  evidenceGaps:     number;
  patternAlerts:    number;

  // Context
  memoryDepth:      number;   // how much institutional memory exists
  graphNodeCount:   number;
  eventCount:       number;
  observations:     string[];
  recommendations:  string[];
}

export interface RuntimeContext {
  tenantId:          string;
  userId:            string;
  userRole:          string;
  sessionId:         string;
  requestId:         string;
  healthState:       EnterpriseHealthState;
  accessibleLayers:  string[];
  auditTrail:        string[];
}

export class InstitutionalKernel {
  constructor(private readonly tenantId: string) {}

  buildRuntimeContext(userId: string, userRole: string): RuntimeContext {
    const sessionId  = uuidv4();
    const requestId  = uuidv4();
    const health     = this.computeHealthState();

    return {
      tenantId: this.tenantId, userId, userRole, sessionId, requestId,
      healthState: health,
      accessibleLayers: this.getAccessibleLayers(userRole),
      auditTrail: [`Context built at ${new Date().toISOString()} for ${userId}`],
    };
  }

  computeHealthState(): EnterpriseHealthState {
    const memory    = getSovereignMemory(this.tenantId);
    const ontology  = getGovernanceOntology(this.tenantId);
    const graph     = getGraphRuntime(this.tenantId);
    const evidence  = getEvidenceEngine(this.tenantId);
    const patterns  = getPatternEngine(this.tenantId);
    const events    = getEventFabric(this.tenantId);

    const memStats  = memory.getStats();
    const ontStats  = ontology.getStats();
    const graphStats= graph.getStats();
    const evStats   = evidence.getStats();
    const patReport = patterns.generateReport();
    const evtStats  = events.getStats();

    // KRI data if available
    let kriBreaches = 0;
    try {
      const kri = getKRIKPIEngine(this.tenantId);
      kriBreaches = kri.getDashboard().red;
    } catch {}

    // Accountability coverage
    const accountabilityCoverageScore = ontStats.nodes > 0
      ? Math.max(0, Math.round(100 - (ontStats.orphanNodes / Math.max(1, ontStats.nodes)) * 100))
      : 100;

    // Evidence completeness
    const evidenceCompletenessScore = evStats.records > 0
      ? Math.min(100, Math.round((evStats.records / Math.max(1, graphStats.nodeCount)) * 100))
      : graphStats.nodeCount === 0 ? 100 : 20;

    // Decision confidence — inversely proportional to orphan governance
    const decisionConfidenceScore = Math.max(0, 100
      - ontStats.orphanNodes * 5
      - patReport.criticalCount * 15
      - kriBreaches * 8
    );

    // Governance pressure (higher = more pressure on governance system)
    const governancePressureIndex = Math.min(100,
      patReport.criticalCount * 20 + patReport.highCount * 10 + ontStats.orphanNodes * 5
    );

    // Execution friction
    const executionFrictionIndex = Math.min(100, ontStats.governanceQuestions * 8 + kriBreaches * 10);

    const overallHealthScore = Math.round(
      (patReport.overallHealthScore * 0.35) +
      (accountabilityCoverageScore  * 0.25) +
      (evidenceCompletenessScore    * 0.20) +
      (decisionConfidenceScore      * 0.20)
    );

    const observations: string[] = [];
    const recommendations: string[] = [];

    if (governancePressureIndex >= 60) {
      observations.push(`High governance pressure (${governancePressureIndex}%) — system under stress`);
      recommendations.push("Review and resolve critical governance patterns immediately");
    }
    if (accountabilityCoverageScore < 70) {
      observations.push(`Accountability gaps detected — ${ontStats.orphanNodes} entities without owners`);
      recommendations.push("Assign accountability to all orphan entities");
    }
    if (memStats.total === 0) {
      observations.push("No institutional memory — system has no historical context");
      recommendations.push("Begin recording governance events to build institutional knowledge");
    }
    if (kriBreaches > 0) {
      observations.push(`${kriBreaches} KRI thresholds in RED — immediate attention required`);
    }

    return {
      tenantId: this.tenantId,
      snapshotAt: new Date().toISOString(),
      overallHealthScore,
      governancePressureIndex,
      executionFrictionIndex,
      accountabilityCoverageScore,
      evidenceCompletenessScore,
      decisionConfidenceScore: Math.max(0, decisionConfidenceScore),
      openRisks:       graphStats.byType["risk"] ?? 0,
      activeIncidents: graphStats.byType["incident"] ?? 0,
      pendingDecisions:graphStats.byType["decision"] ?? 0,
      orphanEntities:  ontStats.orphanNodes,
      evidenceGaps:    Math.max(0, graphStats.nodeCount - evStats.records),
      patternAlerts:   patReport.patterns.length,
      memoryDepth:     memStats.total,
      graphNodeCount:  graphStats.nodeCount,
      eventCount:      evtStats.total,
      observations,
      recommendations,
    };
  }

  private getAccessibleLayers(role: string): string[] {
    const layersByRole: Record<string, string[]> = {
      orchestrator:        ["memory","ontology","graph","evidence","events","kernel","audit","board","simulation"],
      governance_analyst:  ["memory","ontology","graph","evidence","events","kernel"],
      risk_analyst:        ["memory","graph","evidence","events"],
      board_reporter:      ["kernel","board"],
      audit_lead:          ["memory","evidence","audit","graph"],
    };
    return layersByRole[role] ?? ["kernel"];
  }
}

const kernelCache = new Map<string, InstitutionalKernel>();
export function getKernel(tenantId: string): InstitutionalKernel {
  if (!kernelCache.has(tenantId)) kernelCache.set(tenantId, new InstitutionalKernel(tenantId));
  return kernelCache.get(tenantId)!;
}
