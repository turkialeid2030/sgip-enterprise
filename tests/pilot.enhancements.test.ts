/**
 * Pilot Enhancement Tests — Data Maturity Index + Decision Confidence XAI
 */
import { DataMaturityEngine } from "../runtime/data-maturity/data.maturity.engine";
import { ConfidenceExplainabilityEngine } from "../runtime/explainability/confidence.explainability.engine";

describe("DataMaturityEngine", () => {
  let engine: DataMaturityEngine;
  const tid = "tenant-test";
  beforeEach(() => { engine = new DataMaturityEngine(); });

  it("returns unaware stage with zero data", () => {
    const r = engine.compute(tid);
    expect(r.totalDataPoints).toBe(0);
    expect(r.maturityStage).toBe("unaware");
    expect(r.maturityIndex).toBe(0);
  });

  it("computes automated ratio correctly", () => {
    const now = new Date().toISOString();
    engine.trackBatch([
      { pointId:"1", metric:"evidence", provenance:"automated",   sourceSystem:"ad",  capturedAt:now, tenantId:tid },
      { pointId:"2", metric:"evidence", provenance:"automated",   sourceSystem:"ad",  capturedAt:now, tenantId:tid },
      { pointId:"3", metric:"evidence", provenance:"manual",      sourceSystem:null,  capturedAt:now, tenantId:tid },
      { pointId:"4", metric:"evidence", provenance:"smart_upload",sourceSystem:"csv", capturedAt:now, tenantId:tid },
    ]);
    const r = engine.compute(tid);
    expect(r.totalDataPoints).toBe(4);
    expect(r.automatedCount).toBe(2);
    expect(r.automatedRatio).toBe(50);
    expect(r.verifiedRatio).toBe(75); // automated + smart_upload
  });

  it("weights automated data higher in trust score", () => {
    const now = new Date().toISOString();
    const allAuto = new DataMaturityEngine();
    const allManual = new DataMaturityEngine();
    for (let i = 0; i < 10; i++) {
      allAuto.track({ pointId:`a${i}`, metric:"m", provenance:"automated", sourceSystem:"s", capturedAt:now, tenantId:tid });
      allManual.track({ pointId:`m${i}`, metric:"m", provenance:"manual", sourceSystem:null, capturedAt:now, tenantId:tid });
    }
    expect(allAuto.compute(tid).trustWeightedScore).toBeGreaterThan(allManual.compute(tid).trustWeightedScore);
  });

  it("provides bilingual board summary", () => {
    const now = new Date().toISOString();
    engine.track({ pointId:"1", metric:"m", provenance:"automated", sourceSystem:"s", capturedAt:now, tenantId:tid });
    const r = engine.compute(tid);
    expect(r.boardSummary.en).toContain("%");
    expect(r.boardSummary.ar).toContain("%");
    expect(r.boardSummary.ar).toMatch(/[\u0600-\u06FF]/); // contains Arabic
  });

  it("recommends connecting sources when automation is low", () => {
    const now = new Date().toISOString();
    engine.track({ pointId:"1", metric:"m", provenance:"manual", sourceSystem:null, capturedAt:now, tenantId:tid });
    const r = engine.compute(tid);
    expect(r.recommendations.join(" ")).toMatch(/automat|connect|manual/i);
  });

  it("decays freshness for old data", () => {
    const old = new Date(Date.now() - 1000 * 3600 * 24 * 30).toISOString(); // 30 days
    engine.track({ pointId:"1", metric:"m", provenance:"automated", sourceSystem:"s", capturedAt:old, tenantId:tid });
    const r = engine.compute(tid);
    expect(r.freshnessScore).toBeLessThan(50);
  });

  it("isolates tenants", () => {
    const now = new Date().toISOString();
    engine.track({ pointId:"1", metric:"m", provenance:"automated", sourceSystem:"s", capturedAt:now, tenantId:"tenant-a" });
    expect(engine.compute("tenant-a").totalDataPoints).toBe(1);
    expect(engine.compute("tenant-b").totalDataPoints).toBe(0);
  });
});

describe("ConfidenceExplainabilityEngine", () => {
  let engine: ConfidenceExplainabilityEngine;
  const tid = "tenant-test";
  beforeEach(() => { engine = new ConfidenceExplainabilityEngine(); });

  it("computes a score with explanation", () => {
    const r = engine.explain(tid, [
      { factor:"evidence_completeness", value:67 },
      { factor:"control_effectiveness", value:82 },
      { factor:"framework_coverage",    value:88 },
    ]);
    expect(r.score).toBeGreaterThan(0);
    expect(r.score).toBeLessThanOrEqual(100);
    expect(r.factors.length).toBe(3);
  });

  it("sorts factors by absolute contribution", () => {
    const r = engine.explain(tid, [
      { factor:"evidence_completeness", value:30 },
      { factor:"audit_trail_integrity", value:99 },
    ]);
    const absContribs = r.factors.map(f => Math.abs(f.contribution));
    expect(absContribs[0]).toBeGreaterThanOrEqual(absContribs[1]);
  });

  it("identifies positive and negative drivers", () => {
    const r = engine.explain(tid, [
      { factor:"evidence_completeness", value:20 },  // below baseline -> negative
      { factor:"control_effectiveness", value:90 },  // above baseline -> positive
    ]);
    expect(r.topNegative.some(f => f.factor === "evidence_completeness")).toBe(true);
    expect(r.topPositive.some(f => f.factor === "control_effectiveness")).toBe(true);
  });

  it("generates counterfactuals for negative drivers", () => {
    const r = engine.explain(tid, [
      { factor:"evidence_completeness", value:30 },
    ]);
    expect(r.counterfactuals.length).toBeGreaterThan(0);
    expect(r.counterfactuals[0].scoreThen).toBeGreaterThan(r.score);
    expect(r.counterfactuals[0].delta).toBeGreaterThan(0);
  });

  it("includes a model card with limitations", () => {
    const r = engine.explain(tid, [{ factor:"evidence_completeness", value:67 }]);
    expect(r.modelCard.limitations).toMatch(/approximation|not.*proof/i);
    expect(r.modelCard.version).toBeDefined();
  });

  it("marks score as human-overridable (PDPL right)", () => {
    const r = engine.explain(tid, [{ factor:"evidence_completeness", value:67 }]);
    expect(r.humanReview.overridable).toBe(true);
    expect(r.humanReview.overrideNote.ar).toMatch(/[\u0600-\u06FF]/);
  });

  it("provides bilingual narrative and disclaimer", () => {
    const r = engine.explain(tid, [
      { factor:"evidence_completeness", value:67 },
      { factor:"control_effectiveness", value:82 },
    ]);
    expect(r.narrative.en).toContain("confidence");
    expect(r.narrative.ar).toMatch(/[\u0600-\u06FF]/);
    expect(r.disclaimer.en).toMatch(/approximation/i);
    expect(r.disclaimer.ar).toMatch(/[\u0600-\u06FF]/);
  });

  it("clamps score within 0-100", () => {
    const high = engine.explain(tid, Array(6).fill(0).map(() => ({ factor:"evidence_completeness", value:100 })));
    const low  = engine.explain(tid, Array(6).fill(0).map(() => ({ factor:"evidence_completeness", value:0 })));
    expect(high.score).toBeLessThanOrEqual(100);
    expect(low.score).toBeGreaterThanOrEqual(0);
  });
});
