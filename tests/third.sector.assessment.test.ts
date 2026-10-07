/**
 * Third-Sector Governance Assessment Engine — tests
 * Validates against the OFFICIAL waqf framework data (7 principles / 26 outputs / 109 practices).
 */
import {
  ThirdSectorAssessmentEngine, EntityType, PracticeResponse, MaturityLevel,
} from "../runtime/third-sector/third.sector.assessment.engine";
import {
  WAQF_PRACTICES, WAQF_PRINCIPLES, WAQF_OUTPUTS, WAQF_TOTAL_PRACTICES,
} from "../runtime/third-sector/frameworks/waqf.official.framework";

describe("Official Waqf Framework data integrity", () => {
  it("has exactly 7 principles", () => {
    expect(WAQF_PRINCIPLES.length).toBe(7);
  });

  it("has exactly 26 outputs", () => {
    expect(WAQF_OUTPUTS.length).toBe(26);
  });

  it("has exactly 109 practices, matching the official total", () => {
    expect(WAQF_PRACTICES.length).toBe(109);
    expect(WAQF_TOTAL_PRACTICES).toBe(109);
  });

  it("matches the official per-principle distribution", () => {
    const counts: Record<string, number> = {};
    for (const p of WAQF_PRACTICES) counts[p.principle] = (counts[p.principle] ?? 0) + 1;
    expect(counts).toEqual({ "1":10, "2":17, "3":19, "4":28, "5":5, "6":19, "7":11 });
  });

  it("every practice carries a question and expected evidence", () => {
    const noQ = WAQF_PRACTICES.filter(p => !p.question.trim());
    const noE = WAQF_PRACTICES.filter(p => !p.evidence.trim());
    expect(noQ.length).toBe(0);
    expect(noE.length).toBe(0);
  });

  it("practice ids are unique and well-formed", () => {
    const ids = WAQF_PRACTICES.map(p => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.every(i => /^\d+-\d+-\d+$/.test(i))).toBe(true);
  });
});

describe("ThirdSectorAssessmentEngine — framework registry", () => {
  const e = new ThirdSectorAssessmentEngine();

  it("registers all four entity types", () => {
    const list = e.listFrameworks();
    expect(list.length).toBe(4);
    expect(list.map(f => f.entityType).sort()).toEqual(
      ["civil_association","cooperative_association","nonprofit_company","waqf"]
    );
  });

  it("marks waqf ACTIVE with 109 practices", () => {
    const fw = e.getFramework("waqf")!;
    expect(fw.status).toBe("ACTIVE");
    expect(fw.practiceCount).toBe(109);
    // regulator intentionally absent — supervision is a sourced relationship, not a type property
    expect((fw as unknown as Record<string,unknown>).regulator).toBeUndefined();
  });

  it("marks the other three PENDING_OFFICIAL_REFERENCE with zero practices", () => {
    for (const t of ["civil_association","cooperative_association","nonprofit_company"] as EntityType[]) {
      const fw = e.getFramework(t)!;
      expect(fw.status).toBe("PENDING_OFFICIAL_REFERENCE");
      expect(fw.practiceCount).toBe(0);
      expect(e.getPractices(t).length).toBe(0);
    }
  });

  it("exposes a shared cross-entity governance core", () => {
    const core = e.getSharedCorePractices();
    // principles 4,5,6,7 => 28+5+19+11 = 63
    expect(core.length).toBe(63);
    expect(core.every(p => ["4","5","6","7"].includes(p.principle))).toBe(true);
  });
});

describe("ThirdSectorAssessmentEngine — scoring", () => {
  const e = new ThirdSectorAssessmentEngine();
  const all = (m: MaturityLevel, prov: PracticeResponse["provenance"] = "uploaded"): PracticeResponse[] =>
    WAQF_PRACTICES.map(p => ({ practiceId: p.id, maturity: m, provenance: prov, evidenceRef: prov === "uploaded" ? `test-evidence-${p.id}` : undefined }));

  it("refuses to score a pending framework", () => {
    const r = e.assess("ent-1", "civil_association", []);
    expect(r.frameworkStatus).toBe("PENDING_OFFICIAL_REFERENCE");
    expect(r.officialScore.total).toBe(0);
    expect(r.maturityIndex).toBe(0);
    expect(r.summary.ar).toContain("غير مُفعّل");
  });

  it("reproduces the official binary score out of 109", () => {
    const r = e.assess("ent-1", "waqf", all(3));
    expect(r.officialScore.total).toBe(109);
    expect(r.officialScore.verified).toBe(109);
    expect(r.officialScore.percentage).toBe(100);
  });

  it("treats maturity below 3 as not-verified in the official layer", () => {
    const r = e.assess("ent-1", "waqf", all(2));
    expect(r.officialScore.verified).toBe(0);
    expect(r.officialScore.percentage).toBe(0);
    expect(r.maturityIndex).toBeGreaterThan(0); // maturity layer still registers progress
  });

  it("weights automated evidence higher than self-attestation", () => {
    const auto = e.assess("a", "waqf", all(4, "automated"));
    const self = e.assess("b", "waqf", all(4, "self_attested"));
    expect(auto.maturityIndex).toBeGreaterThan(self.maturityIndex);
  });

  it("computes coverage from answered practices", () => {
    const partial = WAQF_PRACTICES.slice(0, 55).map(p => ({
      practiceId: p.id, maturity: 3 as MaturityLevel, provenance: "uploaded" as const, evidenceRef: `test-evidence-${p.id}`,
    }));
    const r = e.assess("ent-1", "waqf", partial);
    expect(r.answered).toBe(55);
    expect(r.coverage).toBe(50); // 55/109 -> 50%
  });

  it("produces per-principle scores for all 7 principles", () => {
    const r = e.assess("ent-1", "waqf", all(3));
    expect(r.byPrinciple.length).toBe(7);
    const p4 = r.byPrinciple.find(p => p.principleId === "4")!;
    expect(p4.practices).toBe(28);
    expect(p4.officialRatio).toBe(100);
  });

  it("builds a gap register carrying the official expected evidence", () => {
    const r = e.assess("ent-1", "waqf", all(1));
    expect(r.gaps.length).toBe(109);
    expect(r.gaps[0].expectedEvidence.length).toBeGreaterThan(0);
    expect(r.gaps[0].severity).toBe("high");
  });

  it("sorts gaps worst-first", () => {
    const mixed: PracticeResponse[] = WAQF_PRACTICES.map((p, i) => ({
      practiceId: p.id,
      maturity: (i % 3 === 0 ? 0 : i % 3 === 1 ? 2 : 4) as MaturityLevel,
      provenance: "uploaded",
    }));
    const r = e.assess("ent-1", "waqf", mixed);
    for (let i = 1; i < r.gaps.length; i++) {
      expect(r.gaps[i].maturity).toBeGreaterThanOrEqual(r.gaps[i-1].maturity);
    }
  });

  it("tracks evidence provenance mix", () => {
    const mixed: PracticeResponse[] = WAQF_PRACTICES.map((p, i) => ({
      practiceId: p.id, maturity: 3 as MaturityLevel,
      provenance: (i % 2 === 0 ? "automated" : "self_attested") as PracticeResponse["provenance"],
    }));
    const r = e.assess("ent-1", "waqf", mixed);
    expect(r.provenance.automated + r.provenance.selfAttested).toBe(109);
    expect(r.provenance.verifiedRatio).toBeGreaterThan(0);
    expect(r.provenance.verifiedRatio).toBeLessThan(100);
  });

  it("emits a bilingual summary and a decision-support disclaimer", () => {
    const r = e.assess("ent-1", "waqf", all(4));
    expect(r.summary.ar).toMatch(/[\u0600-\u06FF]/);
    expect(r.summary.en).toContain("Evidence-verified score");
    expect(r.disclaimer.ar).toContain("لا يُعد شهادة امتثال");
    expect(r.disclaimer.en).toMatch(/not a compliance certification/i);
  });

  it("caps maturity index at 100 and level at 5", () => {
    const r = e.assess("ent-1", "waqf", all(5, "automated"));
    expect(r.maturityIndex).toBeLessThanOrEqual(100);
    expect(r.maturityLevel).toBeLessThanOrEqual(5);
  });
});
