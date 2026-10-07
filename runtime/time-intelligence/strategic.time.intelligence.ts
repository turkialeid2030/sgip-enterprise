/**
 * Strategic Time Intelligence — SCEOS Layer 6
 * Temporal reasoning: drift detection, decay forecasting, risk velocity.
 * Answers: "Where is this organization heading over time?"
 */
import { v4 as uuidv4 } from "uuid";
import { getSovereignMemory } from "../../sovereign-memory/core/sovereign.memory.engine";
import { getPatternEngine } from "../../sovereign-memory/patterns/institutional.pattern.engine";

export interface TimeIntelligenceReport {
  tenantId:          string;
  generatedAt:       string;
  period:            "30d" | "90d" | "12m";
  trendDirection:    "improving" | "stable" | "deteriorating";
  governanceDriftScore:  number;    // 0-100 (100 = severe drift)
  riskVelocity:      number;        // rate of risk increase per week
  controlFatigue:    number;        // 0-100
  complianceTrajectory: "on_track" | "at_risk" | "off_track";
  recurringIssues:   string[];
  unresolvedAging:   AgedItem[];
  earlyWarnings:     EarlyWarning[];
  forecast:          GovernanceForecast;
}

export interface AgedItem {
  entityId:     string;
  entityType:   string;
  title:        string;
  ageDays:      number;
  severity:     "critical" | "high" | "medium";
}

export interface EarlyWarning {
  code:         string;
  signal:       string;
  probability:  number;     // 0-100
  timeframeDay: number;     // expected days until event
  recommendation:string;
}

export interface GovernanceForecast {
  thirtyDayOutlook:  string;
  ninetyDayOutlook:  string;
  twelveMonthOutlook:string;
  strategicRisks:    string[];
  opportunityAreas:  string[];
}

export class StrategicTimeIntelligence {
  constructor(private readonly tenantId: string) {}

  generateReport(period: TimeIntelligenceReport["period"] = "30d"): TimeIntelligenceReport {
    const memory     = getSovereignMemory(this.tenantId);
    const patterns   = getPatternEngine(this.tenantId);
    const memStats   = memory.getStats();
    const patReport  = patterns.generateReport();

    // Governance drift: increases with orphan accountability + pattern count
    const governanceDriftScore = Math.min(100,
      patReport.criticalCount * 25 + patReport.highCount * 10 + memStats.patterns * 5
    );

    // Risk velocity: memories created recently with risk tags
    const recentRisk = memory.recall({ type:"prophylactic", limit:20 });
    const riskVelocity = recentRisk.length * 0.5; // per week proxy

    // Control fatigue proxy
    const controlFatigue = Math.min(100, memStats.patterns * 15 + patReport.highCount * 10);

    // Compliance trajectory
    const complianceTrajectory: TimeIntelligenceReport["complianceTrajectory"] =
      governanceDriftScore >= 60 ? "off_track" :
      governanceDriftScore >= 30 ? "at_risk" : "on_track";

    // Recurring issues from pattern memory
    const patternList = patReport.patterns.map(p => p.title);

    // Unresolved aging
    const unresolvedAging: AgedItem[] = [];
    const institutional = memory.recall({ type:"institutional", limit:50 });
    for (const m of institutional) {
      const ageDays = Math.round((Date.now() - new Date(m.createdAt).getTime()) / 86400000);
      if (ageDays > 30 && m.reinforcements === 0) {
        unresolvedAging.push({ entityId:m.id, entityType:m.subjectType, title:m.content.slice(0,50), ageDays, severity:"medium" });
      }
    }

    // Early warnings
    const earlyWarnings: EarlyWarning[] = [];
    if (governanceDriftScore >= 40) {
      earlyWarnings.push({ code:"EW-001", signal:"Governance drift accelerating", probability:75, timeframeDay:30, recommendation:"Immediate governance review required" });
    }
    if (controlFatigue >= 50) {
      earlyWarnings.push({ code:"EW-002", signal:"Control fatigue indicators present", probability:65, timeframeDay:60, recommendation:"Reduce control burden — automate low-value checks" });
    }
    if (memStats.total === 0) {
      earlyWarnings.push({ code:"EW-003", signal:"No institutional memory — blind spots forming", probability:90, timeframeDay:14, recommendation:"Begin systematic event recording immediately" });
    }

    const trendDirection: TimeIntelligenceReport["trendDirection"] =
      governanceDriftScore >= 50 ? "deteriorating" :
      governanceDriftScore >= 20 ? "stable" : "improving";

    const forecast: GovernanceForecast = {
      thirtyDayOutlook:   governanceDriftScore >= 50 ? "Governance pressure increasing — board escalation likely" : "Governance stable — monitor KRIs",
      ninetyDayOutlook:   controlFatigue >= 60 ? "Control effectiveness at risk — redesign required" : "Compliance trajectory on track if patterns addressed",
      twelveMonthOutlook: trendDirection === "deteriorating" ? "Systemic governance risk if unaddressed — enterprise risk event probable" : "Governance maturity improving — targeted investment recommended",
      strategicRisks:     [
        ...(governanceDriftScore >= 40 ? ["Governance drift leading to strategic misalignment"] : []),
        ...(riskVelocity > 2 ? ["Accelerating risk accumulation"] : []),
        ...(unresolvedAging.length > 3 ? ["Institutional knowledge decay"] : []),
      ],
      opportunityAreas: [
        "Evidence automation — reduce manual collection burden",
        "AI-assisted policy review — accelerate cycle time",
        ...(memStats.total < 50 ? ["Institutional memory build-up — high value activity"] : []),
      ],
    };

    return {
      tenantId:this.tenantId, generatedAt:new Date().toISOString(), period,
      trendDirection, governanceDriftScore, riskVelocity, controlFatigue,
      complianceTrajectory, recurringIssues:patternList,
      unresolvedAging:unresolvedAging.slice(0, 5), earlyWarnings, forecast,
    };
  }
}

const timeIntelCache = new Map<string, StrategicTimeIntelligence>();
export function getTimeIntelligence(tenantId: string): StrategicTimeIntelligence {
  if (!timeIntelCache.has(tenantId)) timeIntelCache.set(tenantId, new StrategicTimeIntelligence(tenantId));
  return timeIntelCache.get(tenantId)!;
}
