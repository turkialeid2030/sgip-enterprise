/**
 * Internal Audit Intelligence Runtime — Phase 9.1
 * Implements IIA Standards: risk-based audit planning, audit universe,
 * observations, issues, evidence, findings, and continuous auditing.
 *
 * IIA Three Lines Model:
 *   Line 1: Operational Management (controls execution)
 *   Line 2: Risk & Compliance (oversight)
 *   Line 3: Internal Audit (independent assurance)
 */
import { v4 as uuidv4 } from "uuid";
import * as crypto from "crypto";
import { getEventStore } from "../../runtime/persistence/persistent.event.store";
import { getRiskRuntime } from "../../risk-runtime/register/risk.intelligence.runtime";
import { getComplianceObligationRuntime } from "../../compliance-runtime/obligations/compliance.obligation.runtime";
import { getCCMRuntime } from "../../compliance-runtime/ccm/ccm.runtime";

export type AuditType = "internal_operational"|"internal_financial"|"internal_it"|"internal_compliance"|"internal_cyber"|"continuous";
export type AuditStatus = "planning"|"fieldwork"|"review"|"reporting"|"remediation_tracking"|"closed"|"deferred";
export type FindingSeverity = "critical"|"high"|"medium"|"low"|"informational";
export type FindingStatus = "open"|"management_agreed"|"in_progress"|"resolved"|"disputed"|"overdue";

export interface AuditUniverse {
  id:          string;
  tenantId:    string;
  name:        string;
  scope:       string[];           // entity types or business units
  riskRating:  "critical"|"high"|"medium"|"low";
  frequency:   "annual"|"biannual"|"quarterly"|"continuous";
  lastAuditAt?: string;
  nextScheduled:string;
  ownerId:     string;
  coverageScore:number;            // 0-100 — how well covered
  createdAt:   string;
}

export interface AuditEngagement {
  id:          string;
  tenantId:    string;
  code:        string;             // AUD-2025-001
  title:       string;
  type:        AuditType;
  status:      AuditStatus;
  universeId:  string;
  ownerId:     string;
  leadAuditorId:string;
  scope:       string;
  objectives:  string[];
  auditPeriodFrom:string;
  auditPeriodTo:string;
  planDate:    string;
  fieldworkDate?:string;
  reportDate?: string;
  closedDate?: string;
  findings:    AuditFinding[];
  evidenceIds: string[];
  readinessScore:number;           // 0-100
  createdAt:   string;
}

export interface AuditFinding {
  id:          string;
  tenantId:    string;
  engagementId:string;
  code:        string;             // FND-2025-001
  title:       string;
  observation: string;
  condition:   string;             // what exists
  criteria:    string;             // what should exist
  cause:       string;             // why gap exists
  effect:      string;             // risk/impact
  severity:    FindingSeverity;
  status:      FindingStatus;
  ownerId:     string;
  dueDate:     string;
  closedDate?: string;
  managementResponse?:string;
  evidenceIds: string[];
  hash:        string;             // immutable integrity
  createdAt:   string;
  updatedAt:   string;
}

export interface AuditReadinessScore {
  tenantId:    string;
  scoredAt:    string;
  overall:     number;             // 0-100
  dimensions: {
    universe_coverage:    number;
    evidence_sufficiency: number;
    finding_closure_rate: number;
    overdue_ratio:        number;
    continuous_coverage:  number;
  };
  openFindings:   number;
  criticalOpen:   number;
  overdueFindings:number;
  recommendations:string[];
}

export interface ContinuousAuditSignal {
  id:         string;
  tenantId:   string;
  signalType: "anomaly"|"policy_breach"|"control_failure"|"exception_detected"|"sod_violation";
  source:     string;
  description:string;
  severity:   FindingSeverity;
  autoFinding:boolean;           // triggers auto-finding creation
  detectedAt: string;
  evidenceRef?:string;
}

const universeStore    = new Map<string, AuditUniverse[]>();
const engagementStore  = new Map<string, AuditEngagement[]>();
const signalStore      = new Map<string, ContinuousAuditSignal[]>();
let   engSeq           = 0;
let   findSeq          = 0;

export class InternalAuditRuntime {
  constructor(private readonly tenantId: string) {}

  // ── Audit Universe Management ─────────────────────────────
  registerUniverseItem(params: Omit<AuditUniverse,"id"|"tenantId"|"coverageScore"|"createdAt">): AuditUniverse {
    const item: AuditUniverse = {
      ...params, id:uuidv4(), tenantId:this.tenantId,
      coverageScore: params.lastAuditAt ? 80 : 20,
      createdAt: new Date().toISOString(),
    };
    if (!universeStore.has(this.tenantId)) universeStore.set(this.tenantId, []);
    universeStore.get(this.tenantId)!.push(item);
    return item;
  }

  // ── Risk-Based Audit Planning ─────────────────────────────
  generateRiskBasedPlan(year: number): Array<{universeItemId:string;name:string;riskRating:string;scheduledFor:string;reason:string}> {
    const universe = this.getUniverse();
    const riskRuntime = getRiskRuntime(this.tenantId);
    const breaching   = riskRuntime.getBreachingTolerance().map(r=>r.category);

    return universe
      .sort((a,b) => {
        const riskOrder = {critical:4, high:3, medium:2, low:1};
        return riskOrder[b.riskRating] - riskOrder[a.riskRating];
      })
      .map((item, idx) => ({
        universeItemId: item.id,
        name:           item.name,
        riskRating:     item.riskRating,
        scheduledFor:   `${year}-${String(Math.min(12,(idx+1)*2)).padStart(2,"0")}-01`,
        reason:         item.riskRating === "critical" ? "Critical risk area — mandatory annual audit" :
                        breaching.some(b => item.scope.includes(b)) ? "Risk tolerance breached in this domain" :
                        "Routine risk-based scheduling",
      }));
  }

  // ── Audit Engagement Lifecycle ────────────────────────────
  openEngagement(params: {
    title:string; type:AuditType; universeId:string; ownerId:string;
    leadAuditorId:string; scope:string; objectives:string[];
    auditPeriodFrom:string; auditPeriodTo:string;
  }): AuditEngagement {
    engSeq++;
    const eng: AuditEngagement = {
      id:uuidv4(), tenantId:this.tenantId,
      code:`AUD-${new Date().getFullYear()}-${String(engSeq).padStart(3,"0")}`,
      ...params, status:"planning", findings:[], evidenceIds:[], readinessScore:30,
      planDate:new Date().toISOString(), createdAt:new Date().toISOString(),
    };
    if (!engagementStore.has(this.tenantId)) engagementStore.set(this.tenantId, []);
    engagementStore.get(this.tenantId)!.push(eng);
    getEventStore(this.tenantId).append({ topic:"audit.engagement.opened", payload:{ engId:eng.id, code:eng.code, type:params.type, scope:params.scope }, actorId:params.leadAuditorId, actorRole:"audit_lead" });
    return eng;
  }

  advanceEngagement(engId: string, newStatus: AuditEngagement["status"], actorId: string): AuditEngagement {
    const eng = this.getEngagement(engId);
    if (!eng) throw Object.assign(new Error("Engagement not found"), {statusCode:404});

    const validTransitions: Record<AuditStatus, AuditStatus[]> = {
      planning:["fieldwork","deferred"],
      fieldwork:["review"],
      review:["reporting"],
      reporting:["remediation_tracking","closed"],
      remediation_tracking:["closed"],
      closed:[], deferred:["planning"],
    };
    if (!validTransitions[eng.status].includes(newStatus)) {
      throw Object.assign(new Error(`Invalid transition: ${eng.status} → ${newStatus}`), {statusCode:422});
    }

    const dateField: Record<string, string> = { fieldwork:"fieldworkDate", closed:"closedDate", reporting:"reportDate" };
    const updates: Partial<AuditEngagement> = { status:newStatus, readinessScore: newStatus==="closed"?100 : newStatus==="reporting"?80 : newStatus==="review"?60 : 40 };
    if (dateField[newStatus]) (updates as any)[dateField[newStatus]] = new Date().toISOString();

    const idx = engagementStore.get(this.tenantId)!.findIndex(e=>e.id===engId);
    engagementStore.get(this.tenantId)![idx] = { ...eng, ...updates };
    getEventStore(this.tenantId).append({ topic:`audit.engagement.${newStatus}`, payload:{engId,code:eng.code,newStatus}, actorId, actorRole:"audit_lead" });
    return engagementStore.get(this.tenantId)![idx];
  }

  // ── Finding Management ────────────────────────────────────
  raiseFinding(params: {
    engagementId:string; title:string; observation:string;
    condition:string; criteria:string; cause:string; effect:string;
    severity:FindingSeverity; ownerId:string; dueDate:string;
  }): AuditFinding {
    const eng = this.getEngagement(params.engagementId);
    if (!eng) throw Object.assign(new Error("Engagement not found"), {statusCode:404});
    findSeq++;
    const now = new Date().toISOString();
    const hash = crypto.createHash("sha256").update(`${params.title}:${params.observation}:${now}`).digest("hex").slice(0,24);
    const finding: AuditFinding = {
      id:uuidv4(), tenantId:this.tenantId,
      code:`FND-${new Date().getFullYear()}-${String(findSeq).padStart(3,"0")}`,
      ...params, status:"open", evidenceIds:[], hash, createdAt:now, updatedAt:now,
    };
    const idx = engagementStore.get(this.tenantId)!.findIndex(e=>e.id===params.engagementId);
    engagementStore.get(this.tenantId)![idx].findings.push(finding);
    getEventStore(this.tenantId).append({ topic:`audit.finding.raised`, payload:{findingId:finding.id,code:finding.code,severity:params.severity,engId:params.engagementId}, actorId:params.ownerId, actorRole:"auditor" });
    if (params.severity === "critical") getEventStore(this.tenantId).append({ topic:"audit.finding.critical.escalation", payload:{findingId:finding.id,code:finding.code}, actorId:"system", actorRole:"system" });
    return finding;
  }

  resolveFinding(findingId: string, resolution: string, resolvedBy: string): AuditFinding | null {
    for (const engs of engagementStore.values()) {
      for (const eng of engs) {
        if (eng.tenantId !== this.tenantId) continue;
        const idx = eng.findings.findIndex(f=>f.id===findingId);
        if (idx >= 0) {
          eng.findings[idx] = { ...eng.findings[idx], status:"resolved", managementResponse:resolution, closedDate:new Date().toISOString(), updatedAt:new Date().toISOString() };
          getEventStore(this.tenantId).append({ topic:"audit.finding.resolved", payload:{findingId,resolution}, actorId:resolvedBy, actorRole:"management" });
          return eng.findings[idx];
        }
      }
    }
    return null;
  }

  // ── Continuous Auditing ───────────────────────────────────
  runContinuousAudit(): ContinuousAuditSignal[] {
    const ccm    = getCCMRuntime(this.tenantId);
    const signals: ContinuousAuditSignal[] = [];
    const now = new Date().toISOString();

    // Control failures
    for (const ctrl of ccm.getAllControls().filter(c=>c.status==="ineffective"||c.status==="override_detected")) {
      const sig: ContinuousAuditSignal = {
        id:uuidv4(), tenantId:this.tenantId,
        signalType: ctrl.status==="override_detected" ? "exception_detected" : "control_failure",
        source:"ccm_runtime", description:`${ctrl.controlCode}: ${ctrl.controlName} — ${ctrl.status}`,
        severity: ctrl.overrideDetected?"critical":"high",
        autoFinding:ctrl.overrideDetected, detectedAt:now,
      };
      signals.push(sig);
    }

    // SoD violations
    for (const viol of ccm.getSoDViolations()) {
      signals.push({ id:uuidv4(), tenantId:this.tenantId, signalType:"sod_violation", source:"ccm_runtime", description:viol.conflictDescription, severity:"critical", autoFinding:true, detectedAt:now });
    }

    // Compliance breaches
    const comp = getComplianceObligationRuntime(this.tenantId);
    for (const breach of comp.getBreached()) {
      signals.push({ id:uuidv4(), tenantId:this.tenantId, signalType:"policy_breach", source:"compliance_runtime", description:`Compliance breach: ${breach.title} (${breach.framework})`, severity:"high", autoFinding:false, detectedAt:now });
    }

    if (!signalStore.has(this.tenantId)) signalStore.set(this.tenantId, []);
    signalStore.get(this.tenantId)!.push(...signals);
    return signals;
  }

  scoreReadiness(): AuditReadinessScore {
    const universe   = this.getUniverse();
    const engs       = this.getEngagements();
    const allFindings= engs.flatMap(e=>e.findings).filter(f=>f.tenantId===this.tenantId);
    const open       = allFindings.filter(f=>f.status==="open"||f.status==="in_progress");
    const critOpen   = open.filter(f=>f.severity==="critical");
    const now        = new Date().toISOString();
    const overdue    = open.filter(f=>f.dueDate<now);

    const coverageScore  = universe.length>0 ? Math.round(universe.filter(u=>u.lastAuditAt).length/universe.length*100) : 0;
    const closureRate    = allFindings.length>0 ? Math.round(allFindings.filter(f=>f.status==="resolved").length/allFindings.length*100) : 0;
    const overdueRatio   = open.length>0 ? Math.round(overdue.length/open.length*100) : 0;
    const overdueHealth  = allFindings.length===0 ? 0 : open.length===0 ? 100 : 100-overdueRatio;
    const evidenceSuff   = engs.length>0 ? Math.round(engs.filter(e=>e.evidenceIds.length>0).length/engs.length*100) : 0;
    const continuousCoverage = (signalStore.get(this.tenantId) ?? []).length > 0 ? 70 : 0;

    const overall = Math.round((coverageScore*0.25)+(closureRate*0.20)+(overdueHealth*0.15)+(evidenceSuff*0.20)+(continuousCoverage*0.20));
    const recs: string[] = [];
    if (critOpen.length>0) recs.push(`${critOpen.length} critical findings open — board escalation required`);
    if (overdue.length>0)  recs.push(`${overdue.length} overdue findings — remediation urgency needed`);
    if (universe.length===0) recs.push("Audit universe is empty — readiness cannot be established");
    else if (coverageScore<50) recs.push("Audit universe coverage below 50% — expand audit program");
    if (engs.length===0) recs.push("No audit engagements recorded — readiness remains unproven");
    if (continuousCoverage===0) recs.push("Continuous audit monitoring is not evidenced");

    return { tenantId:this.tenantId, scoredAt:now, overall, dimensions:{ universe_coverage:coverageScore, evidence_sufficiency:evidenceSuff, finding_closure_rate:closureRate, overdue_ratio:overdueRatio, continuous_coverage:continuousCoverage }, openFindings:open.length, criticalOpen:critOpen.length, overdueFindings:overdue.length, recommendations:recs };
  }

  getUniverse():      AuditUniverse[]    { return universeStore.get(this.tenantId)   ?? []; }
  getEngagements():   AuditEngagement[]  { return (engagementStore.get(this.tenantId)??[]).filter(e=>e.tenantId===this.tenantId); }
  getEngagement(id:string): AuditEngagement|undefined { return this.getEngagements().find(e=>e.id===id); }
  getSignals():       ContinuousAuditSignal[] { return signalStore.get(this.tenantId) ?? []; }
  getAllFindings(severity?: FindingSeverity): AuditFinding[] {
    const all = this.getEngagements().flatMap(e=>e.findings).filter(f=>f.tenantId===this.tenantId);
    return severity ? all.filter(f=>f.severity===severity) : all;
  }
  getOpenFindings():  AuditFinding[] { return this.getAllFindings().filter(f=>f.status==="open"||f.status==="in_progress"); }
}

const auditCache = new Map<string,InternalAuditRuntime>();
export function getInternalAuditRuntime(tenantId:string): InternalAuditRuntime {
  if (!auditCache.has(tenantId)) auditCache.set(tenantId, new InternalAuditRuntime(tenantId));
  return auditCache.get(tenantId)!;
}
