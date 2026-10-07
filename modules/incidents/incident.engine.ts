/**
 * Incident Management Engine
 * Full incident lifecycle: detection → triage → investigation → resolution → closure.
 * Every incident is linked to: risks, controls, evidence, policies, regulations.
 */
import { v4 as uuidv4 } from "uuid";
import { TenantContext } from "../../types/tenant.types";
import { requireTenantContext } from "../../tenant/tenant.context";
import { getEvidenceEngine } from "../../evidence/lineage/evidence.lineage.engine";

export type IncidentSeverity = "critical" | "high" | "medium" | "low";
export type IncidentStatus   = "open" | "investigating" | "contained" | "remediated" | "closed" | "escalated";
export type IncidentCategory = "security" | "operational" | "compliance" | "governance" | "financial" | "reputational" | "data_breach" | "system_failure" | "fraud" | "regulatory";

export interface Incident {
  id:              string;
  tenantId:        string;
  code:            string;           // INC-2025-001
  title:           string;
  description:     string;
  category:        IncidentCategory;
  severity:        IncidentSeverity;
  status:          IncidentStatus;
  detectedAt:      string;
  reportedBy:      string;
  owner:           string;
  containedAt?:    string;
  resolvedAt?:     string;
  closedAt?:       string;
  rootCause?:      string;
  impactSummary:   string;
  linkedRisks:     string[];
  linkedControls:  string[];
  linkedEvidence:  string[];
  linkedPolicies:  string[];
  linkedRegulations:string[];
  capaIds:         string[];
  escalationLevel: 0 | 1 | 2 | 3;    // 0=standard, 3=board
  boardNotified:   boolean;
  regulatorNotified:boolean;
  correlationId:   string;
  immutableRecordId?:string;
  createdAt:       string;
  updatedAt:       string;
}

const incidentStore = new Map<string, Incident>();

export class IncidentEngine {
  constructor(private readonly tenantId: string) {}

  create(params: Omit<Incident, "id" | "tenantId" | "code" | "status" | "escalationLevel" | "boardNotified" | "regulatorNotified" | "correlationId" | "createdAt" | "updatedAt" | "capaIds">, ctx: TenantContext): Incident {
    requireTenantContext(ctx, "IncidentEngine.create");
    const count = [...incidentStore.values()].filter(i => i.tenantId === this.tenantId).length + 1;
    const inc: Incident = {
      ...params,
      id:               uuidv4(),
      tenantId:         this.tenantId,
      code:             `INC-${new Date().getFullYear()}-${String(count).padStart(3,"0")}`,
      status:           "open",
      escalationLevel:  0,
      boardNotified:    false,
      regulatorNotified:false,
      capaIds:          [],
      correlationId:    uuidv4(),
      createdAt:        new Date().toISOString(),
      updatedAt:        new Date().toISOString(),
    };
    incidentStore.set(inc.id, inc);

    // Auto-escalate critical incidents
    if (inc.severity === "critical") {
      const escalated = this.escalate(inc.id, ctx, "Auto-escalated: critical severity");
      // Seal evidence record (using post-escalation state)
      const ev = getEvidenceEngine(this.tenantId);
      ev.createRecord({ entityId:escalated.id, entityType:"incident", title:`Incident detected: ${escalated.title}`, sourceType:"system_log", content:`Incident ${escalated.code}: ${escalated.description}`, collectedBy:params.reportedBy, correlationId:escalated.correlationId });
      return escalated;
    }

    // Seal evidence record
    const ev = getEvidenceEngine(this.tenantId);
    ev.createRecord({ entityId:inc.id, entityType:"incident", title:`Incident detected: ${inc.title}`, sourceType:"system_log", content:`Incident ${inc.code}: ${inc.description}`, collectedBy:params.reportedBy, correlationId:inc.correlationId });

    return inc;
  }

  escalate(incidentId: string, ctx: TenantContext, reason: string): Incident {
    requireTenantContext(ctx, "IncidentEngine.escalate");
    const inc = incidentStore.get(incidentId);  // direct store access during create
    if (!inc || (inc.tenantId !== this.tenantId)) throw Object.assign(new Error(`Incident ${incidentId} not found`), { statusCode:404 });
    const updated: Incident = {
      ...inc,
      status:          "escalated",
      escalationLevel: Math.min(3, inc.escalationLevel + 1) as 0|1|2|3,
      boardNotified:   inc.escalationLevel >= 2,
      updatedAt:       new Date().toISOString(),
    };
    incidentStore.set(incidentId, updated);
    return updated;
  }

  close(incidentId: string, rootCause: string, ctx: TenantContext): Incident {
    requireTenantContext(ctx, "IncidentEngine.close");
    const inc = this.getById(incidentId);
    if (!inc) throw Object.assign(new Error(`Incident ${incidentId} not found`), { statusCode:404 });
    const ev = getEvidenceEngine(this.tenantId);
    const sealed = ev.sealDecisionRecord({ decisionType:"incident_closure", entityId:incidentId, entityType:"incident", actorId:ctx.userId, actorRole:ctx.userRole, outcome:"closed", rationale:rootCause, evidenceRefs:inc.linkedEvidence, policyRefs:inc.linkedPolicies, approvalRefs:[], sodChecked:false, sodViolations:0, policyAllowed:true, correlationId:inc.correlationId });
    const updated: Incident = { ...inc, status:"closed", rootCause, closedAt:new Date().toISOString(), immutableRecordId:sealed.decisionId, updatedAt:new Date().toISOString() };
    incidentStore.set(incidentId, updated);
    return updated;
  }

  getById(id: string): Incident | undefined {
    const i = incidentStore.get(id);
    if (i && i.tenantId !== this.tenantId) return undefined;
    return i;
  }

  findAll(status?: IncidentStatus, severity?: IncidentSeverity): Incident[] {
    return [...incidentStore.values()].filter(i =>
      i.tenantId === this.tenantId &&
      (!status   || i.status   === status) &&
      (!severity || i.severity === severity)
    );
  }

  getOpenByEscalation(): Incident[] {
    return this.findAll().filter(i => i.status !== "closed" && i.escalationLevel > 0);
  }
}

const incidentCache = new Map<string, IncidentEngine>();
export function getIncidentEngine(tenantId: string): IncidentEngine {
  if (!incidentCache.has(tenantId)) incidentCache.set(tenantId, new IncidentEngine(tenantId));
  return incidentCache.get(tenantId)!;
}
