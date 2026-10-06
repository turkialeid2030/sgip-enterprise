/**
 * Pattern Detector — identifies repeated governance failures,
 * recurring findings, escalation trends, control drift.
 */
import { GovernanceMemoryStore, MemoryEntry } from "./memory.store";
import { BaseGovernanceObject } from "../types/governance.types";

export interface PatternResult {
  patternType:  string;
  frequency:    number;
  severity:     "critical" | "high" | "medium" | "low";
  description:  string;
  entityIds:    string[];
  recommendation: string;
  trend:        "increasing" | "stable" | "decreasing" | "worsening";
}

export class PatternDetector {
  constructor(private readonly memory: GovernanceMemoryStore) {}

  detectRepeatedFindings(findings: BaseGovernanceObject[]): PatternResult[] {
    const patterns: PatternResult[] = [];
    // Group by linked regulation
    const byReg = new Map<string, BaseGovernanceObject[]>();
    for (const f of findings) {
      for (const rid of f.linkedRegulations) {
        if (!byReg.has(rid)) byReg.set(rid, []);
        byReg.get(rid)!.push(f);
      }
    }
    for (const [regId, group] of byReg) {
      if (group.length >= 2) {
        patterns.push({
          patternType:    "repeated_regulatory_finding",
          frequency:      group.length,
          severity:       group.length >= 3 ? "high" : "medium",
          description:    `${group.length} نتائج متكررة للائحة ${regId}`,
          entityIds:      group.map(g => g.id),
          recommendation: "مراجعة عميقة لمنظومة الضوابط المرتبطة بهذه اللائحة",
          trend:          "increasing",
        });
      }
    }
    // Group by owner — accountability failure signal
    const byOwner = new Map<string, BaseGovernanceObject[]>();
    for (const f of findings) {
      if (!byOwner.has(f.owner)) byOwner.set(f.owner, []);
      byOwner.get(f.owner)!.push(f);
    }
    for (const [owner, group] of byOwner) {
      if (group.length >= 3) {
        patterns.push({
          patternType:    "accountability_concentration",
          frequency:      group.length,
          severity:       "high",
          description:    `${owner} يتراكم عليه ${group.length} نتائج مفتوحة`,
          entityIds:      group.map(g => g.id),
          recommendation: "توزيع الملكية وتفعيل آلية المساءلة",
          trend:          "stable",
        });
      }
    }
    return patterns;
  }

  detectEscalationAvoidance(workflows: BaseGovernanceObject[]): PatternResult[] {
    const overdue = workflows.filter(w => w.status === "overdue");
    if (overdue.length === 0) return [];
    return [{
      patternType:    "escalation_avoidance",
      frequency:      overdue.length,
      severity:       overdue.length >= 3 ? "critical" : "high",
      description:    `${overdue.length} عمليات متأخرة دون تصعيد`,
      entityIds:      overdue.map(w => w.id),
      recommendation: "تفعيل بروتوكول التصعيد التلقائي",
      trend:          "increasing",
    }];
  }

  detectControlDrift(controls: BaseGovernanceObject[]): PatternResult[] {
    const weak = controls.filter(c => {
      const effectiveness = (c as unknown as Record<string, unknown>)["effectiveness"] as number | undefined;
      return effectiveness !== undefined && effectiveness < 60;
    });
    if (weak.length === 0) return [];
    return [{
      patternType:    "control_drift",
      frequency:      weak.length,
      severity:       weak.length >= 3 ? "high" : "medium",
      description:    `${weak.length} ضوابط انخفضت فعاليتها أقل من 60%`,
      entityIds:      weak.map(c => c.id),
      recommendation: "إعادة تقييم وتحديث الضوابط المتأثرة",
      trend:          "worsening",
    }];
  }

  learnFromPattern(pattern: PatternResult, tenantId: string): MemoryEntry {
    return this.memory.store({
      type:             "pattern",
      title:            `نمط مكتشف: ${pattern.patternType.replace(/_/g, " ")}`,
      summary:          `${pattern.description}. التوصية: ${pattern.recommendation}`,
      source:           "PatternDetector",
      relatedEntityIds: pattern.entityIds,
      importance:       pattern.severity === "critical" ? "critical" : pattern.severity,
      tags:             [pattern.patternType, "auto_detected"],
      confidenceScore:  75,
      tenantId,
    });
  }
}
