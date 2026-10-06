/**
 * Unified Governance Object Model Registry
 * ─────────────────────────────────────────────────────────────────────
 * Canonical source of truth for ALL governance entities.
 * Every module reads/writes entities through this registry.
 * Direct entity manipulation outside the registry is FORBIDDEN.
 *
 * Production: swap in-memory map → PostgreSQL with Row-Level Security
 */
import { v4 as uuidv4 } from "uuid";
import { ZodSchema } from "zod";
import { BaseGovernanceObject, UGOMType, EntityStatus, AuditEntry } from "../types/governance.types";
import { BaseGovernanceSchema, schemas } from "../schemas";
import { SovereignKnowledgeGraph } from "../graph/graph.engine";
import { EventBus } from "./event-bus";
import { AuditLogger } from "../audit/audit.logger";

type EntityMap = Map<string, BaseGovernanceObject>;

export class UGOMRegistry {
  // Partitioned by type for efficient queries
  private readonly stores = new Map<UGOMType, EntityMap>();
  // Global ID index for O(1) cross-type lookup
  private readonly idIndex = new Map<string, UGOMType>();

  constructor(
    private readonly graph: SovereignKnowledgeGraph,
    private readonly eventBus: EventBus,
    private readonly auditLogger: AuditLogger,
    private readonly tenantId: string,
    private readonly organizationId: string,
  ) {}

  // ── Create ─────────────────────────────────────────────────────────

  async create<T extends BaseGovernanceObject>(
    type: UGOMType,
    data: Omit<T, "id" | "version" | "createdAt" | "updatedAt" | "auditTrail" | "tenantId" | "organizationId">,
    createdBy: string,
  ): Promise<T> {
    const now = new Date().toISOString();
    const id  = uuidv4();

    const raw: BaseGovernanceObject = {
      id,
      ...data,
      type,          // explicit override — always canonical
      tenantId:      this.tenantId,
      organizationId:this.organizationId,
      version:       1,
      createdAt:     now,
      updatedAt:     now,
      createdBy,
      updatedBy:     createdBy,
      auditTrail:    [],
    } as BaseGovernanceObject;

    // Validate against schema
    const schema = this.getSchema(type);
    const validated = schema ? schema.parse(raw) : BaseGovernanceSchema.parse(raw);

    // Persist
    this.store(type).set(id, validated as BaseGovernanceObject);
    this.idIndex.set(id, type);

    // Register in Knowledge Graph
    this.graph.upsertNode({
      id, type, label: validated.title ?? id,
      properties: { status: validated.status, riskLevel: validated.riskLevel, owner: validated.owner },
      createdBy,
    });

    // Auto-link to graph based on linkedXxx fields
    this.syncGraphEdges(validated as BaseGovernanceObject, createdBy);

    // Audit
    const auditEntry = this.auditLogger.log({
      action: `${type}.created`, entityId: id, entityType: type,
      performedBy: createdBy, newValue: validated,
    });
    (validated as BaseGovernanceObject).auditTrail.push(auditEntry);

    // Emit event
    this.eventBus.emit({
      type: "entity.created", source: "UGOMRegistry",
      entityId: id, entityType: type,
      payload: validated, tenantId: this.tenantId,
    });

    return validated as T;
  }

  // ── Read ──────────────────────────────────────────────────────────

  findById<T extends BaseGovernanceObject = BaseGovernanceObject>(id: string): T | undefined {
    const type = this.idIndex.get(id);
    if (!type) return undefined;
    return this.store(type).get(id) as T | undefined;
  }

  findByType<T extends BaseGovernanceObject = BaseGovernanceObject>(
    type: UGOMType,
    filter?: Partial<Pick<T, "status" | "owner" | "riskLevel" | "priority">>,
  ): T[] {
    const all = [...(this.stores.get(type)?.values() ?? [])];
    if (!filter) return all as T[];
    return all.filter(e => {
      for (const [k, v] of Object.entries(filter)) {
        if ((e as unknown as Record<string, unknown>)[k] !== v) return false;
      }
      return true;
    }) as T[];
  }

  findAll(tenantId?: string): BaseGovernanceObject[] {
    const tid = tenantId ?? this.tenantId;
    const all: BaseGovernanceObject[] = [];
    for (const store of this.stores.values()) {
      for (const e of store.values()) {
        if (e.tenantId === tid) all.push(e);
      }
    }
    return all;
  }

  // ── Update ────────────────────────────────────────────────────────

  async update<T extends BaseGovernanceObject>(
    id: string,
    patch: Partial<T>,
    updatedBy: string,
    reason?: string,
  ): Promise<T | undefined> {
    const existing = this.findById<T>(id);
    if (!existing) return undefined;

    const now = new Date().toISOString();
    const updated: T = {
      ...existing,
      ...patch,
      id,
      type:        existing.type,
      tenantId:    this.tenantId,
      organizationId: this.organizationId,
      version:     existing.version + 1,
      updatedAt:   now,
      updatedBy,
    } as T;

    const schema = this.getSchema(existing.type);
    const validated = schema ? schema.parse(updated) : BaseGovernanceSchema.parse(updated);

    this.store(existing.type).set(id, validated as BaseGovernanceObject);

    // Update graph node
    this.graph.upsertNode({
      id, type: existing.type, label: validated.title ?? id,
      properties: { status: validated.status, riskLevel: validated.riskLevel, owner: validated.owner },
      createdBy: updatedBy,
    });

    // Re-sync edges for updated links
    this.syncGraphEdges(validated as BaseGovernanceObject, updatedBy);

    const auditEntry = this.auditLogger.log({
      action: `${existing.type}.updated`, entityId: id, entityType: existing.type,
      performedBy: updatedBy, previousValue: existing, newValue: validated,
      details: reason ? { reason } : undefined,
    });
    (validated as BaseGovernanceObject).auditTrail.push(auditEntry);

    this.eventBus.emit({
      type: "entity.updated", source: "UGOMRegistry",
      entityId: id, entityType: existing.type,
      payload: { previous: existing, current: validated },
      tenantId: this.tenantId,
    });

    if (patch.status && patch.status !== existing.status) {
      this.eventBus.emit({
        type: "entity.status_changed", source: "UGOMRegistry",
        entityId: id, entityType: existing.type,
        payload: { entityId: id, entityType: existing.type, fromStatus: existing.status, toStatus: patch.status, changedBy: updatedBy, reason },
        tenantId: this.tenantId,
      });
    }

    return validated as T;
  }

  // ── Status Transition ─────────────────────────────────────────────

  async transitionStatus(
    id: string,
    newStatus: EntityStatus,
    changedBy: string,
    reason?: string,
  ): Promise<boolean> {
    const entity = this.findById(id);
    if (!entity) return false;
    await this.update(id, { status: newStatus } as Partial<BaseGovernanceObject>, changedBy, reason);
    return true;
  }

  // ── Integrity Check ───────────────────────────────────────────────

  validateEvidenceChains(): { valid: BaseGovernanceObject[]; broken: BaseGovernanceObject[] } {
    const findings = this.findByType("audit_finding");
    const valid:   BaseGovernanceObject[] = [];
    const broken:  BaseGovernanceObject[] = [];
    for (const f of findings) {
      const hasEvidence = f.linkedEvidence.length > 0 &&
        f.linkedEvidence.every(eid => this.findById(eid) !== undefined);
      (hasEvidence ? valid : broken).push(f);
    }
    return { valid, broken };
  }

  getStats() {
    const byCtype: Record<string, number> = {};
    for (const [type, store] of this.stores) byCtype[type] = store.size;
    return {
      totalEntities: this.idIndex.size,
      byType: byCtype,
      tenantId: this.tenantId,
    };
  }

  // ── Private ───────────────────────────────────────────────────────

  private store(type: UGOMType): EntityMap {
    if (!this.stores.has(type)) this.stores.set(type, new Map());
    return this.stores.get(type)!;
  }

  private getSchema(type: UGOMType): ZodSchema | undefined {
    return (schemas as Record<string, ZodSchema>)[type];
  }

  private syncGraphEdges(entity: BaseGovernanceObject, createdBy: string): void {
    const edgeMappings: Array<{ ids: string[]; rel: import("../types/governance.types").RelationshipType }> = [
      { ids: entity.linkedRisks,       rel: "creates_risk" },
      { ids: entity.linkedControls,    rel: "enforced_by" },
      { ids: entity.linkedPolicies,    rel: "governs" },
      { ids: entity.linkedRegulations, rel: "maps_to" },
      { ids: entity.linkedEvidence,    rel: "evidenced_by" },
      { ids: entity.linkedFindings,    rel: "produces_finding" },
      { ids: entity.linkedCAPAs,       rel: "triggers" },
      { ids: entity.linkedDecisions,   rel: "approved_by" },
    ];

    for (const { ids, rel } of edgeMappings) {
      for (const targetId of ids) {
        const targetType = this.idIndex.get(targetId);
        if (targetType) {
          this.graph.createEdge({
            fromId: entity.id, fromType: entity.type,
            toId: targetId,    toType: targetType,
            relationship: rel, createdBy,
          });
        }
      }
    }
  }
}
