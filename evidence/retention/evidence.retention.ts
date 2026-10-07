/**
 * Evidence Retention Manager — enforces retention policies on evidence records.
 * Identifies records approaching expiry or eligible for archival.
 */
import { EvidenceLineageEngine, getEvidenceEngine } from "../lineage/evidence.lineage.engine";
import { TenantContext } from "../../types/tenant.types";

export interface RetentionScanResult {
  tenantId:        string;
  scannedAt:       string;
  expiringSoon:    string[];   // expires in < 30 days
  expired:         string[];   // already expired
  legalHolds:      string[];   // never expire while hold active
  purgeEligible:   string[];   // expired + no legal hold
  totalRecords:    number;
}

export class EvidenceRetentionManager {
  scan(ctx: TenantContext): RetentionScanResult {
    const engine  = getEvidenceEngine(ctx.tenantId);
    const records = engine.findRecords({ tenantId: ctx.tenantId, limit: 10000 });
    const now     = new Date();
    const in30    = new Date(now.getTime() + 30 * 86400 * 1000).toISOString();
    const nowISO  = now.toISOString();

    const expiringSoon:  string[] = [];
    const expired:       string[] = [];
    const legalHolds:    string[] = [];
    const purgeEligible: string[] = [];

    for (const rec of records) {
      if (rec.legalHold)  { legalHolds.push(rec.id); continue; }
      if (!rec.expiresAt) continue;
      if (rec.expiresAt < nowISO) {
        expired.push(rec.id);
        purgeEligible.push(rec.id);
      } else if (rec.expiresAt < in30) {
        expiringSoon.push(rec.id);
      }
    }

    return { tenantId: ctx.tenantId, scannedAt: nowISO, expiringSoon, expired, legalHolds, purgeEligible, totalRecords: records.length };
  }
}

export const evidenceRetentionManager = new EvidenceRetentionManager();
