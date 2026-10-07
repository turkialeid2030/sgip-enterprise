/**
 * Data Maturity Index Engine — Pilot Enhancement
 *
 * Addresses the consultant finding: "boards cannot trust a governance number
 * without knowing how it was produced." Tags every data point with provenance
 * (automated | smart_upload | manual) and a freshness timestamp, then computes
 * a board-level sub-metric showing automated-vs-manual sourcing.
 *
 * Maps to Gartner-style data-governance maturity (Unaware -> Optimized).
 * Additive module: does not modify any frozen runtime.
 */

export type DataProvenance = "automated" | "smart_upload" | "manual";

export interface DataPointProvenance {
  pointId:      string;
  metric:       string;          // e.g. "evidence_ratio", "control_effectiveness"
  provenance:   DataProvenance;
  sourceSystem: string | null;   // e.g. "active_directory", "csv_template", "user_form"
  capturedAt:   string;          // ISO timestamp
  tenantId:     string;
}

export type MaturityStage =
  | "unaware"      // 0-20: mostly manual, no provenance
  | "reactive"     // 20-40
  | "managed"      // 40-60
  | "proactive"    // 60-80
  | "optimized";   // 80-100: mostly automated, fresh, traceable

export interface DataMaturityResult {
  tenantId:           string;
  computedAt:         string;
  totalDataPoints:    number;
  automatedCount:     number;
  smartUploadCount:   number;
  manualCount:        number;
  automatedRatio:     number;   // 0-100  (automated / total)
  verifiedRatio:      number;   // 0-100  (automated + smart_upload / total)
  freshnessScore:     number;   // 0-100  (how recent the data is)
  maturityIndex:      number;   // 0-100  weighted composite
  maturityStage:      MaturityStage;
  // Provenance weighting: automated data earns higher trust than manual
  trustWeightedScore: number;   // 0-100
  byMetric:           Array<{ metric: string; automatedRatio: number; points: number }>;
  boardSummary:       { en: string; ar: string };
  recommendations:    string[];
}

// Trust weights — automated data is weighted higher in confidence calculations
const PROVENANCE_WEIGHT: Record<DataProvenance, number> = {
  automated:    1.0,
  smart_upload: 0.7,
  manual:       0.4,
};

const FRESHNESS_HALFLIFE_HOURS = 168; // 7 days — data older than this decays

export class DataMaturityEngine {
  private points: Map<string, DataPointProvenance[]> = new Map();

  /** Record provenance for a single data point. */
  track(p: DataPointProvenance): void {
    if (!p.pointId || !p.tenantId || !p.metric || !(p.provenance in PROVENANCE_WEIGHT)) {
      throw Object.assign(new Error("Invalid data provenance record"), { statusCode:422, code:"VALIDATION_ERROR" });
    }
    const list = this.points.get(p.tenantId) ?? [];
    const idx = list.findIndex(existing => existing.pointId === p.pointId);
    if (idx >= 0) list[idx] = p; else list.push(p);
    this.points.set(p.tenantId, list);
  }

  /** Bulk-record provenance entries. */
  trackBatch(entries: DataPointProvenance[]): void {
    for (const e of entries) this.track(e);
  }

  private freshness(capturedAt: string): number {
    const capturedMs = Date.parse(capturedAt);
    if (!Number.isFinite(capturedMs)) return 0;
    const ageHours = (Date.now() - capturedMs) / 3_600_000;
    if (ageHours <= 0) return 1;
    // Exponential decay: score halves every FRESHNESS_HALFLIFE_HOURS.
    return Math.max(0, Math.min(1, Math.pow(0.5, ageHours / FRESHNESS_HALFLIFE_HOURS)));
  }

  private stageFor(index: number): MaturityStage {
    if (index >= 80) return "optimized";
    if (index >= 60) return "proactive";
    if (index >= 40) return "managed";
    if (index >= 20) return "reactive";
    return "unaware";
  }

  /** Compute the Data Maturity Index for a tenant. */
  compute(tenantId: string): DataMaturityResult {
    const list = this.points.get(tenantId) ?? [];
    const total = list.length;

    if (total === 0) {
      return {
        tenantId, computedAt: new Date().toISOString(),
        totalDataPoints: 0, automatedCount: 0, smartUploadCount: 0, manualCount: 0,
        automatedRatio: 0, verifiedRatio: 0, freshnessScore: 0,
        maturityIndex: 0, maturityStage: "unaware", trustWeightedScore: 0,
        byMetric: [],
        boardSummary: {
          en: "No data provenance recorded yet. All governance figures are unverified.",
          ar: "لم تُسجّل بيانات عن مصدر المعلومات بعد. جميع أرقام الحوكمة غير موثّقة المصدر.",
        },
        recommendations: ["Connect at least one automated data source (IdP/AD, scanner, or ERP) to begin tracking provenance."],
      };
    }

    const automatedCount   = list.filter(p => p.provenance === "automated").length;
    const smartUploadCount = list.filter(p => p.provenance === "smart_upload").length;
    const manualCount      = list.filter(p => p.provenance === "manual").length;

    const automatedRatio = (automatedCount / total) * 100;
    const verifiedRatio  = ((automatedCount + smartUploadCount) / total) * 100;

    const freshnessScore = (list.reduce((s, p) => s + this.freshness(p.capturedAt), 0) / total) * 100;

    // Trust-weighted: sum of provenance weights * freshness, normalized
    const trustSum = list.reduce(
      (s, p) => s + PROVENANCE_WEIGHT[p.provenance] * this.freshness(p.capturedAt), 0,
    );
    const trustWeightedScore = (trustSum / total) * 100;

    // Composite maturity index: 50% verified ratio, 30% trust-weighted, 20% freshness
    const maturityIndex = Math.round(
      0.5 * verifiedRatio + 0.3 * trustWeightedScore + 0.2 * freshnessScore,
    );

    // Per-metric breakdown
    const metrics = [...new Set(list.map(p => p.metric))];
    const byMetric = metrics.map(metric => {
      const mp = list.filter(p => p.metric === metric);
      const auto = mp.filter(p => p.provenance === "automated").length;
      return { metric, automatedRatio: Math.round((auto / mp.length) * 100), points: mp.length };
    }).sort((a, b) => b.points - a.points);

    const stage = this.stageFor(maturityIndex);
    const autoR = Math.round(automatedRatio);
    const manR  = Math.round((manualCount / total) * 100);

    const recommendations: string[] = [];
    if (autoR < 50) recommendations.push("Automated sourcing below 50% — prioritize connecting IdP/AD, security scanner, and ERP/HR systems.");
    if (manR > 30) recommendations.push(`${manR}% of data is manual self-attestation — convert high-volume manual entries to Smart Upload or API connectors.`);
    if (freshnessScore < 60) recommendations.push("Data freshness is low — increase refresh frequency for high-risk controls to daily.");
    if (recommendations.length === 0) recommendations.push("Data maturity is healthy. Maintain automated refresh cadence and monitor drift.");

    return {
      tenantId, computedAt: new Date().toISOString(),
      totalDataPoints: total, automatedCount, smartUploadCount, manualCount,
      automatedRatio: autoR, verifiedRatio: Math.round(verifiedRatio),
      freshnessScore: Math.round(freshnessScore),
      maturityIndex, maturityStage: stage,
      trustWeightedScore: Math.round(trustWeightedScore),
      byMetric,
      boardSummary: {
        en: `${autoR}% of this governance score is automated/machine-verified; ${manR}% is manual self-attestation. Maturity stage: ${stage}.`,
        ar: `${autoR}% من درجة الحوكمة هذه آلية/مُتحقَّق منها آلياً؛ ${manR}% إدخال يدوي ذاتي. مرحلة النضج: ${this.stageAr(stage)}.`,
      },
      recommendations,
    };
  }

  private stageAr(s: MaturityStage): string {
    return { unaware:"غير مدرك", reactive:"تفاعلي", managed:"مُدار", proactive:"استباقي", optimized:"محسّن" }[s];
  }

  /** Apply the trust weight a metric should carry, given its provenance mix. */
  confidenceMultiplier(tenantId: string): number {
    const r = this.compute(tenantId);
    return r.trustWeightedScore / 100;
  }

  reset(tenantId?: string): void {
    if (tenantId) this.points.delete(tenantId);
    else this.points.clear();
  }
}

let _engine: DataMaturityEngine | null = null;
export function getDataMaturityEngine(): DataMaturityEngine {
  if (!_engine) _engine = new DataMaturityEngine();
  return _engine;
}
