/**
 * Traversal Engine — specialised graph traversal algorithms.
 * Provides: BFS, DFS, shortest-path, dependency ordering, cycle detection.
 * Used by: impact analysis, regulatory mapping, evidence lineage.
 */
import { v4 as uuidv4 } from "uuid";
import { GovernanceGraphRuntime } from "../runtime/governance.graph.runtime";
import {
  GovernanceGraphNode, GovernanceGraphEdge, GovernancePath,
  GovernanceEdgeType,
} from "../../types/graph.v4.types";

export interface TraversalOptions {
  maxDepth?:       number;
  edgeFilter?:     GovernanceEdgeType[];
  nodeFilter?:     string[];   // node types to include
  includeInferred?:boolean;
  minWeight?:      number;
}

export class TraversalEngine {
  constructor(private readonly graph: GovernanceGraphRuntime) {}

  /** BFS — level-by-level traversal, good for impact radius */
  bfs(startId: string, opts: TraversalOptions = {}): GovernanceGraphNode[] {
    const visited = new Set<string>();
    const queue:  Array<{ id: string; depth: number }> = [{ id: startId, depth: 0 }];
    const result: GovernanceGraphNode[] = [];
    const maxDepth = opts.maxDepth ?? 5;

    while (queue.length > 0) {
      const { id, depth } = queue.shift()!;
      if (depth > maxDepth || visited.has(id)) continue;
      visited.add(id);
      const node = this.graph.getNode(id);
      if (!node) continue;
      if (opts.nodeFilter && !opts.nodeFilter.includes(node.type)) { continue; }
      result.push(node);
      const edges = this.graph.getOutEdges(id, opts.edgeFilter);
      for (const edge of edges) {
        if (opts.minWeight !== undefined && edge.weight < opts.minWeight) continue;
        if (!visited.has(edge.toId)) queue.push({ id: edge.toId, depth: depth + 1 });
      }
    }
    return result;
  }

  /** DFS — depth-first, good for path finding and cycle detection */
  dfs(startId: string, opts: TraversalOptions = {}): GovernanceGraphNode[] {
    const visited = new Set<string>();
    const result: GovernanceGraphNode[] = [];
    const maxDepth = opts.maxDepth ?? 5;

    const traverse = (id: string, depth: number): void => {
      if (depth > maxDepth || visited.has(id)) return;
      visited.add(id);
      const node = this.graph.getNode(id);
      if (!node) return;
      result.push(node);
      for (const edge of this.graph.getOutEdges(id, opts.edgeFilter)) {
        traverse(edge.toId, depth + 1);
      }
    };
    traverse(startId, 0);
    return result;
  }

  /** Topological sort — returns nodes in dependency order */
  topologicalSort(nodeIds: string[]): GovernanceGraphNode[] {
    const visited = new Set<string>();
    const sorted:  GovernanceGraphNode[] = [];

    const visit = (id: string): void => {
      if (visited.has(id)) return;
      visited.add(id);
      for (const edge of this.graph.getOutEdges(id)) visit(edge.toId);
      const node = this.graph.getNode(id);
      if (node) sorted.unshift(node);
    };
    for (const id of nodeIds) visit(id);
    return sorted;
  }

  /** Find all paths between two nodes (up to maxPaths) */
  findAllPaths(fromId: string, toId: string, maxPaths = 5, maxDepth = 6): GovernancePath[] {
    const paths: GovernancePath[] = [];
    const visited = new Set<string>();

    const dfs = (id: string, depth: number, pathNodes: GovernanceGraphNode[], pathEdges: GovernanceGraphEdge[]): void => {
      if (paths.length >= maxPaths || depth > maxDepth) return;
      if (visited.has(id)) return;
      visited.add(id);
      const node = this.graph.getNode(id);
      if (!node) { visited.delete(id); return; }
      pathNodes.push(node);
      if (id === toId) {
        const totalWeight = pathEdges.reduce((s, e) => s + e.weight, 0);
        paths.push({ pathId: uuidv4(), nodes: [...pathNodes], edges: [...pathEdges], depth, totalWeight });
        pathNodes.pop();
        visited.delete(id);
        return;
      }
      for (const edge of this.graph.getOutEdges(id)) {
        pathEdges.push(edge);
        dfs(edge.toId, depth + 1, pathNodes, pathEdges);
        pathEdges.pop();
      }
      pathNodes.pop();
      visited.delete(id);
    };

    dfs(fromId, 0, [], []);
    return paths;
  }

  /** Shortest path by weight (Dijkstra-lite) */
  shortestPath(fromId: string, toId: string): GovernancePath | null {
    const dist  = new Map<string, number>();
    const prev  = new Map<string, { nodeId: string; edge: GovernanceGraphEdge }>();
    const queue = new Set<string>();

    // Initialise
    const allNodes = this.bfs(fromId, { maxDepth: 10 });
    for (const n of allNodes) { dist.set(n.id, Infinity); queue.add(n.id); }
    dist.set(fromId, 0);

    while (queue.size > 0) {
      // Get node with min distance
      let u = "";
      let minDist = Infinity;
      for (const id of queue) { const d = dist.get(id) ?? Infinity; if (d < minDist) { minDist = d; u = id; } }
      if (!u || u === toId) break;
      queue.delete(u);

      for (const edge of this.graph.getOutEdges(u)) {
        const alt = (dist.get(u) ?? Infinity) + (10 - edge.weight); // invert weight (high weight = short path)
        if (alt < (dist.get(edge.toId) ?? Infinity)) {
          dist.set(edge.toId, alt);
          prev.set(edge.toId, { nodeId: u, edge });
        }
      }
    }

    if (!prev.has(toId) && fromId !== toId) return null;

    // Reconstruct path
    const pathNodes: GovernanceGraphNode[] = [];
    const pathEdges: GovernanceGraphEdge[] = [];
    let cur = toId;
    while (cur !== fromId) {
      const p = prev.get(cur);
      if (!p) return null;
      const node = this.graph.getNode(cur);
      if (node) pathNodes.unshift(node);
      pathEdges.unshift(p.edge);
      cur = p.nodeId;
    }
    const startNode = this.graph.getNode(fromId);
    if (startNode) pathNodes.unshift(startNode);

    return { pathId: uuidv4(), nodes: pathNodes, edges: pathEdges, depth: pathNodes.length, totalWeight: pathEdges.reduce((s, e) => s + e.weight, 0) };
  }
}
