/**
 * Organizational Digital Twin — Phase 2
 * Every entity in the enterprise is a live node.
 * The graph is queryable, traversable, and health-scored.
 *
 * Entities: departments, employees, stakeholders, projects, investments,
 *   workflows, approvals, contracts, risks, KPIs, strategies, policies,
 *   committees, board decisions, vendors, authorities, subsidiaries.
 */
import { v4 as uuidv4 } from "uuid";
import { getGovernanceOntology, OntologyNodeType } from "../../sovereign-memory/ontology/governance.ontology.engine";
import { getDurableEventBus } from "../../runtime/event-bus/durable.event.bus";

export type TwinEntityType =
  | "department"   | "employee"      | "stakeholder"  | "project"
  | "investment"   | "workflow"       | "approval"     | "contract"
  | "risk"         | "kpi"           | "strategy"     | "policy"
  | "committee"    | "board_decision"| "vendor"        | "authority"
  | "subsidiary"   | "executive"     | "asset"         | "process";

export type TwinRelationType =
  | "REPORTS_TO"   | "OWNS"          | "MANAGES"      | "APPROVES"
  | "DEPENDS_ON"   | "GOVERNS"       | "FUNDS"         | "MITIGATES"
  | "IMPACTS"      | "DELEGATES_TO"  | "CONTRACTS_WITH"| "MONITORS"
  | "ESCALATES_TO" | "SUBSIDIARY_OF" | "MEMBER_OF"     | "LEADS";

export interface TwinEntity {
  id:          string;
  tenantId:    string;
  externalId?: string;       // ERP/HRMS ID
  type:        TwinEntityType;
  name:        string;
  code:        string;
  status:      "active" | "inactive" | "archived" | "at_risk";
  health:      number;       // 0-100
  properties:  Record<string, unknown>;
  syncedAt:    string;
  createdAt:   string;
  updatedAt:   string;
}

export interface TwinRelation {
  id:          string;
  tenantId:    string;
  type:        TwinRelationType;
  fromId:      string;
  fromType:    TwinEntityType;
  toId:        string;
  toType:      TwinEntityType;
  weight:      number;       // 0-1 relationship strength
  properties:  Record<string, unknown>;
  createdAt:   string;
}

export interface OrganizationalHeatmap {
  tenantId:    string;
  generatedAt: string;
  dimensions: {
    governance:     number;   // 0-100
    risk:           number;
    compliance:     number;
    performance:    number;
    accountability: number;
  };
  hotspots:    HeatmapHotspot[];
  coldspots:   HeatmapHotspot[];
  overallScore:number;
}

export interface HeatmapHotspot {
  entityId:    string;
  entityType:  TwinEntityType;
  entityName:  string;
  score:       number;
  reason:      string;
  priority:    "critical" | "high" | "medium" | "low";
}

export interface BlastRadiusAnalysis {
  sourceEntityId:  string;
  scenario:        string;
  directlyAffected:TwinEntity[];
  indirectlyAffected:TwinEntity[];
  criticalPaths:   Array<{path: string[]; risk: number}>;
  overallRisk:     number;
  estimatedImpact: string;
}

// ── Stores ────────────────────────────────────────────────────
const entityStore   = new Map<string, TwinEntity>();
const relationStore = new Map<string, TwinRelation>();

// Indexes
const entityTypeIdx = new Map<string, Set<string>>();    // tenantId:type → ids
const outEdgeIdx    = new Map<string, Set<string>>();    // tenantId:entityId → relation ids
const inEdgeIdx     = new Map<string, Set<string>>();    // tenantId:entityId → relation ids

function idxEntity(e: TwinEntity): void {
  const k = `${e.tenantId}:${e.type}`;
  if (!entityTypeIdx.has(k)) entityTypeIdx.set(k, new Set());
  entityTypeIdx.get(k)!.add(e.id);
}
function idxRelation(r: TwinRelation): void {
  const fk = `${r.tenantId}:${r.fromId}`;
  const tk  = `${r.tenantId}:${r.toId}`;
  if (!outEdgeIdx.has(fk)) outEdgeIdx.set(fk, new Set());
  outEdgeIdx.get(fk)!.add(r.id);
  if (!inEdgeIdx.has(tk)) inEdgeIdx.set(tk, new Set());
  inEdgeIdx.get(tk)!.add(r.id);
}

export class OrganizationalDigitalTwin {
  constructor(private readonly tenantId: string) {}

  // ── Entity management ────────────────────────────────────────
  upsertEntity(params: Omit<TwinEntity, "id" | "tenantId" | "createdAt" | "updatedAt" | "syncedAt"> & { id?: string }): TwinEntity {
    // Find by externalId or code
    const existing = [...entityStore.values()].find(
      e => e.tenantId === this.tenantId && ((params.externalId !== undefined && e.externalId === params.externalId) || e.code === params.code)
    );
    const now = new Date().toISOString();
    if (existing) {
      const updated: TwinEntity = { ...existing, ...params, id:existing.id, tenantId:this.tenantId, updatedAt:now, syncedAt:now };
      entityStore.set(existing.id, updated);
      return updated;
    }
    const entity: TwinEntity = { ...params, id:params.id ?? uuidv4(), tenantId:this.tenantId, createdAt:now, updatedAt:now, syncedAt:now };
    entityStore.set(entity.id, entity);
    idxEntity(entity);
    return entity;
  }

  addRelation(params: Omit<TwinRelation, "id" | "tenantId" | "createdAt">): TwinRelation {
    const rel: TwinRelation = { ...params, id:uuidv4(), tenantId:this.tenantId, createdAt:new Date().toISOString() };
    relationStore.set(rel.id, rel);
    idxRelation(rel);
    return rel;
  }

  getEntity(id: string): TwinEntity | undefined {
    const e = entityStore.get(id);
    return e?.tenantId === this.tenantId ? e : undefined;
  }

  getEntitiesByType(type: TwinEntityType): TwinEntity[] {
    const ids = entityTypeIdx.get(`${this.tenantId}:${type}`) ?? new Set();
    return [...ids].map(id => entityStore.get(id)!).filter(e => e?.tenantId === this.tenantId);
  }

  getOutbound(entityId: string): TwinRelation[] {
    const ids = outEdgeIdx.get(`${this.tenantId}:${entityId}`) ?? new Set();
    return [...ids].map(id => relationStore.get(id)!).filter(r => r?.tenantId === this.tenantId);
  }

  getInbound(entityId: string): TwinRelation[] {
    const ids = inEdgeIdx.get(`${this.tenantId}:${entityId}`) ?? new Set();
    return [...ids].map(id => relationStore.get(id)!).filter(r => r?.tenantId === this.tenantId);
  }

  // ── Blast radius analysis ─────────────────────────────────────
  analyzeBlastRadius(sourceEntityId: string, scenario = "entity_failure", maxDepth = 3): BlastRadiusAnalysis {
    const source     = this.getEntity(sourceEntityId);
    if (!source) return { sourceEntityId, scenario, directlyAffected:[], indirectlyAffected:[], criticalPaths:[], overallRisk:0, estimatedImpact:"Entity not found" };

    const directly:   TwinEntity[] = [];
    const indirectly: TwinEntity[] = [];
    const visited     = new Set<string>([sourceEntityId]);

    // BFS depth 1 = direct, depth 2+ = indirect
    const queue: Array<[string, number]> = [[sourceEntityId, 0]];
    while (queue.length > 0) {
      const [nodeId, depth] = queue.shift()!;
      if (depth >= maxDepth) continue;
      const rels = [...this.getOutbound(nodeId), ...this.getInbound(nodeId)];
      for (const rel of rels) {
        const targetId = rel.fromId === nodeId ? rel.toId : rel.fromId;
        if (visited.has(targetId)) continue;
        visited.add(targetId);
        const target = this.getEntity(targetId);
        if (!target) continue;
        if (depth === 0) directly.push(target);
        else             indirectly.push(target);
        queue.push([targetId, depth + 1]);
      }
    }

    const risk = Math.min(100, (directly.length * 15) + (indirectly.length * 5) +
      (source.type === "authority" || source.type === "executive" ? 30 : 0));

    return {
      sourceEntityId, scenario,
      directlyAffected:   directly,
      indirectlyAffected: indirectly,
      criticalPaths:      [],
      overallRisk:        risk,
      estimatedImpact:    `${directly.length} direct + ${indirectly.length} indirect entities affected`,
    };
  }

  // ── Organizational heatmap ────────────────────────────────────
  generateHeatmap(): OrganizationalHeatmap {
    const allEntities = [...entityStore.values()].filter(e => e.tenantId === this.tenantId);
    const atRisk      = allEntities.filter(e => e.health < 60);
    const healthy     = allEntities.filter(e => e.health >= 80);

    // Dimension scoring
    const risks       = this.getEntitiesByType("risk");
    const policies    = this.getEntitiesByType("policy");
    const projects    = this.getEntitiesByType("project");
    const authorities = this.getEntitiesByType("authority");

    const governance   = Math.max(0, 100 - atRisk.length * 8);
    const risk         = Math.max(0, 100 - risks.filter(r => r.health < 60).length * 15);
    const compliance   = Math.max(0, 100 - policies.filter(p => p.status !== "active").length * 10);
    const performance  = allEntities.length > 0 ? Math.round(allEntities.reduce((s, e) => s + e.health, 0) / allEntities.length) : 100;
    const accountability = Math.max(0, 100 - authorities.filter(a => a.health < 50).length * 20);
    const overallScore = Math.round((governance + risk + compliance + performance + accountability) / 5);

    const hotspots:  HeatmapHotspot[] = atRisk.slice(0, 5).map(e => ({
      entityId:e.id, entityType:e.type, entityName:e.name, score:e.health,
      reason:`Health score ${e.health}% — below threshold`,
      priority: e.health < 30 ? "critical" : e.health < 50 ? "high" : "medium",
    }));
    const coldspots: HeatmapHotspot[] = healthy.slice(0, 3).map(e => ({
      entityId:e.id, entityType:e.type, entityName:e.name, score:e.health,
      reason:`Strong performer — health ${e.health}%`, priority:"low",
    }));

    return {
      tenantId:this.tenantId, generatedAt:new Date().toISOString(),
      dimensions:{ governance, risk, compliance, performance, accountability },
      hotspots, coldspots, overallScore,
    };
  }

  // ── Cross-department intelligence ─────────────────────────────
  getCrossEntityDependencies(entityType: TwinEntityType): Array<{from:TwinEntity; to:TwinEntity; relationType:TwinRelationType; risk:number}> {
    const entities = this.getEntitiesByType(entityType);
    const deps: Array<{from:TwinEntity; to:TwinEntity; relationType:TwinRelationType; risk:number}> = [];
    for (const e of entities) {
      for (const rel of this.getOutbound(e.id)) {
        const target = this.getEntity(rel.toId);
        if (target) {
          deps.push({ from:e, to:target, relationType:rel.type, risk: target.health < 60 ? 60 : 20 });
        }
      }
    }
    return deps;
  }

  getStats() {
    const all = [...entityStore.values()].filter(e => e.tenantId === this.tenantId);
    const rels = [...relationStore.values()].filter(r => r.tenantId === this.tenantId);
    const byType: Record<string, number> = {};
    for (const e of all) byType[e.type] = (byType[e.type] ?? 0) + 1;
    return {
      entities: all.length, relations: rels.length, byType,
      atRisk:   all.filter(e => e.health < 60).length,
      inactive: all.filter(e => e.status === "inactive").length,
    };
  }
}

const twinCache = new Map<string, OrganizationalDigitalTwin>();
export function getDigitalTwin(tenantId: string): OrganizationalDigitalTwin {
  if (!twinCache.has(tenantId)) twinCache.set(tenantId, new OrganizationalDigitalTwin(tenantId));
  return twinCache.get(tenantId)!;
}
