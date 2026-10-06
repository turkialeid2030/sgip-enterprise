/**
 * GRC Flow Engine — Operational Governance Runtime
 * The closed-loop governance cycle:
 *   Business Goals → Governance → Policies → Risks → Controls
 *   → Evidence → Testing → Monitoring → Assurance → Executive Reporting
 *   → Board Oversight → Remediation → Retesting → Closure
 *
 * Every step is: graph-linked, evidence-backed, observable, immutable, tenant-isolated.
 */
import { v4 as uuidv4 } from "uuid";
import { TenantContext } from "../../types/tenant.types";
import { requireTenantContext } from "../../tenant/tenant.context";
import { getGraphRuntime } from "../../graph/runtime/governance.graph.runtime";
import { getEvidenceEngine } from "../../evidence/lineage/evidence.lineage.engine";
import { getWorkflowRuntime } from "../workflows/workflow.runtime";

export type GRCFlowStage =
  | "business_goals"      | "governance_ownership" | "policy_definition"
  | "risk_identification"  | "risk_assessment"      | "control_setup"
  | "evidence_collection"  | "control_testing"      | "monitoring"
  | "assurance"            | "executive_reporting"  | "board_oversight"
  | "remediation"          | "retesting"            | "closure";

export const GRC_STAGE_ORDER: GRCFlowStage[] = [
  "business_goals", "governance_ownership", "policy_definition",
  "risk_identification", "risk_assessment", "control_setup",
  "evidence_collection", "control_testing", "monitoring",
  "assurance", "executive_reporting", "board_oversight",
  "remediation", "retesting", "closure",
];

export interface GRCFlowItem {
  id:              string;
  tenantId:        string;
  code:            string;              // GRC-2025-001
  title:           string;
  description:     string;
  currentStage:    GRCFlowStage;
  stageHistory:    StageTransition[];
  linkedEntityId:  string;
  linkedEntityType:string;
  ownerId:         string;
  ownerRole:       string;
  priority:        "critical" | "high" | "medium" | "low";
  status:          "active" | "blocked" | "completed" | "archived";
  graphNodeId?:    string;
  evidenceIds:     string[];
  workflowId?:     string;
  correlationId:   string;
  startedAt:       string;
  completedAt?:    string;
  updatedAt:       string;
}

export interface StageTransition {
  from:            GRCFlowStage | null;
  to:              GRCFlowStage;
  transitionedBy:  string;
  transitionedAt:  string;
  notes?:          string;
  evidenceRef?:    string;
  approvalRef?:    string;
}

export interface GRCFlowMetrics {
  tenantId:          string;
  activeItems:       number;
  completedItems:    number;
  blockedItems:      number;
  avgCycleTimeDays:  number;
  byStage:           Record<GRCFlowStage, number>;
  byPriority:        Record<string, number>;
  bottleneckStage?:  GRCFlowStage;
  generatedAt:       string;
}

const flowStore = new Map<string, GRCFlowItem>();

export class GRCFlowEngine {
  constructor(private readonly tenantId: string) {}

  initiate(params: {
    title:           string;
    description:     string;
    linkedEntityId:  string;
    linkedEntityType:string;
    ownerId:         string;
    ownerRole:       string;
    priority:        GRCFlowItem["priority"];
  }, ctx: TenantContext): GRCFlowItem {
    requireTenantContext(ctx, "GRCFlowEngine.initiate");
    const count = [...flowStore.values()].filter(f => f.tenantId === this.tenantId).length + 1;
    const now   = new Date().toISOString();
    const item: GRCFlowItem = {
      id:              uuidv4(),
      tenantId:        this.tenantId,
      code:            `GRC-${new Date().getFullYear()}-${String(count).padStart(4,"0")}`,
      title:           params.title,
      description:     params.description,
      currentStage:    "business_goals",
      stageHistory:    [{ from:null, to:"business_goals", transitionedBy:ctx.userId, transitionedAt:now }],
      linkedEntityId:  params.linkedEntityId,
      linkedEntityType:params.linkedEntityType,
      ownerId:         params.ownerId,
      ownerRole:       params.ownerRole,
      priority:        params.priority,
      status:          "active",
      evidenceIds:     [],
      correlationId:   uuidv4(),
      startedAt:       now,
      updatedAt:       now,
    };
    flowStore.set(item.id, item);

    // Register in graph
    const graph = getGraphRuntime(this.tenantId);
    graph.upsertNode({ id:item.id, type:"workflow", label:item.title, properties:{ stage:item.currentStage, priority:item.priority, status:item.status } });
    return item;
  }

  advance(flowId: string, notes: string, evidenceRef: string | undefined, ctx: TenantContext): GRCFlowItem {
    requireTenantContext(ctx, "GRCFlowEngine.advance");
    const item = flowStore.get(flowId);
    if (!item || item.tenantId !== this.tenantId) throw Object.assign(new Error(`GRC Flow ${flowId} not found`), { statusCode:404 });
    if (item.status === "completed") throw Object.assign(new Error("Flow already completed"), { statusCode:409 });

    const currentIdx = GRC_STAGE_ORDER.indexOf(item.currentStage);
    const nextStage  = GRC_STAGE_ORDER[currentIdx + 1];
    const now        = new Date().toISOString();

    const transition: StageTransition = { from:item.currentStage, to:nextStage ?? item.currentStage, transitionedBy:ctx.userId, transitionedAt:now, notes, evidenceRef };
    const updatedItem: GRCFlowItem = {
      ...item,
      currentStage: nextStage ?? item.currentStage,
      stageHistory: [...item.stageHistory, transition],
      evidenceIds:  evidenceRef ? [...item.evidenceIds, evidenceRef] : item.evidenceIds,
      status:       nextStage ? "active" : "completed",
      completedAt:  nextStage ? undefined : now,
      updatedAt:    now,
    };
    flowStore.set(flowId, updatedItem);

    // Attach evidence if provided
    if (evidenceRef) {
      const ev = getEvidenceEngine(this.tenantId);
      ev.createRecord({ entityId:flowId, entityType:"grc_flow", title:`Stage transition: ${item.currentStage} → ${nextStage}`, sourceType:"process_log", content:`${notes ?? ""}|evidence:${evidenceRef}`, collectedBy:ctx.userId, correlationId:item.correlationId });
    }

    return updatedItem;
  }

  getById(id: string): GRCFlowItem | undefined {
    const f = flowStore.get(id);
    if (f && f.tenantId !== this.tenantId) return undefined;
    return f;
  }

  getAll(stage?: GRCFlowStage): GRCFlowItem[] {
    return [...flowStore.values()].filter(f =>
      f.tenantId === this.tenantId && (!stage || f.currentStage === stage)
    );
  }

  getMetrics(): GRCFlowMetrics {
    const all        = this.getAll();
    const byStage    = {} as Record<GRCFlowStage, number>;
    const byPriority = {} as Record<string, number>;
    for (const s of GRC_STAGE_ORDER) byStage[s] = 0;
    for (const item of all) {
      byStage[item.currentStage] = (byStage[item.currentStage] ?? 0) + 1;
      byPriority[item.priority]  = (byPriority[item.priority] ?? 0) + 1;
    }
    const completed     = all.filter(f => f.status === "completed");
    const avgCycleMs    = completed.length > 0
      ? completed.reduce((s,f) => s + (new Date(f.completedAt!).getTime() - new Date(f.startedAt).getTime()), 0) / completed.length
      : 0;
    const bottleneck    = GRC_STAGE_ORDER.reduce((a, s) => (byStage[s] > byStage[a] ? s : a), "monitoring" as GRCFlowStage);

    return { tenantId:this.tenantId, activeItems: all.filter(f=>f.status==="active").length, completedItems:completed.length, blockedItems:all.filter(f=>f.status==="blocked").length, avgCycleTimeDays: Math.round(avgCycleMs/86400000), byStage, byPriority, bottleneckStage:byStage[bottleneck]>0?bottleneck:undefined, generatedAt:new Date().toISOString() };
  }
}

const grcCache = new Map<string, GRCFlowEngine>();
export function getGRCFlowEngine(tenantId: string): GRCFlowEngine {
  if (!grcCache.has(tenantId)) grcCache.set(tenantId, new GRCFlowEngine(tenantId));
  return grcCache.get(tenantId)!;
}
