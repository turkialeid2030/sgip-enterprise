/**
 * Gap Analysis Engine — identifies control gaps against framework requirements.
 * Produces prioritized remediation plans with evidence requirements.
 */
import { FrameworkId, FrameworkGap } from "../frameworks/framework.types";
import { CANONICAL_CONTROL_LIBRARY } from "../controls/control.library";
import { frameworkCrosswalkEngine } from "../mappings/framework.crosswalk.engine";

export interface GapAnalysisReport {
  tenantId:       string;
  frameworkId:    FrameworkId;
  analysisDate:   string;
  totalControls:  number;
  implemented:    number;
  gaps:           FrameworkGap[];
  criticalGaps:   number;
  highGaps:       number;
  coverageScore:  number;
  riskExposure:   "critical" | "high" | "medium" | "low";
  quickWins:      string[];           // low-effort, high-impact controls
  strategicItems: string[];           // high-effort, high-impact controls
  estimatedDaysToClose: number;
}

export class GapAnalysisEngine {
  analyze(params: {
    tenantId:           string;
    frameworkId:        FrameworkId;
    implementedControls:string[];
  }): GapAnalysisReport {
    const allRequired = CANONICAL_CONTROL_LIBRARY.filter(c =>
      c.frameworkRefs.some(r => r.frameworkId === params.frameworkId)
    );
    const requiredIds = new Set(allRequired.map(c=>c.id));
    const implementedSet = new Set(params.implementedControls.filter(id=>requiredIds.has(id)));
    const implementedControls = [...implementedSet];
    const gaps = frameworkCrosswalkEngine.detectGaps(params.frameworkId, implementedControls);

    const criticalGaps = gaps.filter(g => g.severity === "critical").length;
    const highGaps     = gaps.filter(g => g.severity === "high").length;
    const coverageScore = allRequired.length > 0
      ? Math.min(100, Math.round((implementedControls.length / allRequired.length) * 100))
      : 100;

    const riskExposure: GapAnalysisReport["riskExposure"] =
      criticalGaps >= 3 ? "critical" :
      criticalGaps >= 1 ? "high" :
      highGaps     >= 3 ? "medium" : "low";

    // Quick wins: low effort, critical/high severity
    const quickWins = CANONICAL_CONTROL_LIBRARY
      .filter(c => c.frameworkRefs.some(r => r.frameworkId === params.frameworkId) &&
        !implementedSet.has(c.id) &&
        c.implementationEffort === "low" &&
        ["critical","high"].includes(c.maturityLevel <= 2 ? "critical" : "high"))
      .map(c => c.id);

    // Strategic items: high effort controls that significantly increase maturity
    const strategicItems = CANONICAL_CONTROL_LIBRARY
      .filter(c => c.frameworkRefs.some(r => r.frameworkId === params.frameworkId) &&
        !implementedSet.has(c.id) &&
        ["high","very_high"].includes(c.implementationEffort) &&
        c.maturityLevel >= 3)
      .map(c => c.id);

    const estimatedDaysToClose = gaps.length * 21;  // avg 3 weeks per control

    return {
      tenantId: params.tenantId,
      frameworkId: params.frameworkId,
      analysisDate: new Date().toISOString(),
      totalControls: allRequired.length,
      implemented: implementedControls.length,
      gaps,
      criticalGaps,
      highGaps,
      coverageScore,
      riskExposure,
      quickWins,
      strategicItems,
      estimatedDaysToClose,
    };
  }
}

export const gapAnalysisEngine = new GapAnalysisEngine();
