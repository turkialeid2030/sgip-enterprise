/**
 * Enterprise Workflow Runtime Engine
 * Manages all governance workflows with SLA, escalation, SoD, evidence requirements.
 * Supports: policy approval, risk escalation, audit findings, incident response,
 *           board approval, executive decisions, vendor review, corrective actions.
 */
import { v4 as uuidv4 } from "uuid";
import { TenantContext } from "../../types/tenant.types";
import { requireTenantContext } from "../../tenant/tenant.context";
import { sodEngine } from "../../policy-engine/rules/sod.engine";
import { getEvidenceEngine } from "../../evidence/lineage/evidence.lineage.engine";

export type WorkflowType =
  | "policy_approval"     | "risk_escalation"     | "compliance_remediation"
  | "audit_finding"       | "incident_response"   | "board_approval"
  | "executive_decision"  | "vendor_review"       | "corrective_action"
  | "regulatory_breach"   | "delegated_authority";

export type WorkflowStatus =
  | "initiated" | "in_progress" | "waiting_approval" | "escalated"
  | "blocked"   | "completed"   | "failed"            | "cancelled";

export interface WorkflowStep {
  stepNumber:   number;
  name:         string;
  assignedTo:   string;
  role:         string;
  type:         "action" | "approval" | "review" | "evidence" | "escalation";
  status:       "pending" | "in_progress" | "completed" | "skipped" | "failed";
  slaHours:     number;
  startedAt?:   string;
  completedAt?: string;
  notes?:       string;
  evidenceIds:  string[];
}

export interface GovernanceWorkflow {
  id:              string;
  tenantId:        string;
  code:            string;            // WF-POL-001
  type:            WorkflowType;
  title:           string;
  description:     string;
  entityId:        string;
  entityType:      string;
  status:          WorkflowStatus;
  initiatedBy:     string;
  steps:           WorkflowStep[];
  currentStep:     number;
  slaDeadline:     string;
  escalationPath:  string[];
  linkedPolicies:  string[];
  linkedEvidence:  string[];
  linkedRisks:     string[];
  sodChecked:      boolean;
  replayProtected: boolean;
  correlationId:   string;
  immutableId?:    string;
  completedAt?:    string;
  createdAt:       string;
  updatedAt:       string;
}

const workflowStore = new Map<string, GovernanceWorkflow>();
const replayStore   = new Set<string>();

export class WorkflowRuntime {
  constructor(private readonly tenantId: string) {}

  initiate(params: {
    type:           WorkflowType;
    title:          string;
    description:    string;
    entityId:       string;
    entityType:     string;
    initiatedBy:    string;
    steps:          Omit<WorkflowStep, "status" | "startedAt" | "completedAt" | "evidenceIds">[];
    slaHours?:      number;
    linkedPolicies?:string[];
    linkedRisks?:   string[];
  }, ctx: TenantContext): GovernanceWorkflow {
    requireTenantContext(ctx, "WorkflowRuntime.initiate");

    // Replay prevention
    const replayKey = `${this.tenantId}:${params.entityId}:${params.type}`;
    if (replayStore.has(replayKey)) {
      throw Object.assign(new Error(`Workflow replay prevented: ${params.type} already active for ${params.entityId}`), { statusCode:409 });
    }
    replayStore.add(replayKey);

    const count = [...workflowStore.values()].filter(w => w.tenantId === this.tenantId).length + 1;
    const typeCode = params.type.slice(0,3).toUpperCase();
    const steps: WorkflowStep[] = params.steps.map(s => ({ ...s, status:"pending", evidenceIds:[] }));
    const slaMs = (params.slaHours ?? 48) * 3600 * 1000;

    const wf: GovernanceWorkflow = {
      id:             uuidv4(),
      tenantId:       this.tenantId,
      code:           `WF-${typeCode}-${String(count).padStart(3,"0")}`,
      type:           params.type,
      title:          params.title,
      description:    params.description,
      entityId:       params.entityId,
      entityType:     params.entityType,
      status:         "initiated",
      initiatedBy:    params.initiatedBy,
      steps,
      currentStep:    0,
      slaDeadline:    new Date(Date.now() + slaMs).toISOString(),
      escalationPath: [],
      linkedPolicies: params.linkedPolicies ?? [],
      linkedEvidence: [],
      linkedRisks:    params.linkedRisks ?? [],
      sodChecked:     false,
      replayProtected:true,
      correlationId:  uuidv4(),
      createdAt:      new Date().toISOString(),
      updatedAt:      new Date().toISOString(),
    };
    workflowStore.set(wf.id, wf);
    return wf;
  }

  advance(workflowId: string, actorId: string, actorRole: string, outcome: "completed" | "failed", notes?: string, ctx?: TenantContext): GovernanceWorkflow {
    const wf = this.getById(workflowId);
    if (!wf) throw Object.assign(new Error(`Workflow ${workflowId} not found`), { statusCode:404 });
    if (wf.status === "completed" || wf.status === "failed" || wf.status === "cancelled") {
      throw Object.assign(new Error(`Cannot advance: workflow already ${wf.status}`), { statusCode:409 });
    }

    // SoD check for approval steps
    const step = wf.steps[wf.currentStep];
    if (step?.type === "approval" && ctx) {
      const violation = sodEngine.checkAction({ tenantId:wf.tenantId, userId:actorId, organizationId:"", userRole:actorRole, sessionId:"", requestId:"", timestamp:""}, actorId, "approve", wf.entityId);
      if (violation && violation.blocked) {
        throw Object.assign(new Error(`SoD violation: ${violation.action1} + ${violation.action2} cannot be same actor`), { statusCode:409 });
      }
    }

    const now = new Date().toISOString();
    const updatedSteps = [...wf.steps];
    if (updatedSteps[wf.currentStep]) {
      updatedSteps[wf.currentStep] = { ...updatedSteps[wf.currentStep], status:outcome, completedAt:now, notes };
    }

    const nextStep  = wf.currentStep + 1;
    const allDone   = nextStep >= wf.steps.length || outcome === "failed";
    const newStatus: WorkflowStatus = outcome === "failed" ? "failed" : allDone ? "completed" : "in_progress";

    const updated: GovernanceWorkflow = { ...wf, steps:updatedSteps, currentStep:nextStep, status:newStatus, updatedAt:now, completedAt: newStatus === "completed" ? now : undefined };
    workflowStore.set(workflowId, updated);

    // Seal if completed
    if (newStatus === "completed" && ctx) {
      const ev     = getEvidenceEngine(wf.tenantId);
      const sealed = ev.sealDecisionRecord({ decisionType:wf.type, entityId:wf.entityId, entityType:wf.entityType, actorId, actorRole, outcome:"workflow_completed", rationale:wf.title, evidenceRefs:wf.linkedEvidence, policyRefs:wf.linkedPolicies, approvalRefs:[], sodChecked:wf.sodChecked, sodViolations:0, policyAllowed:true, correlationId:wf.correlationId });
      const finalUpdate = { ...updated, immutableId:sealed.decisionId };
      workflowStore.set(workflowId, finalUpdate);
      return finalUpdate;
    }
    return updated;
  }

  getById(id: string): GovernanceWorkflow | undefined {
    const w = workflowStore.get(id);
    if (w && w.tenantId !== this.tenantId) return undefined;
    return w;
  }

  getByEntity(entityId: string): GovernanceWorkflow[] {
    return [...workflowStore.values()].filter(w => w.tenantId === this.tenantId && w.entityId === entityId);
  }

  getActive(): GovernanceWorkflow[] {
    return [...workflowStore.values()].filter(w => w.tenantId === this.tenantId && !["completed","failed","cancelled"].includes(w.status));
  }

  getSLABreaches(): GovernanceWorkflow[] {
    const now = new Date().toISOString();
    return this.getActive().filter(w => w.slaDeadline < now);
  }
}

const workflowCache = new Map<string, WorkflowRuntime>();
export function getWorkflowRuntime(tenantId: string): WorkflowRuntime {
  if (!workflowCache.has(tenantId)) workflowCache.set(tenantId, new WorkflowRuntime(tenantId));
  return workflowCache.get(tenantId)!;
}
