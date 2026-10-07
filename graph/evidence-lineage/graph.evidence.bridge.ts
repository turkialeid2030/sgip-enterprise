/**
 * Graph-Evidence Bridge
 * Connects graph edges to evidence records.
 * Every "requires evidence" edge can be verified via this bridge.
 */
import { GovernanceGraphRuntime } from "../runtime/governance.graph.runtime";
import { EvidenceLineageEngine } from "../../evidence/lineage/evidence.lineage.engine";
import { getEvidenceRequiredEdgeTypes } from "../edges/edge.registry";
import { GovernanceEdgeType } from "../../types/graph.v4.types";

export interface EdgeEvidenceStatus {
  edgeId:     string;
  edgeType:   GovernanceEdgeType;
  fromId:     string;
  toId:       string;
  hasEvidence:boolean;
  evidenceId?:string;
  verified:   boolean;
  score:      number;
}

export class GraphEvidenceBridge {
  private readonly evidenceRequiredTypes: Set<GovernanceEdgeType>;

  constructor(
    private readonly graph:    GovernanceGraphRuntime,
    private readonly evidence: EvidenceLineageEngine,
  ) {
    this.evidenceRequiredTypes = new Set(getEvidenceRequiredEdgeTypes());
  }

  /** Verify all evidence-required edges for an entity */
  verifyEntityEvidenceCoverage(entityId: string): EdgeEvidenceStatus[] {
    const outEdges = this.graph.getOutEdges(entityId);
    const inEdges  = this.graph.getInEdges(entityId);
    const statuses: EdgeEvidenceStatus[] = [];

    for (const edge of [...outEdges, ...inEdges]) {
      if (!this.evidenceRequiredTypes.has(edge.edgeType)) continue;
      const hasEvidence = !!edge.evidenceId;
      let verified = false;
      if (hasEvidence && edge.evidenceId) {
        const check = this.evidence.verifyRecord(edge.evidenceId);
        verified = check.valid;
      }
      statuses.push({
        edgeId:     edge.id,
        edgeType:   edge.edgeType,
        fromId:     edge.fromId,
        toId:       edge.toId,
        hasEvidence,
        evidenceId: edge.evidenceId,
        verified,
        score:      !hasEvidence ? 0 : !verified ? 40 : 100,
      });
    }
    return statuses;
  }

  /** Attach evidence to an existing edge */
  attachEvidenceToEdge(
    entityId: string,
    edgeId:   string,
    content:  string,
    collectedBy: string,
    correlationId: string,
  ): string {
    const record = this.evidence.createRecord({
      entityId,
      entityType: "graph_edge",
      title:      `Evidence for edge ${edgeId}`,
      sourceType: "process_log",
      content,
      collectedBy,
      correlationId,
    });
    return record.id;
  }

  /** Coverage score: percentage of required-evidence edges that have verified evidence */
  getEvidenceCoverageScore(entityId: string): number {
    const statuses = this.verifyEntityEvidenceCoverage(entityId);
    if (statuses.length === 0) return 100;
    const verified = statuses.filter(s => s.verified).length;
    return Math.round((verified / statuses.length) * 100);
  }
}
