/**
 * Governance Graph Runtime v4
 * The central knowledge graph for all governance relationships.
 * Built on top of the existing SovereignKnowledgeGraph with typed governance semantics.
 *
 * Production: swap nodeStore/edgeStore → Neo4j / TigerGraph
 * Interface is stable — storage adapter changes only.
 */
import { v4 as uuidv4 } from "uuid";
import {
  GovernanceGraphNode, GovernanceGraphEdge, GovernanceNodeType, GovernanceEdgeType,
  GovernanceGraphQuery, GovernanceGraphResult, GovernancePath,
  ImpactAnalysisResult, ImpactNode, RegulatoryMapping, RegulatoryGap,
  BlastRadiusAnalysis, GraphMetadata,
} from "../../types/graph.v4.types";
import { query } from "../../api/services/db.service";

// ── In-memory stores (swap for DB adapter in production) ──────
const nodeStore = new Map<string, GovernanceGraphNode>();
const edgeStore = new Map<string, GovernanceGraphEdge>();
// Indexes: nodeId → Set<edgeId>
const outIndex  = new Map<string, Set<string>>();
const inIndex   = new Map<string, Set<string>>();
// Tenant index: tenantId → Set<nodeId>
const tenantIndex = new Map<string, Set<string>>();

function indexEdge(edge: GovernanceGraphEdge): void {
  if (!outIndex.has(edge.fromId)) outIndex.set(edge.fromId, new Set());
  if (!inIndex.has(edge.toId))    inIndex.set(edge.toId, new Set());
  outIndex.get(edge.fromId)!.add(edge.id);
  inIndex.get(edge.toId)!.add(edge.id);
}

function removeEdgeIndex(edge: GovernanceGraphEdge): void {
  outIndex.get(edge.fromId)?.delete(edge.id);
  inIndex.get(edge.toId)?.delete(edge.id);
}

export class GovernanceGraphRuntime {
  constructor(private readonly tenantId: string) {}

  // ── Node Operations ────────────────────────────────────────

  upsertNode(params: {
    id: string; type: GovernanceNodeType; label: string;
    properties?: GovernanceGraphNode["properties"]; createdBy?: string;
  }): GovernanceGraphNode {
    const existing = nodeStore.get(params.id);
    const node: GovernanceGraphNode = {
      id:         params.id,
      type:       params.type,
      tenantId:   this.tenantId,
      label:      params.label,
      properties: params.properties ?? {},
      createdAt:  existing?.createdAt ?? new Date().toISOString(),
      updatedAt:  new Date().toISOString(),
      version:    (existing?.version ?? 0) + 1,
    };
    nodeStore.set(node.id, node);
    if (!tenantIndex.has(this.tenantId)) tenantIndex.set(this.tenantId, new Set());
    tenantIndex.get(this.tenantId)!.add(node.id);
    return node;
  }

  getNode(id: string): GovernanceGraphNode | undefined {
    const node = nodeStore.get(id);
    // Tenant isolation: never return nodes from other tenants
    if (node && node.tenantId !== this.tenantId) return undefined;
    return node;
  }

  removeNode(id: string): void {
    const node = nodeStore.get(id);
    if (!node || node.tenantId !== this.tenantId) return;
    // Remove all edges
    const outs = [...(outIndex.get(id) ?? [])];
    const ins  = [...(inIndex.get(id)  ?? [])];
    for (const eid of [...outs, ...ins]) {
      const edge = edgeStore.get(eid);
      if (edge) { removeEdgeIndex(edge); edgeStore.delete(eid); }
    }
    outIndex.delete(id);
    inIndex.delete(id);
    nodeStore.delete(id);
    tenantIndex.get(this.tenantId)?.delete(id);
  }

  // ── Edge Operations ────────────────────────────────────────

  createEdge(params: {
    fromId: string; fromType: GovernanceNodeType;
    toId:   string; toType:   GovernanceNodeType;
    edgeType: GovernanceEdgeType;
    weight?: number; createdBy?: string; isInferred?: boolean;
    properties?: GovernanceGraphEdge["properties"]; evidenceId?: string;
  }): GovernanceGraphEdge | null {
    if (params.fromId === params.toId) return null; // no self-loops
    // Dedup
    const existing = this.findEdge(params.fromId, params.toId, params.edgeType);
    if (existing) return existing;
    // Tenant isolation: both nodes must belong to this tenant
    const from = nodeStore.get(params.fromId);
    const to   = nodeStore.get(params.toId);
    if (from && from.tenantId !== this.tenantId) return null;
    if (to   && to.tenantId   !== this.tenantId) return null;

    const edge: GovernanceGraphEdge = {
      id:         uuidv4(),
      fromId:     params.fromId,
      fromType:   params.fromType,
      toId:       params.toId,
      toType:     params.toType,
      edgeType:   params.edgeType,
      tenantId:   this.tenantId,
      weight:     params.weight ?? 5,
      properties: params.properties ?? {},
      evidenceId: params.evidenceId,
      createdAt:  new Date().toISOString(),
      createdBy:  params.createdBy ?? "system",
      isInferred: params.isInferred ?? false,
    };
    edgeStore.set(edge.id, edge);
    indexEdge(edge);
    return edge;
  }

  findEdge(
    fromId: string, toId: string, edgeType?: GovernanceEdgeType,
  ): GovernanceGraphEdge | undefined {
    const edgeIds = outIndex.get(fromId) ?? new Set();
    for (const eid of edgeIds) {
      const e = edgeStore.get(eid);
      if (e && e.toId === toId) {
        if (!edgeType || e.edgeType === edgeType) return e;
      }
    }
    return undefined;
  }

  getOutEdges(nodeId: string, types?: GovernanceEdgeType[]): GovernanceGraphEdge[] {
    const eids = outIndex.get(nodeId) ?? new Set();
    const edges = [...eids].map(id => edgeStore.get(id)!).filter(Boolean);
    if (!types) return edges;
    return edges.filter(e => types.includes(e.edgeType));
  }

  getInEdges(nodeId: string, types?: GovernanceEdgeType[]): GovernanceGraphEdge[] {
    const eids = inIndex.get(nodeId) ?? new Set();
    const edges = [...eids].map(id => edgeStore.get(id)!).filter(Boolean);
    if (!types) return edges;
    return edges.filter(e => types.includes(e.edgeType));
  }

  // ── Graph Traversal ────────────────────────────────────────

  query(q: GovernanceGraphQuery): GovernanceGraphResult {
    const startMs = Date.now();
    const visited = new Set<string>();
    const result  = { nodes: [] as GovernanceGraphNode[], edges: [] as GovernanceGraphEdge[] };
    const depth   = q.maxDepth ?? 5;

    const traverse = (nodeId: string, d: number): void => {
      if (d > depth || visited.has(nodeId)) return;
      visited.add(nodeId);
      const node = nodeStore.get(nodeId);
      if (!node || node.tenantId !== q.tenantId) return;
      if (q.startNodeTypes && q.startNodeTypes.length > 0 && d === 0 && !q.startNodeTypes.includes(node.type)) return;
      if (q.filter) {
        for (const [k, v] of Object.entries(q.filter)) {
          if ((node.properties as Record<string, unknown>)[k] !== v) return;
        }
      }
      result.nodes.push(node);
      const outs = this.getOutEdges(nodeId, q.edgeTypes);
      for (const edge of outs) {
        if (!q.includeInferred && edge.isInferred) continue;
        if (q.minWeight !== undefined && edge.weight < q.minWeight) continue;
        result.edges.push(edge);
        traverse(edge.toId, d + 1);
      }
    };

    if (q.startNodeId) {
      traverse(q.startNodeId, 0);
    } else {
      const tenantNodes = tenantIndex.get(q.tenantId) ?? new Set();
      for (const nid of tenantNodes) traverse(nid, 0);
    }

    const limit = q.limit ?? 500;
    const truncated = result.nodes.length >= limit;

    return {
      nodes: result.nodes.slice(0, limit),
      edges: result.edges,
      paths: this.extractPaths(q.startNodeId, result.nodes, result.edges),
      metadata: {
        nodeCount:   result.nodes.length,
        edgeCount:   result.edges.length,
        queryTimeMs: Date.now() - startMs,
        truncated,
      },
    };
  }

  // ── Impact Analysis ────────────────────────────────────────

  analyzeImpact(sourceId: string): ImpactAnalysisResult {
    const sourceNode = this.getNode(sourceId);
    if (!sourceNode) throw new Error(`Node not found: ${sourceId}`);

    const direct: ImpactNode[] = [];
    const transitive: ImpactNode[] = [];
    const visited = new Set<string>([sourceId]);
    const affectedRegs = new Set<string>();
    const affectedCmte = new Set<string>();

    // Direct (depth 1)
    for (const edge of this.getOutEdges(sourceId)) {
      const n = this.getNode(edge.toId);
      if (!n) continue;
      direct.push({ node: n, depth: 1, pathWeight: edge.weight, impactType: "direct", via: [edge.edgeType] });
      visited.add(n.id);
      if (n.type === "regulation") affectedRegs.add(n.id);
      if (n.type === "committee")  affectedCmte.add(n.id);
    }

    // Transitive (depth 2-4)
    for (const d of direct) {
      for (const edge2 of this.getOutEdges(d.node.id)) {
        if (visited.has(edge2.toId)) continue;
        const n2 = this.getNode(edge2.toId);
        if (!n2) continue;
        transitive.push({ node: n2, depth: 2, pathWeight: (d.pathWeight + edge2.weight) / 2, impactType: "transitive", via: [...d.via, edge2.edgeType] });
        visited.add(n2.id);
        if (n2.type === "regulation") affectedRegs.add(n2.id);
        if (n2.type === "committee")  affectedCmte.add(n2.id);
      }
    }

    const blastRadius = direct.length + transitive.length;
    const riskAmplification = [...direct, ...transitive].filter(n => n.node.type === "risk").length * 1.5;
    const propagationScore  = Math.min(100, blastRadius * 8);

    return {
      sourceNode,
      directImpact:      direct,
      transitiveImpact:  transitive,
      blastRadius,
      criticalPathLength:direct.length > 0 ? 1 + (transitive.length > 0 ? 1 : 0) : 0,
      riskAmplification,
      affectedRegulations:  [...affectedRegs],
      affectedCommittees:   [...affectedCmte],
      propagationScore,
      recommendation:       blastRadius > 10
        ? "High blast radius — board notification recommended"
        : blastRadius > 5
        ? "Moderate impact — committee review recommended"
        : "Low impact — standard remediation workflow",
    };
  }

  // ── Regulatory Mapping ─────────────────────────────────────

  getRegulatoryMapping(regulationId: string): RegulatoryMapping {
    const regNode = this.getNode(regulationId);
    const policies: GovernanceGraphNode[] = [];
    const controls: GovernanceGraphNode[] = [];
    const obligations: GovernanceGraphNode[] = [];
    const gaps: RegulatoryGap[] = [];

    if (regNode) {
      // Outgoing: regulation → policies / obligations
      for (const edge of this.getOutEdges(regulationId)) {
        const n = this.getNode(edge.toId);
        if (!n) continue;
        if (n.type === "policy")      policies.push(n);
        if (n.type === "obligation")  obligations.push(n);
      }
      // Policies → controls
      for (const pol of policies) {
        for (const edge of this.getOutEdges(pol.id)) {
          const n = this.getNode(edge.toId);
          if (n?.type === "control") controls.push(n);
        }
      }
      // Gap detection
      if (policies.length === 0) gaps.push({ type: "no_policy",  entityType: "policy",  description: "No policies implement this regulation", severity: "critical" });
      if (controls.length === 0) gaps.push({ type: "no_control", entityType: "control", description: "No controls enforce this regulation",  severity: "critical" });
      // Check for expired controls
      for (const ctrl of controls) {
        if (ctrl.properties.status === "expired") {
          gaps.push({ type: "expired_control", entityType: "control", description: `Control ${ctrl.label} is expired`, severity: "high" });
        }
      }
    }

    const coverageScore = regulationId
      ? Math.max(0, 100 - gaps.filter(g => g.severity === "critical").length * 40 - gaps.filter(g => g.severity === "high").length * 20)
      : 0;

    return {
      regulationId,
      regulationCode:  regNode?.properties.code as string ?? regulationId,
      policies, controls, obligations, gaps, coverageScore,
    };
  }

  // ── Blast Radius ───────────────────────────────────────────

  getBlastRadius(sourceId: string, scenario: string): BlastRadiusAnalysis {
    const impact = this.analyzeImpact(sourceId);
    const affectedByType = new Map<GovernanceNodeType, number>();

    for (const n of [...impact.directImpact, ...impact.transitiveImpact]) {
      affectedByType.set(n.node.type, (affectedByType.get(n.node.type) ?? 0) + 1);
    }

    const criticalNodes = [...impact.directImpact, ...impact.transitiveImpact]
      .filter(n => n.node.properties.riskLevel === "critical" || n.node.properties.score !== undefined && (n.node.properties.score as number) >= 15)
      .map(n => n.node);

    const mitigations = [
      impact.blastRadius > 10 ? "Escalate to Board immediately" : null,
      impact.affectedRegulations.length > 0 ? "Notify Compliance team for regulatory impact" : null,
      criticalNodes.length > 0 ? "Isolate critical nodes and validate controls" : null,
      "Run full evidence chain verification",
    ].filter(Boolean) as string[];

    return {
      sourceId, sourceType: impact.sourceNode.type,
      scenario, affectedNodes: affectedByType,
      criticalNodes,
      riskScore: Math.min(100, impact.propagationScore + criticalNodes.length * 10),
      mitigations,
    };
  }

  // ── Path Finding ───────────────────────────────────────────

  findPath(fromId: string, toId: string, maxDepth = 6): GovernancePath | null {
    const visited = new Set<string>();
    const pathNodes: GovernanceGraphNode[] = [];
    const pathEdges: GovernanceGraphEdge[] = [];
    let found = false;

    const dfs = (nodeId: string, d: number): boolean => {
      if (d > maxDepth || visited.has(nodeId)) return false;
      visited.add(nodeId);
      const node = this.getNode(nodeId);
      if (!node) return false;
      pathNodes.push(node);
      if (nodeId === toId) return true;
      for (const edge of this.getOutEdges(nodeId)) {
        pathEdges.push(edge);
        if (dfs(edge.toId, d + 1)) return true;
        pathEdges.pop();
      }
      pathNodes.pop();
      return false;
    };

    found = dfs(fromId, 0);
    if (!found) return null;

    const totalWeight = pathEdges.reduce((s, e) => s + e.weight, 0);
    return { pathId: uuidv4(), nodes: pathNodes, edges: pathEdges, depth: pathNodes.length, totalWeight };
  }

  // ── Orphan / Integrity Detection ──────────────────────────

  detectOrphans(): GovernanceGraphNode[] {
    const tenantNodes = tenantIndex.get(this.tenantId) ?? new Set();
    return [...tenantNodes]
      .map(id => nodeStore.get(id)!)
      .filter(n => {
        const hasOut = (outIndex.get(n.id)?.size ?? 0) > 0;
        const hasIn  = (inIndex.get(n.id)?.size  ?? 0) > 0;
        return !hasOut && !hasIn;
      });
  }

  detectCycles(): string[][] {
    const cycles: string[][] = [];
    const visited  = new Set<string>();
    const stack    = new Set<string>();

    const dfs = (nodeId: string, path: string[]): void => {
      if (stack.has(nodeId)) { cycles.push([...path, nodeId]); return; }
      if (visited.has(nodeId)) return;
      visited.add(nodeId); stack.add(nodeId);
      for (const edge of this.getOutEdges(nodeId)) dfs(edge.toId, [...path, nodeId]);
      stack.delete(nodeId);
    };

    const tenantNodes = tenantIndex.get(this.tenantId) ?? new Set();
    for (const nid of tenantNodes) dfs(nid, []);
    return cycles;
  }

  getStats() {
    const tenantNodes = tenantIndex.get(this.tenantId) ?? new Set();
    const tenantEdges = [...edgeStore.values()].filter(e => e.tenantId === this.tenantId);
    const byType: Record<string, number> = {};
    for (const nid of tenantNodes) {
      const n = nodeStore.get(nid);
      if (n) byType[n.type] = (byType[n.type] ?? 0) + 1;
    }
    const byEdgeType: Record<string, number> = {};
    for (const e of tenantEdges) byEdgeType[e.edgeType] = (byEdgeType[e.edgeType] ?? 0) + 1;
    return { nodeCount: tenantNodes.size, edgeCount: tenantEdges.length, byType, byEdgeType };
  }

  // ── DB Hydration ───────────────────────────────────────────

  async hydrateFromDB(): Promise<{ nodes: number; edges: number }> {
    try {
      const entities = await query<{ id: string; type: string; title: string; status: string; riskLevel: string; owner: string; dataJson: Record<string, unknown> }>(
        `SELECT id, type, title, status, "riskLevel", owner, "dataJson"
         FROM "GovernanceEntity" WHERE "tenantId" = $1 AND status != 'archived' LIMIT 5000`,
        [this.tenantId],
      );
      for (const e of entities) {
        this.upsertNode({ id: e.id, type: e.type as GovernanceNodeType, label: e.title,
          properties: { status: e.status, riskLevel: e.riskLevel, owner: e.owner, ...(e.dataJson ?? {}) } });
      }
      const edges = await query<{ fromId: string; fromType: string; toId: string; toType: string; relationship: string; weight: number }>(
        `SELECT "fromId","fromType","toId","toType",relationship,weight FROM "GraphEdge" WHERE "tenantId"=$1 LIMIT 20000`,
        [this.tenantId],
      );
      let edgeCount = 0;
      for (const e of edges) {
        const created = this.createEdge({
          fromId: e.fromId, fromType: e.fromType as GovernanceNodeType,
          toId: e.toId, toType: e.toType as GovernanceNodeType,
          edgeType: e.relationship as GovernanceEdgeType, weight: e.weight,
        });
        if (created) edgeCount++;
      }
      console.log(`[GovernanceGraph] Hydrated ${entities.length} nodes, ${edgeCount} edges for tenant ${this.tenantId}`);
      return { nodes: entities.length, edges: edgeCount };
    } catch (err) {
      console.warn("[GovernanceGraph] DB unavailable:", (err as Error).message);
      return { nodes: 0, edges: 0 };
    }
  }

  // ── Private helpers ────────────────────────────────────────

  private extractPaths(startId: string | undefined, nodes: GovernanceGraphNode[], edges: GovernanceGraphEdge[]): GovernancePath[] {
    if (!startId || nodes.length === 0) return [];
    const totalWeight = edges.reduce((s, e) => s + e.weight, 0);
    return [{ pathId: uuidv4(), nodes, edges, depth: nodes.length, totalWeight }];
  }
}

// ── Factory: one runtime per tenant (cached) ──────────────────
const runtimeCache = new Map<string, GovernanceGraphRuntime>();

export function getGraphRuntime(tenantId: string): GovernanceGraphRuntime {
  if (!runtimeCache.has(tenantId)) {
    runtimeCache.set(tenantId, new GovernanceGraphRuntime(tenantId));
  }
  return runtimeCache.get(tenantId)!;
}
