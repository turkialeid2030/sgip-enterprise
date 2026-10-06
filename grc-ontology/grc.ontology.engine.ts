/**
 * Unified GRC Ontology — Phase 6.1 / 7.1
 * Canonical entity types and relationships for the entire GRC domain.
 * Board → Governance → Risk → Compliance → Resilience → AI Governance.
 *
 * All entities: immutable IDs, tenant isolation, temporal validity, lineage.
 */
import { v4 as uuidv4 } from "uuid";
import { getEventStore } from "../runtime/persistence/persistent.event.store";
import { getSovereignMemory } from "../sovereign-memory/core/sovereign.memory.engine";

// ── Governance ────────────────────────────────────────────────
export type GovernanceEntityType =
  | "board"             | "committee"          | "executive"
  | "shareholder"       | "stakeholder"        | "policy"
  | "resolution"        | "approval"           | "vote"
  | "quorum"            | "escalation"         | "conflict_of_interest"
  | "delegation"        | "authority"          | "evaluation"
  | "compensation"      | "nomination"         | "meeting"
  | "agenda"            | "action_item"        | "exception"
  | "waiver"            | "investigation"      | "attestation";

// ── Risk ──────────────────────────────────────────────────────
export type RiskEntityType =
  | "enterprise_risk"   | "strategic_risk"     | "operational_risk"
  | "cyber_risk"        | "ai_risk"            | "third_party_risk"
  | "data_risk"         | "esg_risk"           | "regulatory_risk"
  | "model_risk"        | "financial_risk"     | "concentration_risk";

// ── Compliance ────────────────────────────────────────────────
export type ComplianceEntityType =
  | "obligation"        | "regulation"         | "control"
  | "evidence"          | "audit_finding"      | "violation"
  | "remediation"       | "capa"               | "kri"
  | "kpi";

// ── Resilience ────────────────────────────────────────────────
export type ResilienceEntityType =
  | "incident"          | "crisis"             | "continuity_plan"
  | "disaster_recovery" | "recovery_objective" | "service_dependency";

// ── AI Governance ─────────────────────────────────────────────
export type AIGovEntityType =
  | "ai_model"          | "agent"              | "prompt"
  | "ai_decision"       | "hallucination_incident" | "ai_action_trace"
  | "human_override"    | "explainability_record";

export type GRCEntityType = GovernanceEntityType | RiskEntityType | ComplianceEntityType | ResilienceEntityType | AIGovEntityType;

export type GRCRelationType =
  | "GOVERNS"           | "OWNS"               | "APPROVES"
  | "DELEGATES_TO"      | "REPORTS_TO"         | "ESCALATES_TO"
  | "MITIGATES"         | "IMPLEMENTS"         | "EVIDENCES"
  | "MAPS_TO"           | "SUPERSEDES"         | "CONFLICTS_WITH"
  | "TRIGGERS"          | "CAUSED_BY"          | "DEPENDS_ON"
  | "MONITORS"          | "ACCOUNTABLE_FOR"    | "LINKED_TO";

export interface GRCEntity {
  readonly id:            string;
  readonly tenantId:      string;
  readonly canonicalId:   string;
  readonly entityType:    GRCEntityType;
  readonly code:          string;
  readonly title:         string;
  readonly description:   string;
  readonly ownerId?:      string;
  readonly ownerRole?:    string;
  readonly status:        "active" | "inactive" | "archived" | "superseded";
  readonly validFrom:     string;
  readonly validTo?:      string;
  readonly version:       number;
  readonly properties:    Readonly<Record<string, unknown>>;
  readonly createdAt:     string;
  readonly updatedAt:     string;
  readonly createdBy:     string;
}

export interface GRCRelation {
  readonly id:            string;
  readonly tenantId:      string;
  readonly type:          GRCRelationType;
  readonly fromId:        string;
  readonly fromType:      GRCEntityType;
  readonly toId:          string;
  readonly toType:        GRCEntityType;
  readonly strength:      number;
  readonly validFrom:     string;
  readonly validTo?:      string;
  readonly properties:    Readonly<Record<string, unknown>>;
  readonly createdAt:     string;
}

// ── Stores ────────────────────────────────────────────────────
const entityStore    = new Map<string, GRCEntity>();
const relationStore  = new Map<string, GRCRelation>();
const typeIdx        = new Map<string, Set<string>>();   // tenantId:type → ids
const outEdgeIdx     = new Map<string, Set<string>>();   // tenantId:entityId → rel ids
const inEdgeIdx      = new Map<string, Set<string>>();   // tenantId:entityId → rel ids

export class GRCOntologyEngine {
  constructor(private readonly tenantId: string) {}

  upsert(params: {
    entityType:  GRCEntityType;
    code:        string;
    title:       string;
    description: string;
    ownerId?:    string;
    ownerRole?:  string;
    properties?: Record<string, unknown>;
    createdBy:   string;
    validFrom?:  string;
    validTo?:    string;
  }): GRCEntity {
    const existing = this.findByCode(params.entityType, params.code);
    const now = new Date().toISOString();
    if (existing) {  // update always — frozen entities use property replacement
      // Supersede old version
      // Create updated version (existing may be frozen — spread creates new mutable object)
      const updated: GRCEntity = Object.freeze({ ...existing,
        title:       params.title,
        description: params.description,
        ownerId:     params.ownerId,
        ownerRole:   params.ownerRole,
        properties:  Object.freeze({ ...(params.properties ?? {}) }),
        validTo:     params.validTo,
        version:     existing.version + 1,
        updatedAt:   now,
      });
      entityStore.set(existing.id, updated);
      return updated;
    }

    const id: string = uuidv4();
    const entity: GRCEntity = Object.freeze({
      id, tenantId:this.tenantId, canonicalId:id,
      entityType:  params.entityType,
      code:        params.code,
      title:       params.title,
      description: params.description,
      ownerId:     params.ownerId,
      ownerRole:   params.ownerRole,
      status:      "active",
      validFrom:   params.validFrom ?? now,
      validTo:     params.validTo,
      version:     1,
      properties:  Object.freeze({ ...params.properties }),
      createdAt:   now, updatedAt:now,
      createdBy:   params.createdBy,
    });
    entityStore.set(id, entity);

    const typeKey = `${this.tenantId}:${params.entityType}`;
    if (!typeIdx.has(typeKey)) typeIdx.set(typeKey, new Set());
    typeIdx.get(typeKey)!.add(id);

    // Persist to event store
    try {
      getEventStore(this.tenantId).append({
        topic: `grc.entity.${params.entityType}.created`,
        payload:  { entityId:id, code:params.code, entityType:params.entityType },
        actorId:  params.createdBy, actorRole:"system",
      });
    } catch {}

    // Record in sovereign memory
    try {
      getSovereignMemory(this.tenantId).remember({
        type:"semantic", subject:id, subjectType:params.entityType,
        content:`${params.entityType}: ${params.title} — ${params.description}`,
        context:{ actors:params.ownerId?[params.ownerId]:[], affectedEntities:[], regulatoryRefs:[], policyRefs:[], timeframe:"ongoing", confidentiality:"internal" },
        sourceType:"system_event", importance:60,
        tags:[params.entityType, "grc_ontology"], createdBy:params.createdBy,
      });
    } catch {}

    return entity;
  }

  addRelation(params: Omit<GRCRelation, "id" | "tenantId" | "createdAt">): GRCRelation {
    const rel: GRCRelation = Object.freeze({ ...params, id:uuidv4(), tenantId:this.tenantId, createdAt:new Date().toISOString(), properties:Object.freeze({...params.properties}) });
    relationStore.set(rel.id, rel);
    const fk = `${this.tenantId}:${rel.fromId}`;
    const tk  = `${this.tenantId}:${rel.toId}`;
    if (!outEdgeIdx.has(fk)) outEdgeIdx.set(fk, new Set());
    if (!inEdgeIdx.has(tk)) inEdgeIdx.set(tk, new Set());
    outEdgeIdx.get(fk)!.add(rel.id);
    inEdgeIdx.get(tk)!.add(rel.id);
    return rel;
  }

  getById(id: string): GRCEntity | undefined {
    const e = entityStore.get(id);
    return e?.tenantId === this.tenantId ? e : undefined;
  }

  findByCode(type: GRCEntityType, code: string): GRCEntity | undefined {
    const ids = typeIdx.get(`${this.tenantId}:${type}`) ?? new Set();
    return [...ids].map(id => entityStore.get(id)).find(e => e?.code === code && e.tenantId === this.tenantId);
  }

  getByType(type: GRCEntityType): GRCEntity[] {
    const ids = typeIdx.get(`${this.tenantId}:${type}`) ?? new Set();
    return [...ids].map(id => entityStore.get(id)!).filter(e => e?.tenantId === this.tenantId && e.status === "active");
  }

  getOutbound(entityId: string, relType?: GRCRelationType): GRCRelation[] {
    const ids = outEdgeIdx.get(`${this.tenantId}:${entityId}`) ?? new Set();
    const rels = [...ids].map(id => relationStore.get(id)!).filter(r => r?.tenantId === this.tenantId);
    return relType ? rels.filter(r => r.type === relType) : rels;
  }

  getInbound(entityId: string, relType?: GRCRelationType): GRCRelation[] {
    const ids = inEdgeIdx.get(`${this.tenantId}:${entityId}`) ?? new Set();
    const rels = [...ids].map(id => relationStore.get(id)!).filter(r => r?.tenantId === this.tenantId);
    return relType ? rels.filter(r => r.type === relType) : rels;
  }

  // Blast radius: what is affected if this entity changes?
  blastRadius(entityId: string, maxDepth = 4): GRCEntity[] {
    const visited = new Set<string>([entityId]);
    const affected: GRCEntity[] = [];
    const queue: [string, number][] = [[entityId, 0]];
    while (queue.length > 0) {
      const [nodeId, depth] = queue.shift()!;
      if (depth >= maxDepth) continue;
      const rels = [...this.getOutbound(nodeId), ...this.getInbound(nodeId)];
      for (const r of rels) {
        const tid = r.fromId === nodeId ? r.toId : r.fromId;
        if (visited.has(tid)) continue;
        visited.add(tid);
        const e = this.getById(tid);
        if (e) { affected.push(e); queue.push([tid, depth + 1]); }
      }
    }
    return affected;
  }

  getStats() {
    const all = [...entityStore.values()].filter(e => e.tenantId === this.tenantId);
    const rels = [...relationStore.values()].filter(r => r.tenantId === this.tenantId);
    const byType: Record<string, number> = {};
    for (const e of all) byType[e.entityType] = (byType[e.entityType] ?? 0) + 1;
    return { entities:all.length, relations:rels.length, byType };
  }
}

const cache = new Map<string, GRCOntologyEngine>();
export function getGRCOntology(tenantId: string): GRCOntologyEngine {
  if (!cache.has(tenantId)) cache.set(tenantId, new GRCOntologyEngine(tenantId));
  return cache.get(tenantId)!;
}
