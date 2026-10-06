/**
 * Identity Resolution Engine — Phase 5.4
 * Unifies duplicate entities, prevents undefined-externalId merges,
 * canonical entity mapping, cross-tenant isolation.
 *
 * Fixes the undefined === undefined externalId bug discovered in Phase 2.
 */
import { v4 as uuidv4 } from "uuid";

export interface CanonicalEntity {
  canonicalId:   string;
  tenantId:      string;
  entityType:    string;
  primaryCode:   string;
  externalIds:   string[];           // all known external IDs
  aliases:       string[];           // known alternate names
  mergedFrom:    string[];           // entity IDs that were merged into this
  version:       number;
  createdAt:     string;
  updatedAt:     string;
  metadata:      Record<string, unknown>;
}

export interface ResolutionResult {
  canonicalId:   string;
  action:        "created" | "merged" | "found" | "rejected";
  reason:        string;
  entity:        CanonicalEntity;
}

export interface MergeConflict {
  entityAId:     string;
  entityBId:     string;
  conflictType:  "different_tenant" | "undefined_external_id" | "type_mismatch" | "code_collision";
  description:   string;
  rejected:      boolean;
}

// ── Corruption guard types ─────────────────────────────────────
export type CorruptionType =
  | "undefined_external_id_merge"
  | "cross_tenant_entity_merge"
  | "orphan_graph_edge"
  | "duplicate_canonical"
  | "event_hash_mismatch"
  | "replay_order_corruption"
  | "stale_write_overwrite";

export interface CorruptionGuardViolation {
  type:          CorruptionType;
  tenantId:      string;
  entityId?:     string;
  description:   string;
  detectedAt:    string;
  blocked:       boolean;
}

const canonicalStore  = new Map<string, CanonicalEntity>();   // canonicalId → entity
const codeIndex       = new Map<string, string>();             // tenantId:type:code → canonicalId
const externalIdIndex = new Map<string, string>();             // tenantId:externalId → canonicalId
const violationLog:   CorruptionGuardViolation[] = [];

export class IdentityResolutionEngine {
  constructor(private readonly tenantId: string) {}

  /**
   * Resolve or create a canonical entity.
   * Safe: will NEVER merge entities from different tenants.
   * Safe: will NEVER use undefined externalId as a match key.
   */
  resolve(params: {
    entityType:  string;
    code:        string;
    externalId?: string;
    name:        string;
    metadata?:   Record<string, unknown>;
  }): ResolutionResult {
    // 1. Try to find by externalId (only if explicitly provided and non-empty)
    if (params.externalId && params.externalId.trim() !== "") {
      const canonId = externalIdIndex.get(`${this.tenantId}:${params.externalId}`);
      if (canonId) {
        const entity = canonicalStore.get(canonId);
        if (entity && entity.tenantId === this.tenantId) {
          return { canonicalId: canonId, action:"found", reason:"Found by externalId", entity };
        }
      }
    }

    // 2. Try to find by type + code
    const codeKey = `${this.tenantId}:${params.entityType}:${params.code}`;
    const canonByCode = codeIndex.get(codeKey);
    if (canonByCode) {
      const entity = canonicalStore.get(canonByCode);
      if (entity && entity.tenantId === this.tenantId) {
        // Update externalId if new one provided
        if (params.externalId && !entity.externalIds.includes(params.externalId)) {
          const updated = { ...entity, externalIds:[...entity.externalIds, params.externalId], updatedAt:new Date().toISOString(), version:entity.version+1 };
          canonicalStore.set(canonByCode, updated);
          externalIdIndex.set(`${this.tenantId}:${params.externalId}`, canonByCode);
          return { canonicalId:canonByCode, action:"found", reason:"Found by code, updated externalId", entity:updated };
        }
        return { canonicalId:canonByCode, action:"found", reason:"Found by code", entity };
      }
    }

    // 3. Create new canonical entity
    const canonicalId = uuidv4();
    const now = new Date().toISOString();
    const entity: CanonicalEntity = {
      canonicalId, tenantId:this.tenantId,
      entityType:  params.entityType,
      primaryCode: params.code,
      externalIds: params.externalId ? [params.externalId] : [],
      aliases:     [params.name],
      mergedFrom:  [],
      version:     1,
      createdAt:   now, updatedAt:now,
      metadata:    params.metadata ?? {},
    };
    canonicalStore.set(canonicalId, entity);
    codeIndex.set(codeKey, canonicalId);
    if (params.externalId) {
      externalIdIndex.set(`${this.tenantId}:${params.externalId}`, canonicalId);
    }
    return { canonicalId, action:"created", reason:"New canonical entity created", entity };
  }

  /**
   * Safe merge: validates both entities belong to same tenant + have compatible types.
   * Rejects any merge that would violate isolation or create corruption.
   */
  safeMerge(canonIdA: string, canonIdB: string): ResolutionResult | MergeConflict {
    const a = canonicalStore.get(canonIdA);
    const b = canonicalStore.get(canonIdB);

    // Guard: both must exist
    if (!a || !b) {
      return { entityAId:canonIdA, entityBId:canonIdB, conflictType:"code_collision", description:"One or both entities not found", rejected:true };
    }

    // Guard: same tenant
    if (a.tenantId !== this.tenantId || b.tenantId !== this.tenantId) {
      this.recordViolation("cross_tenant_entity_merge", canonIdA, `Attempted cross-tenant merge: ${a.tenantId} + ${b.tenantId}`);
      return { entityAId:canonIdA, entityBId:canonIdB, conflictType:"different_tenant", description:"Cross-tenant merge rejected", rejected:true };
    }

    // Guard: same type
    if (a.entityType !== b.entityType) {
      return { entityAId:canonIdA, entityBId:canonIdB, conflictType:"type_mismatch", description:`Type mismatch: ${a.entityType} vs ${b.entityType}`, rejected:true };
    }

    // Merge B into A
    const merged: CanonicalEntity = {
      ...a,
      externalIds: [...new Set([...a.externalIds, ...b.externalIds])],
      aliases:     [...new Set([...a.aliases,     ...b.aliases])],
      mergedFrom:  [...a.mergedFrom, canonIdB],
      version:     a.version + 1,
      updatedAt:   new Date().toISOString(),
    };
    canonicalStore.set(canonIdA, merged);
    // Remap B's references to A
    codeIndex.set(`${this.tenantId}:${b.entityType}:${b.primaryCode}`, canonIdA);
    for (const extId of b.externalIds) {
      externalIdIndex.set(`${this.tenantId}:${extId}`, canonIdA);
    }
    canonicalStore.delete(canonIdB);

    return { canonicalId:canonIdA, action:"merged", reason:`Merged ${canonIdB} into ${canonIdA}`, entity:merged };
  }

  getCanonical(canonicalId: string): CanonicalEntity | undefined {
    const e = canonicalStore.get(canonicalId);
    return e?.tenantId === this.tenantId ? e : undefined;
  }

  findByCode(entityType: string, code: string): CanonicalEntity | undefined {
    const canonId = codeIndex.get(`${this.tenantId}:${entityType}:${code}`);
    return canonId ? this.getCanonical(canonId) : undefined;
  }

  getAllForTenant(): CanonicalEntity[] {
    return [...canonicalStore.values()].filter(e => e.tenantId === this.tenantId);
  }

  private recordViolation(type: CorruptionType, entityId: string, description: string): void {
    violationLog.push({ type, tenantId:this.tenantId, entityId, description, detectedAt:new Date().toISOString(), blocked:true });
  }

  getViolations(): CorruptionGuardViolation[] {
    return violationLog.filter(v => v.tenantId === this.tenantId);
  }
}

const irCache = new Map<string, IdentityResolutionEngine>();
export function getIdentityResolutionEngine(tenantId: string): IdentityResolutionEngine {
  if (!irCache.has(tenantId)) irCache.set(tenantId, new IdentityResolutionEngine(tenantId));
  return irCache.get(tenantId)!;
}
