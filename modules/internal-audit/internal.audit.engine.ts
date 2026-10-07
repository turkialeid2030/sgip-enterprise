/**
 * Internal Audit Engine
 * Full audit lifecycle: planning → execution → findings → remediation → opinions.
 * Every finding is immutable. Evidence is locked at audit close.
 */
import { v4 as uuidv4 } from "uuid";
import { TenantContext } from "../../types/tenant.types";
import { requireTenantContext } from "../../tenant/tenant.context";
import { getEvidenceEngine } from "../../evidence/lineage/evidence.lineage.engine";
import { getEvidenceHub } from "../evidence-hub/evidence.hub";

export type AuditStatus = "planning" | "fieldwork" | "review" | "findings_issued" | "remediation" | "closed";
export type FindingSeverity = "critical" | "high" | "medium" | "low" | "informational";
export type FindingStatus = "open" | "in_remediation" | "management_response" | "closed" | "accepted_risk";

export interface AuditEngagement {
  id:              string;
  tenantId:        string;
  code:            string;               // AUD-2025-001
  title:           string;
  scope:           string[];             // entity IDs in scope
  auditType:       "internal" | "external" | "regulatory" | "it_audit" | "financial" | "operational";
  status:          AuditStatus;
  leadAuditor:     string;
  team:            string[];
  entityIds:       string[];             // what is being audited
  frameworkIds:    string[];             // compliance frameworks
  plannedStartAt:  string;
  plannedEndAt:    string;
  actualStartAt?:  string;
  closedAt?:       string;
  findings:        AuditFinding[];
  assuranceOpinion?:string;
  overallRating:   "adequate" | "improvement_needed" | "significant_concerns" | "inadequate" | "not_rated";
  evidenceIds:     string[];
  correlationId:   string;
  immutableId?:    string;
  createdAt:       string;
  updatedAt:       string;
}

export interface AuditFinding {
  id:              string;
  engagementId:    string;
  tenantId:        string;
  code:            string;               // AUD-F-001
  title:           string;
  description:     string;
  severity:        FindingSeverity;
  status:          FindingStatus;
  controlId?:      string;
  rootCause:       string;
  recommendation:  string;
  managementResponse?: string;
  targetRemediationDate?: string;
  closedAt?:       string;
  evidenceIds:     string[];
  isImmutable:     boolean;              // locked when audit closed
  raisedBy:        string;
  raisedAt:        string;
  updatedAt:       string;
}

const engagementStore = new Map<string, AuditEngagement>();
const findingStore    = new Map<string, AuditFinding>();

export class InternalAuditEngine {
  constructor(private readonly tenantId: string) {}

  planEngagement(params: Omit<AuditEngagement, "id" | "tenantId" | "code" | "status" | "findings" | "overallRating" | "evidenceIds" | "correlationId" | "createdAt" | "updatedAt">, ctx: TenantContext): AuditEngagement {
    requireTenantContext(ctx, "InternalAuditEngine.planEngagement");
    const count = [...engagementStore.values()].filter(e => e.tenantId === this.tenantId).length + 1;
    const now   = new Date().toISOString();
    const eng: AuditEngagement = {
      ...params,
      id:           uuidv4(),
      tenantId:     this.tenantId,
      code:         `AUD-${new Date().getFullYear()}-${String(count).padStart(3,"0")}`,
      status:       "planning",
      findings:     [],
      overallRating:"not_rated",
      evidenceIds:  [],
      correlationId:uuidv4(),
      createdAt:    now,
      updatedAt:    now,
    };
    engagementStore.set(eng.id, eng);
    return eng;
  }

  raiseFinding(params: {
    engagementId:  string;
    title:         string;
    description:   string;
    severity:      FindingSeverity;
    controlId?:    string;
    rootCause:     string;
    recommendation:string;
    raisedBy:      string;
    targetDate?:   string;
  }, ctx: TenantContext): AuditFinding {
    requireTenantContext(ctx, "InternalAuditEngine.raiseFinding");
    const eng = engagementStore.get(params.engagementId);
    if (!eng || eng.tenantId !== this.tenantId) throw Object.assign(new Error("Engagement not found"), { statusCode:404 });

    const findingCount = eng.findings.length + 1;
    const now          = new Date().toISOString();
    const finding: AuditFinding = {
      id:              uuidv4(),
      engagementId:    params.engagementId,
      tenantId:        this.tenantId,
      code:            `${eng.code}-F${String(findingCount).padStart(2,"0")}`,
      title:           params.title,
      description:     params.description,
      severity:        params.severity,
      status:          "open",
      controlId:       params.controlId,
      rootCause:       params.rootCause,
      recommendation:  params.recommendation,
      targetRemediationDate: params.targetDate,
      evidenceIds:     [],
      isImmutable:     false,
      raisedBy:        params.raisedBy,
      raisedAt:        now,
      updatedAt:       now,
    };
    findingStore.set(finding.id, finding);

    // Update engagement
    eng.findings.push(finding);
    eng.updatedAt = now;
    engagementStore.set(params.engagementId, eng);

    return finding;
  }

  closeEngagement(engagementId: string, assuranceOpinion: string, rating: AuditEngagement["overallRating"], ctx: TenantContext): AuditEngagement {
    requireTenantContext(ctx, "InternalAuditEngine.closeEngagement");
    const eng = engagementStore.get(engagementId);
    if (!eng || eng.tenantId !== this.tenantId) throw Object.assign(new Error("Engagement not found"), { statusCode:404 });

    // Lock all findings — make them immutable (update both store and engagement array)
    const updatedFindings = eng.findings.map(f => {
      const finding = findingStore.get(f.id);
      const immutableFinding = finding ? { ...finding, isImmutable:true, updatedAt:new Date().toISOString() } : { ...f, isImmutable:true, updatedAt:new Date().toISOString() };
      if (finding) findingStore.set(f.id, immutableFinding);
      return immutableFinding;
    });

    // Seal evidence record
    const ev     = getEvidenceEngine(this.tenantId);
    const sealed = ev.sealDecisionRecord({ decisionType:"audit_closure", entityId:engagementId, entityType:"audit", actorId:ctx.userId, actorRole:ctx.userRole, outcome:rating, rationale:assuranceOpinion, evidenceRefs:eng.evidenceIds, policyRefs:eng.frameworkIds, approvalRefs:[], sodChecked:false, sodViolations:0, policyAllowed:true, correlationId:eng.correlationId });

    const updated: AuditEngagement = { ...eng, findings:updatedFindings, status:"closed", assuranceOpinion, overallRating:rating, closedAt:new Date().toISOString(), immutableId:sealed.decisionId, updatedAt:new Date().toISOString() };
    engagementStore.set(engagementId, updated);
    return updated;
  }

  getEngagement(id: string): AuditEngagement | undefined {
    const e = engagementStore.get(id);
    if (e && e.tenantId !== this.tenantId) return undefined;
    return e;
  }

  getAll(): AuditEngagement[] {
    return [...engagementStore.values()].filter(e => e.tenantId === this.tenantId);
  }

  getOpenFindings(severity?: FindingSeverity): AuditFinding[] {
    return [...findingStore.values()].filter(f =>
      f.tenantId === this.tenantId && f.status === "open" && (!severity || f.severity === severity)
    );
  }
}

const auditCache = new Map<string, InternalAuditEngine>();
export function getAuditEngine(tenantId: string): InternalAuditEngine {
  if (!auditCache.has(tenantId)) auditCache.set(tenantId, new InternalAuditEngine(tenantId));
  return auditCache.get(tenantId)!;
}
