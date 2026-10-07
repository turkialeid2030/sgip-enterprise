/**
 * Regulatory Mapper — builds full regulation → policy → control → evidence chains.
 * Used for: compliance reporting, gap analysis, regulator submissions.
 */
import { GovernanceGraphRuntime } from "../runtime/governance.graph.runtime";
import { RegulatoryMapping, RegulatoryGap } from "../../types/graph.v4.types";

export interface FullRegulatoryView {
  regulationId:   string;
  regulationCode: string;
  mappings:       RegulatoryMapping[];
  aggregateCoverageScore: number;
  criticalGaps:   RegulatoryGap[];
  remediationPriority: "immediate" | "urgent" | "scheduled" | "none";
}

export class RegulatoryMapper {
  constructor(private readonly graph: GovernanceGraphRuntime) {}

  getFullView(regulationId: string): FullRegulatoryView {
    const mapping = this.graph.getRegulatoryMapping(regulationId);
    const criticalGaps = mapping.gaps.filter(g => g.severity === "critical");

    const remediationPriority: FullRegulatoryView["remediationPriority"] =
      criticalGaps.length >= 2    ? "immediate" :
      criticalGaps.length === 1   ? "urgent"    :
      mapping.gaps.length > 0     ? "scheduled" :
      "none";

    return {
      regulationId,
      regulationCode:  mapping.regulationCode,
      mappings:        [mapping],
      aggregateCoverageScore: mapping.coverageScore,
      criticalGaps,
      remediationPriority,
    };
  }

  /** Compare two regulations — find shared controls, policies, obligations */
  compareRegulations(regId1: string, regId2: string): {
    sharedControls:    string[];
    sharedPolicies:    string[];
    uniqueToReg1:      string[];
    uniqueToReg2:      string[];
    synergyScore:      number;
  } {
    const m1 = this.graph.getRegulatoryMapping(regId1);
    const m2 = this.graph.getRegulatoryMapping(regId2);

    const c1 = new Set(m1.controls.map(c => c.id));
    const c2 = new Set(m2.controls.map(c => c.id));
    const p1 = new Set(m1.policies.map(p => p.id));
    const p2 = new Set(m2.policies.map(p => p.id));

    const sharedControls = [...c1].filter(id => c2.has(id));
    const sharedPolicies = [...p1].filter(id => p2.has(id));

    const synergyScore = Math.round(
      ((sharedControls.length + sharedPolicies.length) /
       Math.max(1, c1.size + c2.size + p1.size + p2.size)) * 100
    );

    return {
      sharedControls,
      sharedPolicies,
      uniqueToReg1: [...c1].filter(id => !c2.has(id)),
      uniqueToReg2: [...c2].filter(id => !c1.has(id)),
      synergyScore,
    };
  }
}
