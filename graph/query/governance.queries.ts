/**
 * Governance Queries — Real governance intelligence queries.
 * Answers the key governance questions:
 *   - Why was this approved?
 *   - What evidence supports this?
 *   - What risks are affected?
 *   - Which policies allowed this?
 *   - What regulations apply?
 *   - What controls are linked?
 *   - What is the blast radius?
 *   - Which committees are affected?
 *   - What controls are disabled?
 *   - What evidence has expired?
 */
import {
  GovernanceGraphNode, GovernanceGraphEdge, GovernancePath,
  ImpactAnalysisResult, RegulatoryMapping,
} from "../../types/graph.v4.types";
import { GovernanceGraphRuntime } from "../runtime/governance.graph.runtime";

export interface WhyApprovedResult {
  decisionId:   string;
  approvedBy:   string[];
  policies:     GovernanceGraphNode[];
  regulations:  GovernanceGraphNode[];
  evidence:     GovernanceGraphNode[];
  approvalPath: GovernancePath | null;
  confidenceScore: number;
}

export interface ControlStatusResult {
  controlId:    string;
  control:      GovernanceGraphNode | undefined;
  linkedRisks:  GovernanceGraphNode[];
  testResults:  GovernanceGraphNode[];
  evidence:     GovernanceGraphNode[];
  isDisabled:   boolean;
  lastTested?:  string;
}

export class GovernanceQueryEngine {
  constructor(private readonly graph: GovernanceGraphRuntime) {}

  // Q1: لماذا تمت الموافقة؟
  whyWasApproved(decisionId: string): WhyApprovedResult {
    const decisionNode = this.graph.getNode(decisionId);
    const policies:    GovernanceGraphNode[] = [];
    const regulations: GovernanceGraphNode[] = [];
    const evidence:    GovernanceGraphNode[] = [];
    const approvers:   string[] = [];

    if (decisionNode) {
      for (const edge of this.graph.getInEdges(decisionId)) {
        const n = this.graph.getNode(edge.fromId);
        if (!n) continue;
        if (n.type === "policy")     policies.push(n);
        if (n.type === "regulation") regulations.push(n);
        if (n.type === "evidence")   evidence.push(n);
        if (n.type === "user" && edge.edgeType === "COMMITTEE_APPROVES_DECISION")
          approvers.push(n.label);
      }
    }

    const confidenceScore = evidence.length > 0 ? Math.min(100, 60 + evidence.length * 10 + policies.length * 5) : 30;
    const approvalPath = this.graph.findPath(evidence[0]?.id ?? decisionId, decisionId, 4);

    return { decisionId, approvedBy: approvers, policies, regulations, evidence, approvalPath, confidenceScore };
  }

  // Q2: ما الأدلة المرتبطة؟
  getLinkedEvidence(entityId: string): GovernanceGraphNode[] {
    const evidence: GovernanceGraphNode[] = [];
    for (const edge of this.graph.getInEdges(entityId, ["EVIDENCE_SUPPORTS_FINDING", "EVIDENCE_VALIDATES_CONTROL", "EVIDENCE_PROVES_COMPLIANCE", "ATTESTATION_CERTIFIES_CONTROL"])) {
      const n = this.graph.getNode(edge.fromId);
      if (n) evidence.push(n);
    }
    for (const edge of this.graph.getOutEdges(entityId, ["EVIDENCE_SUPPORTS_FINDING", "EVIDENCE_VALIDATES_CONTROL"])) {
      const n = this.graph.getNode(edge.toId);
      if (n && n.type === "evidence") evidence.push(n);
    }
    return [...new Map(evidence.map(e => [e.id, e])).values()];
  }

  // Q3: ما المخاطر المتأثرة؟
  getAffectedRisks(entityId: string): GovernanceGraphNode[] {
    const result = this.graph.query({
      tenantId: this.graph["tenantId"],  // access private field via bracket notation
      startNodeId: entityId,
      edgeTypes: ["CONTROL_ADDRESSES_RISK", "INCIDENT_TRIGGERS_RISK", "VENDOR_INTRODUCES_RISK", "RISK_AMPLIFIES_RISK"],
      maxDepth: 3,
    });
    return result.nodes.filter(n => n.type === "risk");
  }

  // Q4: ما السياسات التي سمحت بذلك؟
  getApplicablePolicies(entityId: string, action: string): GovernanceGraphNode[] {
    const policies: GovernanceGraphNode[] = [];
    for (const edge of this.graph.getInEdges(entityId, ["POLICY_GOVERNS_CONTROL", "COMMITTEE_OWNS_POLICY"])) {
      const n = this.graph.getNode(edge.fromId);
      if (n?.type === "policy") policies.push(n);
    }
    return policies;
  }

  // Q5: ما اللائحة المرتبطة؟
  getLinkedRegulations(entityId: string): RegulatoryMapping[] {
    const regulations: GovernanceGraphNode[] = [];
    const visited = new Set<string>();
    const findRegs = (nid: string, depth: number): void => {
      if (depth > 4 || visited.has(nid)) return;
      visited.add(nid);
      for (const edge of this.graph.getInEdges(nid, ["REGULATION_REQUIRES_CONTROL", "POLICY_IMPLEMENTS_REGULATION", "REGULATION_CREATES_OBLIGATION"])) {
        const n = this.graph.getNode(edge.fromId);
        if (n?.type === "regulation") regulations.push(n);
        else findRegs(edge.fromId, depth + 1);
      }
    };
    findRegs(entityId, 0);
    return [...new Map(regulations.map(r => [r.id, r])).values()].map(r => this.graph.getRegulatoryMapping(r.id));
  }

  // Q6: ما الضوابط المرتبطة؟
  getLinkedControls(entityId: string): GovernanceGraphNode[] {
    const controls: GovernanceGraphNode[] = [];
    for (const edge of [...this.graph.getOutEdges(entityId), ...this.graph.getInEdges(entityId)]) {
      const target = edge.fromId === entityId ? edge.toId : edge.fromId;
      const n = this.graph.getNode(target);
      if (n?.type === "control") controls.push(n);
    }
    return [...new Map(controls.map(c => [c.id, c])).values()];
  }

  // Q7: ما أثر التغيير؟ (blast radius)
  getChangeImpact(entityId: string): ImpactAnalysisResult {
    return this.graph.analyzeImpact(entityId);
  }

  // Q8: ما اللجان المتأثرة؟
  getAffectedCommittees(entityId: string): GovernanceGraphNode[] {
    const result = this.graph.query({
      tenantId: (this.graph as unknown as { tenantId: string }).tenantId,
      startNodeId: entityId,
      edgeTypes: ["COMMITTEE_OWNS_POLICY", "COMMITTEE_APPROVES_DECISION"],
      maxDepth: 4,
    });
    return result.nodes.filter(n => n.type === "committee");
  }

  // Q9: ما الضوابط المعطلة؟
  getDisabledControls(): ControlStatusResult[] {
    const result = this.graph.query({
      tenantId: (this.graph as unknown as { tenantId: string }).tenantId,
      startNodeTypes: ["control"],
      filter: { status: "blocked" },
    });
    return result.nodes
      .filter(n => n.type === "control")
      .map(ctrl => ({
        controlId:   ctrl.id,
        control:     ctrl,
        linkedRisks: this.getLinkedControls(ctrl.id).filter(n => n.type === "risk"),
        testResults: [],
        evidence:    this.getLinkedEvidence(ctrl.id),
        isDisabled:  true,
        lastTested:  ctrl.properties.lastTestedAt as string | undefined,
      }));
  }

  // Q10: ما الأدلة المنتهية؟
  getExpiredEvidence(): GovernanceGraphNode[] {
    const now = new Date().toISOString();
    const result = this.graph.query({
      tenantId: (this.graph as unknown as { tenantId: string }).tenantId,
      startNodeTypes: ["evidence"],
    });
    return result.nodes.filter(n =>
      n.type === "evidence" &&
      n.properties.expiresAt !== undefined &&
      (n.properties.expiresAt as string) < now
    );
  }
}
