/**
 * Impact Analyzer — governance change impact assessment.
 * Given a proposed change, calculates: blast radius, regulatory exposure,
 * affected controls, cascading risks, committee notifications needed.
 */
import {
  GovernanceGraphRuntime,
} from "../runtime/governance.graph.runtime";
import {
  ImpactAnalysisResult, BlastRadiusAnalysis,
  GovernanceNodeType, GovernanceEdgeType,
} from "../../types/graph.v4.types";
import { getRiskPropagatingEdgeTypes } from "../edges/edge.registry";

export interface ChangeImpactAssessment {
  sourceId:          string;
  changeType:        string;
  directImpact:      ImpactAnalysisResult;
  blastRadius:       BlastRadiusAnalysis;
  riskPropagation:   RiskPropagationResult;
  regulatoryExposure:RegulatoryExposureResult;
  requiredApprovals: string[];
  recommendation:    string;
  riskScore:         number;
  needsBoardEscalation: boolean;
}

export interface RiskPropagationResult {
  originRisks:    string[];
  amplifiedRisks: string[];
  newRisks:       string[];
  totalExposure:  number;
}

export interface RegulatoryExposureResult {
  directRegulations:    string[];
  transitiveRegulations:string[];
  potentialBreach:      boolean;
  affectedObligations:  string[];
}

export class ImpactAnalyzer {
  private readonly riskEdges: GovernanceEdgeType[];

  constructor(private readonly graph: GovernanceGraphRuntime) {
    this.riskEdges = getRiskPropagatingEdgeTypes();
  }

  assessChangeImpact(sourceId: string, changeType: string): ChangeImpactAssessment {
    const directImpact  = this.graph.analyzeImpact(sourceId);
    const blastRadius   = this.graph.getBlastRadius(sourceId, changeType);
    const riskProp      = this.assessRiskPropagation(sourceId);
    const regExposure   = this.assessRegulatoryExposure(sourceId);

    const riskScore = Math.min(100,
      blastRadius.riskScore * 0.4 +
      riskProp.totalExposure * 0.3 +
      (regExposure.potentialBreach ? 30 : 0),
    );

    const needsBoardEscalation =
      riskScore >= 70 ||
      regExposure.potentialBreach ||
      directImpact.blastRadius >= 10 ||
      blastRadius.criticalNodes.length >= 3;

    const requiredApprovals: string[] = [];
    if (needsBoardEscalation)              requiredApprovals.push("Board");
    if (regExposure.potentialBreach)       requiredApprovals.push("CCO");
    if (directImpact.riskAmplification > 3) requiredApprovals.push("CRO");

    const recommendation = needsBoardEscalation
      ? "Immediate Board notification required — high blast radius"
      : riskScore >= 40
      ? "Committee review recommended — moderate impact"
      : "Standard approval workflow — low impact";

    return {
      sourceId, changeType, directImpact, blastRadius,
      riskPropagation: riskProp, regulatoryExposure: regExposure,
      requiredApprovals, recommendation, riskScore, needsBoardEscalation,
    };
  }

  private assessRiskPropagation(sourceId: string): RiskPropagationResult {
    const result = this.graph.query({
      tenantId:  this.getTenantId(),
      startNodeId: sourceId,
      edgeTypes: this.riskEdges,
      maxDepth:  4,
    });
    const originRisks    = result.nodes.filter(n => n.id === sourceId && n.type === "risk").map(n => n.id);
    const amplifiedRisks = result.nodes.filter(n => n.id !== sourceId && n.type === "risk").map(n => n.id);
    return {
      originRisks,
      amplifiedRisks,
      newRisks: [],  // detected by governance monitoring
      totalExposure: Math.min(100, (originRisks.length + amplifiedRisks.length) * 15),
    };
  }

  private assessRegulatoryExposure(sourceId: string): RegulatoryExposureResult {
    const direct = this.graph.query({
      tenantId: this.getTenantId(),
      startNodeId: sourceId,
      edgeTypes: ["POLICY_IMPLEMENTS_REGULATION", "REGULATION_REQUIRES_CONTROL", "REGULATION_CREATES_OBLIGATION"],
      maxDepth: 3,
    });
    const directRegs    = direct.nodes.filter(n => n.type === "regulation").map(n => n.id);
    const obligations   = direct.nodes.filter(n => n.type === "obligation").map(n => n.id);
    return {
      directRegulations:    directRegs,
      transitiveRegulations:[],
      potentialBreach:      directRegs.length > 0 && obligations.length > 0,
      affectedObligations:  obligations,
    };
  }

  private getTenantId(): string {
    // Access via property — graph is constructed per-tenant
    return (this.graph as unknown as { tenantId: string }).tenantId;
  }
}
