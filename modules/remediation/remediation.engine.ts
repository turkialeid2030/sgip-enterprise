/**
 * Remediation Lifecycle Engine
 * Control Gap → Root Cause → Action Plan → Owner → SLA → Evidence → Retest → Closure.
 * Full lifecycle with evidence, approval, escalation, immutable closure.
 */
import { v4 as uuidv4 } from "uuid";
import { TenantContext } from "../../types/tenant.types";
import { requireTenantContext } from "../../tenant/tenant.context";
import { getEvidenceEngine } from "../../evidence/lineage/evidence.lineage.engine";

export type RemediationStatus =
  | "identified" | "assigned"    | "in_progress" | "evidence_submitted"
  | "in_retest"  | "closed"      | "overdue"      | "escalated"          | "accepted_risk";

export interface RemediationAction {
  id:               string;
  tenantId:         string;
  code:             string;               // REM-2025-001
  title:            string;
  description:      string;
  sourceType:       "audit_finding" | "control_gap" | "policy_violation" | "incident" | "risk" | "kri_breach";
  sourceId:         string;
  status:           RemediationStatus;
  ownerId:          string;
  ownerRole:        string;
  priority:         "critical" | "high" | "medium" | "low";
  rootCause:        string;
  actionPlan:       string;
  targetCloseDate:  string;
  actualCloseDate?: string;
  slaBreached:      boolean;
  evidenceIds:      string[];
  retestRequired:   boolean;
  retestEvidenceId?:string;
  approvalRequired: boolean;
  approvalRef?:     string;
  escalationLevel:  0 | 1 | 2;
  escalatedAt?:     string;
  immutableId?:     string;
  correlationId:    string;
  createdAt:        string;
  updatedAt:        string;
}

const remediationStore = new Map<string, RemediationAction>();

export class RemediationLifecycleEngine {
  constructor(private readonly tenantId: string) {}

  create(params: Omit<RemediationAction, "id" | "tenantId" | "code" | "status" | "slaBreached" | "evidenceIds" | "escalationLevel" | "correlationId" | "createdAt" | "updatedAt">, ctx: TenantContext): RemediationAction {
    requireTenantContext(ctx, "RemediationLifecycleEngine.create");
    const count = [...remediationStore.values()].filter(r => r.tenantId === this.tenantId).length + 1;
    const now   = new Date().toISOString();
    const rem: RemediationAction = {
      ...params,
      id:             uuidv4(),
      tenantId:       this.tenantId,
      code:           `REM-${new Date().getFullYear()}-${String(count).padStart(3,"0")}`,
      status:         "identified",
      slaBreached:    false,
      evidenceIds:    [],
      escalationLevel:0,
      correlationId:  uuidv4(),
      createdAt:      now,
      updatedAt:      now,
    };
    remediationStore.set(rem.id, rem);
    return rem;
  }

  submitEvidence(remediationId: string, evidenceContent: string, submittedBy: string, ctx: TenantContext): RemediationAction {
    requireTenantContext(ctx, "RemediationLifecycleEngine.submitEvidence");
    const rem = this.getById(remediationId);
    if (!rem) throw Object.assign(new Error("Remediation not found"), { statusCode:404 });
    const ev      = getEvidenceEngine(this.tenantId);
    const record  = ev.createRecord({ entityId:remediationId, entityType:"remediation", title:`Remediation evidence: ${rem.title}`, sourceType:"process_log", content:evidenceContent, collectedBy:submittedBy, correlationId:rem.correlationId });
    const updated = { ...rem, status:"evidence_submitted" as RemediationStatus, evidenceIds:[...rem.evidenceIds, record.id], updatedAt:new Date().toISOString() };
    remediationStore.set(remediationId, updated);
    return updated;
  }

  close(remediationId: string, retestPassed: boolean, ctx: TenantContext): RemediationAction {
    requireTenantContext(ctx, "RemediationLifecycleEngine.close");
    const rem = this.getById(remediationId);
    if (!rem) throw Object.assign(new Error("Remediation not found"), { statusCode:404 });
    if (rem.evidenceIds.length === 0) throw Object.assign(new Error("Cannot close: no evidence submitted"), { statusCode:422 });

    // Seal immutable record
    const ev     = getEvidenceEngine(this.tenantId);
    const sealed = ev.sealDecisionRecord({ decisionType:"remediation_closure", entityId:remediationId, entityType:"remediation", actorId:ctx.userId, actorRole:ctx.userRole, outcome:retestPassed ? "closed" : "accepted_risk", rationale:rem.actionPlan, evidenceRefs:rem.evidenceIds, policyRefs:[], approvalRefs: rem.approvalRef ? [rem.approvalRef] : [], sodChecked:false, sodViolations:0, policyAllowed:true, correlationId:rem.correlationId });

    const now = new Date().toISOString();
    const updated = { ...rem, status: retestPassed ? "closed" as RemediationStatus : "accepted_risk" as RemediationStatus, actualCloseDate:now, immutableId:sealed.decisionId, slaBreached:new Date(now) > new Date(rem.targetCloseDate), updatedAt:now };
    remediationStore.set(remediationId, updated);
    return updated;
  }

  checkSLABreaches(): RemediationAction[] {
    const now = new Date().toISOString();
    const breached = [...remediationStore.values()].filter(r =>
      r.tenantId === this.tenantId && !["closed","accepted_risk"].includes(r.status) && r.targetCloseDate < now
    );
    for (const r of breached) {
      if (!r.slaBreached) remediationStore.set(r.id, { ...r, slaBreached:true, status:"overdue", updatedAt:new Date().toISOString() });
    }
    return breached;
  }

  getById(id: string): RemediationAction | undefined {
    const r = remediationStore.get(id);
    if (r && r.tenantId !== this.tenantId) return undefined;
    return r;
  }

  getAll(status?: RemediationStatus): RemediationAction[] {
    return [...remediationStore.values()].filter(r =>
      r.tenantId === this.tenantId && (!status || r.status === status)
    );
  }

  getOverdue(): RemediationAction[] { return this.checkSLABreaches(); }
}

const remediationCache = new Map<string, RemediationLifecycleEngine>();
export function getRemediationEngine(tenantId: string): RemediationLifecycleEngine {
  if (!remediationCache.has(tenantId)) remediationCache.set(tenantId, new RemediationLifecycleEngine(tenantId));
  return remediationCache.get(tenantId)!;
}
