/**
 * Optimistic Concurrency Control — Phase 5.6
 * Version-based write protection.
 * Stale writes are rejected. Conflicts are logged.
 */
import { v4 as uuidv4 } from "uuid";
import { getEventStore } from "../persistence/persistent.event.store";

export interface VersionedEntity {
  id:        string;
  tenantId:  string;
  version:   number;
  updatedAt: string;
  updatedBy: string;
}

export interface WriteResult<T> {
  success:   boolean;
  entity?:   T;
  conflict?: WriteConflict;
}

export interface WriteConflict {
  entityId:        string;
  tenantId:        string;
  expectedVersion: number;
  actualVersion:   number;
  conflictedAt:    string;
  rejectedBy:      string;
}

const versionStore = new Map<string, number>();        // tenantId:entityId → version
const conflictLog: WriteConflict[] = [];
const idempotencyStore = new Map<string, unknown>();   // tenantId:key → result

export class OptimisticConcurrencyController {
  constructor(private readonly tenantId: string) {}

  /**
   * Check and increment version atomically.
   * Returns false if expected version doesn't match.
   */
  tryWrite<T extends VersionedEntity>(
    entityId:        string,
    expectedVersion: number,
    newValue:        T,
    actorId:         string,
  ): WriteResult<T> {
    const key     = `${this.tenantId}:${entityId}`;
    const current = versionStore.get(key) ?? 0;

    if (current !== expectedVersion) {
      const conflict: WriteConflict = {
        entityId, tenantId:this.tenantId,
        expectedVersion, actualVersion:current,
        conflictedAt:new Date().toISOString(),
        rejectedBy:actorId,
      };
      conflictLog.push(conflict);

      // Record in event store
      try {
        getEventStore(this.tenantId).append({
          topic:"concurrency.conflict",
          payload:{ entityId, expectedVersion, actualVersion:current },
          actorId, actorRole:"system",
        });
      } catch {}

      return { success:false, conflict };
    }

    // Increment version
    const nextVersion = current + 1;
    versionStore.set(key, nextVersion);

    const updated = { ...newValue, version:nextVersion, updatedAt:new Date().toISOString(), updatedBy:actorId };
    return { success:true, entity:updated as T };
  }

  getCurrentVersion(entityId: string): number {
    return versionStore.get(`${this.tenantId}:${entityId}`) ?? 0;
  }

  initVersion(entityId: string, version = 0): void {
    versionStore.set(`${this.tenantId}:${entityId}`, version);
  }

  /**
   * Idempotency gate — same key returns same result, no duplicate processing.
   */
  idempotentWrite<T>(key: string, compute: () => T): { result: T; wasDuplicate: boolean } {
    const storeKey = `${this.tenantId}:${key}`;
    if (idempotencyStore.has(storeKey)) {
      return { result: idempotencyStore.get(storeKey) as T, wasDuplicate:true };
    }
    const result = compute();
    idempotencyStore.set(storeKey, result);
    return { result, wasDuplicate:false };
  }

  getConflicts(): WriteConflict[] {
    return conflictLog.filter(c => c.tenantId === this.tenantId);
  }
}

const occCache = new Map<string, OptimisticConcurrencyController>();
export function getOCC(tenantId: string): OptimisticConcurrencyController {
  if (!occCache.has(tenantId)) occCache.set(tenantId, new OptimisticConcurrencyController(tenantId));
  return occCache.get(tenantId)!;
}
