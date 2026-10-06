/**
 * Governance Monte Carlo Engine
 * Pure deterministic simulation core used by the Executive API.
 * Financial impacts are stress-test assumptions and MUST be tenant-calibrated
 * before they are used as forecasts, provisions, valuations, or investment inputs.
 */

export type MonteCarloHorizon = "30d"|"90d"|"12m";
export type MonteCarloEvent = "risk_breach"|"control_failure"|"compliance_incident"|"board_delay"|"cyber_attack"|"regulatory_change"|"key_person_loss";

export interface GovernanceMonteCarloInput {
  iterations: number;
  horizon: MonteCarloHorizon;
  simulateEvents: MonteCarloEvent[];
  seed?: number;
  baseline: { riskScore:number; controlHealth:number; complianceScore:number };
}

export interface GovernanceMonteCarloResult {
  parameters: { iterations:number; horizon:MonteCarloHorizon; horizonDays:number; events:MonteCarloEvent[]; seed:number };
  baseline: { riskScore:number; controlHealth:number; complianceScore:number };
  results: {
    averageRiskScore:number;
    averageControlHealth:number;
    averageCompliance:number;
    averageFinancialImpact:number;
    p95FinancialImpact:number;
    p95RiskScore:number;
    riskStdDev:number;
    riskStandardError:number;
    riskConfidenceInterval95:{low:number;high:number};
    worstCaseRisk:number;
    bestCaseRisk:number;
    failureProbability:number;
    eventFrequency:Record<string,number>;
  };
  recommendation:string;
  confidence:"high"|"medium"|"low";
  confidenceBasis:string;
  modelGovernance:{ probabilityBasis:string; financialCalibration:"heuristic_uncalibrated"; modelVersion:string };
}

const EVENT_IMPACTS: Record<MonteCarloEvent, {riskDelta:number; complianceDelta:number; controlDelta:number; financialImpact:number; p90:number}> = {
  risk_breach:         {riskDelta:+15, complianceDelta:-5,  controlDelta:-10, financialImpact:500000,  p90:0.35},
  control_failure:     {riskDelta:+10, complianceDelta:-8,  controlDelta:-20, financialImpact:200000,  p90:0.25},
  compliance_incident: {riskDelta:+8,  complianceDelta:-20, controlDelta:-5,  financialImpact:350000,  p90:0.25},
  board_delay:         {riskDelta:+5,  complianceDelta:-3,  controlDelta:0,    financialImpact:100000,  p90:0.25},
  cyber_attack:        {riskDelta:+25, complianceDelta:-15, controlDelta:-25, financialImpact:2000000, p90:0.15},
  regulatory_change:   {riskDelta:+12, complianceDelta:-12, controlDelta:-5,  financialImpact:300000,  p90:0.25},
  key_person_loss:     {riskDelta:+8,  complianceDelta:-5,  controlDelta:-8,  financialImpact:150000,  p90:0.25},
};

const clamp = (n:number) => Math.max(0, Math.min(100, Number.isFinite(n)?n:0));
const round2 = (n:number) => Math.round(n*100)/100;

export function runGovernanceMonteCarlo(input:GovernanceMonteCarloInput): GovernanceMonteCarloResult {
  if (!Number.isInteger(input.iterations) || input.iterations < 10 || input.iterations > 500) throw new RangeError("iterations must be an integer from 10 to 500");
  if (!input.simulateEvents.length) throw new RangeError("simulateEvents must contain at least one event");
  const horizonDays = input.horizon === "30d" ? 30 : input.horizon === "90d" ? 90 : 365;
  const seed = input.seed ?? Math.max(1, Date.now()%2147483647);
  if (!Number.isInteger(seed) || seed < 1 || seed > 2147483647) throw new RangeError("seed must be an integer from 1 to 2147483647");
  let seedState=seed;
  const seededRand=()=>{ seedState=(seedState*9301+49297)%233280; return seedState/233280; };
  // Convert a 90-day cumulative event probability to the selected horizon
  // under a constant-hazard survival assumption.
  const horizonProbability=(p90:number)=>1-Math.pow(1-p90,horizonDays/90);

  const baseline={riskScore:clamp(input.baseline.riskScore),controlHealth:clamp(input.baseline.controlHealth),complianceScore:clamp(input.baseline.complianceScore)};
  const runs:Array<{riskScore:number;controlHealth:number;complianceScore:number;financialImpact:number;eventsTriggered:MonteCarloEvent[]}>=[];
  for(let i=0;i<input.iterations;i++){
    let riskScore=baseline.riskScore,controlHealth=baseline.controlHealth,complianceScore=baseline.complianceScore,totalFinancial=0;
    const eventsTriggered:MonteCarloEvent[]=[];
    for(const event of input.simulateEvents){
      const model=EVENT_IMPACTS[event];
      if(!model) throw new RangeError(`Unsupported Monte Carlo event: ${event}`);
      if(seededRand()<horizonProbability(model.p90)){
        riskScore=clamp(riskScore+model.riskDelta);
        controlHealth=clamp(controlHealth+model.controlDelta);
        complianceScore=clamp(complianceScore+model.complianceDelta);
        totalFinancial+=model.financialImpact*(0.5+seededRand());
        eventsTriggered.push(event);
      }
    }
    runs.push({riskScore,controlHealth,complianceScore,financialImpact:Math.round(totalFinancial),eventsTriggered});
  }

  const avg=(key:"riskScore"|"controlHealth"|"complianceScore"|"financialImpact")=>Math.round(runs.reduce((s,r)=>s+r[key],0)/runs.length);
  const averageRiskScore=avg("riskScore"), averageControlHealth=avg("controlHealth"), averageCompliance=avg("complianceScore"), averageFinancialImpact=avg("financialImpact");
  const byRisk=[...runs].sort((a,b)=>b.riskScore-a.riskScore), byFinancial=[...runs].sort((a,b)=>b.financialImpact-a.financialImpact);
  const p95Index=Math.min(runs.length-1,Math.floor(runs.length*0.05));
  const riskVariance=runs.reduce((s,r)=>s+Math.pow(r.riskScore-averageRiskScore,2),0)/Math.max(1,runs.length-1);
  const riskStdDev=Math.sqrt(riskVariance), riskStandardError=riskStdDev/Math.sqrt(runs.length), riskMargin95=1.96*riskStandardError;
  const eventFrequency:Record<string,number>={};
  for(const r of runs) for(const e of r.eventsTriggered) eventFrequency[e]=(eventFrequency[e]??0)+1;
  const failureRuns=runs.filter(r=>r.riskScore>70).length;
  const confidence:GovernanceMonteCarloResult["confidence"] = input.iterations>=100&&riskMargin95<=2?"high":input.iterations>=50&&riskMargin95<=5?"medium":"low";

  return {
    parameters:{iterations:input.iterations,horizon:input.horizon,horizonDays,events:[...input.simulateEvents],seed},
    baseline,
    results:{
      averageRiskScore,averageControlHealth,averageCompliance,averageFinancialImpact,
      p95FinancialImpact:byFinancial[p95Index].financialImpact,p95RiskScore:byRisk[p95Index].riskScore,
      riskStdDev:round2(riskStdDev),riskStandardError:round2(riskStandardError),
      riskConfidenceInterval95:{low:clamp(round2(averageRiskScore-riskMargin95)),high:clamp(round2(averageRiskScore+riskMargin95))},
      worstCaseRisk:byRisk[0].riskScore,bestCaseRisk:byRisk[byRisk.length-1].riskScore,
      failureProbability:Math.round(failureRuns/runs.length*100),eventFrequency,
    },
    recommendation:averageRiskScore>60?"High governance risk — immediate board escalation and remediation required":averageRiskScore>40?"Moderate governance risk — strengthen controls and compliance program":"Governance risk within acceptable parameters — maintain current program",
    confidence,
    confidenceBasis:"95% risk mean interval derived from standard error and iteration count",
    modelGovernance:{probabilityBasis:"90-day cumulative probabilities converted by constant-hazard survival model",financialCalibration:"heuristic_uncalibrated",modelVersion:"MC-GOV-1.1"},
  };
}
