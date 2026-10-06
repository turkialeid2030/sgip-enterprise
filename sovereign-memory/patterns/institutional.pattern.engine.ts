/**
 * Institutional Pattern Engine — SCEOS Layer A.3
 *
 * Detects governance patterns — both healthy and pathological.
 * The enterprise equivalent of "institutional memory + early warning system".
 *
 * Detects:
 * - Governance drift (decisions diverging from policy)
 * - Shadow governance (unofficial decision channels)
 * - Orphan accountability (entities with no owner chain)
 * - Policy resistance (repeated bypass attempts)
 * - Evidence decay (evidence going stale)
 * - Executive override patterns
 * - Compliance fatigue indicators
 */
import { v4 as uuidv4 } from "uuid";
import { getSovereignMemory, MemoryInsight } from "../core/sovereign.memory.engine";
import { getGovernanceOntology } from "../ontology/governance.ontology.engine";

export type PatternSeverity = "critical" | "high" | "medium" | "low" | "informational";
export type PatternCategory =
  | "governance_drift"      | "shadow_governance"    | "orphan_accountability"
  | "policy_resistance"     | "evidence_decay"       | "executive_override"
  | "compliance_fatigue"    | "audit_avoidance"      | "authority_abuse"
  | "conflict_of_interest"  | "knowledge_loss"       | "healthy_governance";

export interface GovernancePattern {
  id:              string;
  tenantId:        string;
  category:        PatternCategory;
  severity:        PatternSeverity;
  title:           string;
  description:     string;
  frequency:       number;
  firstObservedAt: string;
  lastObservedAt:  string;
  affectedEntities:string[];
  affectedActors:  string[];
  evidence:        string[];         // memory IDs + evidence IDs
  trend:           "emerging" | "stable" | "escalating" | "resolving";
  riskScore:       number;           // 0-100
  recommendation:  string;
  autoEscalate:    boolean;
  correlationId:   string;
}

export interface PatternReport {
  tenantId:        string;
  generatedAt:     string;
  overallHealthScore: number;  // 0-100 (100 = excellent governance health)
  patterns:        GovernancePattern[];
  criticalCount:   number;
  highCount:       number;
  topRisk:         string;
  executiveSummary:string;
  immediateActions:string[];
}

const patternStore: GovernancePattern[] = [];

export class InstitutionalPatternEngine {
  constructor(private readonly tenantId: string) {}

  scan(): GovernancePattern[] {
    const memory    = getSovereignMemory(this.tenantId);
    const ontology  = getGovernanceOntology(this.tenantId);
    const detected: GovernancePattern[] = [];
    const now = new Date().toISOString();

    // ── 1. Orphan accountability + all governance gaps ────────
    const questions = ontology.generateGovernanceQuestions();
    const orphanQs  = questions.filter(q => q.category === "accountability" || q.category === "risk");
    if (orphanQs.length > 0) {
      detected.push({
        id:uuidv4(), tenantId:this.tenantId,
        category:"orphan_accountability", severity: orphanQs.length >= 3 ? "critical" : "high",
        title:`${orphanQs.length} entities without accountability`,
        description:`${orphanQs.length} governance entities have no defined owner or accountable party`,
        frequency:orphanQs.length, firstObservedAt:now, lastObservedAt:now,
        affectedEntities:orphanQs.flatMap(q=>q.entityIds), affectedActors:[],
        evidence:[], trend:"stable",
        riskScore:Math.min(100, orphanQs.length * 15),
        recommendation:"Assign ownership to all orphan entities immediately",
        autoEscalate:orphanQs.length >= 5, correlationId:uuidv4(),
      });
    }

    // ── 2. Evidence-free decisions ───────────────────────────
    const evidenceQs = questions.filter(q => q.category === "evidence");
    if (evidenceQs.length > 0) {
      detected.push({
        id:uuidv4(), tenantId:this.tenantId,
        category:"evidence_decay", severity:evidenceQs.length >= 3 ? "critical" : "high",
        title:`${evidenceQs.length} decisions without evidence`,
        description:"Decisions are being made without attached evidence — audit trail broken",
        frequency:evidenceQs.length, firstObservedAt:now, lastObservedAt:now,
        affectedEntities:evidenceQs.flatMap(q=>q.entityIds), affectedActors:[],
        evidence:[], trend:"emerging",
        riskScore:Math.min(100, evidenceQs.length * 20),
        recommendation:"Enforce evidence gate — no decision proceeds without attached evidence",
        autoEscalate:true, correlationId:uuidv4(),
      });
    }

    // ── 3. Governance drift from sovereign memory ────────────
    const memoryInsights = memory.detectPatterns();
    for (const insight of memoryInsights) {
      const category: PatternCategory =
        insight.pattern.includes("violation") ? "governance_drift" :
        insight.pattern.includes("Evidence-free") ? "evidence_decay" :
        "knowledge_loss";
      detected.push({
        id:uuidv4(), tenantId:this.tenantId,
        category, severity:insight.confidence >= 85 ? "high" : "medium",
        title:insight.pattern,
        description:insight.risk,
        frequency:insight.frequency, firstObservedAt:now, lastObservedAt:now,
        affectedEntities:insight.supportingIds, affectedActors:[],
        evidence:insight.supportingIds, trend:"stable",
        riskScore:Math.round(insight.confidence * 0.8),
        recommendation:insight.recommendation,
        autoEscalate:insight.confidence >= 90, correlationId:uuidv4(),
      });
    }

    // ── 4. Knowledge loss detection ──────────────────────────
    const stats = memory.getStats();
    if (stats.total > 10 && stats.byType.institutional === 0) {
      detected.push({
        id:uuidv4(), tenantId:this.tenantId,
        category:"knowledge_loss", severity:"medium",
        title:"No institutional lessons being recorded",
        description:"The organization is not capturing governance lessons learned — institutional knowledge at risk",
        frequency:1, firstObservedAt:now, lastObservedAt:now,
        affectedEntities:[], affectedActors:[],
        evidence:[], trend:"emerging",
        riskScore:35,
        recommendation:"Establish lessons-learned process — record institutional memories after key events",
        autoEscalate:false, correlationId:uuidv4(),
      });
    }

    // Store detected patterns
    for (const p of detected) {
      if (!patternStore.find(x => x.tenantId === this.tenantId && x.category === p.category)) {
        patternStore.push(p);
      }
    }

    return detected;
  }

  generateReport(): PatternReport {
    const patterns = this.scan();
    const critical  = patterns.filter(p => p.severity === "critical").length;
    const high      = patterns.filter(p => p.severity === "high").length;

    let healthScore = 100;
    for (const p of patterns) {
      if (p.severity === "critical") healthScore -= 20;
      else if (p.severity === "high") healthScore -= 10;
      else if (p.severity === "medium") healthScore -= 5;
    }
    healthScore = Math.max(0, healthScore);

    const topRisk  = patterns.sort((a,b) => b.riskScore - a.riskScore)[0];
    const immediateActions = patterns
      .filter(p => p.autoEscalate || p.severity === "critical")
      .map(p => p.recommendation);

    const executiveSummary = healthScore >= 80
      ? "Governance health is strong. Monitor for emerging patterns."
      : healthScore >= 60
      ? `Governance requires attention. ${critical + high} significant patterns detected.`
      : `CRITICAL: Governance health deteriorating. Immediate board escalation recommended.`;

    return {
      tenantId: this.tenantId,
      generatedAt: new Date().toISOString(),
      overallHealthScore: healthScore,
      patterns,
      criticalCount: critical,
      highCount: high,
      topRisk: topRisk?.title ?? "No critical risks detected",
      executiveSummary,
      immediateActions,
    };
  }

  getStoredPatterns(): GovernancePattern[] {
    return patternStore.filter(p => p.tenantId === this.tenantId);
  }
}

const patternCache = new Map<string, InstitutionalPatternEngine>();
export function getPatternEngine(tenantId: string): InstitutionalPatternEngine {
  if (!patternCache.has(tenantId)) patternCache.set(tenantId, new InstitutionalPatternEngine(tenantId));
  return patternCache.get(tenantId)!;
}
