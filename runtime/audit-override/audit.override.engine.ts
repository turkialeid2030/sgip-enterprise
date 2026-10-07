/**
 * Audit Override Engine — Pilot Enhancement
 *
 * Implements the PDPL right to human review: when a governance officer overrides
 * an AI-driven score or decision, the override is recorded in an immutable,
 * hash-chained audit trail (SHA-256), mirroring the platform's event-store pattern.
 *
 * Additive module: does not modify any frozen runtime.
 */

import { createHash } from "crypto";

export interface OverrideRequest {
  tenantId:      string;
  actorId:       string;
  actorRole:     string;
  decisionType:  string;          // e.g. "decision_confidence", "risk_score", "control_status"
  entityId:      string;          // what was overridden
  originalValue: string | number;
  overrideValue: string | number;
  justification: string;          // mandatory — auditor requirement
}

export interface OverrideRecord extends OverrideRequest {
  id:           string;
  sequence:     number;
  hash:         string;
  previousHash: string;
  timestamp:    string;
}

export interface OverrideChainVerification {
  valid:        boolean;
  totalRecords: number;
  brokenAt:     number | null;
  message:      string;
}

const GENESIS_HASH = "GENESIS";

export class AuditOverrideEngine {
  private chains: Map<string, OverrideRecord[]> = new Map();

  private computeHash(r: Omit<OverrideRecord, "hash">): string {
    const payload = JSON.stringify({
      id: r.id, sequence: r.sequence, tenantId: r.tenantId, actorId: r.actorId,
      decisionType: r.decisionType, entityId: r.entityId,
      originalValue: r.originalValue, overrideValue: r.overrideValue,
      justification: r.justification, timestamp: r.timestamp, previousHash: r.previousHash,
    });
    return createHash("sha256").update(payload).digest("hex");
  }

  /** Record an override. Justification is mandatory. */
  recordOverride(req: OverrideRequest): { ok: boolean; record?: OverrideRecord; error?: string } {
    if (!req.justification || req.justification.trim().length < 10) {
      return { ok: false, error: "Justification is required (min 10 chars) for any override — auditor requirement." };
    }
    const chain = this.chains.get(req.tenantId) ?? [];
    const previousHash = chain.length > 0 ? chain[chain.length - 1].hash : GENESIS_HASH;
    const sequence = chain.length + 1;

    const base: Omit<OverrideRecord, "hash"> = {
      ...req,
      id: `ovr-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      sequence,
      previousHash,
      timestamp: new Date().toISOString(),
    };
    const hash = this.computeHash(base);
    const record: OverrideRecord = { ...base, hash };

    chain.push(record);
    this.chains.set(req.tenantId, chain);
    return { ok: true, record };
  }

  /** Retrieve the override history for a tenant (optionally filtered by entity). */
  getOverrides(tenantId: string, entityId?: string): OverrideRecord[] {
    const chain = this.chains.get(tenantId) ?? [];
    return entityId ? chain.filter(r => r.entityId === entityId) : [...chain];
  }

  /** Verify the integrity of the hash chain (tamper detection). */
  verifyChain(tenantId: string): OverrideChainVerification {
    const chain = this.chains.get(tenantId) ?? [];
    if (chain.length === 0) {
      return { valid: true, totalRecords: 0, brokenAt: null, message: "No overrides recorded." };
    }
    let prev = GENESIS_HASH;
    for (const rec of chain) {
      if (rec.previousHash !== prev) {
        return { valid: false, totalRecords: chain.length, brokenAt: rec.sequence, message: `Chain broken at sequence ${rec.sequence}: previousHash mismatch.` };
      }
      const { hash: _h, ...recWithoutHash } = rec;
      const recomputed = this.computeHash(recWithoutHash);
      if (recomputed !== rec.hash) {
        return { valid: false, totalRecords: chain.length, brokenAt: rec.sequence, message: `Chain broken at sequence ${rec.sequence}: hash mismatch (record altered).` };
      }
      prev = rec.hash;
    }
    return { valid: true, totalRecords: chain.length, brokenAt: null, message: "Override chain is intact and verifiable." };
  }

  reset(tenantId?: string): void {
    if (tenantId) this.chains.delete(tenantId);
    else this.chains.clear();
  }
}

let _engine: AuditOverrideEngine | null = null;
export function getAuditOverrideEngine(): AuditOverrideEngine {
  if (!_engine) _engine = new AuditOverrideEngine();
  return _engine;
}
