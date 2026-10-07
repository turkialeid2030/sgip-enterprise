/**
 * Chain Verifier — integrity checks for evidence chains.
 * Detects: tampering, broken links, expired evidence, missing attestations.
 */
import { EvidenceLineageEngine, getEvidenceEngine } from "../lineage/evidence.lineage.engine";
import { TenantContext } from "../../types/tenant.types";

export interface ChainVerificationReport {
  entityId:      string;
  tenantId:      string;
  chainLength:   number;
  integrityScore:number;
  tampered:      boolean;
  brokenLinks:   string[];
  expiredRecords:string[];
  missingAttestation: boolean;
  recommendation:string;
  verifiedAt:    string;
}

export class ChainVerifier {
  verify(entityId: string, ctx: TenantContext): ChainVerificationReport {
    const engine = getEvidenceEngine(ctx.tenantId);
    const chain  = engine.getChainForEntity(entityId);

    const brokenLinks:    string[] = [];
    const expiredRecords: string[] = [];
    let integrityScore = 100;
    let tampered = false;

    if (!chain || chain.records.length === 0) {
      return {
        entityId, tenantId: ctx.tenantId, chainLength: 0,
        integrityScore: 0, tampered: false,
        brokenLinks: [], expiredRecords: [],
        missingAttestation: true,
        recommendation: "No evidence chain found — create evidence records",
        verifiedAt: new Date().toISOString(),
      };
    }

    // Verify each record
    for (const rec of chain.records) {
      const check = engine.verifyRecord(rec.id);
      if (check.tampered) {
        brokenLinks.push(rec.id);
        tampered = true;
        integrityScore -= 25;
      }
      if (rec.expiresAt && rec.expiresAt < new Date().toISOString()) {
        expiredRecords.push(rec.id);
        integrityScore -= 10;
      }
    }

    const attestations      = engine.getAttestationsForEntity(entityId);
    const missingAttestation = attestations.length === 0;
    if (missingAttestation) integrityScore -= 15;

    integrityScore = Math.max(0, integrityScore);

    const recommendation = tampered
      ? "CRITICAL: Evidence tampering detected — immediate investigation required"
      : expiredRecords.length > 0
      ? "Evidence records expired — refresh required for compliance"
      : missingAttestation
      ? "No attestation found — request control owner attestation"
      : integrityScore >= 90
      ? "Evidence chain is complete and verified"
      : "Evidence chain has issues — review and remediate";

    return {
      entityId, tenantId: ctx.tenantId,
      chainLength:  chain.records.length,
      integrityScore, tampered, brokenLinks, expiredRecords,
      missingAttestation, recommendation,
      verifiedAt: new Date().toISOString(),
    };
  }
}

export const chainVerifier = new ChainVerifier();
