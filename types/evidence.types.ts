/**
 * Evidence Lineage Types
 * Every governance decision must be provable.
 * Evidence chains are immutable once created.
 */
export type EvidenceSourceType =
  | "document"       | "system_log"     | "process_log"
  | "board_resolution"| "audit_report"   | "control_test"
  | "attestation"    | "policy"          | "contract"
  | "email"          | "financial_statement" | "risk_assessment"
  | "external_audit" | "regulatory_filing" | "interview_record";

export type EvidenceStatus =
  | "pending"     | "verified"   | "failed"
  | "expired"     | "tampered"   | "legal_hold" | "archived";

export interface EvidenceRecord {
  id:               string;
  tenantId:         string;
  code:             string;
  title:            string;
  sourceType:       EvidenceSourceType;
  status:           EvidenceStatus;
  // Integrity
  contentHash:      string;    // SHA-256 of content
  chainHash:        string;    // SHA-256(previous_hash + contentHash + timestamp)
  previousHash?:    string;    // links to prior evidence in chain
  integrityScore:   number;    // 0-100
  // Provenance
  collectedBy:      string;
  collectedAt:      string;
  sourceSystem?:    string;
  sourceRef?:       string;    // external reference (document number, etc.)
  // Linkage
  entityId:         string;
  entityType:       string;
  correlationId:    string;
  // Retention
  retentionDays:    number;
  expiresAt?:       string;
  legalHold:        boolean;
  legalHoldReason?: string;
  // Verification
  verifiedBy?:      string;
  verifiedAt?:      string;
  verificationNotes?:string;
  // Metadata
  version:          number;
  createdAt:        string;
  updatedAt:        string;
}

// ── Evidence Chain (linked list of records) ───────────────────
export interface EvidenceChain {
  chainId:        string;
  tenantId:       string;
  entityId:       string;
  entityType:     string;
  records:        EvidenceRecord[];
  chainIntegrity: boolean;     // all hashes valid
  chainScore:     number;      // 0-100
  gaps:           EvidenceGap[];
  createdAt:      string;
  lastUpdatedAt:  string;
}

export interface EvidenceGap {
  position:    number;
  description: string;
  severity:    "critical" | "high" | "medium";
}

// ── Attestation ───────────────────────────────────────────────
export interface Attestation {
  id:              string;
  tenantId:        string;
  entityId:        string;
  entityType:      string;
  attestedBy:      string;
  attestedByRole:  string;
  statement:       string;
  confidence:      number;     // 0-100
  evidenceIds:     string[];
  policyRef?:      string;
  signatureHash:   string;     // attestedBy:entityId:statement:timestamp
  timestamp:       string;
  expiresAt?:      string;
  isRevoked:       boolean;
  revokedReason?:  string;
  correlationId:   string;
}

// ── Immutable Decision Record ─────────────────────────────────
export interface ImmutableDecisionRecord {
  decisionId:      string;
  tenantId:        string;
  decisionType:    string;
  entityId:        string;
  entityType:      string;
  actorId:         string;
  actorRole:       string;
  outcome:         string;
  rationale:       string;
  evidenceRefs:    string[];
  policyRefs:      string[];
  approvalRefs:    string[];
  sodChecked:      boolean;
  sodViolations:   number;
  policyAllowed:   boolean;
  integrityHash:   string;
  correlationId:   string;
  timestamp:       string;
  isSealed:        boolean;    // once sealed, cannot be modified
}

// ── Evidence Query ────────────────────────────────────────────
export interface EvidenceQuery {
  tenantId:    string;
  entityId?:   string;
  entityType?: string;
  status?:     EvidenceStatus;
  sourceType?: EvidenceSourceType;
  fromDate?:   string;
  toDate?:     string;
  legalHold?:  boolean;
  limit?:      number;
}
