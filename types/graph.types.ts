/**
 * Sovereign Knowledge Graph — Type Definitions
 * Real graph relationships — not tags, not JSON arrays.
 */
import { UGOMType, RelationshipType } from "./governance.types";

// ── Graph Node ─────────────────────────────────────────────────────────
export interface GraphNode {
  id:           string;
  type:         UGOMType;
  label:        string;
  properties:   Record<string, unknown>;
  tenantId:     string;
  createdAt:    string;
  updatedAt:    string;
  version:      number;
}

// ── Graph Edge (typed, directed relationship) ──────────────────────────
export interface GraphEdge {
  id:           string;
  fromId:       string;
  fromType:     UGOMType;
  toId:         string;
  toType:       UGOMType;
  relationship: RelationshipType;
  weight:       number;           // semantic strength 0-10
  properties:   Record<string, unknown>;
  createdAt:    string;
  createdBy:    string;
  tenantId:     string;
  isInferred:   boolean;         // true = derived by engine, false = explicit
}

// ── Graph Query ────────────────────────────────────────────────────────
export interface GraphQuery {
  startNodeId?:   string;
  nodeTypes?:     UGOMType[];
  relationships?: RelationshipType[];
  maxDepth?:      number;
  minWeight?:     number;
  tenantId:       string;
  includeInferred?: boolean;
}

// ── Graph Query Result ─────────────────────────────────────────────────
export interface GraphQueryResult {
  nodes:    GraphNode[];
  edges:    GraphEdge[];
  paths:    GraphPath[];
  metadata: {
    nodeCount:   number;
    edgeCount:   number;
    queryTimeMs: number;
    truncated:   boolean;
  };
}

// ── Graph Path (traceability chain) ───────────────────────────────────
export interface GraphPath {
  pathId:    string;
  nodes:     GraphNode[];
  edges:     GraphEdge[];
  depth:     number;
  score:     number;
}

// ── Impact Analysis Result ─────────────────────────────────────────────
export interface ImpactAnalysis {
  sourceNode:     GraphNode;
  directImpact:   GraphNode[];
  indirectImpact: GraphNode[];
  propagationScore: number;
  riskAmplification: number;
  criticalPath:   GraphPath;
}

// ── Entity Resolution ──────────────────────────────────────────────────
export interface EntityResolutionResult {
  canonicalId:  string;
  duplicates:   string[];
  confidence:   number;
  mergeStrategy: 'keep_latest' | 'keep_highest_confidence' | 'manual_review';
}
