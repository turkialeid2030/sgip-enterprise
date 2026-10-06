/**
 * Institutional Simulation Engine — SCEOS Layer 4
 * Simulates governance decisions before they are made.
 * What-if analysis for every major institutional move.
 */
import { v4 as uuidv4 } from "uuid";
import { getGovernanceOntology } from "../../sovereign-memory/ontology/governance.ontology.engine";
import { getPatternEngine } from "../../sovereign-memory/patterns/institutional.pattern.engine";
import { getEconomicEngine } from "../economic-cognition/economic.cognition.engine";

export type SimulationScenario =
  | "change_authority"     | "approve_policy"       | "control_failure"
  | "project_delay"        | "kri_breach"           | "compliance_incident"
  | "evidence_weakness"    | "conflict_of_interest" | "risk_owner_loss"
  | "board_pressure";

export interface SimulationInput {
  scenario:       SimulationScenario;
  tenantId:       string;
  entityId:       string;
  entityType:     string;
  actorId:        string;
  parameters:     Record<string, unknown>;
  simulatedBy:    string;
}

export interface SimulationResult {
  id:                   string;
  tenantId:             string;
  scenario:             SimulationScenario;
  entityId:             string;
  simulatedAt:          string;
  simulatedBy:          string;
  expectedImpact: {
    healthScoreDelta:   number;
    governancePressureDelta:number;
    decisionConfidenceDelta:number;
    evidenceCompletenessDelta:number;
  };
  blastRadius: {
    affectedEntities:   string[];
    affectedActors:     string[];
    criticalPaths:      string[];
    score:              number;
  };
  riskDelta:            number;
  costDelta:            number;
  financialModel: {
    currency: "SAR";
    calibrationStatus:"heuristic_uncalibrated"|"calibrated";
    modelVersion:string;
    source:string;
  };
  governancePressureDelta:number;
  recommendedMitigation:string[];
  confidence:           number;
  warnings:             string[];
}

const SCENARIO_MODELS: Record<SimulationScenario, Partial<SimulationResult>> = {
  change_authority:     { riskDelta:15,   governancePressureDelta:20, confidence:80 },
  approve_policy:       { riskDelta:-5,  governancePressureDelta:-10,confidence:85 },
  control_failure:      { riskDelta:30,  governancePressureDelta:35, confidence:75 },
  project_delay:        { riskDelta:10,  governancePressureDelta:15, confidence:80 },
  kri_breach:           { riskDelta:25,  governancePressureDelta:30, confidence:85 },
  compliance_incident:  { riskDelta:40, governancePressureDelta:50, confidence:70 },
  evidence_weakness:    { riskDelta:20,  governancePressureDelta:15, confidence:90 },
  conflict_of_interest: { riskDelta:35,  governancePressureDelta:40, confidence:75 },
  risk_owner_loss:      { riskDelta:25,   governancePressureDelta:20, confidence:80 },
  board_pressure:       { riskDelta:15,   governancePressureDelta:25, confidence:70 },
};

const simulationStore = new Map<string, SimulationResult>();

export class InstitutionalSimulationEngine {
  constructor(private readonly tenantId: string) {}

  simulate(input: Omit<SimulationInput, "tenantId">): SimulationResult {
    const model    = SCENARIO_MODELS[input.scenario] ?? {};
    const ontology = getGovernanceOntology(this.tenantId);
    const patterns = getPatternEngine(this.tenantId);
    const economic = getEconomicEngine(this.tenantId);

    // Compute blast radius
    const entity  = ontology.getNodesByType(input.entityType as any).find(n => n.id === input.entityId);
    const blastBR = entity ? ontology.computeBlastRadius(input.entityId) : { affected:[], score:0 };

    const asFinite = (v:unknown): number|undefined => { const n=Number(v); return Number.isFinite(n)?n:undefined; };
    const scale = Math.max(0.1, Math.min(4, asFinite(input.parameters.scale) ?? 1));
    const delayDays = Math.max(0, Math.min(3650, asFinite(input.parameters.days) ?? 0));
    const scenarioForEconomic = input.scenario === "control_failure" ? "control_failure" :
      input.scenario === "compliance_incident" ? "compliance_breach" :
      input.scenario === "kri_breach" ? "kri_breach" :
      input.scenario === "project_delay" ? "audit_delay" :
      input.scenario === "evidence_weakness" ? "evidence_gap" : "governance_gap";
    // Economic impact. Built-in SAR amounts are explicitly heuristic until tenant-calibrated.
    const econ = economic.assess({ entityId:input.entityId, entityType:input.entityType, scenario:scenarioForEconomic, context:{...input.parameters,delayDays} });

    const dayFactor = input.scenario === "project_delay" && delayDays > 0 ? Math.max(0.1, Math.min(4, delayDays/30)) : 1;
    const riskDelta = Math.round((model.riskDelta ?? 0) * scale * dayFactor * 100) / 100;
    const governancePressureDelta = Math.round((model.governancePressureDelta ?? 0) * scale * dayFactor * 100) / 100;
    const explicitCost = asFinite(input.parameters.cost);
    // Financial impact has a single source of truth: Economic Cognition. The simulation layer
    // may scale the exposure or accept an explicit stress-test override, but it must not keep
    // a second set of duplicate SAR constants that can drift from the governed financial model.
    const costDelta = input.scenario === "project_delay" && explicitCost !== undefined && explicitCost >= 0
      ? Math.min(10_000_000_000, explicitCost)
      : Math.round(econ.financialImpact.netImpact * scale);

    // Pattern-adjusted warnings
    const patReport = patterns.generateReport();
    const warnings: string[] = [];
    if (patReport.criticalCount > 0) {
      warnings.push(`${patReport.criticalCount} critical governance patterns already active — simulation impact may be amplified`);
    }
    if (blastBR.score > 50) {
      warnings.push(`High blast radius (${blastBR.score}) — change affects ${blastBR.affected.length} entities`);
    }

    // Mitigations per scenario
    const mitigations: Record<SimulationScenario, string[]> = {
      change_authority:     ["Document new authority in RACI","Notify affected stakeholders","Update delegation registry"],
      approve_policy:       ["Conduct stakeholder review","Attach approval evidence","Set review schedule"],
      control_failure:      ["Initiate emergency remediation","Apply compensating control","Escalate to CRO"],
      project_delay:        ["Revise milestone schedule","Re-assess risk register","Notify board"],
      kri_breach:           ["Activate risk response plan","Escalate to risk committee","Review controls"],
      compliance_incident:  ["Notify regulator within SLA","Engage legal counsel","Freeze affected processes"],
      evidence_weakness:    ["Collect missing evidence","Extend evidence retention","Assign evidence owner"],
      conflict_of_interest: ["Recuse conflicted party","Appoint independent reviewer","Disclose to board"],
      risk_owner_loss:      ["Assign interim risk owner","Trigger RACI review","Brief successor"],
      board_pressure:       ["Prepare board pack","Schedule emergency session","Document pressure signals"],
    };

    const result: SimulationResult = {
      id:           uuidv4(),
      tenantId:     this.tenantId,
      scenario:     input.scenario,
      entityId:     input.entityId,
      simulatedAt:  new Date().toISOString(),
      simulatedBy:  input.simulatedBy,
      expectedImpact: {
        healthScoreDelta:          -riskDelta * 0.3,
        governancePressureDelta,
        decisionConfidenceDelta:   -riskDelta * 0.2,
        evidenceCompletenessDelta: input.scenario === "evidence_weakness" ? -15 : 0,
      },
      blastRadius: {
        affectedEntities: blastBR.affected.map(n => n.id),
        affectedActors:   [],
        criticalPaths:    [],
        score:            blastBR.score,
      },
      riskDelta,
      costDelta,
      financialModel:{currency:"SAR",calibrationStatus:"heuristic_uncalibrated",modelVersion:"INST-SIM-1.1",source:"Built-in SGIP stress-test assumptions combined with the Economic Cognition model; tenant/source calibration required before financial reliance."},
      governancePressureDelta,
      recommendedMitigation:   mitigations[input.scenario],
      confidence:              model.confidence ?? 70,
      warnings:[...warnings, "Financial impact values are heuristic stress-test assumptions until calibrated to tenant/source data."],
    };
    simulationStore.set(result.id, result);
    return result;
  }

  getSimulations(): SimulationResult[] {
    return [...simulationStore.values()].filter(s => s.tenantId === this.tenantId);
  }
}

const simCache = new Map<string, InstitutionalSimulationEngine>();
export function getSimulationEngine(tenantId: string): InstitutionalSimulationEngine {
  if (!simCache.has(tenantId)) simCache.set(tenantId, new InstitutionalSimulationEngine(tenantId));
  return simCache.get(tenantId)!;
}
