/**
 * Governance Graph v4 Types
 * Typed node + edge contracts for the Governance Knowledge Runtime.
 * Every governance entity is a node. Every relationship is a typed edge.
 * No relationship exists outside this type system.
 */

// ── Node types (governance entity taxonomy) ───────────────────
export type GovernanceNodeType =
  | "regulation"         | "policy"             | "control"
  | "risk"               | "incident"           | "audit_finding"
  | "evidence"           | "vendor"             | "kpi"
  | "kri"                | "kci"                | "board_decision"
  | "committee"          | "exception"          | "remediation"
  | "audit_finding_ref"  | "attestation"        | "workflow"
  | "asset"              | "user"               | "role"
  | "tenant"             | "capa"               | "obligation"
  | "strategic_objective"| "contract"           | "procedure";

// ── Edge relationship taxonomy ────────────────────────────────
export type GovernanceEdgeType =
  // Regulatory chain
  | "REGULATION_REQUIRES_CONTROL"  | "REGULATION_CREATES_OBLIGATION"
  | "POLICY_IMPLEMENTS_REGULATION" | "POLICY_SUPERSEDES_POLICY"
  | "POLICY_GOVERNS_CONTROL"       | "CONTROL_ADDRESSES_RISK"
  // Evidence chain
  | "EVIDENCE_SUPPORTS_FINDING"    | "EVIDENCE_VALIDATES_CONTROL"
  | "EVIDENCE_PROVES_COMPLIANCE"   | "ATTESTATION_CERTIFIES_CONTROL"
  // Risk propagation
  | "RISK_THREATENS_ASSET"         | "RISK_AMPLIFIES_RISK"
  | "INCIDENT_TRIGGERS_RISK"       | "VENDOR_INTRODUCES_RISK"
  // Audit lineage
  | "FINDING_SPAWNS_CAPA"          | "CAPA_CLOSES_FINDING"
  | "EXCEPTION_OVERRIDES_CONTROL"  | "WORKFLOW_APPROVES_EXCEPTION"
  // Organizational
  | "COMMITTEE_OWNS_POLICY"        | "COMMITTEE_APPROVES_DECISION"
  | "USER_OWNS_RISK"               | "USER_ATTESTS_CONTROL"
  | "ROLE_GRANTS_ACCESS"           | "ROLE_RESTRICTS_ACTION"
  // KPI linkage
  | "KRI_MEASURES_RISK"            | "KCI_TESTS_CONTROL"
  | "KPI_TRACKS_OBJECTIVE"         | "FINDING_BREACHES_KRI"
  // Inheritance
  | "CONTROL_INHERITS_CONTROL"     | "POLICY_INHERITS_POLICY"
  | "RISK_INHERITS_RISK";

// ── Typed Graph Node ──────────────────────────────────────────
export interface GovernanceGraphNode {
  id:           string;
  type:         GovernanceNodeType;
  tenantId:     string;
  label:        string;
  properties:   GovernanceNodeProperties;
  createdAt:    string;
  updatedAt:    string;
  version:      number;
}

export interface GovernanceNodeProperties {
  status?:          string;
  riskLevel?:       string;
  owner?:           string;
  score?:           number;
  code?:            string;
  effectiveFrom?:   string;
  effectiveTo?:     string;
  freshnessScore?:  number;
  confidenceScore?: number;
  [key: string]:    unknown;
}

// ── Typed Graph Edge ──────────────────────────────────────────
export interface GovernanceGraphEdge {
  id:           string;
  fromId:       string;
  fromType:     GovernanceNodeType;
  toId:         string;
  toType:       GovernanceNodeType;
  edgeType:     GovernanceEdgeType;
  tenantId:     string;
  weight:       number;        // 0-10, semantic strength
  properties:   EdgeProperties;
  evidenceId?:  string;        // supporting evidence for this relationship
  createdAt:    string;
  createdBy:    string;
  isInferred:   boolean;       // derived by engine vs explicit
}

export interface EdgeProperties {
  rationale?:    string;
  effectiveFrom?:string;
  effectiveTo?:  string;
  policyRef?:    string;
  auditRef?:     string;
  [key: string]: unknown;
}

// ── Graph Query ───────────────────────────────────────────────
export interface GovernanceGraphQuery {
  tenantId:          string;
  startNodeId?:      string;
  startNodeTypes?:   GovernanceNodeType[];
  edgeTypes?:        GovernanceEdgeType[];
  maxDepth?:         number;
  minWeight?:        number;
  includeInferred?:  boolean;
  filter?:           Partial<GovernanceNodeProperties>;
  limit?:            number;
}

export interface GovernanceGraphResult {
  nodes:    GovernanceGraphNode[];
  edges:    GovernanceGraphEdge[];
  paths:    GovernancePath[];
  metadata: GraphMetadata;
}

export interface GovernancePath {
  pathId:     string;
  nodes:      GovernanceGraphNode[];
  edges:      GovernanceGraphEdge[];
  depth:      number;
  totalWeight:number;
  annotation?: string;
}

export interface GraphMetadata {
  nodeCount:   number;
  edgeCount:   number;
  queryTimeMs: number;
  truncated:   boolean;
}

// ── Impact Analysis ───────────────────────────────────────────
export interface ImpactAnalysisResult {
  sourceNode:          GovernanceGraphNode;
  directImpact:        ImpactNode[];
  transitiveImpact:    ImpactNode[];
  blastRadius:         number;         // estimated affected entities
  criticalPathLength:  number;
  riskAmplification:   number;
  affectedRegulations: string[];
  affectedCommittees:  string[];
  propagationScore:    number;         // 0-100
  recommendation:      string;
}

export interface ImpactNode {
  node:        GovernanceGraphNode;
  depth:       number;
  pathWeight:  number;
  impactType:  "direct" | "transitive";
  via:         string[];              // edge types traversed
}

// ── Regulatory Mapping ────────────────────────────────────────
export interface RegulatoryMapping {
  regulationId:   string;
  regulationCode: string;
  policies:       GovernanceGraphNode[];
  controls:       GovernanceGraphNode[];
  obligations:    GovernanceGraphNode[];
  gaps:           RegulatoryGap[];
  coverageScore:  number;             // 0-100
}

export interface RegulatoryGap {
  type:        "no_policy" | "no_control" | "no_evidence" | "expired_control" | "untested_control";
  entityType:  GovernanceNodeType;
  description: string;
  severity:    "critical" | "high" | "medium" | "low";
}

// ── Blast Radius ──────────────────────────────────────────────
export interface BlastRadiusAnalysis {
  sourceId:      string;
  sourceType:    GovernanceNodeType;
  scenario:      string;
  affectedNodes: Map<GovernanceNodeType, number>;
  criticalNodes: GovernanceGraphNode[];
  riskScore:     number;
  mitigations:   string[];
}
