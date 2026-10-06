/**
 * Execution Orchestration Engine — Phase 3
 * BPMN-style workflow execution with approval pipelines,
 * SLA monitoring, escalation, human-in-the-loop governance,
 * closed-loop execution and proof generation.
 */
import { v4 as uuidv4 } from "uuid";
import { getDurableEventBus } from "../../runtime/event-bus/durable.event.bus";
import { getRecoveryEngine } from "../../runtime/failure-recovery/failure.recovery.engine";

export type WFNodeType = "start" | "task" | "approval" | "decision" | "escalation" | "notification" | "end";
export type WFStatus   = "pending" | "active" | "waiting_approval" | "escalated" | "completed" | "failed" | "cancelled";
export type SLAStatus  = "on_track" | "at_risk" | "breached";

export interface WFNode {
  id:           string;
  type:         WFNodeType;
  name:         string;
  assignedTo?:  string;
  assignedRole?:string;
  slaHours:     number;
  inputData?:   Record<string, unknown>;
  outputData?:  Record<string, unknown>;
  status:       WFStatus;
  startedAt?:   string;
  completedAt?: string;
  notes?:       string;
  evidenceIds:  string[];
}

export interface WFDefinition {
  id:           string;
  tenantId:     string;
  name:         string;
  version:      string;
  category:     "governance" | "compliance" | "risk" | "audit" | "executive" | "vendor";
  nodes:        WFNode[];
  totalSLAHours:number;
  requiresEvidence:boolean;
  requiresSoD:  boolean;
  createdAt:    string;
}

export interface WFInstance {
  id:           string;
  tenantId:     string;
  definitionId: string;
  name:         string;
  entityId:     string;
  entityType:   string;
  status:       WFStatus;
  currentNodeIdx:number;
  initiatedBy:  string;
  nodes:        WFNode[];
  slaDeadline:  string;
  slaStatus:    SLAStatus;
  evidenceIds:  string[];
  executionLog: ExecutionLogEntry[];
  immutableProofId?:string;
  correlationId:string;
  startedAt:    string;
  completedAt?: string;
}

export interface ExecutionLogEntry {
  timestamp:  string;
  nodeId:     string;
  nodeName:   string;
  actorId:    string;
  action:     string;
  outcome:    "success" | "failure" | "escalated";
  notes?:     string;
}

export interface ExecutionProof {
  instanceId:     string;
  tenantId:       string;
  completedNodes: number;
  totalNodes:     number;
  evidenceCount:  number;
  executionLog:   ExecutionLogEntry[];
  slaCompliance:  boolean;
  generatedAt:    string;
  integrityHash:  string;
}

const defStore  = new Map<string, WFDefinition>();
const instStore = new Map<string, WFInstance>();
const proofStore= new Map<string, ExecutionProof>();

export class WorkflowOrchestrator {
  constructor(private readonly tenantId: string) {}

  defineWorkflow(params: Omit<WFDefinition, "id" | "tenantId" | "createdAt"> & { nodes: Array<Omit<WFNode, "id"> & { id?: string }> }): WFDefinition {
    const def: WFDefinition = { ...params as any, id:uuidv4(), tenantId:this.tenantId, createdAt:new Date().toISOString(), nodes: (params.nodes as any[]).map(n => ({...n, id:n.id ?? uuidv4()})) };
    defStore.set(def.id, def); return def;
  }

  async startInstance(params: {
    definitionId: string;
    entityId:     string;
    entityType:   string;
    initiatedBy:  string;
    inputData?:   Record<string, unknown>;
  }): Promise<WFInstance> {
    const def = defStore.get(params.definitionId);
    if (!def || def.tenantId !== this.tenantId) throw Object.assign(new Error("Workflow definition not found"), {statusCode:404});

    const now  = new Date().toISOString();
    const slaDeadline = new Date(Date.now() + def.totalSLAHours * 3600000).toISOString();
    const nodes = def.nodes.map(n => ({ ...n, id:uuidv4(), status:"pending" as WFStatus, evidenceIds:[] }));
    nodes[0].status    = "active";
    nodes[0].startedAt = now;

    const inst: WFInstance = {
      id: uuidv4(), tenantId:this.tenantId, definitionId:params.definitionId,
      name:def.name, entityId:params.entityId, entityType:params.entityType,
      status:"active", currentNodeIdx:0, initiatedBy:params.initiatedBy,
      nodes, slaDeadline, slaStatus:"on_track", evidenceIds:[], executionLog:[],
      correlationId:uuidv4(), startedAt:now,
    };
    instStore.set(inst.id, inst);

    const bus = getDurableEventBus(this.tenantId);
    await bus.publish({ topic:"workflow.started", payload:{ instanceId:inst.id, name:inst.name, entityId:params.entityId }, actorId:params.initiatedBy, actorRole:"system", correlationId:inst.correlationId });
    return inst;
  }

  async advanceNode(instanceId: string, actorId: string, outcome: "success" | "failure" | "escalated", notes?: string, evidenceId?: string): Promise<WFInstance> {
    const inst = instStore.get(instanceId);
    if (!inst || inst.tenantId !== this.tenantId) throw Object.assign(new Error("Instance not found"), {statusCode:404});
    if (inst.status === "completed" || inst.status === "failed") throw Object.assign(new Error(`Cannot advance: already ${inst.status}`), {statusCode:409});

    const node    = inst.nodes[inst.currentNodeIdx];
    const now     = new Date().toISOString();
    node.status   = outcome === "success" ? "completed" : outcome === "escalated" ? "escalated" : "failed";
    node.completedAt = now;
    node.notes    = notes;
    if (evidenceId) { node.evidenceIds.push(evidenceId); inst.evidenceIds.push(evidenceId); }

    inst.executionLog.push({ timestamp:now, nodeId:node.id, nodeName:node.name, actorId, action:node.type, outcome, notes });

    // SLA check
    inst.slaStatus = now > inst.slaDeadline ? "breached" : now > new Date(new Date(inst.slaDeadline).getTime() - 3600000).toISOString() ? "at_risk" : "on_track";

    if (outcome === "failure") {
      inst.status = "failed";
    } else if (outcome === "escalated") {
      inst.status = "escalated";
    } else {
      const nextIdx = inst.currentNodeIdx + 1;
      if (nextIdx >= inst.nodes.length) {
        inst.status      = "completed";
        inst.completedAt = now;
        // Generate execution proof
        await this.generateProof(inst);
      } else {
        inst.currentNodeIdx = nextIdx;
        inst.nodes[nextIdx].status    = "active";
        inst.nodes[nextIdx].startedAt = now;
        if (inst.nodes[nextIdx].type === "approval") inst.status = "waiting_approval";
      }
    }

    instStore.set(instanceId, inst);
    const bus = getDurableEventBus(this.tenantId);
    await bus.publish({ topic:`workflow.node.${outcome}`, payload:{ instanceId, nodeId:node.id, nodeName:node.name, outcome }, actorId, actorRole:"system", correlationId:inst.correlationId });
    return inst;
  }

  private async generateProof(inst: WFInstance): Promise<ExecutionProof> {
    const { createHash } = await import("crypto");
    const hash  = createHash("sha256").update(JSON.stringify(inst.executionLog)).digest("hex").slice(0, 24);
    const proof: ExecutionProof = {
      instanceId:     inst.id,
      tenantId:       this.tenantId,
      completedNodes: inst.nodes.filter(n => n.status === "completed").length,
      totalNodes:     inst.nodes.length,
      evidenceCount:  inst.evidenceIds.length,
      executionLog:   inst.executionLog,
      slaCompliance:  inst.slaStatus !== "breached",
      generatedAt:    new Date().toISOString(),
      integrityHash:  hash,
    };
    Object.freeze(proof);
    proofStore.set(inst.id, proof);
    inst.immutableProofId = proof.integrityHash;
    return proof;
  }

  checkSLABreaches(): WFInstance[] {
    const now = new Date().toISOString();
    return [...instStore.values()].filter(i =>
      i.tenantId === this.tenantId && !["completed","failed","cancelled"].includes(i.status) && i.slaDeadline < now
    );
  }

  getInstance(id: string): WFInstance | undefined {
    const i = instStore.get(id);
    return i?.tenantId === this.tenantId ? i : undefined;
  }

  getProof(instanceId: string): ExecutionProof | undefined {
    return proofStore.get(instanceId);
  }

  getActive(): WFInstance[] {
    return [...instStore.values()].filter(i => i.tenantId === this.tenantId && !["completed","failed","cancelled"].includes(i.status));
  }
}

const orchCache = new Map<string, WorkflowOrchestrator>();
export function getOrchestrator(tenantId: string): WorkflowOrchestrator {
  if (!orchCache.has(tenantId)) orchCache.set(tenantId, new WorkflowOrchestrator(tenantId));
  return orchCache.get(tenantId)!;
}
