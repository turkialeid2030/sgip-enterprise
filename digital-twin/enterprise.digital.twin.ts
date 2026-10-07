/**
 * Enterprise Digital Twin — Phase 17
 * Simulation, what-if, crisis, dependency, organizational resilience.
 */
import { v4 as uuidv4 } from "uuid";
import { getRiskRuntime } from "../risk-runtime/register/risk.intelligence.runtime";
import { getComplianceObligationRuntime } from "../compliance-runtime/obligations/compliance.obligation.runtime";
import { getCCMRuntime } from "../compliance-runtime/ccm/ccm.runtime";
import { getResilienceRuntime } from "../resilience-runtime/continuity/operational.resilience.runtime";
import { getIncidentRuntime } from "../resilience-runtime/incidents/incident.crisis.runtime";
import { getKernel } from "../runtime/institutional-kernel/institutional.kernel";

export type SimulationScenario =
  | "board_succession"       | "ceo_departure"          | "regulatory_investigation"
  | "cyber_attack"           | "data_breach"            | "market_crash"
  | "key_vendor_failure"     | "regulator_intervention" | "merger_acquisition"
  | "ai_system_failure"      | "pandemic_disruption"    | "financial_restatement";

export interface TwinState {
  tenantId:            string;
  snapshotAt:          string;
  governanceScore:     number;
  riskExposure:        number;
  complianceHealth:    number;
  controlEffectiveness:number;
  resilienceScore:     number;
  openFindings:        number;
  criticalRisks:       number;
  activeCrises:        number;
}

export interface SimulationResult {
  id:                  string;
  tenantId:            string;
  scenario:            SimulationScenario;
  preState:            TwinState;
  postState:           TwinState;
  timeline:            SimulationEvent[];
  financialImpact:     number;
  recoveryTimeHours:   number;
  criticalPath:        string[];
  boardActions:        string[];
  regulatoryActions:   string[];
  confidence:          number;
  financialModel:      { status:"heuristic_uncalibrated"|"calibrated"; version:string; source:string };
  simulatedAt:         string;
}

export interface SimulationEvent {
  hour:        number;        // hours after T0
  event:       string;
  impact:      string;
  severity:    "critical"|"high"|"medium"|"low";
  mitigation?: string;
}

export interface WhatIfAnalysis {
  id:              string;
  tenantId:        string;
  question:        string;
  currentState:    TwinState;
  alternativeState:TwinState;
  deltaScore:      number;
  deltaFinancial:  number;
  recommendation:  string;
  confidence:      number;
  analyzedAt:      string;
}

const simulationStore = new Map<string, SimulationResult[]>();

const SCENARIO_IMPACTS: Record<SimulationScenario, {governance:number; risk:number; financial:number; recovery:number; events:Omit<SimulationEvent,"hour">[] }> = {
  board_succession:        {governance:-20, risk:+15, financial:+50000000, recovery:720, events:[{event:"Board chair resignation",impact:"Governance vacuum — key decisions stalled",severity:"critical"},{event:"Emergency board meeting",impact:"Succession protocol activated",severity:"high"},{event:"Interim governance structure",impact:"Reduced decision authority",severity:"medium"}]},
  ceo_departure:           {governance:-15, risk:+20, financial:+100000000, recovery:2160, events:[{event:"CEO departure announced",impact:"Strategic uncertainty — market reaction",severity:"critical"},{event:"Board takes executive control",impact:"Governance overhead increases",severity:"high"}]},
  regulatory_investigation:{governance:-30, risk:+35, financial:+200000000, recovery:4380, events:[{event:"Regulatory inquiry received",impact:"Document preservation required",severity:"critical"},{event:"External counsel engaged",impact:"Cost escalation begins",severity:"high"},{event:"Operations restriction possible",impact:"Business continuity risk",severity:"critical"}]},
  cyber_attack:            {governance:-10, risk:+40, financial:+500000000, recovery:168, events:[{event:"Attack detected by SOC",impact:"Incident response activated",severity:"critical"},{event:"SAMA notification (4h)",impact:"Regulatory compliance clock starts",severity:"critical"},{event:"Customer notification",impact:"Reputational risk materializes",severity:"high"}]},
  data_breach:             {governance:-15, risk:+35, financial:+300000000, recovery:720, events:[{event:"Data breach confirmed",impact:"PDPL notification required within 72h",severity:"critical"},{event:"SDAIA notification",impact:"Regulatory exposure",severity:"critical"},{event:"Customer notification",impact:"Trust erosion",severity:"high"}]},
  market_crash:            {governance:-5, risk:+30, financial:+1000000000, recovery:8760, events:[{event:"Market volatility spike",impact:"Portfolio value decline",severity:"high"},{event:"Liquidity pressure",impact:"Capital adequacy review",severity:"critical"}]},
  key_vendor_failure:      {governance:-10, risk:+25, financial:+150000000, recovery:720, events:[{event:"Vendor insolvency",impact:"Service disruption — BCP activated",severity:"critical"},{event:"Emergency vendor onboarding",impact:"Procurement governance stressed",severity:"high"}]},
  regulator_intervention:  {governance:-40, risk:+30, financial:+400000000, recovery:8760, events:[{event:"Regulatory sanctions imposed",impact:"Operations restricted",severity:"critical"},{event:"Remediation plan required",impact:"Board involvement mandatory",severity:"critical"}]},
  merger_acquisition:      {governance:+5, risk:+20, financial:-500000000, recovery:17520, events:[{event:"Deal announced",impact:"Integration governance required",severity:"medium"},{event:"Due diligence phase",impact:"Governance transparency required",severity:"medium"}]},
  ai_system_failure:       {governance:-15, risk:+25, financial:+75000000, recovery:336, events:[{event:"AI model output anomaly",impact:"Human override activated",severity:"critical"},{event:"Model suspended",impact:"Business process impacted",severity:"high"}]},
  pandemic_disruption:     {governance:-10, risk:+20, financial:+250000000, recovery:8760, events:[{event:"Business continuity plan activated",impact:"Remote governance challenges",severity:"high"},{event:"Regulatory relief sought",impact:"Compliance timeline adjusted",severity:"medium"}]},
  financial_restatement:   {governance:-35, risk:+30, financial:+200000000, recovery:4380, events:[{event:"Material error discovered",impact:"Restatement required — board notified",severity:"critical"},{event:"External audit re-engagement",impact:"Audit costs escalate",severity:"high"},{event:"Regulatory notification",impact:"Disclosure obligations triggered",severity:"critical"}]},
};

export class EnterpriseTwin {
  constructor(private readonly tenantId: string) {}

  private clampScore(value:number): number { return Math.max(0, Math.min(100, Number.isFinite(value)?value:0)); }

  captureState(): TwinState {
    const risk    = getRiskRuntime(this.tenantId);
    const compl   = getComplianceObligationRuntime(this.tenantId);
    const ccm     = getCCMRuntime(this.tenantId);
    const resil   = getResilienceRuntime(this.tenantId);
    const incident= getIncidentRuntime(this.tenantId);

    let governanceScore = 0;
    try { governanceScore = getKernel(this.tenantId).computeHealthState().overallHealthScore; } catch { governanceScore = 0; }
    return {
      tenantId:    this.tenantId,
      snapshotAt:  new Date().toISOString(),
      governanceScore:     this.clampScore(governanceScore),
      riskExposure:        this.clampScore(risk.getBreachingTolerance().length * 15),
      complianceHealth:    this.clampScore(100 - compl.getBreached().length * 20),
      controlEffectiveness:this.clampScore(ccm.getOverallScore()),
      resilienceScore:     this.clampScore(resil.scoreResilience().overallScore),
      openFindings:        0,
      criticalRisks:       risk.getAll().filter(r=>r.residualScore>=20).length,
      activeCrises:        incident.getCrises().filter(c=>c.status!=="resolved"&&c.status!=="closed").length,
    };
  }

  simulate(scenario: SimulationScenario): SimulationResult {
    const preState  = this.captureState();
    const impact    = SCENARIO_IMPACTS[scenario];
    const postState: TwinState = {
      ...preState,
      snapshotAt:          new Date().toISOString(),
      governanceScore:     this.clampScore(preState.governanceScore + impact.governance),
      riskExposure:        this.clampScore(preState.riskExposure + impact.risk),
      complianceHealth:    this.clampScore(preState.complianceHealth + Math.min(0,impact.governance)),
      controlEffectiveness:this.clampScore(preState.controlEffectiveness + impact.governance*0.5),
      resilienceScore:     this.clampScore(preState.resilienceScore + impact.governance*0.3),
      criticalRisks:       preState.criticalRisks + Math.round(impact.risk/10),
      activeCrises:        preState.activeCrises + (["cyber_attack","data_breach","regulatory_investigation"].includes(scenario)?1:0),
    };

    const timeline: SimulationEvent[] = impact.events.map((e,i) => ({ ...e, hour:i===0?0:i===1?4:24 }));
    const boardActions: string[] = ["Convene emergency board meeting","Activate crisis management protocol","Notify regulators within required timeframes","Engage external counsel"];
    const regActions: string[]   = ["Prepare regulatory notification","Document incident timeline","Preserve evidence","Cooperate with investigation"];
    const deltaScore = postState.governanceScore - preState.governanceScore;
    const confidence = 78;

    const result: SimulationResult = { id:uuidv4(), tenantId:this.tenantId, scenario, preState, postState, timeline, financialImpact:impact.financial, recoveryTimeHours:impact.recovery, criticalPath:timeline.filter(e=>e.severity==="critical").map(e=>e.event), boardActions, regulatoryActions:regActions, confidence, financialModel:{status:"heuristic_uncalibrated",version:"DT-1.1",source:"Built-in stress-test assumptions; not an investment valuation or forecast."}, simulatedAt:new Date().toISOString() };

    if (!simulationStore.has(this.tenantId)) simulationStore.set(this.tenantId, []);
    simulationStore.get(this.tenantId)!.push(result);
    return result;
  }

  whatIf(question: string, alternativeActions: Record<string,number>): WhatIfAnalysis {
    const current = this.captureState();
    const alternative: TwinState = { ...current, snapshotAt:new Date().toISOString(), governanceScore:this.clampScore(current.governanceScore + (alternativeActions.governance??0)), controlEffectiveness:this.clampScore(current.controlEffectiveness + (alternativeActions.controls??0)), complianceHealth:this.clampScore(current.complianceHealth + (alternativeActions.compliance??0)) };
    const deltaScore = alternative.governanceScore - current.governanceScore;
    const deltaFinancial = deltaScore * 100000;

    return { id:uuidv4(), tenantId:this.tenantId, question, currentState:current, alternativeState:alternative, deltaScore, deltaFinancial, recommendation:deltaScore>0?"Recommended — positive governance impact":"Not recommended — insufficient improvement or negative impact", confidence:75, analyzedAt:new Date().toISOString() };
  }

  getSimulations(): SimulationResult[] { return simulationStore.get(this.tenantId) ?? []; }
  getScenarios(): SimulationScenario[] { return Object.keys(SCENARIO_IMPACTS) as SimulationScenario[]; }
}

const twinCache = new Map<string, EnterpriseTwin>();
export function getEnterpriseTwin(tenantId: string): EnterpriseTwin {
  if (!twinCache.has(tenantId)) twinCache.set(tenantId, new EnterpriseTwin(tenantId));
  return twinCache.get(tenantId)!;
}
