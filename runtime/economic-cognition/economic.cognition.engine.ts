/**
 * Economic Cognition Engine — SCEOS Layer 3
 * Connects governance decisions to financial and operational impact.
 * Every recommendation includes cost, risk delta, and confidence.
 */
import { v4 as uuidv4 } from "uuid";
import { getGovernanceOntology } from "../../sovereign-memory/ontology/governance.ontology.engine";

export interface EconomicImpact {
  id:                string;
  tenantId:          string;
  entityId:          string;
  entityType:        string;
  scenario:          string;
  financialImpact:   FinancialImpact;
  operationalImpact: OperationalImpact;
  riskImpact:        RiskImpactScore;
  confidence:        number;           // 0-100
  evidenceLinks:     string[];
  calculatedAt:      string;
}

export interface FinancialImpact {
  currency:          string;
  costOfDelay:       number;           // per day
  delayDays:         number;           // scenario/context duration used in netImpact
  costOfFailure:     number;           // total if control fails
  compliancePenalty: number;           // regulatory fine estimate
  remediationCost:   number;
  opportunityCost:   number;
  netImpact:         number;           // costOfDelay*delayDays + fixed exposure components
  confidenceRange:   { low:number; high:number };
  modelGovernance:   { version:string; calibrationStatus:"heuristic_uncalibrated"|"calibrated"; source:string; asOf:string|null };
}

export interface OperationalImpact {
  productivityLossDays:  number;
  affectedFTEs:          number;
  processDelayDays:      number;
  automationROI:         number;       // estimated ROI of automating this
  operationalWaste:      string[];     // identified waste areas
}

export interface RiskImpactScore {
  inherentIncrease:  number;          // delta
  residualIncrease:  number;
  controlWeakening:  number;          // 0-100
  complianceExposure:number;          // 0-100
  reputationalRisk:  number;          // 0-100
}

export interface GovernanceCostModel {
  tenantId:          string;
  annualGovernanceCost:    number;
  costPerDecision:         number;
  costPerAudit:            number;
  costPerComplianceBreach: number;
  wastedGovernanceSpend:   number;     // governance effort on low-value activities
  automationOpportunity:   number;     // SAR savings assumption from automation
  modelGovernance: {
    currency:"SAR";
    calibrationStatus:"heuristic_uncalibrated"|"calibrated";
    modelVersion:string;
    source:string;
    asOf:string|null;
  };
  generatedAt:             string;
}

// Built-in impact models by scenario
const IMPACT_MODELS: Record<string, Partial<EconomicImpact>> = {
  control_failure: {
    financialImpact: { currency:"SAR", costOfDelay:0, delayDays:0, costOfFailure:500000, compliancePenalty:250000, remediationCost:75000, opportunityCost:150000, netImpact:975000, confidenceRange:{low:400000, high:1500000}, modelGovernance:{version:"ECON-1.1",calibrationStatus:"heuristic_uncalibrated",source:"Built-in SGIP stress-test assumption; requires tenant calibration before financial reliance.",asOf:null} },
    operationalImpact: { productivityLossDays:30, affectedFTEs:15, processDelayDays:14, automationROI:40, operationalWaste:["manual evidence collection","duplicate testing","delayed reporting"] },
    riskImpact: { inherentIncrease:20, residualIncrease:15, controlWeakening:70, complianceExposure:60, reputationalRisk:45 },
  },
  compliance_breach: {
    financialImpact: { currency:"SAR", costOfDelay:5000, delayDays:0, costOfFailure:2000000, compliancePenalty:1000000, remediationCost:150000, opportunityCost:500000, netImpact:3650000, confidenceRange:{low:1000000, high:6000000}, modelGovernance:{version:"ECON-1.1",calibrationStatus:"heuristic_uncalibrated",source:"Built-in SGIP stress-test assumption; requires regulatory/tenant calibration before financial reliance.",asOf:null} },
    operationalImpact: { productivityLossDays:60, affectedFTEs:25, processDelayDays:30, automationROI:60, operationalWaste:["compliance reporting","regulatory correspondence","audit preparation"] },
    riskImpact: { inherentIncrease:35, residualIncrease:30, controlWeakening:50, complianceExposure:90, reputationalRisk:75 },
  },
  evidence_gap: {
    financialImpact: { currency:"SAR", costOfDelay:1000, delayDays:0, costOfFailure:100000, compliancePenalty:50000, remediationCost:25000, opportunityCost:75000, netImpact:250000, confidenceRange:{low:100000, high:400000}, modelGovernance:{version:"ECON-1.1",calibrationStatus:"heuristic_uncalibrated",source:"Built-in SGIP stress-test assumption; requires tenant calibration before financial reliance.",asOf:null} },
    operationalImpact: { productivityLossDays:10, affectedFTEs:5, processDelayDays:7, automationROI:75, operationalWaste:["manual evidence gathering","audit rework"] },
    riskImpact: { inherentIncrease:10, residualIncrease:8, controlWeakening:30, complianceExposure:40, reputationalRisk:20 },
  },
  kri_breach: {
    financialImpact: { currency:"SAR", costOfDelay:2500, delayDays:0, costOfFailure:350000, compliancePenalty:100000, remediationCost:60000, opportunityCost:125000, netImpact:635000, confidenceRange:{low:250000, high:1100000}, modelGovernance:{version:"ECON-1.1",calibrationStatus:"heuristic_uncalibrated",source:"Built-in KRI breach stress-test assumption; requires tenant calibration.",asOf:null} },
    operationalImpact: { productivityLossDays:14, affectedFTEs:8, processDelayDays:5, automationROI:55, operationalWaste:["manual KRI escalation","delayed risk response"] },
    riskImpact: { inherentIncrease:18, residualIncrease:15, controlWeakening:35, complianceExposure:30, reputationalRisk:25 },
  },
  audit_delay: {
    financialImpact: { currency:"SAR", costOfDelay:7500, delayDays:0, costOfFailure:150000, compliancePenalty:100000, remediationCost:50000, opportunityCost:200000, netImpact:500000, confidenceRange:{low:200000, high:900000}, modelGovernance:{version:"ECON-1.1",calibrationStatus:"heuristic_uncalibrated",source:"Built-in audit-delay stress-test assumption; requires engagement-specific calibration.",asOf:null} },
    operationalImpact: { productivityLossDays:20, affectedFTEs:10, processDelayDays:30, automationROI:45, operationalWaste:["audit rework","late evidence","management follow-up"] },
    riskImpact: { inherentIncrease:12, residualIncrease:10, controlWeakening:25, complianceExposure:45, reputationalRisk:20 },
  },
  governance_gap: {
    financialImpact: { currency:"SAR", costOfDelay:3000, delayDays:0, costOfFailure:300000, compliancePenalty:150000, remediationCost:80000, opportunityCost:120000, netImpact:650000, confidenceRange:{low:250000, high:1200000}, modelGovernance:{version:"ECON-1.1",calibrationStatus:"heuristic_uncalibrated",source:"Built-in governance-gap stress-test assumption; requires tenant calibration.",asOf:null} },
    operationalImpact: { productivityLossDays:18, affectedFTEs:12, processDelayDays:10, automationROI:50, operationalWaste:["unclear ownership","duplicate approvals","governance rework"] },
    riskImpact: { inherentIncrease:15, residualIncrease:12, controlWeakening:30, complianceExposure:35, reputationalRisk:30 },
  },
};

const impactStore = new Map<string, EconomicImpact>();

export class EconomicCognitionEngine {
  constructor(private readonly tenantId: string) {}

  assess(params: {
    entityId:   string;
    entityType: string;
    scenario:   "control_failure" | "compliance_breach" | "evidence_gap" | "kri_breach" | "audit_delay" | "governance_gap";
    context?:   Record<string, unknown>;
    evidenceLinks?: string[];
  }): EconomicImpact {
    const model = IMPACT_MODELS[params.scenario];
    if (!model) throw Object.assign(new Error(`Unsupported economic scenario: ${params.scenario}`), {statusCode:422, code:"VALIDATION_ERROR"});
    const delayDaysRaw = Number(params.context?.delayDays ?? 0);
    const delayDays = Number.isFinite(delayDaysRaw) && delayDaysRaw > 0 ? Math.min(3650, delayDaysRaw) : 0;
    const baseFinancial = { ...(model.financialImpact as FinancialImpact) };
    baseFinancial.delayDays = delayDays;
    baseFinancial.netImpact = Math.round(baseFinancial.costOfFailure + baseFinancial.compliancePenalty + baseFinancial.remediationCost + baseFinancial.opportunityCost + baseFinancial.costOfDelay * delayDays);
    if (delayDays > 0) {
      baseFinancial.confidenceRange = { low:Math.round(baseFinancial.confidenceRange.low + baseFinancial.costOfDelay*delayDays*0.5), high:Math.round(baseFinancial.confidenceRange.high + baseFinancial.costOfDelay*delayDays*1.5) };
    }
    const impact: EconomicImpact = {
      id:           uuidv4(),
      tenantId:     this.tenantId,
      entityId:     params.entityId,
      entityType:   params.entityType,
      scenario:     params.scenario,
      financialImpact:   baseFinancial,
      operationalImpact: { ...(model.operationalImpact as OperationalImpact) },
      riskImpact:        { ...(model.riskImpact as RiskImpactScore) },
      confidence:   75,
      evidenceLinks:params.evidenceLinks ?? [],
      calculatedAt: new Date().toISOString(),
    };
    impactStore.set(impact.id, impact);
    return impact;
  }

  buildCostModel(): GovernanceCostModel {
    const ontology   = getGovernanceOntology(this.tenantId);
    const stats      = ontology.getStats();
    const policyCount= stats.byType?.policy ?? 1;
    const riskCount  = stats.byType?.risk ?? 1;

    return {
      tenantId:                this.tenantId,
      annualGovernanceCost:    policyCount * 50000 + riskCount * 30000,
      costPerDecision:         15000,
      costPerAudit:            200000,
      costPerComplianceBreach: 1500000,
      wastedGovernanceSpend:   Math.round((policyCount * 50000 + riskCount * 30000) * 0.25),
      automationOpportunity:   Math.round((policyCount * 50000 + riskCount * 30000) * 0.40),
      modelGovernance: {
        currency:"SAR", calibrationStatus:"heuristic_uncalibrated", modelVersion:"GOV-COST-1.1",
        source:"Built-in SGIP governance-cost stress-test assumptions; requires tenant/source calibration before budgeting, valuation, provisioning, or investment reliance.", asOf:null,
      },
      generatedAt:             new Date().toISOString(),
    };
  }

  getImpacts(): EconomicImpact[] {
    return [...impactStore.values()].filter(i => i.tenantId === this.tenantId);
  }

  getTotalExposure(): number {
    return this.getImpacts().reduce((s, i) => s + i.financialImpact.netImpact, 0);
  }
}

const econCache = new Map<string, EconomicCognitionEngine>();
export function getEconomicEngine(tenantId: string): EconomicCognitionEngine {
  if (!econCache.has(tenantId)) econCache.set(tenantId, new EconomicCognitionEngine(tenantId));
  return econCache.get(tenantId)!;
}
