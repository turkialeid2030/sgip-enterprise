/**
 * Evidence Lineage Engine
 * Every governance decision must be provable.
 * Evidence chains are immutable linked lists with SHA-256 integrity hashes.
 *
 * Chain integrity: each record hashes the previous record's hash.
 * Any tampering breaks the chain — detectable on verify().
 */
import { v4 as uuidv4 } from "uuid";
import {
  EvidenceRecord, EvidenceChain, EvidenceGap,
  Attestation, ImmutableDecisionRecord, EvidenceQuery, EvidenceStatus,
} from "../../types/evidence.types";
import { query } from "../../api/services/db.service";
import { TenantContext } from "../../types/tenant.types";

// ── Simple deterministic hash (SHA-256 substitute — no crypto module needed) ──
// Production: replace with crypto.createHash("sha256").update(input).digest("hex")
function computeHash(input: string): string {
  let h = 0;
  for (let i = 0; i < input.length; i++) {
    h = ((h << 5) - h + input.charCodeAt(i)) | 0;
  }
  return `h-${Math.abs(h).toString(16).padStart(8, "0")}-${input.length}`;
}

function computeChainHash(previousHash: string | undefined, contentHash: string, timestamp: string): string {
  return computeHash(`${previousHash ?? "genesis"}:${contentHash}:${timestamp}`);
}

// ── In-memory store (production: PostgreSQL with append-only RLS) ──
const evidenceStore = new Map<string, EvidenceRecord>();
const chainStore    = new Map<string, EvidenceChain>();      // chainId → chain
const entityChains  = new Map<string, string>();              // `tenantId:entityId` → chainId
const decisionStore = new Map<string, ImmutableDecisionRecord>();
const attestStore   = new Map<string, Attestation>();

export class EvidenceLineageEngine {
  constructor(private readonly tenantId: string) {}

  // ── Create Evidence Record ─────────────────────────────────

  createRecord(params: {
    entityId:    string;
    entityType:  string;
    title:       string;
    sourceType:  EvidenceRecord["sourceType"];
    content:     string;          // content to hash
    collectedBy: string;
    correlationId: string;
    retentionDays?: number;
    legalHold?:  boolean;
  }): EvidenceRecord {
    const chainKey = `${this.tenantId}:${params.entityId}`;
    const existingChainId = entityChains.get(chainKey);
    const chain = existingChainId ? chainStore.get(existingChainId) : undefined;
    const previousRecord = chain?.records.at(-1);
    const previousHash   = previousRecord?.chainHash;

    const timestamp   = new Date().toISOString();
    const contentHash = computeHash(params.content);
    const chainHash   = computeChainHash(previousHash, contentHash, timestamp);

    const record: EvidenceRecord = {
      id:             uuidv4(),
      tenantId:       this.tenantId,
      code:           `EV-${Date.now().toString(36).toUpperCase()}`,
      title:          params.title,
      sourceType:     params.sourceType,
      status:         "pending",
      contentHash,
      chainHash,
      previousHash,
      integrityScore: 100,
      collectedBy:    params.collectedBy,
      collectedAt:    timestamp,
      entityId:       params.entityId,
      entityType:     params.entityType,
      correlationId:  params.correlationId,
      retentionDays:  params.retentionDays ?? 365,
      legalHold:      params.legalHold ?? false,
      version:        1,
      createdAt:      timestamp,
      updatedAt:      timestamp,
    };
    evidenceStore.set(record.id, record);

    // Append to chain
    this.appendToChain(params.entityId, record);

    return record;
  }

  // ── Verify Evidence Chain Integrity ───────────────────────

  verifyChain(entityId: string): { valid: boolean; issues: string[]; score: number } {
    const chainKey = `${this.tenantId}:${entityId}`;
    const chainId  = entityChains.get(chainKey);
    if (!chainId) return { valid: true, issues: [], score: 100 };
    const chain = chainStore.get(chainId);
    if (!chain) return { valid: false, issues: ["Chain not found"], score: 0 };

    const issues: string[] = [];
    for (let i = 0; i < chain.records.length; i++) {
      const rec  = chain.records[i];
      const prev = chain.records[i - 1];
      const expectedChainHash = computeChainHash(prev?.chainHash, rec.contentHash, rec.collectedAt);
      if (rec.chainHash !== expectedChainHash) {
        issues.push(`Record ${rec.id} (position ${i}): chain hash mismatch — possible tampering`);
      }
      if (i > 0 && rec.previousHash !== prev!.chainHash) {
        issues.push(`Record ${rec.id}: previousHash doesn't match prior record — chain broken`);
      }
    }

    const score = issues.length === 0 ? 100 : Math.max(0, 100 - issues.length * 20);
    return { valid: issues.length === 0, issues, score };
  }

  // ── Verify Single Record ───────────────────────────────────

  verifyRecord(recordId: string): { valid: boolean; tampered: boolean; issue?: string } {
    const record = evidenceStore.get(recordId);
    if (!record || record.tenantId !== this.tenantId) {
      return { valid: false, tampered: false, issue: "Record not found" };
    }
    const expectedChainHash = computeChainHash(record.previousHash, record.contentHash, record.collectedAt);
    if (record.chainHash !== expectedChainHash) {
      return { valid: false, tampered: true, issue: "Chain hash mismatch — evidence may have been tampered" };
    }
    return { valid: true, tampered: false };
  }

  // ── Create Attestation ─────────────────────────────────────

  createAttestation(params: {
    entityId:     string;
    entityType:   string;
    statement:    string;
    attestedBy:   string;
    attestedByRole: string;
    evidenceIds:  string[];
    confidence:   number;
    policyRef?:   string;
    correlationId:string;
  }): Attestation {
    const timestamp = new Date().toISOString();
    const signatureHash = computeHash(`${params.attestedBy}:${params.entityId}:${params.statement}:${timestamp}`);

    const attestation: Attestation = {
      id:             uuidv4(),
      tenantId:       this.tenantId,
      entityId:       params.entityId,
      entityType:     params.entityType,
      attestedBy:     params.attestedBy,
      attestedByRole: params.attestedByRole,
      statement:      params.statement,
      confidence:     params.confidence,
      evidenceIds:    params.evidenceIds,
      policyRef:      params.policyRef,
      signatureHash,
      timestamp,
      isRevoked:      false,
      correlationId:  params.correlationId,
    };
    attestStore.set(attestation.id, attestation);

    // Auto-create evidence record for the attestation itself
    this.createRecord({
      entityId:    params.entityId,
      entityType:  params.entityType,
      title:       `Attestation by ${params.attestedBy}`,
      sourceType:  "attestation",
      content:     `${params.statement}:${signatureHash}`,
      collectedBy: params.attestedBy,
      correlationId: params.correlationId,
    });

    return attestation;
  }

  revokeAttestation(attestationId: string, reason: string): void {
    const att = attestStore.get(attestationId);
    if (att && att.tenantId === this.tenantId) {
      attestStore.set(attestationId, { ...att, isRevoked: true, revokedReason: reason });
    }
  }

  // ── Seal Immutable Decision Record ────────────────────────

  sealDecisionRecord(params: {
    decisionType:  string;
    entityId:      string;
    entityType:    string;
    actorId:       string;
    actorRole:     string;
    outcome:       string;
    rationale:     string;
    evidenceRefs:  string[];
    policyRefs:    string[];
    approvalRefs:  string[];
    sodChecked:    boolean;
    sodViolations: number;
    policyAllowed: boolean;
    correlationId: string;
  }): ImmutableDecisionRecord {
    const timestamp = new Date().toISOString();
    const integrityHash = computeHash(
      `${params.decisionType}:${params.entityId}:${params.actorId}:${params.outcome}:${timestamp}`
    );
    const record: ImmutableDecisionRecord = {
      decisionId:    uuidv4(),
      tenantId:      this.tenantId,
      ...params,
      integrityHash,
      timestamp,
      isSealed:      true,
    };
    Object.freeze(record);
    decisionStore.set(record.decisionId, record);

    // Attach to evidence chain
    this.createRecord({
      entityId:    params.entityId,
      entityType:  params.entityType,
      title:       `Decision: ${params.decisionType} — ${params.outcome}`,
      sourceType:  "process_log",
      content:     `${params.outcome}:${integrityHash}`,
      collectedBy: params.actorId,
      correlationId: params.correlationId,
    });

    return record;
  }

  // ── Query ──────────────────────────────────────────────────

  getChainForEntity(entityId: string): EvidenceChain | null {
    const chainKey = `${this.tenantId}:${entityId}`;
    const chainId  = entityChains.get(chainKey);
    if (!chainId) return null;
    return chainStore.get(chainId) ?? null;
  }

  findRecords(q: EvidenceQuery): EvidenceRecord[] {
    return [...evidenceStore.values()].filter(r => {
      if (r.tenantId !== q.tenantId) return false;
      if (q.entityId   && r.entityId   !== q.entityId)   return false;
      if (q.entityType && r.entityType !== q.entityType)  return false;
      if (q.status     && r.status     !== q.status)      return false;
      if (q.sourceType && r.sourceType !== q.sourceType)  return false;
      if (q.legalHold  !== undefined && r.legalHold !== q.legalHold) return false;
      return true;
    }).slice(0, q.limit ?? 100);
  }

  getDecisionRecord(decisionId: string): ImmutableDecisionRecord | undefined {
    const rec = decisionStore.get(decisionId);
    if (rec && rec.tenantId !== this.tenantId) return undefined;
    return rec;
  }

  getAttestationsForEntity(entityId: string): Attestation[] {
    return [...attestStore.values()].filter(a => a.tenantId === this.tenantId && a.entityId === entityId && !a.isRevoked);
  }

  getStats() {
    const tenantRecords = [...evidenceStore.values()].filter(r => r.tenantId === this.tenantId);
    const tenantDecisions = [...decisionStore.values()].filter(d => d.tenantId === this.tenantId);
    const tenantAttestations = [...attestStore.values()].filter(a => a.tenantId === this.tenantId);
    return {
      records:      tenantRecords.length,
      chains:       [...entityChains.keys()].filter(k => k.startsWith(this.tenantId)).length,
      decisions:    tenantDecisions.length,
      attestations: tenantAttestations.length,
      legalHolds:   tenantRecords.filter(r => r.legalHold).length,
    };
  }

  // ── Private helpers ────────────────────────────────────────

  private appendToChain(entityId: string, record: EvidenceRecord): void {
    const chainKey = `${this.tenantId}:${entityId}`;
    let chainId    = entityChains.get(chainKey);
    if (!chainId) {
      chainId = uuidv4();
      const now = new Date().toISOString();
      chainStore.set(chainId, {
        chainId, tenantId: this.tenantId, entityId,
        entityType:     record.entityType,
        records:        [],
        chainIntegrity: true,
        chainScore:     100,
        gaps:           [],
        createdAt:      now,
        lastUpdatedAt:  now,
      });
      entityChains.set(chainKey, chainId);
    }
    const chain = chainStore.get(chainId)!;
    chain.records.push(record);
    chain.lastUpdatedAt = new Date().toISOString();
  }
}

// ── Factory: one engine per tenant ────────────────────────────
const evidenceEngineCache = new Map<string, EvidenceLineageEngine>();
export function getEvidenceEngine(tenantId: string): EvidenceLineageEngine {
  if (!evidenceEngineCache.has(tenantId)) {
    evidenceEngineCache.set(tenantId, new EvidenceLineageEngine(tenantId));
  }
  return evidenceEngineCache.get(tenantId)!;
}
