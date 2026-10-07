/**
 * Executive Summary Engine
 * Generates human-readable governance narratives for executive consumption.
 * Explains WHY — not just what the data shows.
 */
import { TenantContext } from "../../types/tenant.types";
import { getGraphRuntime } from "../../graph/runtime/governance.graph.runtime";
import { getEvidenceEngine } from "../../evidence/lineage/evidence.lineage.engine";
import { globalMetrics } from "../../observability/metrics/governance.metrics";
import { getCultureEngine } from "../culture/culture.signal.engine";

export interface ExecutiveSummary {
  tenantId:           string;
  period:             string;
  generatedAt:        string;
  governanceScore:    number;
  headline:           string;
  keyInsights:        string[];
  riskNarrative:      string;
  complianceNarrative:string;
  decisionNarrative:  string;
  cultureNarrative:   string;
  immediateActions:   Array<{ priority:number; action:string; owner:string; deadline:string }>;
  boardReady:         boolean;
}

export class ExecutiveSummaryEngine {
  generate(ctx: TenantContext, period = "last_30_days"): ExecutiveSummary {
    const tenantId   = ctx.tenantId;
    const graph      = getGraphRuntime(tenantId);
    const graphStats = graph.getStats();
    const culture    = getCultureEngine(tenantId).generateReport();
    const now        = new Date().toISOString();

    // Governance score
    const governanceScore = Math.round(
      culture.healthScore * 0.4 +
      (graphStats.nodeCount > 0 ? 60 : 30) * 0.3 +
      60 * 0.3  // baseline
    );

    const headline = governanceScore >= 80
      ? "Governance is operating effectively — no critical issues identified"
      : governanceScore >= 60
      ? "Governance requires attention — several risks and gaps identified"
      : "Governance in critical state — immediate board attention required";

    const keyInsights: string[] = [
      `${graphStats.nodeCount} governance entities tracked in knowledge graph`,
      `${graphStats.edgeCount} relationships mapped across risk, control, and policy domains`,
      culture.signals.length > 0 ? `${culture.signals.length} behavioral governance signals detected` : "No behavioral governance signals — culture appears healthy",
    ];

    const riskCount = graphStats.byType["risk"] ?? 0;
    const riskNarrative = `The governance graph contains ${riskCount} active risks. ` +
      (riskCount > 3
        ? `Risk concentration is notable — ${riskCount} risks require executive attention.`
        : `Risk profile appears manageable at current scale.`);

    const complianceNarrative = `${graphStats.byType["compliance_obligation"] ?? 0} compliance obligations are tracked. ` +
      `Evidence coverage and control testing should be validated quarterly.`;

    const decisionNarrative = `${graphStats.byType["decision"] ?? 0} governance decisions are in the system. ` +
      `All decisions must carry evidence, policy validation, and approved authority.`;

    const cultureNarrative = culture.healthScore >= 80
      ? "Governance culture is healthy — policies are being followed and controls tested on schedule."
      : `Governance culture signals detected: ${culture.riskAreas.slice(0,3).join(", ")}. Training and enforcement recommended.`;

    const immediateActions = [
      ...culture.signals.filter(s => s.severity === "critical").map((s, i) => ({
        priority: i + 1, action: s.recommendation, owner: s.actorId ?? "CGO",
        deadline: new Date(Date.now() + 7 * 86400000).toISOString().slice(0,10),
      })),
    ].slice(0, 5);

    return {
      tenantId, period, generatedAt: now,
      governanceScore, headline, keyInsights,
      riskNarrative, complianceNarrative, decisionNarrative, cultureNarrative,
      immediateActions,
      boardReady: governanceScore >= 70 && immediateActions.filter(a => a.priority === 1).length === 0,
    };
  }
}

export const executiveSummaryEngine = new ExecutiveSummaryEngine();
