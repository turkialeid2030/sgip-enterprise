/**
 * Process Mining Engine — Phase 4
 * Discovers, analyzes, and optimizes enterprise processes.
 * Detects drift, bottlenecks, waste, and conformance violations.
 */
import { v4 as uuidv4 } from "uuid";
import { getDurableEventBus } from "../../runtime/event-bus/durable.event.bus";

export interface ProcessEvent {
  caseId:       string;
  activity:     string;
  resource:     string;
  timestamp:    string;
  duration?:    number;   // ms
  outcome:      "completed" | "failed" | "skipped";
  tenantId:     string;
}

export interface DiscoveredProcess {
  id:           string;
  tenantId:     string;
  name:         string;
  variants:     ProcessVariant[];
  avgDuration:  number;   // ms
  frequency:    number;   // cases per week
  bottlenecks:  Bottleneck[];
  driftScore:   number;   // 0-100 (100 = severe drift)
  efficiency:   number;   // 0-100
  discoveredAt: string;
}

export interface ProcessVariant {
  id:         string;
  activities: string[];
  frequency:  number;
  avgDuration:number;
  isIdeal:    boolean;
}

export interface Bottleneck {
  activity:    string;
  avgWaitMs:   number;
  frequency:   number;
  impact:      "critical" | "high" | "medium" | "low";
  recommendation:string;
}

export interface DriftReport {
  processName: string;
  tenantId:    string;
  driftScore:  number;   // 0-100
  deviations:  ProcessDeviation[];
  trend:       "improving" | "stable" | "deteriorating";
  generatedAt: string;
}

export interface ProcessDeviation {
  caseId:      string;
  expectedPath:string[];
  actualPath:  string[];
  deviationPoint:string;
  impact:      string;
}

export interface ConformanceReport {
  processName: string;
  tenantId:    string;
  conformanceScore:number;   // 0-100
  violations:  ConformanceViolation[];
  compliantCases:number;
  totalCases:  number;
}

export interface ConformanceViolation {
  caseId:      string;
  rule:        string;
  description: string;
  severity:    "critical" | "high" | "medium";
}

export interface FrictionReport {
  tenantId:    string;
  generatedAt: string;
  overallFrictionScore:number;   // 0-100
  frictionPoints:FrictionPoint[];
  estimatedWasteHours:number;
  recommendations:string[];
}

export interface FrictionPoint {
  activity:    string;
  frictionType:"wait" | "rework" | "unnecessary_approval" | "duplicate" | "manual_entry";
  occurrences: number;
  wasteHours:  number;
  priority:    "critical" | "high" | "medium" | "low";
}

// ── Event log store ───────────────────────────────────────────
const eventLog   = new Map<string, ProcessEvent[]>();   // tenantId → events
const caseIndex  = new Map<string, ProcessEvent[]>();   // tenantId:caseId → events

export class ProcessMiningEngine {
  constructor(private readonly tenantId: string) {}

  recordEvent(event: Omit<ProcessEvent, "tenantId">): void {
    const full: ProcessEvent = { ...event, tenantId:this.tenantId };
    if (!eventLog.has(this.tenantId)) eventLog.set(this.tenantId, []);
    eventLog.get(this.tenantId)!.push(full);
    const key = `${this.tenantId}:${event.caseId}`;
    if (!caseIndex.has(key)) caseIndex.set(key, []);
    caseIndex.get(key)!.push(full);
  }

  discoverProcess(processName: string, caseIds?: string[]): DiscoveredProcess {
    const allEvents = eventLog.get(this.tenantId) ?? [];
    const cases     = caseIds
      ? caseIds.map(id => caseIndex.get(`${this.tenantId}:${id}`) ?? [])
      : this.groupByCases(allEvents);

    // Build variants by activity sequence
    const variantMap = new Map<string, { count:number; durations:number[] }>();
    for (const caseEvents of cases) {
      const sorted = caseEvents.sort((a,b) => a.timestamp.localeCompare(b.timestamp));
      const path   = sorted.map(e => e.activity).join(" → ");
      const dur    = sorted.at(-1) ? (new Date(sorted.at(-1)!.timestamp).getTime() - new Date(sorted[0].timestamp).getTime()) : 0;
      if (!variantMap.has(path)) variantMap.set(path, { count:0, durations:[] });
      variantMap.get(path)!.count++;
      variantMap.get(path)!.durations.push(dur);
    }

    const variants: ProcessVariant[] = [...variantMap.entries()].map(([path, data], i) => ({
      id:uuidv4(), activities:path.split(" → "), frequency:data.count,
      avgDuration:data.durations.reduce((s,d)=>s+d,0)/(data.durations.length||1),
      isIdeal:i===0 && data.count >= Math.max(...[...variantMap.values()].map(v=>v.count)),
    })).sort((a,b) => b.frequency-a.frequency);

    // Detect bottlenecks (activities with long wait times)
    const activityTimes = new Map<string, number[]>();
    for (const events of cases) {
      for (const e of events) {
        if (!activityTimes.has(e.activity)) activityTimes.set(e.activity, []);
        activityTimes.get(e.activity)!.push(e.duration ?? 0);
      }
    }
    const bottlenecks: Bottleneck[] = [...activityTimes.entries()]
      .filter(([,times]) => { const avg = times.reduce((s,t)=>s+t,0)/(times.length||1); return avg > 3600000; })
      .map(([activity, times]) => ({
        activity, avgWaitMs:Math.round(times.reduce((s,t)=>s+t,0)/times.length),
        frequency:times.length,
        impact: times.reduce((s,t)=>s+t,0)/times.length > 86400000 ? "critical" : "high",
        recommendation:`Automate or streamline "${activity}" — avg wait ${Math.round(times.reduce((s,t)=>s+t,0)/times.length/3600000)}h`,
      }));

    const totalDuration = variants.reduce((s,v)=>s+v.avgDuration*v.frequency,0);
    const totalCases    = variants.reduce((s,v)=>s+v.frequency,0);
    const avgDuration   = totalCases > 0 ? totalDuration/totalCases : 0;
    const driftScore    = Math.min(100, (variants.length - 1) * 10);   // more variants = more drift
    const efficiency    = Math.max(0, 100 - driftScore - bottlenecks.length * 10);

    return {
      id:uuidv4(), tenantId:this.tenantId, name:processName, variants,
      avgDuration, frequency:Math.round(totalCases/4),
      bottlenecks, driftScore, efficiency, discoveredAt:new Date().toISOString(),
    };
  }

  detectDrift(processName: string, idealPath: string[]): DriftReport {
    const allEvents = eventLog.get(this.tenantId) ?? [];
    const cases     = this.groupByCases(allEvents);
    const deviations: ProcessDeviation[] = [];

    for (const caseEvents of cases) {
      const sorted    = caseEvents.sort((a,b) => a.timestamp.localeCompare(b.timestamp));
      const actualPath = sorted.map(e => e.activity);
      const deviationPoint = idealPath.find((act, i) => actualPath[i] !== act);
      if (deviationPoint) {
        deviations.push({ caseId:sorted[0].caseId, expectedPath:idealPath, actualPath, deviationPoint, impact:"Governance process drift detected" });
      }
    }

    const driftScore = Math.min(100, Math.round((deviations.length / Math.max(1, cases.length)) * 100));
    return {
      processName, tenantId:this.tenantId, driftScore, deviations,
      trend: driftScore > 50 ? "deteriorating" : driftScore > 20 ? "stable" : "improving",
      generatedAt:new Date().toISOString(),
    };
  }

  checkConformance(processName: string, rules: Array<{rule:string; check:(path:string[])=>boolean}>): ConformanceReport {
    const allEvents = eventLog.get(this.tenantId) ?? [];
    const cases     = this.groupByCases(allEvents);
    const violations: ConformanceViolation[] = [];
    let compliant = 0;

    for (const caseEvents of cases) {
      const path = caseEvents.sort((a,b)=>a.timestamp.localeCompare(b.timestamp)).map(e=>e.activity);
      let caseViolated = false;
      for (const r of rules) {
        if (!r.check(path)) {
          violations.push({ caseId:caseEvents[0].caseId, rule:r.rule, description:`Rule "${r.rule}" violated in case ${caseEvents[0].caseId}`, severity:"high" });
          caseViolated = true;
        }
      }
      if (!caseViolated) compliant++;
    }
    return { processName, tenantId:this.tenantId, conformanceScore:Math.round((compliant/Math.max(1,cases.length))*100), violations, compliantCases:compliant, totalCases:cases.length };
  }

  analyzeFriction(): FrictionReport {
    const allEvents = eventLog.get(this.tenantId) ?? [];
    const activityMap = new Map<string, number[]>();
    for (const e of allEvents) {
      if (!activityMap.has(e.activity)) activityMap.set(e.activity, []);
      activityMap.get(e.activity)!.push(e.duration ?? 0);
    }

    const frictionPoints: FrictionPoint[] = [...activityMap.entries()]
      .filter(([,durs]) => durs.reduce((s,d)=>s+d,0)/durs.length > 1800000)  // avg > 30min
      .map(([activity, durs]) => {
        const avgMs = durs.reduce((s,d)=>s+d,0)/durs.length;
        return { activity, frictionType:"wait" as const, occurrences:durs.length, wasteHours:Math.round(avgMs*durs.length/3600000), priority: avgMs > 86400000 ? "critical" : "high" as const };
      });

    const totalWaste = frictionPoints.reduce((s,p)=>s+p.wasteHours,0);
    const overallFriction = Math.min(100, frictionPoints.length * 15);

    return {
      tenantId:this.tenantId, generatedAt:new Date().toISOString(), overallFrictionScore:overallFriction,
      frictionPoints:frictionPoints.slice(0,5), estimatedWasteHours:totalWaste,
      recommendations:frictionPoints.slice(0,3).map(fp=>`Automate "${fp.activity}" — ${fp.wasteHours}h waste/cycle`),
    };
  }

  private groupByCases(events: ProcessEvent[]): ProcessEvent[][] {
    const map = new Map<string, ProcessEvent[]>();
    for (const e of events.filter(e=>e.tenantId===this.tenantId)) {
      if (!map.has(e.caseId)) map.set(e.caseId, []);
      map.get(e.caseId)!.push(e);
    }
    return [...map.values()];
  }
}

const pmCache = new Map<string, ProcessMiningEngine>();
export function getProcessMiningEngine(tenantId: string): ProcessMiningEngine {
  if (!pmCache.has(tenantId)) pmCache.set(tenantId, new ProcessMiningEngine(tenantId));
  return pmCache.get(tenantId)!;
}
