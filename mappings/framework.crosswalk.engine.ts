/**
 * Framework Crosswalk Engine
 * Maps controls across frameworks, detects overlaps, identifies gaps.
 * Enables: "Implement GDPR Art.30 once, satisfy ISO 27701 7.2.1 simultaneously."
 */
import { FrameworkId, ControlMapping, FrameworkGap } from "../frameworks/framework.types";
import { CANONICAL_CONTROL_LIBRARY, CanonicalControl } from "../controls/control.library";

export interface CrosswalkResult {
  sourceFramework:  FrameworkId;
  targetFramework:  FrameworkId;
  mappings:         ControlMapping[];
  coverageScore:    number;    // % of target covered by source
  uncoveredControls:string[];  // target controls with no source mapping
  redundantControls:string[];  // source controls that map to nothing
  harmonizationRecommendations: string[];
}

export interface OverlapAnalysis {
  frameworks:       FrameworkId[];
  sharedControls:   Array<{ controlId: string; coveredBy: FrameworkId[]; coverageScore: number }>;
  uniqueControls:   Array<{ frameworkId: FrameworkId; controlId: string; title: string }>;
  harmonizationScore:number;  // 0-100 overall overlap
}

export class FrameworkCrosswalkEngine {
  /**
   * Compare two frameworks and produce a mapping.
   * Returns how much of target is satisfied by implementing source.
   */
  crosswalk(sourceId: FrameworkId, targetId: FrameworkId): CrosswalkResult {
    const sourceControls = CANONICAL_CONTROL_LIBRARY.filter(c =>
      c.frameworkRefs.some(r => r.frameworkId === sourceId)
    );
    const targetControls = CANONICAL_CONTROL_LIBRARY.filter(c =>
      c.frameworkRefs.some(r => r.frameworkId === targetId)
    );

    const mappings: ControlMapping[] = [];
    const coveredTargetIds = new Set<string>();

    for (const src of sourceControls) {
      const srcRef = src.frameworkRefs.find(r => r.frameworkId === sourceId)!;
      for (const tgt of targetControls) {
        const tgtRef = tgt.frameworkRefs.find(r => r.frameworkId === targetId);
        if (!tgtRef) continue;
        // Same canonical control = direct mapping
        if (src.id === tgt.id) {
          mappings.push({
            sourceControlId: srcRef.controlCode,
            sourceFramework: sourceId,
            targetControlId: tgtRef.controlCode,
            targetFramework: targetId,
            mappingType:     "equivalent",
            coverageScore:   100,
            notes:           `Both map to canonical control ${src.id}: ${src.title}`,
            validatedAt:     new Date().toISOString(),
          });
          coveredTargetIds.add(tgtRef.controlCode);
        } else if (src.category === tgt.category) {
          mappings.push({
            sourceControlId: srcRef.controlCode,
            sourceFramework: sourceId,
            targetControlId: tgtRef.controlCode,
            targetFramework: targetId,
            mappingType:     "related",
            coverageScore:   60,
            notes:           `Same category (${src.category}) — partial coverage`,
            validatedAt:     new Date().toISOString(),
          });
          coveredTargetIds.add(tgtRef.controlCode);
        }
      }
    }

    const allTargetCodes = targetControls
      .map(c => c.frameworkRefs.find(r => r.frameworkId === targetId)?.controlCode ?? "")
      .filter(Boolean);
    const uncoveredControls = allTargetCodes.filter(c => !coveredTargetIds.has(c));
    const coverageScore     = allTargetCodes.length > 0
      ? Math.round((coveredTargetIds.size / allTargetCodes.length) * 100)
      : 0;

    const recommendations: string[] = [];
    if (coverageScore < 50)  recommendations.push(`Low coverage (${coverageScore}%) — significant additional controls needed`);
    if (uncoveredControls.length > 0) recommendations.push(`${uncoveredControls.length} target controls require dedicated implementation`);
    if (mappings.filter(m => m.mappingType === "equivalent").length > 0)
      recommendations.push(`${mappings.filter(m => m.mappingType === "equivalent").length} controls can be shared — avoid duplication`);

    return {
      sourceFramework: sourceId, targetFramework: targetId,
      mappings, coverageScore, uncoveredControls, redundantControls: [],
      harmonizationRecommendations: recommendations,
    };
  }

  /**
   * Analyze overlap across multiple frameworks.
   * "If we implement ISO 27001, what % of NCA ECC + SAMA CSF do we get for free?"
   */
  analyzeOverlap(frameworkIds: FrameworkId[]): OverlapAnalysis {
    const controlFrameworkMap = new Map<string, Set<FrameworkId>>();

    for (const ctrl of CANONICAL_CONTROL_LIBRARY) {
      for (const ref of ctrl.frameworkRefs) {
        if (frameworkIds.includes(ref.frameworkId)) {
          if (!controlFrameworkMap.has(ctrl.id)) controlFrameworkMap.set(ctrl.id, new Set());
          controlFrameworkMap.get(ctrl.id)!.add(ref.frameworkId);
        }
      }
    }

    const sharedControls: OverlapAnalysis["sharedControls"] = [];
    const uniqueControls: OverlapAnalysis["uniqueControls"]  = [];

    for (const [ctrlId, fwks] of controlFrameworkMap) {
      const ctrl = CANONICAL_CONTROL_LIBRARY.find(c => c.id === ctrlId)!;
      if (fwks.size > 1) {
        sharedControls.push({
          controlId:     ctrlId,
          coveredBy:     [...fwks],
          coverageScore: Math.round((fwks.size / frameworkIds.length) * 100),
        });
      } else {
        uniqueControls.push({ frameworkId: [...fwks][0], controlId: ctrlId, title: ctrl?.title ?? ctrlId });
      }
    }

    const harmonizationScore = controlFrameworkMap.size > 0
      ? Math.round((sharedControls.length / controlFrameworkMap.size) * 100)
      : 0;

    return { frameworks: frameworkIds, sharedControls, uniqueControls, harmonizationScore };
  }

  /**
   * Gap analysis: which canonical controls are NOT implemented for a framework?
   */
  detectGaps(frameworkId: FrameworkId, implementedControlIds: string[]): FrameworkGap[] {
    const required = CANONICAL_CONTROL_LIBRARY.filter(c =>
      c.frameworkRefs.some(r => r.frameworkId === frameworkId)
    );
    const gaps: FrameworkGap[] = [];

    for (const ctrl of required) {
      if (!implementedControlIds.includes(ctrl.id)) {
        const ref = ctrl.frameworkRefs.find(r => r.frameworkId === frameworkId)!;
        gaps.push({
          frameworkId,
          controlId:   ref.controlCode,
          gapType:     "missing_control",
          severity:    ctrl.maturityLevel <= 2 ? "critical" : ctrl.maturityLevel === 3 ? "high" : "medium",
          description: `Control not implemented: ${ctrl.title}`,
          recommendation: `Implement ${ctrl.id}: ${ctrl.title} — ${ctrl.objective}`,
          entityIds:   [],
        });
      }
    }
    return gaps;
  }
}

export const frameworkCrosswalkEngine = new FrameworkCrosswalkEngine();
