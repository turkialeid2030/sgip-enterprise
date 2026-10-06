/**
 * KRI/KPI Intelligence Layer
 * Real-time key risk and performance indicators with threshold monitoring.
 * Auto-generates governance alerts when thresholds breached.
 */
import { v4 as uuidv4 } from "uuid";
import { TenantContext } from "../../types/tenant.types";
import { globalMetrics } from "../../observability/metrics/governance.metrics";
import { globalAnomalyDetector } from "../../observability/anomaly-detection/anomaly.detector";

export type IndicatorType = "KRI" | "KPI" | "KCI";
export type TrendDirection = "improving" | "stable" | "deteriorating";

export interface Indicator {
  id:             string;
  tenantId:       string;
  code:           string;             // KRI-001, KPI-010
  name:           string;
  type:           IndicatorType;
  category:       string;
  description:    string;
  unit:           string;
  frequency:      "real_time" | "hourly" | "daily" | "weekly" | "monthly";
  greenThreshold: number;             // value range = green (healthy)
  amberThreshold: number;             // amber = warning
  redThreshold:   number;             // red = breach
  currentValue:   number;
  previousValue?:  number;
  trend:          TrendDirection;
  status:         "green" | "amber" | "red";
  owner:          string;
  linkedRisks:    string[];
  linkedControls: string[];
  lastUpdatedAt:  string;
  createdAt:      string;
}

export interface IndicatorBreach {
  indicatorId:    string;
  tenantId:       string;
  indicatorCode:  string;
  indicatorName:  string;
  previousValue:  number;
  currentValue:   number;
  threshold:      number;
  breachLevel:    "amber" | "red";
  detectedAt:     string;
  escalateTo:     string;
  acknowledged:   boolean;
}

// Built-in governance KRIs
export const BUILTIN_KRI_TEMPLATES: Omit<Indicator, "id" | "tenantId" | "currentValue" | "previousValue" | "trend" | "status" | "lastUpdatedAt" | "createdAt">[] = [
  { code:"KRI-001", name:"Unresolved Critical Findings",         type:"KRI", category:"audit",      description:"Number of critical audit findings not yet remediated",                   unit:"count",   frequency:"daily",    greenThreshold:0,  amberThreshold:2,  redThreshold:5,  owner:"CAE",  linkedRisks:[], linkedControls:[] },
  { code:"KRI-002", name:"Policy Compliance Rate",               type:"KRI", category:"compliance", description:"% of policies with active attestation by responsible parties",          unit:"percent", frequency:"monthly",  greenThreshold:95, amberThreshold:85, redThreshold:75, owner:"CCO",  linkedRisks:[], linkedControls:[] },
  { code:"KRI-003", name:"SoD Violations",                       type:"KRI", category:"controls",   description:"Number of active Segregation of Duties violations",                     unit:"count",   frequency:"daily",    greenThreshold:0,  amberThreshold:3,  redThreshold:10, owner:"CGO",  linkedRisks:[], linkedControls:[] },
  { code:"KRI-004", name:"Evidence Integrity Score",             type:"KRI", category:"evidence",   description:"% of evidence chains that pass integrity verification",                  unit:"percent", frequency:"daily",    greenThreshold:98, amberThreshold:90, redThreshold:80, owner:"CGO",  linkedRisks:[], linkedControls:[] },
  { code:"KRI-005", name:"High-Risk Vendor Count",               type:"KRI", category:"vendor",     description:"Number of vendors with risk score above 70",                             unit:"count",   frequency:"weekly",   greenThreshold:2,  amberThreshold:5,  redThreshold:10, owner:"CPO",  linkedRisks:[], linkedControls:[] },
  { code:"KRI-006", name:"Approval SLA Breaches",                type:"KRI", category:"governance", description:"Number of approval requests that exceeded SLA",                         unit:"count",   frequency:"daily",    greenThreshold:0,  amberThreshold:5,  redThreshold:15, owner:"CGO",  linkedRisks:[], linkedControls:[] },
  { code:"KRI-007", name:"Failed Controls",                      type:"KRI", category:"controls",   description:"Number of controls that failed their last test",                        unit:"count",   frequency:"weekly",   greenThreshold:0,  amberThreshold:3,  redThreshold:8,  owner:"CRO",  linkedRisks:[], linkedControls:[] },
  { code:"KRI-008", name:"Orphan Accountability",                type:"KRI", category:"governance", description:"Number of decisions or entities without an accountable party",          unit:"count",   frequency:"daily",    greenThreshold:0,  amberThreshold:5,  redThreshold:15, owner:"CGO",  linkedRisks:[], linkedControls:[] },
  { code:"KPI-001", name:"Governance Maturity Score",            type:"KPI", category:"governance", description:"Overall governance maturity level (0-100)",                             unit:"score",   frequency:"monthly",  greenThreshold:70, amberThreshold:50, redThreshold:30, owner:"CGO",  linkedRisks:[], linkedControls:[] },
  { code:"KPI-002", name:"Audit Completion Rate",                type:"KPI", category:"audit",      description:"% of planned audit engagements completed on schedule",                  unit:"percent", frequency:"monthly",greenThreshold:90, amberThreshold:75, redThreshold:60, owner:"CAE",  linkedRisks:[], linkedControls:[] },
  { code:"KPI-003", name:"Control Effectiveness",                type:"KPI", category:"controls",   description:"Weighted average of control test scores (0-100)",                       unit:"score",   frequency:"monthly",  greenThreshold:80, amberThreshold:65, redThreshold:50, owner:"CRO",  linkedRisks:[], linkedControls:[] },
  { code:"KPI-004", name:"Remediation Cycle Time (Days)",        type:"KPI", category:"audit",      description:"Average days to close a finding from identification to closure",        unit:"days",    frequency:"monthly",  greenThreshold:30, amberThreshold:60, redThreshold:90, owner:"CAE",  linkedRisks:[], linkedControls:[] },
];

const indicatorStore = new Map<string, Indicator>();
const breachStore:    IndicatorBreach[] = [];

export class KRIKPIEngine {
  constructor(private readonly tenantId: string) {}

  seed(): void {
    const now = new Date().toISOString();
    for (const tmpl of BUILTIN_KRI_TEMPLATES) {
      const id       = uuidv4();
      const indicator: Indicator = {
        ...tmpl,
        id, tenantId: this.tenantId,
        currentValue:  tmpl.greenThreshold,
        trend:         "stable",
        status:        "green",
        lastUpdatedAt: now,
        createdAt:     now,
      };
      indicatorStore.set(`${this.tenantId}:${id}`, indicator);
    }
  }

  update(indicatorId: string, newValue: number): { indicator: Indicator; breach?: IndicatorBreach } {
    const key = `${this.tenantId}:${indicatorId}`;
    const ind = indicatorStore.get(key);
    if (!ind) throw Object.assign(new Error(`Indicator ${indicatorId} not found`), { statusCode: 404 });

    const prevValue = ind.currentValue;
    const status: Indicator["status"] =
      newValue <= ind.greenThreshold ? "green" :
      newValue <= ind.amberThreshold ? "amber" : "red";
    const trend: TrendDirection =
      newValue < prevValue ? "improving" :
      newValue > prevValue ? "deteriorating" : "stable";

    const updated: Indicator = { ...ind, currentValue: newValue, previousValue: prevValue, status, trend, lastUpdatedAt: new Date().toISOString() };
    indicatorStore.set(key, updated);

    // Record metrics
    globalMetrics.record({ name:"policy_block_rate", value:newValue, unit:"count", tenantId:this.tenantId, labels:{ indicator:ind.code } });

    // Detect breach
    let breach: IndicatorBreach | undefined;
    if (status !== "green" && ind.status === "green") {
      breach = { indicatorId, tenantId:this.tenantId, indicatorCode:ind.code, indicatorName:ind.name, previousValue:prevValue, currentValue:newValue, threshold:status==="amber"?ind.amberThreshold:ind.redThreshold, breachLevel:status, detectedAt:new Date().toISOString(), escalateTo:ind.owner, acknowledged:false };
      breachStore.push(breach);
      // Trigger anomaly
      if (status === "red") globalAnomalyDetector.checkApprovalBottleneck(this.tenantId, Math.round(newValue));
    }
    return { indicator: updated, breach };
  }

  getAll(): Indicator[] {
    return [...indicatorStore.values()].filter(i => i.tenantId === this.tenantId);
  }

  getBreaches(unacknowledged = true): IndicatorBreach[] {
    return breachStore.filter(b => b.tenantId === this.tenantId && (!unacknowledged || !b.acknowledged));
  }

  getDashboard() {
    const all      = this.getAll();
    const green    = all.filter(i => i.status === "green").length;
    const amber    = all.filter(i => i.status === "amber").length;
    const red      = all.filter(i => i.status === "red").length;
    const breaches = this.getBreaches();
    const score    = all.length > 0 ? Math.round((green / all.length) * 100) : 0;
    return { total:all.length, green, amber, red, score, breaches: breaches.length, indicators: all, dataSufficiency:all.length>0?"sufficient":"insufficient" as const };
  }
}

const krkpiCache = new Map<string, KRIKPIEngine>();
export function getKRIKPIEngine(tenantId: string): KRIKPIEngine {
  if (!krkpiCache.has(tenantId)) krkpiCache.set(tenantId, new KRIKPIEngine(tenantId));
  return krkpiCache.get(tenantId)!;
}
