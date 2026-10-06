/**
 * Governance Ontology Engine — SCEOS Layer A.2
 *
 * The enterprise's self-model. Defines WHAT governs WHAT, WHO owns WHAT,
 * HOW accountability flows, and WHERE the enterprise is healthy vs broken.
 *
 * This is not a dictionary. It is a live runtime taxonomy that:
 * - Knows every governance concept and its relationships
 * - Detects when relationships are broken (orphan governance)
 * - Infers accountability chains from incomplete records
 * - Generates governance questions the enterprise should be asking
 */
import { v4 as uuidv4 } from "uuid";
import { getSovereignMemory } from "../core/sovereign.memory.engine";

export type OntologyNodeType =
  | "business_goal"      | "strategy"         | "initiative"
  | "policy"             | "standard"          | "procedure"
  | "risk"               | "control"           | "evidence"
  | "obligation"         | "finding"           | "incident"
  | "remediation"        | "decision"          | "approval"
  | "executive"          | "committee"         | "board"
  | "stakeholder"        | "vendor"            | "regulator"
  | "ai_model"           | "process"           | "asset"
  | "kri"                | "kpi";

export type OntologyRelationType =
  | "GOVERNS"            | "IMPLEMENTS"        | "MITIGATES"
  | "OWNS"               | "APPROVES"          | "DELEGATES_TO"
  | "REPORTS_TO"         | "ESCALATES_TO"      | "EVIDENCES"
  | "VIOLATES"           | "DEPENDS_ON"        | "MAPS_TO"
  | "SUPERSEDES"         | "CONFLICTS_WITH"    | "TRIGGERS"
  | "INFORMS"            | "ACCOUNTABLE_FOR"   | "MONITORS";

export interface OntologyNode {
  id:           string;
  tenantId:     string;
  type:         OntologyNodeType;
  code:         string;
  label:        string;
  description:  string;
  ownerId?:     string;
  ownerRole?:   string;
  status:       "active" | "draft" | "deprecated" | "archived";
  properties:   Record<string, unknown>;
  createdAt:    string;
  updatedAt:    string;
}

export interface OntologyRelation {
  id:           string;
  tenantId:     string;
  type:         OntologyRelationType;
  fromId:       string;
  fromType:     OntologyNodeType;
  toId:         string;
  toType:       OntologyNodeType;
  strength:     number;      // 0-1
  bidirectional:boolean;
  evidenceRef?: string;
  createdAt:    string;
}

export interface AccountabilityChain {
  entityId:     string;
  entityType:   OntologyNodeType;
  chain:        AccountabilityLink[];
  isComplete:   boolean;
  gaps:         string[];
}

export interface AccountabilityLink {
  actorId:      string;
  actorType:    OntologyNodeType;
  role:         string;
  relation:     OntologyRelationType;
  depth:        number;
}

export interface GovernanceQuestion {
  id:           string;
  question:     string;
  category:     "accountability" | "evidence" | "risk" | "compliance" | "oversight";
  urgency:      "immediate" | "this_week" | "this_month";
  entityIds:    string[];
  insight:      string;
}

// ── Tenant-isolated stores ────────────────────────────────────
const nodeStore     = new Map<string, OntologyNode>();
const relationStore = new Map<string, OntologyRelation>();

// Indexes: tenantId:type → ids
const nodeTypeIdx   = new Map<string, Set<string>>();
const relFromIdx    = new Map<string, Set<string>>();
const relToIdx      = new Map<string, Set<string>>();

function idxNode(n: OntologyNode): void {
  const k = `${n.tenantId}:${n.type}`;
  if (!nodeTypeIdx.has(k)) nodeTypeIdx.set(k, new Set());
  nodeTypeIdx.get(k)!.add(n.id);
}
function idxRel(r: OntologyRelation): void {
  const fk = `${r.tenantId}:${r.fromId}`;
  const tk  = `${r.tenantId}:${r.toId}`;
  if (!relFromIdx.has(fk)) relFromIdx.set(fk, new Set());
  relFromIdx.get(fk)!.add(r.id);
  if (!relToIdx.has(tk)) relToIdx.set(tk, new Set());
  relToIdx.get(tk)!.add(r.id);
}

export class GovernanceOntologyEngine {
  constructor(private readonly tenantId: string) {}

  // ── Node operations ──────────────────────────────────────────
  upsertNode(params: Omit<OntologyNode, "id" | "tenantId" | "createdAt" | "updatedAt">): OntologyNode {
    // Find existing by code + tenant
    const existing = [...nodeStore.values()].find(n => n.tenantId === this.tenantId && n.code === params.code);
    const now = new Date().toISOString();
    if (existing && !Object.isFrozen(existing)) {
      const updated = { ...existing, ...params, updatedAt: now };
      nodeStore.set(existing.id, updated);
      return updated;
    }
    const node: OntologyNode = { ...params, id:uuidv4(), tenantId:this.tenantId, createdAt:now, updatedAt:now };
    nodeStore.set(node.id, node);
    idxNode(node);
    // Remember in sovereign memory
    getSovereignMemory(this.tenantId).remember({
      type:"semantic", subject:node.id, subjectType:node.type,
      content:`${node.type}: ${node.label} — ${node.description}`,
      context:{ actors:node.ownerId ? [node.ownerId] : [], affectedEntities:[], regulatoryRefs:[], policyRefs:[], timeframe:"ongoing", confidentiality:"internal" },
      sourceType:"system_event", importance:50, tags:[node.type, "ontology"],
      createdBy:"system",
    });
    return node;
  }

  addRelation(params: Omit<OntologyRelation, "id" | "tenantId" | "createdAt">): OntologyRelation {
    const rel: OntologyRelation = { ...params, id:uuidv4(), tenantId:this.tenantId, createdAt:new Date().toISOString() };
    relationStore.set(rel.id, rel);
    idxRel(rel);
    return rel;
  }

  getNode(id: string): OntologyNode | undefined {
    const n = nodeStore.get(id);
    return n?.tenantId === this.tenantId ? n : undefined;
  }

  getNodesByType(type: OntologyNodeType): OntologyNode[] {
    const ids = nodeTypeIdx.get(`${this.tenantId}:${type}`) ?? new Set();
    return [...ids].map(id => nodeStore.get(id)!).filter(Boolean);
  }

  getRelationsFrom(nodeId: string): OntologyRelation[] {
    const ids = relFromIdx.get(`${this.tenantId}:${nodeId}`) ?? new Set();
    return [...ids].map(id => relationStore.get(id)!).filter(r => r?.tenantId === this.tenantId);
  }

  getRelationsTo(nodeId: string): OntologyRelation[] {
    const ids = relToIdx.get(`${this.tenantId}:${nodeId}`) ?? new Set();
    return [...ids].map(id => relationStore.get(id)!).filter(r => r?.tenantId === this.tenantId);
  }

  // ── Accountability chain tracing ─────────────────────────────
  traceAccountability(entityId: string, maxDepth = 5): AccountabilityChain {
    const entity = this.getNode(entityId);
    if (!entity) return { entityId, entityType:"policy", chain:[], isComplete:false, gaps:["Entity not found"] };

    const chain: AccountabilityLink[] = [];
    const visited   = new Set<string>();
    const gaps:string[] = [];

    const traverse = (nodeId: string, depth: number) => {
      if (depth > maxDepth || visited.has(nodeId)) return;
      visited.add(nodeId);
      // Check outgoing: this node governs/owns/reports to others
      const outRels = this.getRelationsFrom(nodeId).filter(r =>
        ["OWNS","ACCOUNTABLE_FOR","REPORTS_TO","GOVERNS"].includes(r.type)
      );
      // Check incoming: others are accountable FOR this node
      const inRels = this.getRelationsTo(nodeId).filter(r =>
        ["ACCOUNTABLE_FOR","OWNS","GOVERNS"].includes(r.type)
      );
      const allRels = [...outRels, ...inRels];
      for (const rel of allRels) {
        const targetId = rel.fromId === nodeId ? rel.toId : rel.fromId;
        const target   = this.getNode(targetId);
        if (!target) { gaps.push(`Broken link: ${nodeId} → ${targetId}`); continue; }
        chain.push({ actorId:target.id, actorType:target.type, role:rel.type, relation:rel.type, depth });
        traverse(target.id, depth + 1);
      }
    };
    traverse(entityId, 1);

    const isComplete = chain.length > 0 &&
      chain.some(c => ["executive","committee","board"].includes(c.actorType));

    if (!isComplete && chain.length === 0) gaps.push("No accountability chain defined — orphan entity");
    if (!chain.some(c => c.actorType === "board")) gaps.push("No board-level oversight in chain");

    return { entityId, entityType:entity.type, chain, isComplete, gaps };
  }

  // ── Governance health questions ──────────────────────────────
  generateGovernanceQuestions(): GovernanceQuestion[] {
    const questions: GovernanceQuestion[] = [];
    const allNodes = [...nodeStore.values()].filter(n => n.tenantId === this.tenantId);

    // Orphan risks (no controlling policy or control)
    const risks = allNodes.filter(n => n.type === "risk");
    for (const risk of risks) {
      const outRels = this.getRelationsFrom(risk.id);
      const hasControl = outRels.some(r => r.type === "MITIGATES" || r.toType === "control");
      if (!hasControl) {
        questions.push({ id:uuidv4(), category:"risk",
          question:`Risk "${risk.label}" has no mitigating control — what is the response plan?`,
          urgency:"this_week", entityIds:[risk.id], insight:"Unmitigated risk detected" });
      }
    }

    // Policies without owners
    const policies = allNodes.filter(n => n.type === "policy");
    for (const pol of policies) {
      if (!pol.ownerId) {
        questions.push({ id:uuidv4(), category:"accountability",
          question:`Policy "${pol.label}" has no assigned owner — who is accountable?`,
          urgency:"this_week", entityIds:[pol.id], insight:"Orphan policy — accountability gap" });
      }
    }

    // Decisions without evidence
    const decisions = allNodes.filter(n => n.type === "decision");
    for (const dec of decisions) {
      const hasEvidence = this.getRelationsFrom(dec.id).some(r => r.toType === "evidence" || r.type === "EVIDENCES");
      if (!hasEvidence) {
        questions.push({ id:uuidv4(), category:"evidence",
          question:`Decision "${dec.label}" has no evidence — how can it be audited?`,
          urgency:"immediate", entityIds:[dec.id], insight:"Evidence-free decision" });
      }
    }

    // Executives without supervised entities
    const execs = allNodes.filter(n => n.type === "executive");
    for (const exec of execs) {
      const supervises = this.getRelationsFrom(exec.id).filter(r => r.type === "GOVERNS" || r.type === "ACCOUNTABLE_FOR");
      if (supervises.length === 0) {
        questions.push({ id:uuidv4(), category:"oversight",
          question:`Executive "${exec.label}" has no governance responsibilities — is this intentional?`,
          urgency:"this_month", entityIds:[exec.id], insight:"Idle executive — governance gap" });
      }
    }

    return questions;
  }

  // ── Blast radius: what does this entity affect? ──────────────
  computeBlastRadius(nodeId: string, maxDepth = 4): { affected: OntologyNode[]; score: number } {
    const visited = new Set<string>();
    const affected: OntologyNode[] = [];

    const traverse = (id: string, depth: number) => {
      if (depth > maxDepth || visited.has(id)) return;
      visited.add(id);
      const rels = [...this.getRelationsFrom(id), ...this.getRelationsTo(id)];
      for (const rel of rels) {
        const targetId = rel.fromId === id ? rel.toId : rel.fromId;
        if (visited.has(targetId)) continue;
        const target = this.getNode(targetId);
        if (target) { affected.push(target); traverse(targetId, depth + 1); }
      }
    };
    traverse(nodeId, 1);

    const score = Math.min(100, affected.length * 8 +
      affected.filter(n => ["board","executive","committee"].includes(n.type)).length * 15);
    return { affected: [...new Set(affected.map(n=>n.id))].map(id => this.getNode(id)!).filter(Boolean), score };
  }

  getStats() {
    const nodes = [...nodeStore.values()].filter(n => n.tenantId === this.tenantId);
    const rels  = [...relationStore.values()].filter(r => r.tenantId === this.tenantId);
    const byType = {} as Record<OntologyNodeType, number>;
    for (const n of nodes) byType[n.type] = (byType[n.type] ?? 0) + 1;
    return { nodes:nodes.length, relations:rels.length, byType,
      orphanNodes: nodes.filter(n => {
        const from = relFromIdx.get(`${this.tenantId}:${n.id}`) ?? new Set();
        const to   = relToIdx.get(`${this.tenantId}:${n.id}`) ?? new Set();
        return from.size === 0 && to.size === 0;
      }).length,
      governanceQuestions: this.generateGovernanceQuestions().length,
    };
  }
}

const ontologyCache = new Map<string, GovernanceOntologyEngine>();
export function getGovernanceOntology(tenantId: string): GovernanceOntologyEngine {
  if (!ontologyCache.has(tenantId)) ontologyCache.set(tenantId, new GovernanceOntologyEngine(tenantId));
  return ontologyCache.get(tenantId)!;
}
