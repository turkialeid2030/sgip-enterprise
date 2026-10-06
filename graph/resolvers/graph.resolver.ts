/**
 * Graph Resolver — resolves complex multi-hop governance queries.
 * Single entry point for all "governance intelligence" queries from the API.
 */
import { GovernanceGraphRuntime }  from "../runtime/governance.graph.runtime";
import { GovernanceQueryEngine }   from "../query/governance.queries";
import { PathAnalyzer }            from "../path-analysis/path.analyzer";
import { ImpactAnalyzer }          from "../impact-analysis/impact.analyzer";
import { TraversalEngine }         from "../traversal/traversal.engine";
import { RegulatoryMapper }        from "../regulatory-mapping/regulatory.mapper";
import { GraphEvidenceBridge }     from "../evidence-lineage/graph.evidence.bridge";
import { EvidenceLineageEngine }   from "../../evidence/lineage/evidence.lineage.engine";
import { TenantContext }           from "../../types/tenant.types";
import { requireTenantContext }    from "../../tenant/tenant.context";
import { getGraphRuntime }         from "../runtime/governance.graph.runtime";
import { getEvidenceEngine }       from "../../evidence/lineage/evidence.lineage.engine";

export class GraphResolver {
  private readonly queryEngine:   GovernanceQueryEngine;
  private readonly pathAnalyzer:  PathAnalyzer;
  private readonly impactAnalyzer:ImpactAnalyzer;
  private readonly traversal:     TraversalEngine;
  private readonly regMapper:     RegulatoryMapper;
  private readonly evidenceBridge:GraphEvidenceBridge;

  constructor(
    private readonly graph:    GovernanceGraphRuntime,
    private readonly evidence: EvidenceLineageEngine,
  ) {
    this.queryEngine    = new GovernanceQueryEngine(graph);
    this.pathAnalyzer   = new PathAnalyzer(graph);
    this.impactAnalyzer = new ImpactAnalyzer(graph);
    this.traversal      = new TraversalEngine(graph);
    this.regMapper      = new RegulatoryMapper(graph);
    this.evidenceBridge = new GraphEvidenceBridge(graph, evidence);
  }

  // ── Public resolution interface ────────────────────────────

  resolve(queryType: GraphQueryType, params: GraphQueryParams): unknown {
    switch (queryType) {
      case "why_approved":           return this.queryEngine.whyWasApproved(params.entityId!);
      case "linked_evidence":        return this.queryEngine.getLinkedEvidence(params.entityId!);
      case "affected_risks":         return this.queryEngine.getAffectedRisks(params.entityId!);
      case "applicable_policies":    return this.queryEngine.getApplicablePolicies(params.entityId!, params.action!);
      case "linked_regulations":     return this.queryEngine.getLinkedRegulations(params.entityId!);
      case "linked_controls":        return this.queryEngine.getLinkedControls(params.entityId!);
      case "change_impact":          return this.queryEngine.getChangeImpact(params.entityId!);
      case "affected_committees":    return this.queryEngine.getAffectedCommittees(params.entityId!);
      case "disabled_controls":      return this.queryEngine.getDisabledControls();
      case "expired_evidence":       return this.queryEngine.getExpiredEvidence();
      case "traceability_report":    return this.pathAnalyzer.generateTraceabilityReport(params.entityId!);
      case "change_assessment":      return this.impactAnalyzer.assessChangeImpact(params.entityId!, params.changeType!);
      case "regulatory_view":        return this.regMapper.getFullView(params.entityId!);
      case "evidence_coverage":      return this.evidenceBridge.getEvidenceCoverageScore(params.entityId!);
      case "shortest_path":          return this.traversal.shortestPath(params.fromId!, params.toId!);
      case "all_paths":              return this.traversal.findAllPaths(params.fromId!, params.toId!, params.maxPaths);
      default: throw new Error(`Unknown graph query type: ${queryType}`);
    }
  }

  static forTenant(ctx: TenantContext): GraphResolver {
    requireTenantContext(ctx, "GraphResolver.forTenant");
    return new GraphResolver(
      getGraphRuntime(ctx.tenantId),
      getEvidenceEngine(ctx.tenantId),
    );
  }
}

export type GraphQueryType =
  | "why_approved"       | "linked_evidence"      | "affected_risks"
  | "applicable_policies"| "linked_regulations"   | "linked_controls"
  | "change_impact"      | "affected_committees"  | "disabled_controls"
  | "expired_evidence"   | "traceability_report"  | "change_assessment"
  | "regulatory_view"    | "evidence_coverage"    | "shortest_path"
  | "all_paths";

export interface GraphQueryParams {
  entityId?:   string;
  fromId?:     string;
  toId?:       string;
  action?:     string;
  changeType?: string;
  maxPaths?:   number;
}
