/**
 * Risk Module — Service Layer
 * All risk operations go through this service.
 * Directly depends on UGOMRegistry + SKG + EventBus — no bypasses.
 */
import { v4 as uuidv4 } from "uuid";
import { UGOMRegistry } from "../../core/ugom.registry";
import { SovereignKnowledgeGraph } from "../../graph/graph.engine";
import { EventBus } from "../../core/event-bus";
import { GovernanceMemoryStore } from "../../governance-memory/memory.store";
import { RiskEntity } from "../../schemas/entities.schema";
import { RiskBreachPayload } from "../../types/events.types";

export interface CreateRiskInput {
  title:          string;
  description?:   string;
  category:       RiskEntity["category"];
  owner:          string;
  ownerId?:       string;
  department?:    string;
  probability:    number;
  impact:         number;
  controlIds?:    string[];
  regulationId?:  string;
  tags?:          string[];
  createdBy:      string;
}

export interface RiskSummary {
  totalRisks:       number;
  criticalCount:    number;
  breachCount:      number;
  avgResidualScore: number;
  topRisks:         RiskEntity[];
}

export class RiskService {
  constructor(
    private readonly registry: UGOMRegistry,
    private readonly graph:    SovereignKnowledgeGraph,
    private readonly eventBus: EventBus,
    private readonly memory:   GovernanceMemoryStore,
    private readonly tenantId: string,
  ) {}

  async createRisk(input: CreateRiskInput): Promise<RiskEntity> {
    const inherentScore = input.probability * input.impact;
    const now = new Date().toISOString();

    const risk = await this.registry.create<RiskEntity>(
      "risk",
      {
        title:          input.title,
        description:    input.description,
        category:       input.category,
        owner:          input.owner,
        ownerId:        input.ownerId,
        department:     input.department,
        status:         "active",
        priority:       inherentScore >= 15 ? "critical" : inherentScore >= 10 ? "high" : inherentScore >= 6 ? "medium" : "low",
        riskLevel:      inherentScore >= 15 ? "critical" : inherentScore >= 10 ? "high" : inherentScore >= 6 ? "medium" : "low",
        impactLevel:    input.impact >= 4 ? "critical" : input.impact >= 3 ? "high" : "medium",
        code:           `R-${String(Date.now()).slice(-4)}`,
        probability:    input.probability,
        impact:         input.impact,
        inherentScore,
        residualScore:  inherentScore,
        controlIds:     input.controlIds ?? [],
        regulationId:   input.regulationId,
        toleranceBreached: inherentScore >= 20,
        appetiteBreached:  inherentScore >= 15,
        trending:       "stable",
        treatmentStatus: "not_started",
        linkedControls:  input.controlIds ?? [],
        linkedRegulations: input.regulationId ? [input.regulationId] : [],
        linkedPolicies:  [],
        linkedEvidence:  [],
        linkedFindings:  [],
        linkedCAPAs:     [],
        linkedDecisions: [],
        linkedObligations:[],
        escalationPath:  inherentScore >= 15 ? [
          { order: 1, escalateTo: "CRO",   triggerAfterH: 24 },
          { order: 2, escalateTo: "Board", triggerAfterH: 72 },
        ] : [],
        approvalChain: [],
        confidentiality: "confidential",
        tags:           input.tags ?? [],
        updatedBy:      input.createdBy,
      } as unknown as Omit<RiskEntity, "id" | "version" | "createdAt" | "updatedAt" | "auditTrail" | "tenantId" | "organizationId">,
      input.createdBy,
    );

    // Check appetite breach → emit event
    if (risk.appetiteBreached) {
      const payload: RiskBreachPayload = {
        riskId:      risk.id,
        riskCode:    risk.code,
        breachType:  "appetite",
        actualScore: risk.inherentScore,
        threshold:   15,
        escalateTo:  ["CRO", "Board"],
      };
      this.eventBus.emit({
        type: "risk.appetite_breach", source: "RiskService",
        entityId: risk.id, entityType: "risk",
        payload, tenantId: this.tenantId, severity: "critical",
      });
      // Store in memory
      this.memory.store({
        type: "risk_evolution",
        title: `تجاوز شهية المخاطر: ${risk.title}`,
        summary: `المخاطرة ${risk.code} تجاوزت حد شهية المخاطر (${risk.inherentScore} > 15)`,
        source: "RiskService",
        sourceEntityId: risk.id, sourceEntityType: "risk",
        relatedEntityIds: [risk.id],
        importance: "critical",
        tags: ["breach", "appetite", risk.category],
        confidenceScore: 95,
        tenantId: this.tenantId,
      });
    }

    return risk;
  }

  async updateResidualScore(
    riskId:     string,
    newScore:   number,
    updatedBy:  string,
    reason?:    string,
  ): Promise<RiskEntity | undefined> {
    const risk = this.registry.findById<RiskEntity>(riskId);
    if (!risk) return undefined;
    const wasBreached = risk.toleranceBreached;
    const updated = await this.registry.update<RiskEntity>(
      riskId,
      { residualScore: newScore, toleranceBreached: newScore >= 20, updatedBy } as Partial<RiskEntity>,
      updatedBy, reason,
    );
    // Memory: if breach resolved
    if (updated && wasBreached && !updated.toleranceBreached) {
      this.memory.store({
        type: "lesson_learned",
        title: `تقليص مخاطرة حرجة: ${risk.title}`,
        summary: `تحسّنت ${risk.code} من ${risk.residualScore} إلى ${newScore} بعد: ${reason ?? "إجراء تصحيحي"}`,
        source: "RiskService",
        sourceEntityId: riskId, sourceEntityType: "risk",
        relatedEntityIds: [riskId],
        importance: "high",
        tags: ["residual_improvement", risk.category],
        confidenceScore: 85,
        tenantId: this.tenantId,
      });
    }
    return updated;
  }

  getRisksByCategory(): Record<string, RiskEntity[]> {
    const risks = this.registry.findByType<RiskEntity>("risk");
    const map: Record<string, RiskEntity[]> = {};
    for (const r of risks) {
      if (!map[r.category]) map[r.category] = [];
      map[r.category].push(r);
    }
    return map;
  }

  getHeatmap(): Array<{ probability: number; impact: number; risks: RiskEntity[] }> {
    const risks = this.registry.findByType<RiskEntity>("risk");
    const cells: Array<{ probability: number; impact: number; risks: RiskEntity[] }> = [];
    for (let p = 1; p <= 5; p++) {
      for (let i = 1; i <= 5; i++) {
        const group = risks.filter(r => r.probability === p && r.impact === i);
        if (group.length > 0) cells.push({ probability: p, impact: i, risks: group });
      }
    }
    return cells;
  }

  getBreaches(): RiskEntity[] {
    return this.registry.findByType<RiskEntity>("risk")
      .filter(r => r.toleranceBreached || r.appetiteBreached);
  }

  getSummary(): RiskSummary {
    const all = this.registry.findByType<RiskEntity>("risk");
    const breaches = all.filter(r => r.toleranceBreached);
    const avg = all.length
      ? Math.round(all.reduce((s, r) => s + r.residualScore, 0) / all.length * 10) / 10
      : 0;
    return {
      totalRisks:       all.length,
      criticalCount:    all.filter(r => r.riskLevel === "critical").length,
      breachCount:      breaches.length,
      avgResidualScore: avg,
      topRisks:         all.sort((a, b) => b.inherentScore - a.inherentScore).slice(0, 5),
    };
  }
}
