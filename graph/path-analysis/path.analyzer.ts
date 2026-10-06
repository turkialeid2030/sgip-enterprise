/**
 * Path Analyzer — finds and scores governance paths.
 * Traces: evidence → finding → capa → risk → regulation
 * Detects: critical paths, weak links, missing evidence, policy gaps.
 */
import { v4 as uuidv4 } from "uuid";
import { GovernanceGraphRuntime } from "../runtime/governance.graph.runtime";
import {
  GovernancePath, GovernanceGraphNode, GovernanceGraphEdge,
  GovernanceEdgeType,
} from "../../types/graph.v4.types";
import { getEdgeDefinition } from "../edges/edge.registry";

export interface PathScore {
  path:            GovernancePath;
  score:           number;     // 0-100
  weakLinks:       string[];   // edge IDs with weight < 4
  missingEvidence: string[];   // edge IDs that requiresEvidence but have none
  criticalNodes:   GovernanceGraphNode[];
  isComplete:      boolean;    // no missing evidence
  annotation:      string;
}

export interface TraceabilityReport {
  entityId:      string;
  upstreamPaths: PathScore[];
  downstreamPaths:PathScore[];
  coverageScore: number;
  gaps:          TraceabilityGap[];
  generatedAt:   string;
}

export interface TraceabilityGap {
  type:        "missing_evidence"  | "broken_chain" | "orphan_node" | "expired_evidence" | "no_policy";
  description: string;
  severity:    "critical" | "high" | "medium";
  nodeId?:     string;
  edgeId?:     string;
}

export class PathAnalyzer {
  constructor(private readonly graph: GovernanceGraphRuntime) {}

  /**
   * Full traceability report for an entity:
   * - Where does it come from? (upstream: regulations, policies)
   * - What does it affect? (downstream: risks, findings, CAPAs)
   */
  generateTraceabilityReport(entityId: string): TraceabilityReport {
    const upstream   = this.findUpstreamPaths(entityId);
    const downstream = this.findDownstreamPaths(entityId);
    const gaps       = this.detectGaps(entityId, upstream, downstream);

    const scoredUpstream   = upstream.map(p => this.scorePath(p));
    const scoredDownstream = downstream.map(p => this.scorePath(p));

    const allScores    = [...scoredUpstream, ...scoredDownstream];
    const coverageScore = allScores.length > 0
      ? Math.round(allScores.reduce((s, p) => s + p.score, 0) / allScores.length)
      : 0;

    return {
      entityId,
      upstreamPaths:   scoredUpstream,
      downstreamPaths: scoredDownstream,
      coverageScore,
      gaps,
      generatedAt: new Date().toISOString(),
    };
  }

  /** Score a path: penalise weak links, missing evidence, short depth */
  scorePath(path: GovernancePath): PathScore {
    const weakLinks:       string[] = [];
    const missingEvidence: string[] = [];
    const criticalNodes:   GovernanceGraphNode[] = [];

    for (const edge of path.edges) {
      if (edge.weight < 4) weakLinks.push(edge.id);
      const def = getEdgeDefinition(edge.edgeType);
      if (def?.requiresEvidence && !edge.evidenceId) missingEvidence.push(edge.id);
    }

    for (const node of path.nodes) {
      if (node.properties.riskLevel === "critical" || (node.properties.score as number ?? 0) >= 15) {
        criticalNodes.push(node);
      }
    }

    const weakPenalty    = weakLinks.length       * 10;
    const evidencePenalty= missingEvidence.length * 15;
    const depthBonus     = Math.min(20, path.depth * 4);
    const score = Math.max(0, Math.min(100, 70 + depthBonus - weakPenalty - evidencePenalty));

    const annotation = missingEvidence.length > 0
      ? `⚠ ${missingEvidence.length} edges missing evidence`
      : weakLinks.length > 0
      ? `⚡ ${weakLinks.length} weak links detected`
      : "✓ Complete traceability chain";

    return {
      path, score, weakLinks, missingEvidence, criticalNodes,
      isComplete: missingEvidence.length === 0,
      annotation,
    };
  }

  findUpstreamPaths(nodeId: string, maxDepth = 5): GovernancePath[] {
    const paths: GovernancePath[] = [];
    const visited = new Set<string>();

    const traverse = (id: string, depth: number, nodes: GovernanceGraphNode[], edges: GovernanceGraphEdge[]): void => {
      if (depth > maxDepth || visited.has(id)) return;
      visited.add(id);
      const node = this.graph.getNode(id);
      if (!node) return;
      nodes.push(node);
      const inEdges = this.graph.getInEdges(id);
      if (inEdges.length === 0 && depth > 0) {
        const totalWeight = edges.reduce((s, e) => s + e.weight, 0);
        paths.push({ pathId: uuidv4(), nodes: [...nodes], edges: [...edges], depth, totalWeight });
        return;
      }
      for (const edge of inEdges) {
        edges.push(edge);
        traverse(edge.fromId, depth + 1, [...nodes], [...edges]);
        edges.pop();
      }
      if (inEdges.length === 0) {
        paths.push({ pathId: uuidv4(), nodes: [...nodes], edges: [...edges], depth, totalWeight: 0 });
      }
    };

    traverse(nodeId, 0, [], []);
    return paths;
  }

  findDownstreamPaths(nodeId: string, maxDepth = 5): GovernancePath[] {
    const paths: GovernancePath[] = [];
    const visited = new Set<string>();

    const traverse = (id: string, depth: number, nodes: GovernanceGraphNode[], edges: GovernanceGraphEdge[]): void => {
      if (depth > maxDepth || visited.has(id)) return;
      visited.add(id);
      const node = this.graph.getNode(id);
      if (!node) return;
      nodes.push(node);
      const outEdges = this.graph.getOutEdges(id);
      if (outEdges.length === 0 && depth > 0) {
        const totalWeight = edges.reduce((s, e) => s + e.weight, 0);
        paths.push({ pathId: uuidv4(), nodes: [...nodes], edges: [...edges], depth, totalWeight });
        return;
      }
      for (const edge of outEdges) {
        edges.push(edge);
        traverse(edge.toId, depth + 1, [...nodes], [...edges]);
        edges.pop();
      }
    };

    traverse(nodeId, 0, [], []);
    return paths;
  }

  private detectGaps(
    entityId: string,
    upstream: GovernancePath[],
    downstream: GovernancePath[],
  ): TraceabilityGap[] {
    const gaps: TraceabilityGap[] = [];
    const allPaths = [...upstream, ...downstream];
    const allEdges = allPaths.flatMap(p => p.edges);

    // Missing evidence on required edges
    for (const edge of allEdges) {
      const def = getEdgeDefinition(edge.edgeType);
      if (def?.requiresEvidence && !edge.evidenceId) {
        gaps.push({ type: "missing_evidence", description: `Edge ${edge.edgeType} (${edge.id}) lacks supporting evidence`, severity: "high", edgeId: edge.id });
      }
    }

    // No upstream policy path
    const hasPolicy = allPaths.some(p => p.nodes.some(n => n.type === "policy"));
    if (!hasPolicy && upstream.length > 0) {
      gaps.push({ type: "no_policy", description: "No policy found in upstream chain", severity: "high", nodeId: entityId });
    }

    // Orphan check
    if (upstream.length === 0 && downstream.length === 0) {
      gaps.push({ type: "orphan_node", description: "Entity has no graph connections", severity: "critical", nodeId: entityId });
    }

    return gaps;
  }
}
