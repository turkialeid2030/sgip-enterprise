/**
 * Predictive Governance Analytics — Phase 7.10/7.13
 * Executive dashboards, governance drift prediction, anomaly forecasting.
 */
import { v4 as uuidv4 } from "uuid";
import { getKernel } from "../../runtime/institutional-kernel/institutional.kernel";
import { getThermodynamics } from "../../runtime/thermodynamics/organizational.thermodynamics";
import { getTimeIntelligence } from "../../runtime/time-intelligence/strategic.time.intelligence";
import { getRiskRuntime } from "../../risk-runtime/register/risk.intelligence.runtime";
import { getComplianceObligationRuntime } from "../../compliance-runtime/obligations/compliance.obligation.runtime";
import { getCCMRuntime } from "../../compliance-runtime/ccm/ccm.runtime";
import { getIncidentRuntime } from "../../resilience-runtime/incidents/incident.crisis.runtime";
import { getBoardRuntime } from "../../governance-runtime/board/board.runtime";
import { getAssuranceRuntime } from "../../assurance-runtime/integrated/integrated.assurance.runtime";

export interface ExecutiveCockpit {
  tenantId:string; generatedAt:string;
  boardReadiness:         number;
  governanceHealthScore:  number;
  enterpriseRiskExposure: number;
  complianceHealth:       number;
  controlEffectiveness:   number;
  organizationalTemp:     number;
  openCrises:             number;
  openCAPAs:              number;
  toleranceBreaches:      number;
  obligationBreaches:     number;
  pendingResolutions:     number;
  latestAssuranceRating:  string;
  immediateActions:       string[];
  boardWarnings:          string[];
  trend:                  "improving"|"stable"|"deteriorating";
  forecast30d:            string;
}

export interface GovernancePrediction {
  tenantId:string; generatedAt:string;
  driftProbability:       number;  // 0-100
  breachProbability:      number;
  controlDegradation:     number;
  boardBottleneckRisk:    number;
  aiGovernanceRisk:       number;
  timeHorizon:            "30d"|"90d"|"12m";
  topRisks:               string[];
  earlyWarnings:          string[];
}

export class PredictiveGovernanceRuntime {
  constructor(private readonly tenantId:string) {}

  buildExecutiveCockpit():ExecutiveCockpit {
    const kernel   = getKernel(this.tenantId);
    const thermo   = getThermodynamics(this.tenantId);
    const forecast = getTimeIntelligence(this.tenantId);
    const risk     = getRiskRuntime(this.tenantId);
    const compl    = getComplianceObligationRuntime(this.tenantId);
    const ccm      = getCCMRuntime(this.tenantId);
    const incident = getIncidentRuntime(this.tenantId);
    const board    = getBoardRuntime(this.tenantId);
    const assurance= getAssuranceRuntime(this.tenantId);

    const health    = kernel.computeHealthState();
    const heatReport= thermo.generateReport();
    const timeReport= forecast.generateReport("30d");
    const opinion   = assurance.getLatestOpinion();

    const toleranceBreaches  = risk.getBreachingTolerance().length;
    const obligationBreaches = compl.getBreached().length;
    const openCrises         = incident.getCrises().filter(c=>c.status!=="resolved"&&c.status!=="closed").length;
    const openCAPAs          = incident.getOpenCAPAs().length;
    const pendingResolutions = board.getResolutions().filter(r=>r.status==="under_vote").length;

    const immediateActions = [...health.recommendations, ...heatReport.immediateActions].slice(0,5);
    if(toleranceBreaches>0)  immediateActions.push(`${toleranceBreaches} risks exceeding tolerance — board escalation required`);
    if(obligationBreaches>0) immediateActions.push(`${obligationBreaches} compliance obligations in breach — regulatory exposure`);

    const boardReadiness = Math.max(0, 100 - toleranceBreaches*10 - obligationBreaches*8 - openCrises*15);
    const trend:ExecutiveCockpit["trend"] = timeReport.trendDirection;

    return {
      tenantId:this.tenantId, generatedAt:new Date().toISOString(),
      boardReadiness, governanceHealthScore:health.overallHealthScore,
      enterpriseRiskExposure:Math.min(100,toleranceBreaches*20+obligationBreaches*10),
      complianceHealth:obligationBreaches===0?100:Math.max(0,100-obligationBreaches*15),
      controlEffectiveness:ccm.getOverallScore(),
      organizationalTemp:heatReport.metrics.overallTemperature,
      openCrises, openCAPAs, toleranceBreaches, obligationBreaches, pendingResolutions,
      latestAssuranceRating:opinion?.overallRating??"not_assessed",
      immediateActions, boardWarnings:heatReport.boardWarnings,
      trend, forecast30d:timeReport.forecast.thirtyDayOutlook,
    };
  }

  predict(horizon:"30d"|"90d"|"12m"="30d"):GovernancePrediction {
    const risk   = getRiskRuntime(this.tenantId);
    const compl  = getComplianceObligationRuntime(this.tenantId);
    const ccm    = getCCMRuntime(this.tenantId);
    const time   = getTimeIntelligence(this.tenantId);
    const report = time.generateReport(horizon);

    const driftProbability   = Math.min(100,report.governanceDriftScore*1.2);
    const breachProbability  = Math.min(100,compl.getAll().filter(o=>o.status==="active"&&o.dueDate).length*8);
    const controlDegradation = Math.max(0,100-ccm.getOverallScore());
    const boardBottleneckRisk= report.earlyWarnings.length*15;
    const aiGovernanceRisk   = 20;

    const topRisks = risk.getBreachingTolerance().slice(0,3).map(r=>`${r.title} (score:${r.residualScore})`);
    const earlyWarnings = report.earlyWarnings.map(w=>w.signal);

    return {tenantId:this.tenantId,generatedAt:new Date().toISOString(),driftProbability,breachProbability,controlDegradation,boardBottleneckRisk,aiGovernanceRisk,timeHorizon:horizon,topRisks,earlyWarnings};
  }
}

const predCache=new Map<string,PredictiveGovernanceRuntime>();
export function getPredictiveRuntime(tenantId:string):PredictiveGovernanceRuntime {
  if(!predCache.has(tenantId)) predCache.set(tenantId,new PredictiveGovernanceRuntime(tenantId));
  return predCache.get(tenantId)!;
}
