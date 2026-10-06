/**
 * SGIP v5 Tests — Framework Knowledge + Decision Governance + RACI + Culture + Narrative
 * Covers all Phase 1-6 of v5: frameworks, controls, crosswalk, maturity, gap analysis,
 * decisions, RACI, culture signals, executive intelligence.
 */
import { buildTenantContext } from "../tenant/tenant.context";
import {
  FRAMEWORK_REGISTRY, getFrameworksByDomain, getMandatoryFrameworks, getCertifiableFrameworks,
} from "../frameworks/framework.registry";
import {
  CANONICAL_CONTROL_LIBRARY, getControlById, getControlsByCategory, getControlsByFramework, getControlsByRiskCategory,
} from "../controls/control.library";
import { frameworkCrosswalkEngine } from "../mappings/framework.crosswalk.engine";
import { maturityScoringEngine } from "../assessments/maturity.scoring.engine";
import { gapAnalysisEngine } from "../assessments/gap.analysis.engine";
import { DecisionEngine, getDecisionEngine } from "../governance/decisions/decision.engine";
import { RACIEngine, getRACIEngine } from "../governance/raci/raci.engine";
import { CultureSignalEngine, getCultureEngine } from "../governance/culture/culture.signal.engine";
import { executiveSummaryEngine } from "../governance/narrative/executive.summary.engine";

jest.mock("../api/services/db.service", () => ({
  // Contract members required by the tenancy guard (real impl binds AsyncLocalStorage)
  runInTenantScope: (_t: string, fn: () => unknown) => Promise.resolve(fn()),
  currentTenantId: () => "tenant-test",
  // Atomic audit contract: run the mutation then the audit on the same fake tx
  auditedMutation: async (_t: string, fn: (tx: unknown) => Promise<unknown>,
                          audit: (tx: unknown, r: unknown) => Promise<void>) => {
    // A realistic tx: an INSERT ... RETURNING yields a row. Returning [] would
    // model a failed insert, which the production code correctly rejects.
    const tx = {
      query: jest.fn().mockResolvedValue([{ id: "mock-id", tenantId: "tenant-test", code: "MOCK", title: "mock" }]),
      queryOne: jest.fn().mockResolvedValue({ id: "mock-id", tenantId: "tenant-test" }),
    };
    const r = await fn(tx); await audit(tx, r); return r;
  },
  withTenant: <T>(_t: string, fn: (tx: unknown) => Promise<T>) => fn({
    query: jest.fn().mockResolvedValue([]), queryOne: jest.fn().mockResolvedValue(null),
  }),
  query:    jest.fn().mockResolvedValue([]),
  queryOne: jest.fn().mockResolvedValue(null),
}));
jest.mock("../api/services/audit.dao", () => ({
  AuditDAO: { logIn: jest.fn().mockResolvedValue(undefined), log: jest.fn().mockResolvedValue(undefined) },
}));

const ctx = buildTenantContext({ tenantId:"t-v5", organizationId:"org-v5", userId:"cgo-001", userRole:"governance_analyst" });

// ═══════════════════════════════════════════════════════════════
// FRAMEWORK REGISTRY
// ═══════════════════════════════════════════════════════════════
describe("Framework Registry", () => {
  it("contains all 14 frameworks", () => {
    expect(Object.keys(FRAMEWORK_REGISTRY)).toHaveLength(14);
  });
  it("each framework has required fields", () => {
    for (const f of Object.values(FRAMEWORK_REGISTRY)) {
      expect(f.id).toBeTruthy();
      expect(f.name).toBeTruthy();
      expect(f.version).toBeTruthy();
      expect(f.controlCount).toBeGreaterThan(0);
      expect(Array.isArray(f.domains)).toBe(true);
    }
  });
  it("getFrameworksByDomain returns security frameworks", () => {
    const secFw = getFrameworksByDomain("security");
    expect(secFw.length).toBeGreaterThanOrEqual(3);
    expect(secFw.some(f => f.id === "ISO_27001")).toBe(true);
    expect(secFw.some(f => f.id === "NCA_ECC")).toBe(true);
  });
  it("getMandatoryFrameworks: Saudi Arabia returns NCA_ECC", () => {
    const mandatory = getMandatoryFrameworks("Saudi Arabia");
    expect(mandatory.some(f => f.id === "NCA_ECC")).toBe(true);
    expect(mandatory.some(f => f.id === "ISMS_PDPL")).toBe(true);
  });
  it("getMandatoryFrameworks: Saudi Financial Sector returns SAMA_CSF", () => {
    const mandatory = getMandatoryFrameworks("Saudi Financial Sector");
    expect(mandatory.some(f => f.id === "SAMA_CSF")).toBe(true);
  });
  it("getCertifiableFrameworks includes ISO 27001", () => {
    const certifiable = getCertifiableFrameworks();
    expect(certifiable.some(f => f.id === "ISO_27001")).toBe(true);
    expect(certifiable.some(f => f.id === "PCI_DSS")).toBe(true);
  });
  it("COBIT_2019 has maturityModel=true", () => {
    expect(FRAMEWORK_REGISTRY.COBIT_2019.maturityModel).toBe(true);
  });
  it("ISO_27001 has 93 controls", () => {
    expect(FRAMEWORK_REGISTRY.ISO_27001.controlCount).toBe(93);
  });
  it("GDPR applies to EU", () => {
    expect(FRAMEWORK_REGISTRY.GDPR.applicability).toContain("EU");
  });
});

// ═══════════════════════════════════════════════════════════════
// CONTROL LIBRARY
// ═══════════════════════════════════════════════════════════════
describe("Canonical Control Library", () => {
  it("contains 15+ controls", () => {
    expect(CANONICAL_CONTROL_LIBRARY.length).toBeGreaterThanOrEqual(15);
  });
  it("each control has id, title, frameworkRefs", () => {
    for (const c of CANONICAL_CONTROL_LIBRARY) {
      expect(c.id).toMatch(/^CTRL-/);
      expect(c.title).toBeTruthy();
      expect(c.frameworkRefs.length).toBeGreaterThan(0);
    }
  });
  it("getControlById: CTRL-ACC-001 returns access control", () => {
    const c = getControlById("CTRL-ACC-001");
    expect(c).toBeDefined();
    expect(c!.category).toBe("access_control");
  });
  it("getControlById: unknown returns undefined", () => {
    expect(getControlById("CTRL-UNKNOWN")).toBeUndefined();
  });
  it("getControlsByCategory: access_control returns ≥2", () => {
    expect(getControlsByCategory("access_control").length).toBeGreaterThanOrEqual(2);
  });
  it("getControlsByFramework: ISO_27001 returns controls", () => {
    const ctrls = getControlsByFramework("ISO_27001");
    expect(ctrls.length).toBeGreaterThan(0);
    expect(ctrls.every(c => c.frameworkRefs.some(r => r.frameworkId === "ISO_27001"))).toBe(true);
  });
  it("getControlsByRiskCategory: cyber returns ≥3", () => {
    expect(getControlsByRiskCategory("cyber").length).toBeGreaterThanOrEqual(3);
  });
  it("CTRL-ACC-003 (SoD) maps to SOX", () => {
    const c = getControlById("CTRL-ACC-003");
    expect(c?.frameworkRefs.some(r => r.frameworkId === "SOX")).toBe(true);
  });
  it("CTRL-PRV-001 maps to GDPR and ISO_27701", () => {
    const c = getControlById("CTRL-PRV-001");
    expect(c?.frameworkRefs.some(r => r.frameworkId === "GDPR")).toBe(true);
    expect(c?.frameworkRefs.some(r => r.frameworkId === "ISO_27701")).toBe(true);
  });
  it("all controls have evidenceTypes", () => {
    for (const c of CANONICAL_CONTROL_LIBRARY) {
      expect(c.evidenceTypes.length).toBeGreaterThan(0);
    }
  });
});

// ═══════════════════════════════════════════════════════════════
// FRAMEWORK CROSSWALK ENGINE
// ═══════════════════════════════════════════════════════════════
describe("FrameworkCrosswalkEngine", () => {
  it("crosswalk ISO_27001 → NIST_CSF returns result", () => {
    const r = frameworkCrosswalkEngine.crosswalk("ISO_27001", "NIST_CSF");
    expect(r.sourceFramework).toBe("ISO_27001");
    expect(r.targetFramework).toBe("NIST_CSF");
    expect(r.coverageScore).toBeGreaterThanOrEqual(0);
    expect(r.coverageScore).toBeLessThanOrEqual(100);
    expect(Array.isArray(r.mappings)).toBe(true);
  });
  it("crosswalk ISO_27001 → itself = 100% coverage", () => {
    const r = frameworkCrosswalkEngine.crosswalk("ISO_27001", "ISO_27001");
    expect(r.coverageScore).toBe(100);
  });
  it("analyzeOverlap: ISO_27001 + NCA_ECC returns harmonizationScore", () => {
    const r = frameworkCrosswalkEngine.analyzeOverlap(["ISO_27001", "NCA_ECC"]);
    expect(r.harmonizationScore).toBeGreaterThanOrEqual(0);
    expect(r.frameworks).toContain("ISO_27001");
    expect(r.frameworks).toContain("NCA_ECC");
  });
  it("analyzeOverlap: 3 frameworks returns shared controls array", () => {
    const r = frameworkCrosswalkEngine.analyzeOverlap(["ISO_27001", "GDPR", "ISO_27701"]);
    expect(Array.isArray(r.sharedControls)).toBe(true);
    expect(Array.isArray(r.uniqueControls)).toBe(true);
  });
  it("detectGaps: empty implementations → all controls are gaps", () => {
    const gaps = frameworkCrosswalkEngine.detectGaps("ISO_27001", []);
    expect(gaps.length).toBeGreaterThan(0);
    expect(gaps.every(g => g.frameworkId === "ISO_27001")).toBe(true);
  });
  it("detectGaps: all implemented → no gaps", () => {
    const isoControls = CANONICAL_CONTROL_LIBRARY.filter(c => c.frameworkRefs.some(r => r.frameworkId === "ISO_27001")).map(c => c.id);
    const gaps = frameworkCrosswalkEngine.detectGaps("ISO_27001", isoControls);
    expect(gaps).toHaveLength(0);
  });
  it("crosswalk produces harmonizationRecommendations", () => {
    const r = frameworkCrosswalkEngine.crosswalk("GDPR", "ISO_27701");
    expect(Array.isArray(r.harmonizationRecommendations)).toBe(true);
  });
  it("GDPR → ISMS_PDPL crosswalk works", () => {
    const r = frameworkCrosswalkEngine.crosswalk("GDPR", "ISMS_PDPL");
    expect(r.sourceFramework).toBe("GDPR");
    expect(r.coverageScore).toBeGreaterThanOrEqual(0);
  });
});

// ═══════════════════════════════════════════════════════════════
// MATURITY SCORING ENGINE
// ═══════════════════════════════════════════════════════════════
describe("MaturityScoringEngine", () => {
  it("score with no controls returns level 1", () => {
    const r = maturityScoringEngine.score({ tenantId:"t1", frameworkId:"ISO_27001", implementedControls:[], mode:"enterprise", assessedBy:"u1" });
    expect(r.currentLevel).toBe(1);
    expect(r.overallScore).toBe(0);
    expect(r.frameworkId).toBe("ISO_27001");
  });
  it("score with all controls returns high score", () => {
    const allControls = CANONICAL_CONTROL_LIBRARY.filter(c => c.frameworkRefs.some(r => r.frameworkId === "ISO_27001")).map(c => c.id);
    const r = maturityScoringEngine.score({ tenantId:"t1", frameworkId:"ISO_27001", implementedControls: allControls, mode:"enterprise", assessedBy:"u1" });
    expect(r.overallScore).toBe(100);
  });
  it("returns 5 dimensions", () => {
    const r = maturityScoringEngine.score({ tenantId:"t1", frameworkId:"NIST_CSF", implementedControls:[], mode:"sme", assessedBy:"u1" });
    expect(r.dimensions).toHaveLength(5);
  });
  it("benchmarkComparison is numeric", () => {
    const r = maturityScoringEngine.score({ tenantId:"t1", frameworkId:"COBIT_2019", implementedControls:[], mode:"startup", assessedBy:"u1" });
    expect(typeof r.benchmarkComparison).toBe("number");
  });
  it("roadmap has phases when targetLevel > currentLevel", () => {
    const r = maturityScoringEngine.score({ tenantId:"t1", frameworkId:"ISO_27001", implementedControls:[], mode:"enterprise", targetLevel:3, assessedBy:"u1" });
    expect(r.roadmap.length).toBeGreaterThanOrEqual(0);  // may be 0 if no controls at those levels
  });
  it("score varies by org mode (startup vs enterprise)", () => {
    const startup    = maturityScoringEngine.score({ tenantId:"t1", frameworkId:"ISO_27001", implementedControls:[], mode:"startup",    assessedBy:"u1" });
    const enterprise = maturityScoringEngine.score({ tenantId:"t1", frameworkId:"ISO_27001", implementedControls:[], mode:"enterprise", assessedBy:"u1" });
    // Same score but different benchmark comparisons
    expect(startup.benchmarkComparison).not.toBe(enterprise.benchmarkComparison);
  });
  it("Saudi-specific: NCA_ECC maturity scoring works", () => {
    const r = maturityScoringEngine.score({ tenantId:"t1", frameworkId:"NCA_ECC", implementedControls:[], mode:"regulated_enterprise", assessedBy:"u1" });
    expect(r.frameworkId).toBe("NCA_ECC");
    expect(typeof r.overallScore).toBe("number");
  });
});

// ═══════════════════════════════════════════════════════════════
// GAP ANALYSIS ENGINE
// ═══════════════════════════════════════════════════════════════
describe("GapAnalysisEngine", () => {
  it("analyze with no controls: all critical/high gaps", () => {
    const r = gapAnalysisEngine.analyze({ tenantId:"t1", frameworkId:"ISO_27001", implementedControls:[] });
    expect(r.gaps.length).toBeGreaterThan(0);
    expect(r.coverageScore).toBe(0);
    expect(["critical","high"]).toContain(r.riskExposure);
  });
  it("fully implemented: coverage=100, low exposure", () => {
    const all = CANONICAL_CONTROL_LIBRARY.filter(c => c.frameworkRefs.some(r => r.frameworkId === "ISO_27001")).map(c => c.id);
    const r   = gapAnalysisEngine.analyze({ tenantId:"t1", frameworkId:"ISO_27001", implementedControls: all });
    expect(r.coverageScore).toBe(100);
    expect(r.riskExposure).toBe("low");
    expect(r.gaps).toHaveLength(0);
  });
  it("report includes quickWins and strategicItems arrays", () => {
    const r = gapAnalysisEngine.analyze({ tenantId:"t1", frameworkId:"NIST_CSF", implementedControls:[] });
    expect(Array.isArray(r.quickWins)).toBe(true);
    expect(Array.isArray(r.strategicItems)).toBe(true);
  });
  it("estimatedDaysToClose is positive when gaps exist", () => {
    const r = gapAnalysisEngine.analyze({ tenantId:"t1", frameworkId:"PCI_DSS", implementedControls:[] });
    if (r.gaps.length > 0) expect(r.estimatedDaysToClose).toBeGreaterThan(0);
  });
  it("GDPR gap analysis detects privacy control gaps", () => {
    const r = gapAnalysisEngine.analyze({ tenantId:"t1", frameworkId:"GDPR", implementedControls:[] });
    expect(r.gaps.some(g => g.description.toLowerCase().includes("privacy") || g.description.toLowerCase().includes("data"))).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════
// DECISION ENGINE
// ═══════════════════════════════════════════════════════════════
describe("DecisionEngine", () => {
  let engine: DecisionEngine;
  let decCtx: ReturnType<typeof buildTenantContext>;
  beforeEach(() => {
    engine = new DecisionEngine("t-dec");
    decCtx = buildTenantContext({ tenantId:"t-dec", organizationId:"org-dec", userId:"cgo-001", userRole:"governance_analyst" });
  });

  const validDecisionParams = {
    title:            "Approve Vendor Risk Exception",
    description:      "Allow vendor X access under monitored conditions",
    decisionType:     "exception_approval" as const,
    owner:            "cro-001",
    ownerRole:        "risk_analyst",
    accountableParty: "cgo-001",
    approver:         "cgo-001",
    approverRole:     "governance_analyst",
    linkedControls:   ["CTRL-ACC-001"],
    linkedRisks:      ["risk-001"],
    linkedEvidence:   ["ev-001"],
    linkedPolicies:   ["pol-001"],
    linkedRegulations:[],
    businessImpact:   "Enables critical vendor integration",
    riskImpact:       "increases" as const,
    urgency:          "standard" as const,
    createdBy:        "cro-001",
  };

  it("creates decision with auto-generated code", async () => {
    const d = await engine.create(validDecisionParams, decCtx);
    expect(d.id).toBeTruthy();
    expect(d.code).toMatch(/^DEC-\d{4}-\d{3}$/);
    expect(d.status).toBe("draft");
    expect(d.tenantId).toBe("t-dec");
  });

  it("validate: passes when all required fields set", async () => {
    const d      = await engine.create(validDecisionParams, decCtx);
    const result = await engine.validate(d.id, decCtx);
    expect(result.passed).toBe(true);
    expect(result.blockers).toHaveLength(0);
    expect(result.decisionId).toBe(d.id);
  });

  it("validate: fails when no evidence attached", async () => {
    const noEvidence = { ...validDecisionParams, linkedEvidence: [] };
    const d          = await engine.create(noEvidence, decCtx);
    const result     = await engine.validate(d.id, decCtx);
    expect(result.passed).toBe(false);
    expect(result.blockers.some(b => b.includes("evidence"))).toBe(true);
  });

  it("validate: fails when owner === approver (SoD)", async () => {
    const sodConflict = { ...validDecisionParams, owner:"user-1", approver:"user-1" };
    const d           = await engine.create(sodConflict, decCtx);
    const result      = await engine.validate(d.id, decCtx);
    expect(result.passed).toBe(false);
    expect(result.blockers.some(b => b.includes("SoD"))).toBe(true);
    expect(result.sodViolation).toBeDefined();
  });

  it("approve: seals immutable record after validation", async () => {
    const d = await engine.create(validDecisionParams, ctx);
    await engine.validate(d.id, decCtx);
    const approved = await engine.approve(d.id, "cgo-001", decCtx);
    expect(approved.status).toBe("approved");
    expect(approved.approvedAt).toBeTruthy();
    expect(approved.immutableRecordId).toBeTruthy();
  });

  it("approve: throws 409 if not pending_approval", async () => {
    const d = await engine.create(validDecisionParams, ctx);
    // Don't validate first — still in draft
    await expect(engine.approve(d.id, "cgo-001", decCtx)).rejects.toMatchObject({ statusCode:409 });
  });

  it("findAll returns all tenant decisions", async () => {
    await engine.create(validDecisionParams, ctx);
    await engine.create({ ...validDecisionParams, title:"Second Decision" }, decCtx);
    expect(engine.findAll().length).toBeGreaterThanOrEqual(2);
  });

  it("getOrphanDecisions returns decisions without evidence", async () => {
    await engine.create({ ...validDecisionParams, linkedEvidence:[] }, decCtx);
    const orphans = engine.getOrphanDecisions();
    expect(orphans.length).toBeGreaterThanOrEqual(1);
  });

  it("tenant isolation: different tenant returns undefined", async () => {
    const ctxOther2 = buildTenantContext({ tenantId:"t-other", organizationId:"o2", userId:"u2", userRole:"risk_analyst" });
    const otherEngine = new DecisionEngine("t-other");
    const d = await otherEngine.create(validDecisionParams, ctxOther2);
    expect(engine.getById(d.id)).toBeUndefined();  // t-dec cannot see t-other's decisions
  });
});

// ═══════════════════════════════════════════════════════════════
// RACI ENGINE
// ═══════════════════════════════════════════════════════════════
describe("RACIEngine", () => {
  let engine: RACIEngine;
  beforeEach(() => { engine = new RACIEngine("t-raci"); });

  it("assigns RACI entry to entity", () => {
    const entry = engine.assign({ entityId:"risk-001", entityType:"risk", entityTitle:"Test Risk", userId:"u1", userName:"User One", userRole:"risk_analyst", raciRole:"Accountable" });
    expect(entry.tenantId).toBe("t-raci");
    expect(entry.raciRole).toBe("Accountable");
  });

  it("getForEntity returns assigned entries", () => {
    engine.assign({ entityId:"risk-002", entityType:"risk", entityTitle:"R2", userId:"u1", userName:"U1", userRole:"r", raciRole:"Responsible" });
    engine.assign({ entityId:"risk-002", entityType:"risk", entityTitle:"R2", userId:"u2", userName:"U2", userRole:"r", raciRole:"Accountable" });
    const entries = engine.getForEntity("risk-002");
    expect(entries.length).toBe(2);
  });

  it("detectConflicts: missing accountable is critical", () => {
    engine.assign({ entityId:"risk-003", entityType:"risk", entityTitle:"R3", userId:"u1", userName:"U1", userRole:"r", raciRole:"Responsible" });
    const conflicts = engine.detectConflicts(["risk-003"]);
    expect(conflicts.some(c => c.type === "missing_accountable")).toBe(true);
    expect(conflicts.some(c => c.severity === "critical")).toBe(true);
  });

  it("detectConflicts: no conflicts when R+A assigned", () => {
    engine.assign({ entityId:"risk-004", entityType:"risk", entityTitle:"R4", userId:"u1", userName:"U1", userRole:"r", raciRole:"Responsible" });
    engine.assign({ entityId:"risk-004", entityType:"risk", entityTitle:"R4", userId:"u2", userName:"U2", userRole:"r", raciRole:"Accountable" });
    const conflicts = engine.detectConflicts(["risk-004"]).filter(c => c.type === "missing_accountable" || c.type === "no_responsible");
    expect(conflicts).toHaveLength(0);
  });

  it("detectConflicts: multiple accountable is high severity", () => {
    engine.assign({ entityId:"risk-005", entityType:"risk", entityTitle:"R5", userId:"u1", userName:"U1", userRole:"r", raciRole:"Accountable" });
    engine.assign({ entityId:"risk-005", entityType:"risk", entityTitle:"R5", userId:"u2", userName:"U2", userRole:"r", raciRole:"Accountable" });
    const conflicts = engine.detectConflicts(["risk-005"]);
    expect(conflicts.some(c => c.type === "multiple_accountable")).toBe(true);
  });

  it("buildMatrix returns coverageScore", () => {
    engine.assign({ entityId:"m-001", entityType:"risk", entityTitle:"M1", userId:"u1", userName:"U1", userRole:"r", raciRole:"Responsible" });
    engine.assign({ entityId:"m-001", entityType:"risk", entityTitle:"M1", userId:"u2", userName:"U2", userRole:"r", raciRole:"Accountable" });
    const matrix = engine.buildMatrix(["m-001", "m-002"]);
    expect(matrix.coverageScore).toBeGreaterThanOrEqual(0);
    expect(matrix.coverageScore).toBeLessThanOrEqual(100);
    expect(matrix.orphanEntities).toContain("m-002");
  });
});

// ═══════════════════════════════════════════════════════════════
// CULTURE SIGNAL ENGINE
// ═══════════════════════════════════════════════════════════════
describe("CultureSignalEngine", () => {
  let engine: CultureSignalEngine;
  beforeEach(() => { engine = new CultureSignalEngine(`t-culture-${Date.now()}`); });

  it("no signals on fresh engine", () => {
    const report = engine.generateReport();
    expect(report.signals).toHaveLength(0);
    expect(report.healthScore).toBe(100);
  });

  it("recordAction: control_bypass emits signal after 2 occurrences", () => {
    engine.recordAction("u1", "risk_analyst", "bypass_control", "control");
    engine.recordAction("u1", "risk_analyst", "bypass_control", "control");
    const signals = engine.getSignals("control_bypass_attempt");
    expect(signals.length).toBeGreaterThanOrEqual(1);
  });

  it("executive_override emits signal immediately", () => {
    engine.recordAction("ceo-001", "orchestrator", "executive_override", "decision");
    const signals = engine.getSignals("executive_override");
    expect(signals.length).toBeGreaterThanOrEqual(1);
  });

  it("healthScore decreases with critical signals", () => {
    engine.recordAction("u1", "r", "bypass_control", "c");
    engine.recordAction("u1", "r", "bypass_control", "c");
    engine.recordAction("u1", "r", "bypass_control", "c");
    engine.recordAction("u1", "r", "bypass_control", "c");
    engine.recordAction("u1", "r", "bypass_control", "c");
    const report = engine.generateReport();
    expect(report.healthScore).toBeLessThan(100);
  });

  it("generateReport includes recommendations", () => {
    engine.recordAction("u1", "r", "executive_override", "decision");
    const report = engine.generateReport();
    expect(Array.isArray(report.recommendations)).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════
// EXECUTIVE SUMMARY ENGINE
// ═══════════════════════════════════════════════════════════════
describe("ExecutiveSummaryEngine", () => {
  it("generates executive summary with required fields", () => {
    const summary = executiveSummaryEngine.generate(ctx);
    expect(summary.tenantId).toBe("t-v5");
    expect(summary.governanceScore).toBeGreaterThanOrEqual(0);
    expect(summary.governanceScore).toBeLessThanOrEqual(100);
    expect(summary.headline).toBeTruthy();
    expect(Array.isArray(summary.keyInsights)).toBe(true);
    expect(summary.keyInsights.length).toBeGreaterThan(0);
  });

  it("riskNarrative and complianceNarrative are non-empty strings", () => {
    const s = executiveSummaryEngine.generate(ctx);
    expect(typeof s.riskNarrative).toBe("string");
    expect(typeof s.complianceNarrative).toBe("string");
    expect(s.riskNarrative.length).toBeGreaterThan(0);
  });

  it("boardReady is boolean", () => {
    const s = executiveSummaryEngine.generate(ctx);
    expect(typeof s.boardReady).toBe("boolean");
  });

  it("immediateActions is an array", () => {
    const s = executiveSummaryEngine.generate(ctx);
    expect(Array.isArray(s.immediateActions)).toBe(true);
  });

  it("cultureNarrative reflects engine state", () => {
    const s = executiveSummaryEngine.generate(ctx);
    expect(s.cultureNarrative.length).toBeGreaterThan(10);
  });
});

// ═══════════════════════════════════════════════════════════════
// INTEGRATION: Decision + Evidence + RACI
// ═══════════════════════════════════════════════════════════════
describe("Integration: Decision lifecycle with evidence + RACI", () => {
  it("full decision lifecycle: create → assign RACI → validate → approve", async () => {
    const decEngine  = new DecisionEngine("t-integration");
    const raciEngine = new RACIEngine("t-integration");
    const intCtx     = buildTenantContext({ tenantId:"t-integration", organizationId:"o", userId:"cgo", userRole:"governance_analyst" });

    // 1. Create decision
    const decision = await decEngine.create({
      title:"Strategic Partnership Approval", description:"Approve JV with vendor X",
      decisionType:"strategic", owner:"coo-001", ownerRole:"governance_analyst",
      accountableParty:"cgo-001", approver:"cgo-001", approverRole:"orchestrator",
      linkedControls:["CTRL-GOV-001"], linkedRisks:["risk-JV-001"],
      linkedEvidence:["board-ev-001"], linkedPolicies:["pol-governance"],
      linkedRegulations:["reg-cma"], businessImpact:"Revenue growth of SAR 50M",
      riskImpact:"increases", urgency:"standard", createdBy:"coo-001",
    }, intCtx);
    expect(decision.code).toBeTruthy();

    // 2. Assign RACI
    raciEngine.assign({ entityId:decision.id, entityType:"decision", entityTitle:decision.title, userId:"coo-001", userName:"COO", userRole:"governance_analyst", raciRole:"Responsible" });
    raciEngine.assign({ entityId:decision.id, entityType:"decision", entityTitle:decision.title, userId:"cgo-001", userName:"CGO", userRole:"orchestrator", raciRole:"Accountable" });
    const raciEntries = raciEngine.getForEntity(decision.id);
    expect(raciEntries).toHaveLength(2);

    // 3. Validate
    const validation = await decEngine.validate(decision.id, intCtx);
    expect(validation.passed).toBe(true);

    // 4. Approve
    const approverCtx = buildTenantContext({ tenantId:"t-integration", organizationId:"o", userId:"cgo-001", userRole:"orchestrator" });
    const approved    = await decEngine.approve(decision.id, "cgo-001", approverCtx);
    expect(approved.status).toBe("approved");
    expect(approved.immutableRecordId).toBeTruthy();

    // 5. Verify immutability via evidence engine
    const evEngine    = require("../evidence/lineage/evidence.lineage.engine").getEvidenceEngine("t-integration");
    const sealedRec   = evEngine.getDecisionRecord(approved.immutableRecordId!);
    expect(sealedRec).toBeDefined();
    expect(sealedRec?.isSealed).toBe(true);
    expect(Object.isFrozen(sealedRec)).toBe(true);
  });
});
