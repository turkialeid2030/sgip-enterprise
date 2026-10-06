/**
 * Silent Data Corruption Guards — Phase 5.10
 * Centralized validation for all corruption patterns.
 * Every write operation should pass through these guards.
 */
import { CorruptionGuardViolation, CorruptionType } from "../identity-resolution/identity.resolution.engine";

export interface GuardCheckResult {
  passed:    boolean;
  violations:CorruptionGuardViolation[];
  blocked:   boolean;
}

const allViolations: CorruptionGuardViolation[] = [];

function record(type: CorruptionType, tenantId: string, entityId: string | undefined, desc: string, blocked: boolean): CorruptionGuardViolation {
  const v: CorruptionGuardViolation = { type, tenantId, entityId, description:desc, detectedAt:new Date().toISOString(), blocked };
  allViolations.push(v);
  return v;
}

export const CorruptionGuards = {
  /**
   * Guard 1: Prevent undefined/null externalId merge.
   */
  checkExternalIdMerge(tenantId: string, externalId: unknown, entityId?: string): GuardCheckResult {
    if (externalId === undefined || externalId === null || (typeof externalId === "string" && externalId.trim() === "")) {
      const v = record("undefined_external_id_merge", tenantId, entityId, `Attempted entity merge using undefined/empty externalId`, true);
      return { passed:false, violations:[v], blocked:true };
    }
    return { passed:true, violations:[], blocked:false };
  },

  /**
   * Guard 2: Prevent cross-tenant entity operations.
   */
  checkTenantIsolation(requesterTenantId: string, entityTenantId: string, entityId?: string): GuardCheckResult {
    if (requesterTenantId !== entityTenantId) {
      const v = record("cross_tenant_entity_merge", requesterTenantId, entityId, `Cross-tenant access: requester=${requesterTenantId}, entity=${entityTenantId}`, true);
      return { passed:false, violations:[v], blocked:true };
    }
    return { passed:true, violations:[], blocked:false };
  },

  /**
   * Guard 3: Check for orphan graph edges.
   */
  checkGraphEdge(tenantId: string, fromNodeExists: boolean, toNodeExists: boolean, edgeId?: string): GuardCheckResult {
    if (!fromNodeExists || !toNodeExists) {
      const v = record("orphan_graph_edge", tenantId, edgeId, `Orphan edge: fromNodeExists=${fromNodeExists}, toNodeExists=${toNodeExists}`, true);
      return { passed:false, violations:[v], blocked:true };
    }
    return { passed:true, violations:[], blocked:false };
  },

  /**
   * Guard 4: Detect event hash mismatch (tampering).
   */
  checkEventHash(tenantId: string, eventId: string, computedHash: string, storedHash: string): GuardCheckResult {
    if (computedHash !== storedHash) {
      const v = record("event_hash_mismatch", tenantId, eventId, `Hash mismatch: stored=${storedHash.slice(0,8)}, computed=${computedHash.slice(0,8)}`, true);
      return { passed:false, violations:[v], blocked:true };
    }
    return { passed:true, violations:[], blocked:false };
  },

  /**
   * Guard 5: Detect replay order corruption.
   */
  checkReplayOrder(tenantId: string, prevSeq: number, currentSeq: number, eventId?: string): GuardCheckResult {
    if (currentSeq <= prevSeq) {
      const v = record("replay_order_corruption", tenantId, eventId, `Out-of-order replay: prev=${prevSeq}, current=${currentSeq}`, true);
      return { passed:false, violations:[v], blocked:true };
    }
    return { passed:true, violations:[], blocked:false };
  },

  /**
   * Guard 6: Detect stale write overwrite.
   */
  checkVersionStaleness(tenantId: string, expectedVersion: number, actualVersion: number, entityId?: string): GuardCheckResult {
    if (expectedVersion < actualVersion) {
      const v = record("stale_write_overwrite", tenantId, entityId, `Stale write: expected v${expectedVersion} but entity is at v${actualVersion}`, true);
      return { passed:false, violations:[v], blocked:true };
    }
    return { passed:true, violations:[], blocked:false };
  },

  /**
   * Run all applicable guards in one pass.
   */
  runAll(checks: Array<() => GuardCheckResult>): GuardCheckResult {
    const allViolations: CorruptionGuardViolation[] = [];
    let anyBlocked = false;
    for (const check of checks) {
      const result = check();
      allViolations.push(...result.violations);
      if (result.blocked) anyBlocked = true;
    }
    return { passed: allViolations.length === 0, violations: allViolations, blocked: anyBlocked };
  },

  getViolations(tenantId: string): CorruptionGuardViolation[] {
    return allViolations.filter(v => v.tenantId === tenantId);
  },

  getAllViolations(): CorruptionGuardViolation[] {
    return [...allViolations];
  },
};
