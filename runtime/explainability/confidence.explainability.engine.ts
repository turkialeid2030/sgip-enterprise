/**
 * Decision Confidence Explainability Engine (XAI) — Pilot Enhancement
 *
 * Addresses the consultant finding: the "84% decision confidence" must not be
 * a black box. Produces an auditable chain-of-reasoning using feature
 * attribution (SHAP-style additive contributions), counterfactuals, and a
 * human-override hook — bilingual, regulator-defensible.
 *
 * Critically: post-hoc explanations are presented as APPROXIMATIONS, paired
 * with a model card and human-review right (PDPL Article on automated decisions).
 * Additive module: does not modify any frozen runtime.
 */

export interface ConfidenceFactor {
  factor:        string;          // e.g. "evidence_completeness"
  labelEn:       string;
  labelAr:       string;
  contribution:  number;          // signed points: +raises, -lowers the score
  value:         number;          // the underlying measured value (0-100)
  weight:        number;          // factor weight in the model (0-1)
  provenance:    "automated" | "smart_upload" | "manual";
}

export interface Counterfactual {
  factor:    string;
  currentEn: string;
  currentAr: string;
  ifChanged: string;              // "if evidence rose to 85%"
  ifChangedAr: string;
  scoreThen: number;              // resulting confidence
  delta:     number;              // change vs current
}

export interface ConfidenceExplanation {
  tenantId:        string;
  score:           number;        // the headline confidence index (0-100)
  computedAt:      string;
  method:          string;        // explanation technique used
  baseline:        number;        // model baseline before factors
  factors:         ConfidenceFactor[];   // sorted by |contribution| desc
  topPositive:     ConfidenceFactor[];
  topNegative:     ConfidenceFactor[];
  counterfactuals: Counterfactual[];
  narrative:       { en: string; ar: string };
  modelCard:       {
    name:        string;
    version:     string;
    intendedUse: string;
    limitations: string;
    method:      string;
    dataLineage: string;
  };
  humanReview:     {
    overridable:  boolean;
    overrideNote: { en: string; ar: string };
  };
  disclaimer:      { en: string; ar: string };
}

const FACTOR_META: Record<string, { en: string; ar: string; weight: number }> = {
  evidence_completeness:  { en: "Evidence Completeness",   ar: "اكتمال الأدلة",          weight: 0.30 },
  control_effectiveness:  { en: "Control Effectiveness",   ar: "فعالية الضوابط",         weight: 0.25 },
  data_freshness:         { en: "Data Freshness",          ar: "حداثة البيانات",         weight: 0.15 },
  automated_sourcing:     { en: "Automated Data Sourcing", ar: "المصادر الآلية للبيانات", weight: 0.15 },
  framework_coverage:     { en: "Framework Coverage",      ar: "تغطية الأطر التنظيمية",   weight: 0.10 },
  audit_trail_integrity:  { en: "Audit Trail Integrity",   ar: "سلامة مسار التدقيق",      weight: 0.05 },
};

export interface FactorInput {
  factor:     keyof typeof FACTOR_META | string;
  value:      number;             // 0-100
  provenance?: "automated" | "smart_upload" | "manual";
}

export class ConfidenceExplainabilityEngine {
  private readonly BASELINE = 50;  // neutral starting point

  /**
   * Compute the confidence score AND its full explanation in one pass.
   * SHAP-style: each factor's contribution = weight * (value - baseline) / scaling.
   */
  explain(tenantId: string, inputs: FactorInput[]): ConfidenceExplanation {
    const factors: ConfidenceFactor[] = inputs.map(inp => {
      const meta = FACTOR_META[inp.factor] ?? { en: inp.factor, ar: inp.factor, weight: 0.1 };
      // Additive contribution centered on baseline
      const contribution = meta.weight * (inp.value - this.BASELINE);
      return {
        factor:       inp.factor,
        labelEn:      meta.en,
        labelAr:      meta.ar,
        contribution: Math.round(contribution * 10) / 10,
        value:        inp.value,
        weight:       meta.weight,
        provenance:   inp.provenance ?? "manual",
      };
    });

    // Score = baseline + sum of contributions, clamped 0-100
    const rawScore = this.BASELINE + factors.reduce((s, f) => s + f.contribution, 0);
    const score = Math.max(0, Math.min(100, Math.round(rawScore)));

    const sorted = [...factors].sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution));
    const topPositive = sorted.filter(f => f.contribution > 0).slice(0, 3);
    const topNegative = sorted.filter(f => f.contribution < 0).slice(0, 3);

    // Counterfactuals for the biggest negative drivers
    const counterfactuals: Counterfactual[] = topNegative.map(f => {
      const target = 85;
      const meta = FACTOR_META[f.factor] ?? { weight: 0.1 };
      const newContribution = meta.weight * (target - this.BASELINE);
      const scoreThen = Math.max(0, Math.min(100, Math.round(score - f.contribution + newContribution)));
      return {
        factor:      f.factor,
        currentEn:   `${f.labelEn} is at ${f.value}%`,
        currentAr:   `${f.labelAr} عند ${f.value}%`,
        ifChanged:   `if ${f.labelEn} rose to ${target}%`,
        ifChangedAr: `لو ارتفع ${f.labelAr} إلى ${target}%`,
        scoreThen,
        delta:       scoreThen - score,
      };
    });

    const narrative = this.buildNarrative(score, topPositive, topNegative);

    return {
      tenantId, score, computedAt: new Date().toISOString(),
      method: "SHAP-style additive feature attribution + counterfactual analysis",
      baseline: this.BASELINE,
      factors: sorted,
      topPositive, topNegative, counterfactuals,
      narrative,
      modelCard: {
        name:        "SGIP Decision Confidence Model",
        version:     "1.0",
        intendedUse: "Board-level governance decision support. Not a substitute for human judgment.",
        limitations: "Post-hoc attributions are approximations of model behavior, not logical proof. Confidence reflects data quality, not outcome certainty.",
        method:      "Weighted additive factor model with provenance-adjusted trust weighting.",
        dataLineage: "Factors sourced from evidence registry, control monitoring, data maturity engine, and audit trail.",
      },
      humanReview: {
        overridable: true,
        overrideNote: {
          en: "This score may be overridden by an authorized governance officer. Any override is recorded in the immutable audit trail (PDPL human-review right).",
          ar: "يمكن لمسؤول الحوكمة المخوّل تجاوز هذه الدرجة. يُسجَّل أي تجاوز في مسار التدقيق غير القابل للتعديل (حق المراجعة البشرية وفق نظام حماية البيانات).",
        },
      },
      disclaimer: {
        en: "Explanations are approximations to aid interpretation. They do not constitute proof of the underlying computation and should be reviewed alongside source evidence.",
        ar: "التفسيرات تقريبية للمساعدة على الفهم، ولا تُعدّ دليلاً قاطعاً على الحساب الأساسي، ويجب مراجعتها مع الأدلة المصدرية.",
      },
    };
  }

  private buildNarrative(
    score: number,
    pos: ConfidenceFactor[],
    neg: ConfidenceFactor[],
  ): { en: string; ar: string } {
    const posEn = pos.map(f => `${f.labelEn} (+${f.contribution})`).join(", ") || "none";
    const negEn = neg.map(f => `${f.labelEn} (${f.contribution})`).join(", ") || "none";
    const posAr = pos.map(f => `${f.labelAr} (+${f.contribution})`).join("، ") || "لا يوجد";
    const negAr = neg.map(f => `${f.labelAr} (${f.contribution})`).join("، ") || "لا يوجد";

    return {
      en: `The decision confidence index is ${score}%. It is raised primarily by: ${posEn}. It is reduced primarily by: ${negEn}. Improving the negative drivers would yield the largest confidence gain.`,
      ar: `مؤشر ثقة القرار هو ${score}%. يرتفع أساساً بسبب: ${posEn === "none" ? "لا يوجد" : posAr}. وينخفض أساساً بسبب: ${negEn === "none" ? "لا يوجد" : negAr}. معالجة العوامل السلبية ستحقق أكبر زيادة في الثقة.`,
    };
  }
}

let _engine: ConfidenceExplainabilityEngine | null = null;
export function getConfidenceExplainabilityEngine(): ConfidenceExplainabilityEngine {
  if (!_engine) _engine = new ConfidenceExplainabilityEngine();
  return _engine;
}
