/**
 * Autonomous Governance Runtime — Phase 15
 * Self-healing, organizational drift detection, adaptive tuning,
 * governance fatigue detection, predictive escalation.
 */
import { v4 as uuidv4 } from "uuid";
import { getEventStore } from "../runtime/persistence/persistent.event.store";
import { getRiskRuntime } from "../risk-runtime/register/risk.intelligence.runtime";
import { getComplianceObligationRuntime } from "../compliance-runtime/obligations/compliance.obligation.runtime";
import { getCCMRuntime } from "../compliance-runtime/ccm/ccm.runtime";
import { getInternalAuditRuntime } from "../audit-runtime/internal/internal.audit.runtime";
import { getPredictiveRuntime } from "../analytics-runtime/predictive/predictive.governance.runtime";

export type AutonomousActionType =
  | "escalate_to_board"          | "trigger_remediation"
  | "suspend_control_override"   | "notify_regulator"
  | "quarantine_ai_model"        | "freeze_access"
  | "initiate_dr_simulation"     | "generate_audit_finding"
  | "alert_executive"            | "adaptive_control_tune";

export interface AutonomousAction {
  readonly id:          string;
  readonly tenantId:    string;
  readonly actionType:  AutonomousActionType;
  readonly trigger:     string;
  readonly rationale:   string;
  readonly confidence:  number;       // 0-100
  readonly humanApproved:boolean;
  readonly executedAt?: string;
  readonly outcome?:    string;
  readonly createdAt:   string;
}

export interface DriftSignal {
  id:         string;
  tenantId:   string;
  driftType:  "governance_drift"|"compliance_drift"|"control_drift"|"behavioral_drift"|"entropy_drift";
  metric:     string;
  baseline:   number;
  current:    number;
  deviation:  number;
  severity:   "critical"|"high"|"medium"|"low";
  detectedAt: string;
  recommendation:string;
}

export interface GovernanceFatigueReport {
  tenantId:       string;
  scoredAt:       string;
  fatigueScore:   number;     // 0-100 (higher = more fatigue)
  indicators: {
    overdueFindings:  number;
    repeatingFindings:number;
    escalationBacklog:number;
    controlOverrides: number;
    missedAttestations:number;
  };
  riskLevel:     "critical"|"high"|"medium"|"low";
  recommendations:string[];
}

export interface PredictiveEscalation {
  id:          string;
  tenantId:    string;
  trigger:     string;
  probability: number;       // 0-100
  timeHorizon: string;       // "24h", "7d", "30d"
  actionItems: string[];
  escalateTo:  string;
  predictedAt: string;
}

const actionStore     = new Map<string, AutonomousAction[]>();
const driftLog        = new Map<string, DriftSignal[]>();
const escalationQueue = new Map<string, PredictiveEscalation[]>();

export class AutonomousGovernanceRuntime {
  constructor(private readonly tenantId: string) {}

  /**
   * Run full autonomous governance cycle.
   * Detects drift, fatigue, emerging risks → proposes actions.
   */
  runGovernanceCycle(): { drifts:DriftSignal[]; actions:AutonomousAction[]; escalations:PredictiveEscalation[]; fatigueReport:GovernanceFatigueReport } {
    const drifts     = this.detectDrift();
    const fatigue    = this.scoreGovernanceFatigue();
    const escalations= this.predictEscalations();
    const actions    = this.proposeActions(drifts, fatigue, escalations);
    return { drifts, actions, escalations, fatigueReport:fatigue };
  }

  detectDrift(): DriftSignal[] {
    const risk   = getRiskRuntime(this.tenantId);
    const compl  = getComplianceObligationRuntime(this.tenantId);
    const ccm    = getCCMRuntime(this.tenantId);
    const audit  = getInternalAuditRuntime(this.tenantId);
    const signals: DriftSignal[] = [];
    const now = new Date().toISOString();

    // Control effectiveness drift
    const ctrlScore = ccm.getOverallScore();
    if (ctrlScore < 65) {
      signals.push({ id:uuidv4(), tenantId:this.tenantId, driftType:"control_drift", metric:"overall_control_effectiveness", baseline:80, current:ctrlScore, deviation:80-ctrlScore, severity:ctrlScore<40?"critical":"high", detectedAt:now, recommendation:"Initiate emergency control review and remediation" });
    }

    // Risk tolerance drift
    const breaching = risk.getBreachingTolerance().length;
    if (breaching >= 3) {
      signals.push({ id:uuidv4(), tenantId:this.tenantId, driftType:"governance_drift", metric:"risk_tolerance_breaches", baseline:0, current:breaching, deviation:breaching*100, severity:breaching>=5?"critical":"high", detectedAt:now, recommendation:`${breaching} risks exceed tolerance — board escalation required` });
    }

    // Compliance drift
    const oblBreaches = compl.getBreached().length;
    if (oblBreaches > 0) {
      signals.push({ id:uuidv4(), tenantId:this.tenantId, driftType:"compliance_drift", metric:"obligation_breaches", baseline:0, current:oblBreaches, deviation:oblBreaches*100, severity:oblBreaches>=3?"critical":"high", detectedAt:now, recommendation:`${oblBreaches} compliance obligations in breach — regulatory exposure` });
    }

    // Audit finding aging drift
    const openCritical = audit.getAllFindings("critical").filter(f=>f.status==="open").length;
    if (openCritical > 0) {
      signals.push({ id:uuidv4(), tenantId:this.tenantId, driftType:"governance_drift", metric:"open_critical_findings", baseline:0, current:openCritical, deviation:openCritical*100, severity:"critical", detectedAt:now, recommendation:`${openCritical} critical audit findings open — immediate remediation` });
    }

    if (!driftLog.has(this.tenantId)) driftLog.set(this.tenantId, []);
    driftLog.get(this.tenantId)!.push(...signals);
    return signals;
  }

  scoreGovernanceFatigue(): GovernanceFatigueReport {
    const audit   = getInternalAuditRuntime(this.tenantId);
    const ccm     = getCCMRuntime(this.tenantId);
    const now     = new Date().toISOString();

    const overdueFindings    = audit.getOpenFindings().filter(f => f.dueDate < now).length;
    const repeatingFindings  = 0; // simplified — would check repeat patterns
    const escalationBacklog  = audit.getOpenFindings().filter(f => f.severity === "critical").length;
    const controlOverrides   = ccm.getSignals("critical").filter(s => s.signalType === "override_detected").length;
    const missedAttestations = 0;

    const fatigueScore = Math.min(100, overdueFindings*15 + escalationBacklog*20 + controlOverrides*25 + repeatingFindings*10);
    const riskLevel    = fatigueScore >= 70 ? "critical" : fatigueScore >= 50 ? "high" : fatigueScore >= 30 ? "medium" : "low";

    const recs: string[] = [
      ...(overdueFindings > 0  ? [`${overdueFindings} overdue findings — governance fatigue accumulating`] : []),
      ...(controlOverrides > 0 ? [`${controlOverrides} control overrides — possible governance bypass pattern`] : []),
      ...(fatigueScore > 50    ? ["Governance capacity review recommended — workload may be unsustainable"] : []),
    ];

    return { tenantId:this.tenantId, scoredAt:now, fatigueScore, indicators:{ overdueFindings, repeatingFindings, escalationBacklog, controlOverrides, missedAttestations }, riskLevel, recommendations:recs };
  }

  predictEscalations(): PredictiveEscalation[] {
    const report   = getPredictiveRuntime(this.tenantId).predict("30d");
    const escalations: PredictiveEscalation[] = [];
    const now = new Date().toISOString();

    if (report.driftProbability > 60) {
      escalations.push({ id:uuidv4(), tenantId:this.tenantId, trigger:"governance_drift_probability_high", probability:report.driftProbability, timeHorizon:"30d", actionItems:["Review governance program","Strengthen controls","Escalate to board"], escalateTo:"board_risk_committee", predictedAt:now });
    }
    if (report.breachProbability > 50) {
      escalations.push({ id:uuidv4(), tenantId:this.tenantId, trigger:"compliance_breach_imminent", probability:report.breachProbability, timeHorizon:"30d", actionItems:["Prioritize overdue obligations","Assign remediation owners","Brief CCO"], escalateTo:"chief_compliance_officer", predictedAt:now });
    }

    if (!escalationQueue.has(this.tenantId)) escalationQueue.set(this.tenantId, []);
    escalationQueue.get(this.tenantId)!.push(...escalations);
    return escalations;
  }

  proposeActions(drifts: DriftSignal[], fatigue: GovernanceFatigueReport, escalations: PredictiveEscalation[]): AutonomousAction[] {
    const actions: AutonomousAction[] = [];
    const now = new Date().toISOString();

    for (const d of drifts.filter(d=>d.severity==="critical")) {
      actions.push(Object.freeze({ id:uuidv4(), tenantId:this.tenantId, actionType:"escalate_to_board", trigger:`Critical drift: ${d.metric}`, rationale:d.recommendation, confidence:90, humanApproved:false, createdAt:now }));
    }

    if (fatigue.riskLevel === "critical") {
      actions.push(Object.freeze({ id:uuidv4(), tenantId:this.tenantId, actionType:"alert_executive", trigger:"governance_fatigue_critical", rationale:`Fatigue score ${fatigue.fatigueScore}/100 — governance capacity at risk`, confidence:85, humanApproved:false, createdAt:now }));
    }

    for (const e of escalations) {
      if (e.probability > 70) {
        actions.push(Object.freeze({ id:uuidv4(), tenantId:this.tenantId, actionType:"trigger_remediation", trigger:e.trigger, rationale:`${e.probability}% probability of escalation within ${e.timeHorizon}`, confidence:e.probability, humanApproved:false, createdAt:now }));
      }
    }

    if (!actionStore.has(this.tenantId)) actionStore.set(this.tenantId, []);
    actionStore.get(this.tenantId)!.push(...actions);

    if (actions.length > 0) {
      getEventStore(this.tenantId).append({ topic:"autonomous.governance.cycle.completed", payload:{ actionsProposed:actions.length, driftsDetected:drifts.length, escalations:escalations.length }, actorId:"autonomous_engine", actorRole:"system" });
    }

    return actions;
  }

  getActions():    AutonomousAction[]      { return actionStore.get(this.tenantId)     ?? []; }
  getDriftLog():   DriftSignal[]           { return driftLog.get(this.tenantId)        ?? []; }
  getEscalations():PredictiveEscalation[]  { return escalationQueue.get(this.tenantId) ?? []; }
}

const autoCache = new Map<string, AutonomousGovernanceRuntime>();
export function getAutonomousGovernance(tenantId: string): AutonomousGovernanceRuntime {
  if (!autoCache.has(tenantId)) autoCache.set(tenantId, new AutonomousGovernanceRuntime(tenantId));
  return autoCache.get(tenantId)!;
}
