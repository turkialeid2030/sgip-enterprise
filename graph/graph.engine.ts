/**
 * Sovereign Knowledge Graph Engine
 * ─────────────────────────────────────────────────────────────────────
 * Real graph with typed nodes + directed edges.
 * NOT a JSON array of IDs — every relationship is a first-class object.
 *
 * Production TODO: swap in-memory store → Neo4j / TigerGraph
 * Interface is stable; only the storage adapter changes.
 */
import { v4 as uuidv4 } from "uuid";
import {
  GraphNode, GraphEdge, GraphQuery, GraphQueryResult,
  GraphPath, ImpactAnalysis, EntityResolutionResult,
} from "../types/graph.types";
import { UGOMType, RelationshipType } from "../types/governance.types";
import { EventBus } from "../core/event-bus";
import { AuditLogger } from "../audit/audit.logger";

// ── In-memory stores (swap for DB adapters in production) ─────────────
const nodeStore  = new Map<string, GraphNode>();
const edgeStore  = new Map<string, GraphEdge>();
// Index: nodeId → Set<edgeId>
const nodeEdgeIndex = new Map<string, Set<string>>();

function indexEdge(edge: GraphEdge): void {
  for (const nodeId of [edge.fromId, edge.toId]) {
    if (!nodeEdgeIndex.has(nodeId)) nodeEdgeIndex.set(nodeId, new Set());
    nodeEdgeIndex.get(nodeId)!.add(edge.id);
  }
}

export class SovereignKnowledgeGraph {
  constructor(
    private readonly eventBus: EventBus,
    private readonly auditLogger: AuditLogger,
    private readonly tenantId: string,
  ) {}

  // ── Node Operations ──────────────────────────────────────────────────

  upsertNode(params: {
    id:         string;
    type:       UGOMType;
    label:      string;
    properties: Record<string, unknown>;
    createdBy:  string;
  }): GraphNode {
    const existing = nodeStore.get(params.id);
    const node: GraphNode = {
      id:         params.id,
      type:       params.type,
      label:      params.label,
      properties: params.properties,
      tenantId:   this.tenantId,
      createdAt:  existing?.createdAt ?? new Date().toISOString(),
      updatedAt:  new Date().toISOString(),
      version:    (existing?.version ?? 0) + 1,
    };
    nodeStore.set(node.id, node);
    this.eventBus.emit({
      id: uuidv4(), type: "graph.edge_created", source: "SKG",
      entityId: node.id, entityType: node.type,
      payload: { action: existing ? "updated" : "created", node },
      tenantId: this.tenantId,
      timestamp: new Date().toISOString(),
      traceId: uuidv4(), handled: false,
    });
    return node;
  }

  getNode(id: string): GraphNode | undefined {
    return nodeStore.get(id);
  }

  deleteNode(id: string, deletedBy: string): void {
    const node = nodeStore.get(id);
    if (!node) return;
    // Remove all edges involving this node
    const edgeIds = nodeEdgeIndex.get(id);
    if (edgeIds) {
      for (const eid of edgeIds) {
        edgeStore.delete(eid);
      }
      nodeEdgeIndex.delete(id);
    }
    nodeStore.delete(id);
    this.auditLogger.log({
      action: "graph.node_deleted", entityId: id, entityType: node.type,
      performedBy: deletedBy, details: { label: node.label },
    });
  }

  // ── Edge Operations ──────────────────────────────────────────────────

  createEdge(params: {
    fromId:       string;
    fromType:     UGOMType;
    toId:         string;
    toType:       UGOMType;
    relationship: RelationshipType;
    weight?:      number;
    properties?:  Record<string, unknown>;
    createdBy:    string;
    isInferred?:  boolean;
  }): GraphEdge | null {
    // Prevent self-loops
    if (params.fromId === params.toId) return null;
    // Check for duplicate edge
    const existing = this.findEdge(params.fromId, params.toId, params.relationship);
    if (existing) return existing;

    const edge: GraphEdge = {
      id:           uuidv4(),
      fromId:       params.fromId,
      fromType:     params.fromType,
      toId:         params.toId,
      toType:       params.toType,
      relationship: params.relationship,
      weight:       params.weight ?? 5,
      properties:   params.properties ?? {},
      createdAt:    new Date().toISOString(),
      createdBy:    params.createdBy,
      tenantId:     this.tenantId,
      isInferred:   params.isInferred ?? false,
    };
    edgeStore.set(edge.id, edge);
    indexEdge(edge);
    this.eventBus.emit({
      id: uuidv4(), type: "graph.edge_created", source: "SKG",
      payload: edge, tenantId: this.tenantId,
      timestamp: new Date().toISOString(), traceId: uuidv4(), handled: false,
    });
    return edge;
  }

  findEdge(
    fromId: string, toId: string, relationship?: RelationshipType,
  ): GraphEdge | undefined {
    const edgeIds = nodeEdgeIndex.get(fromId);
    if (!edgeIds) return undefined;
    for (const eid of edgeIds) {
      const edge = edgeStore.get(eid);
      if (!edge) continue;
      if (edge.fromId === fromId && edge.toId === toId) {
        if (!relationship || edge.relationship === relationship) return edge;
      }
    }
    return undefined;
  }

  getEdgesForNode(nodeId: string): GraphEdge[] {
    const edgeIds = nodeEdgeIndex.get(nodeId) ?? new Set();
    return [...edgeIds].map(id => edgeStore.get(id)!).filter(Boolean);
  }

  removeEdge(edgeId: string): void {
    const edge = edgeStore.get(edgeId);
    if (!edge) return;
    edgeStore.delete(edgeId);
    nodeEdgeIndex.get(edge.fromId)?.delete(edgeId);
    nodeEdgeIndex.get(edge.toId)?.delete(edgeId);
  }

  // ── Graph Traversal ──────────────────────────────────────────────────

  query(q: GraphQuery): GraphQueryResult {
    const startMs = Date.now();
    const visited  = new Set<string>();
    const result   = { nodes: [] as GraphNode[], edges: [] as GraphEdge[] };
    const depth    = q.maxDepth ?? 4;

    const traverse = (nodeId: string, currentDepth: number): void => {
      if (currentDepth > depth || visited.has(nodeId)) return;
      visited.add(nodeId);
      const node = nodeStore.get(nodeId);
      if (!node) return;
      if (node.tenantId !== q.tenantId) return;
      if (q.nodeTypes && !q.nodeTypes.includes(node.type)) return;
      result.nodes.push(node);

      const edges = this.getEdgesForNode(nodeId);
      for (const edge of edges) {
        if (q.relationships && !q.relationships.includes(edge.relationship)) continue;
        if (q.minWeight !== undefined && edge.weight < q.minWeight) continue;
        if (!q.includeInferred && edge.isInferred) continue;
        const neighborId = edge.fromId === nodeId ? edge.toId : edge.fromId;
        if (!visited.has(neighborId)) {
          result.edges.push(edge);
          traverse(neighborId, currentDepth + 1);
        }
      }
    };

    if (q.startNodeId) {
      traverse(q.startNodeId, 0);
    } else {
      // Full tenant scan
      for (const [id, node] of nodeStore) {
        if (node.tenantId === q.tenantId) traverse(id, 0);
      }
    }

    return {
      nodes: result.nodes,
      edges: result.edges,
      paths: this.extractPaths(q.startNodeId, result.nodes, result.edges),
      metadata: {
        nodeCount:   result.nodes.length,
        edgeCount:   result.edges.length,
        queryTimeMs: Date.now() - startMs,
        truncated:   result.nodes.length >= 500,
      },
    };
  }

  // ── Traceability Chain ────────────────────────────────────────────────

  getTraceabilityChain(startId: string, maxDepth = 6): GraphPath {
    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];
    const visited = new Set<string>();

    const traverse = (id: string, depth: number): void => {
      if (depth > maxDepth || visited.has(id)) return;
      visited.add(id);
      const node = nodeStore.get(id);
      if (!node) return;
      nodes.push(node);
      this.getEdgesForNode(id)
        .filter(e => e.fromId === id)
        .forEach(e => { edges.push(e); traverse(e.toId, depth + 1); });
    };

    traverse(startId, 0);
    return {
      pathId: uuidv4(),
      nodes, edges,
      depth: nodes.length,
      score: nodes.length * 10,
    };
  }

  // ── Impact Analysis ───────────────────────────────────────────────────

  analyzeImpact(sourceId: string): ImpactAnalysis {
    const sourceNode = nodeStore.get(sourceId);
    if (!sourceNode) throw new Error(`Node not found: ${sourceId}`);

    const directEdges  = this.getEdgesForNode(sourceId).filter(e => e.fromId === sourceId);
    const directNodes  = directEdges.map(e => nodeStore.get(e.toId)).filter(Boolean) as GraphNode[];
    const indirectSet  = new Set<string>();

    for (const dn of directNodes) {
      const secondLevel = this.getEdgesForNode(dn.id).filter(e => e.fromId === dn.id);
      for (const e of secondLevel) {
        if (e.toId !== sourceId) indirectSet.add(e.toId);
      }
    }

    const indirectNodes = [...indirectSet]
      .map(id => nodeStore.get(id))
      .filter(Boolean) as GraphNode[];

    const propagationScore = Math.min(100,
      (directNodes.length * 15) + (indirectNodes.length * 5));

    const riskAmplification = directNodes.filter(n =>
      n.type === "risk" || n.type === "control"
    ).length * 1.5;

    return {
      sourceNode,
      directImpact:    directNodes,
      indirectImpact:  indirectNodes,
      propagationScore,
      riskAmplification,
      criticalPath:    this.getTraceabilityChain(sourceId, 3),
    };
  }

  // ── Blind Spot Detection ──────────────────────────────────────────────

  detectBlindSpots(): { orphanedNodes: GraphNode[]; isolatedRisks: GraphNode[]; uncoveredObligations: GraphNode[] } {
    const connectedIds = new Set<string>();
    for (const edge of edgeStore.values()) {
      connectedIds.add(edge.fromId);
      connectedIds.add(edge.toId);
    }
    const orphanedNodes = [...nodeStore.values()].filter(
      n => n.tenantId === this.tenantId && !connectedIds.has(n.id)
    );
    const isolatedRisks = [...nodeStore.values()].filter(n =>
      n.type === "risk" && n.tenantId === this.tenantId &&
      !this.getEdgesForNode(n.id).some(e => e.relationship === "mitigates")
    );
    const uncoveredObligations = [...nodeStore.values()].filter(n =>
      n.type === "compliance_obligation" && n.tenantId === this.tenantId &&
      !this.getEdgesForNode(n.id).some(e =>
        e.relationship === "addresses" || e.relationship === "enforced_by"
      )
    );
    return { orphanedNodes, isolatedRisks, uncoveredObligations };
  }

  // ── Entity Resolution & Deduplication ────────────────────────────────

  resolveEntity(candidateLabel: string, type: UGOMType): EntityResolutionResult {
    const candidates = [...nodeStore.values()].filter(n =>
      n.type === type &&
      n.tenantId === this.tenantId &&
      n.label.toLowerCase().includes(candidateLabel.toLowerCase().slice(0, 10))
    );
    if (candidates.length === 0) {
      return { canonicalId: "", duplicates: [], confidence: 0, mergeStrategy: "manual_review" };
    }
    const canonical = candidates[0];
    const duplicates = candidates.slice(1).map(c => c.id);
    const confidence = duplicates.length === 0 ? 100 : 60;
    return {
      canonicalId: canonical.id,
      duplicates,
      confidence,
      mergeStrategy: confidence > 90 ? "keep_latest" : "manual_review",
    };
  }

  // ── Relationship Indexing ─────────────────────────────────────────────

  getRelationshipIndex(): Map<RelationshipType, number> {
    const index = new Map<RelationshipType, number>();
    for (const edge of edgeStore.values()) {
      index.set(edge.relationship, (index.get(edge.relationship) ?? 0) + 1);
    }
    return index;
  }

  getStats() {
    return {
      nodeCount: nodeStore.size,
      edgeCount: edgeStore.size,
      nodesByType: Object.fromEntries(
        [...nodeStore.values()].reduce((acc, n) => {
          acc.set(n.type, (acc.get(n.type) ?? 0) + 1);
          return acc;
        }, new Map<string, number>())
      ),
      relationshipIndex: Object.fromEntries(this.getRelationshipIndex()),
    };
  }

  // ── Private Helpers ───────────────────────────────────────────────────

  private extractPaths(
    startId: string | undefined,
    nodes: GraphNode[],
    edges: GraphEdge[],
  ): GraphPath[] {
    if (!startId) return [];
    return [{
      pathId: uuidv4(),
      nodes,
      edges,
      depth: nodes.length,
      score: nodes.length * 8,
    }];
  }
}
