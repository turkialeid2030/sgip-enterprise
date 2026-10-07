/**
 * Pilot Enhancement Tests (Wave 2) — Smart Upload + Audit Override + Board Report
 */
import { SmartUploadEngine } from "../runtime/smart-upload/smart.upload.engine";
import { AuditOverrideEngine } from "../runtime/audit-override/audit.override.engine";
import { BoardReportGenerator } from "../reporting/board-reports/board.report.generator";

describe("SmartUploadEngine", () => {
  let engine: SmartUploadEngine;
  beforeEach(() => { engine = new SmartUploadEngine(); });

  it("lists all framework templates", () => {
    const list = engine.listTemplates();
    expect(list.length).toBe(6);
    expect(list.map(t => t.framework)).toContain("sama_csf");
    expect(list.map(t => t.framework)).toContain("pdpl");
  });

  it("generates a CSV template with headers", () => {
    const csv = engine.generateCsvTemplate("nca_ecc");
    expect(csv).toContain("control_id");
    expect(csv).toContain("main_domain");
  });

  it("commits valid rows tagged smart_upload", () => {
    const csv = `control_id,domain,description,maturity,owner,status
SAMA-1,Access Control,User access management,3,Ahmad,implemented
SAMA-2,Encryption,Data at rest encryption,4,Sara,implemented`;
    const r = engine.upload("tenant-a", "sama_csf", csv);
    expect(r.totalRows).toBe(2);
    expect(r.committed).toBe(2);
    expect(r.invalidRows).toBe(0);
    expect(r.provenance).toBe("smart_upload");
  });

  it("rejects rows with missing required fields", () => {
    const csv = `control_id,domain,description,maturity,owner,status
SAMA-1,,User access,3,Ahmad,implemented`;
    const r = engine.upload("tenant-a", "sama_csf", csv);
    expect(r.invalidRows).toBe(1);
    expect(r.committed).toBe(0);
    expect(r.errors.some(e => e.column === "domain")).toBe(true);
  });

  it("rejects invalid enum values", () => {
    const csv = `control_id,domain,description,maturity,owner,status
SAMA-1,Access,desc,9,Ahmad,implemented`;
    const r = engine.upload("tenant-a", "sama_csf", csv);
    expect(r.errors.some(e => e.column === "maturity")).toBe(true);
  });

  it("provides bilingual summary", () => {
    const csv = `control_id,domain,description,maturity,owner,status
SAMA-1,Access,desc,3,Ahmad,implemented`;
    const r = engine.upload("tenant-a", "sama_csf", csv);
    expect(r.summary.ar).toMatch(/[\u0600-\u06FF]/);
    expect(r.summary.en).toContain("committed");
  });

  it("handles unknown framework gracefully", () => {
    const r = engine.upload("tenant-a", "unknown" as never, "a,b\n1,2");
    expect(r.committed).toBe(0);
    expect(r.errors.length).toBeGreaterThan(0);
  });
});

describe("AuditOverrideEngine", () => {
  let engine: AuditOverrideEngine;
  const tid = "tenant-a";
  beforeEach(() => { engine = new AuditOverrideEngine(); });

  it("records an override with valid justification", () => {
    const r = engine.recordOverride({
      tenantId: tid, actorId:"u1", actorRole:"cro", decisionType:"decision_confidence",
      entityId:"score-1", originalValue:84, overrideValue:78,
      justification:"Manual review found stale evidence in PDPL controls.",
    });
    expect(r.ok).toBe(true);
    expect(r.record?.hash).toBeDefined();
    expect(r.record?.previousHash).toBe("GENESIS");
  });

  it("rejects override without sufficient justification", () => {
    const r = engine.recordOverride({
      tenantId: tid, actorId:"u1", actorRole:"cro", decisionType:"x",
      entityId:"e1", originalValue:1, overrideValue:2, justification:"no",
    });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/justification/i);
  });

  it("chains overrides with linked hashes", () => {
    engine.recordOverride({ tenantId:tid, actorId:"u1", actorRole:"cro", decisionType:"x", entityId:"e1", originalValue:1, overrideValue:2, justification:"first override reason here" });
    const second = engine.recordOverride({ tenantId:tid, actorId:"u1", actorRole:"cro", decisionType:"x", entityId:"e2", originalValue:3, overrideValue:4, justification:"second override reason here" });
    const all = engine.getOverrides(tid);
    expect(all.length).toBe(2);
    expect(second.record?.previousHash).toBe(all[0].hash);
  });

  it("verifies an intact chain", () => {
    engine.recordOverride({ tenantId:tid, actorId:"u1", actorRole:"cro", decisionType:"x", entityId:"e1", originalValue:1, overrideValue:2, justification:"valid justification text" });
    const v = engine.verifyChain(tid);
    expect(v.valid).toBe(true);
    expect(v.brokenAt).toBeNull();
  });

  it("detects tampering in the chain", () => {
    engine.recordOverride({ tenantId:tid, actorId:"u1", actorRole:"cro", decisionType:"x", entityId:"e1", originalValue:1, overrideValue:2, justification:"valid justification text" });
    const chain = engine.getOverrides(tid);
    chain[0].overrideValue = 999; // tamper
    const v = engine.verifyChain(tid);
    expect(v.valid).toBe(false);
    expect(v.brokenAt).toBe(1);
  });

  it("isolates override chains per tenant", () => {
    engine.recordOverride({ tenantId:"tenant-a", actorId:"u1", actorRole:"cro", decisionType:"x", entityId:"e1", originalValue:1, overrideValue:2, justification:"tenant a override reason" });
    expect(engine.getOverrides("tenant-a").length).toBe(1);
    expect(engine.getOverrides("tenant-b").length).toBe(0);
  });

  it("filters overrides by entity", () => {
    engine.recordOverride({ tenantId:tid, actorId:"u1", actorRole:"cro", decisionType:"x", entityId:"e1", originalValue:1, overrideValue:2, justification:"entity one override here" });
    engine.recordOverride({ tenantId:tid, actorId:"u1", actorRole:"cro", decisionType:"x", entityId:"e2", originalValue:3, overrideValue:4, justification:"entity two override here" });
    expect(engine.getOverrides(tid, "e1").length).toBe(1);
  });
});

describe("BoardReportGenerator", () => {
  let gen: BoardReportGenerator;
  beforeEach(() => { gen = new BoardReportGenerator(); });

  const base = {
    tenantId:"t", organizationName:"Test Bank", period:"Q2 2026",
    governanceScore:85, complianceScore:82, riskExposure:35, openRisks:18, confidenceIndex:84,
    topActions:["Review NCA controls", "Complete PDPL audit"],
  };

  it("generates Arabic RTL report", () => {
    const html = gen.generate({ ...base, locale:"ar" });
    expect(html).toContain('dir="rtl"');
    expect(html).toContain("تقرير الحوكمة");
    expect(html).toContain("85");
  });

  it("generates English LTR report", () => {
    const html = gen.generate({ ...base, locale:"en" });
    expect(html).toContain('dir="ltr"');
    expect(html).toContain("Board Governance Report");
  });

  it("includes data maturity block when provided", () => {
    const html = gen.generate({ ...base, locale:"en", dataMaturity:{ automatedRatio:78, manualCount:12, maturityStage:"proactive" } });
    expect(html).toContain("78%");
    expect(html).toContain("proactive");
  });

  it("includes confidence narrative when provided", () => {
    const html = gen.generate({ ...base, locale:"en", confidenceNarrative:"Confidence reduced by stale evidence." });
    expect(html).toContain("stale evidence");
  });

  it("escapes HTML to prevent injection", () => {
    const html = gen.generate({ ...base, locale:"en", organizationName:"<script>alert(1)</script>" });
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("renders confidential marking", () => {
    const html = gen.generate({ ...base, locale:"en" });
    expect(html).toMatch(/CONFIDENTIAL/i);
  });
});
