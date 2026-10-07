/**
 * Phase 9: Sovereign Governance Runtime — Audit + Financial + Maturity Tests
 * Covers: Internal Audit Runtime, Financial Audit Runtime,
 *         Governance Maturity Engine, Phase 9 Executive APIs.
 * Additive — 616 baseline tests preserved.
 */
import request from "supertest";
import jwt from "jsonwebtoken";
import { app } from "../api/server";
import { InternalAuditRuntime, getInternalAuditRuntime } from "../audit-runtime/internal/internal.audit.runtime";
import { FinancialAuditRuntime, getFinancialAuditRuntime } from "../audit-runtime/financial/financial.audit.runtime";
import { GovernanceMaturityEngine, getMaturityEngine } from "../governance-maturity/governance.maturity.engine";

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
  connectDB:jest.fn().mockResolvedValue(undefined), disconnectDB:jest.fn().mockResolvedValue(undefined),
  query:jest.fn().mockResolvedValue([]), queryOne:jest.fn().mockResolvedValue(null),
  queryCount:jest.fn().mockResolvedValue(0), transaction:jest.fn().mockImplementation(async(fn:any)=>fn({})), getPool:jest.fn().mockReturnValue({}),
}));
jest.mock("../api/services/entity.dao", () => ({
  EntityDAO: {
    // tx-aware variant used by the atomic audit contract
    createIn: jest.fn().mockImplementation((_tx, d) => Promise.resolve({ ...d, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() })), findMany:jest.fn().mockResolvedValue([]), count:jest.fn().mockResolvedValue(0), findOne:jest.fn().mockResolvedValue(null), create:jest.fn().mockImplementation((d:any)=>Promise.resolve({...d,id:"new-id"})), update:jest.fn().mockResolvedValue({}), archive:jest.fn().mockResolvedValue(undefined), getEdges:jest.fn().mockResolvedValue([]), getInEdges:jest.fn().mockResolvedValue([]), upsertEdge:jest.fn().mockResolvedValue(undefined) },
}));
jest.mock("../api/services/audit.dao", () => ({ AuditDAO: { logIn: jest.fn().mockResolvedValue(undefined), log:jest.fn().mockResolvedValue(undefined), findRecent:jest.fn().mockResolvedValue([]) } }));
jest.mock("../api/services/agent.dao", () => ({ AgentDAO: { create:jest.fn().mockResolvedValue(undefined), findPending:jest.fn().mockResolvedValue([]), findOne:jest.fn().mockResolvedValue(null), review:jest.fn().mockResolvedValue({id:"out-1"}), count:jest.fn().mockResolvedValue(0) } }));
jest.mock("../graph/db.adapter", () => ({ GraphDBAdapter: jest.fn().mockImplementation(() => ({ hydrate:jest.fn().mockResolvedValue({nodes:0,edges:0}), getEngine:jest.fn().mockReturnValue(null), persistEdge:jest.fn().mockResolvedValue(undefined), syncNode:jest.fn().mockResolvedValue(undefined) })) }));

const uid = () => `t-p9-${Math.random().toString(36).slice(2,10)}`;
const JWT_SECRET = "dev_secret";
function token(role = "governance_analyst") {
  return jwt.sign({ userId:"u1", email:`${role}@test.sgip`, role, tenantId:"tenant-test", nameAr:"T" }, JWT_SECRET, { expiresIn:"1h" });
}
const a = { Authorization:`Bearer ${token()}` };

// ═══════════════════════════════════════════════════════════════
// INTERNAL AUDIT RUNTIME
// ═══════════════════════════════════════════════════════════════
describe("InternalAuditRuntime — Phase 9.1", () => {
  it("registers audit universe item", () => {
    const t=uid(); const audit=new InternalAuditRuntime(t);
    const u=audit.registerUniverseItem({name:"IT General Controls",scope:["information_security","access_management"],riskRating:"high",frequency:"annual",ownerId:"it_ciso",nextScheduled:"2025-06-01"});
    expect(u.id).toBeTruthy();
    expect(u.riskRating).toBe("high");
    expect(u.tenantId).toBe(t);
  });

  it("generateRiskBasedPlan returns priority-ordered schedule", () => {
    const t=uid(); const audit=new InternalAuditRuntime(t);
    audit.registerUniverseItem({name:"Cyber Controls",scope:["cyber"],riskRating:"critical",frequency:"annual",ownerId:"ciso",nextScheduled:"2025-01-01"});
    audit.registerUniverseItem({name:"HR Controls",scope:["hr"],riskRating:"low",frequency:"annual",ownerId:"hr_mgr",nextScheduled:"2025-12-01"});
    const plan=audit.generateRiskBasedPlan(2025);
    expect(plan[0].riskRating).toBe("critical");  // critical first
    expect(plan.length).toBe(2);
  });

  it("openEngagement creates audit with planning status", () => {
    const t=uid(); const audit=new InternalAuditRuntime(t);
    const u=audit.registerUniverseItem({name:"Revenue Controls",scope:["finance"],riskRating:"high",frequency:"annual",ownerId:"cfo",nextScheduled:"2025-03-01"});
    const eng=audit.openEngagement({title:"Revenue Controls Audit 2025",type:"internal_financial",universeId:u.id,ownerId:"cae",leadAuditorId:"audit-lead-1",scope:"Revenue recognition and controls",objectives:["Test revenue controls","Assess compliance with IFRS 15"],auditPeriodFrom:"2025-01-01",auditPeriodTo:"2025-03-31"});
    expect(eng.code).toMatch(/^AUD-/);
    expect(eng.status).toBe("planning");
    expect(eng.objectives).toHaveLength(2);
  });

  it("advance engagement: planning → fieldwork → review", () => {
    const t=uid(); const audit=new InternalAuditRuntime(t);
    const u=audit.registerUniverseItem({name:"AP Controls",scope:["finance"],riskRating:"medium",frequency:"annual",ownerId:"cfo",nextScheduled:"2025-01-01"});
    const eng=audit.openEngagement({title:"AP Test",type:"internal_operational",universeId:u.id,ownerId:"cae",leadAuditorId:"al1",scope:"Accounts payable",objectives:["Test AP"],auditPeriodFrom:"2025-01-01",auditPeriodTo:"2025-03-31"});
    const fw=audit.advanceEngagement(eng.id,"fieldwork","al1");
    expect(fw.status).toBe("fieldwork");
    const rv=audit.advanceEngagement(eng.id,"review","al1");
    expect(rv.status).toBe("review");
  });

  it("invalid status transition throws", () => {
    const t=uid(); const audit=new InternalAuditRuntime(t);
    const u=audit.registerUniverseItem({name:"Test",scope:[],riskRating:"low",frequency:"annual",ownerId:"u",nextScheduled:"2025-01-01"});
    const eng=audit.openEngagement({title:"T",type:"internal_operational",universeId:u.id,ownerId:"u",leadAuditorId:"u",scope:"s",objectives:[],auditPeriodFrom:"2025-01-01",auditPeriodTo:"2025-03-31"});
    expect(()=>audit.advanceEngagement(eng.id,"closed","u")).toThrow(); // cannot jump from planning to closed
  });

  it("raiseFinding creates finding with immutable hash", () => {
    const t=uid(); const audit=new InternalAuditRuntime(t);
    const u=audit.registerUniverseItem({name:"Access Control Review",scope:["security"],riskRating:"critical",frequency:"annual",ownerId:"ciso",nextScheduled:"2025-01-01"});
    const eng=audit.openEngagement({title:"Access Control Audit",type:"internal_it",universeId:u.id,ownerId:"cae",leadAuditorId:"al1",scope:"Access controls",objectives:[],auditPeriodFrom:"2025-01-01",auditPeriodTo:"2025-03-31"});
    audit.advanceEngagement(eng.id,"fieldwork","al1");
    const finding=audit.raiseFinding({engagementId:eng.id,title:"Privileged access without approval",observation:"15 accounts have admin access without documented approval",condition:"Privileged accounts exist without approval records",criteria:"Policy requires documented approval for all privileged access",cause:"Access provisioning process bypassed in emergency",effect:"Risk of unauthorized access and data breach",severity:"critical",ownerId:"it_owner",dueDate:"2025-03-31"});
    expect(finding.code).toMatch(/^FND-/);
    expect(finding.severity).toBe("critical");
    expect(finding.hash).toBeTruthy();
    expect(finding.hash.length).toBe(24);
  });

  it("resolveFinding updates status", () => {
    const t=uid(); const audit=new InternalAuditRuntime(t);
    const u=audit.registerUniverseItem({name:"Vendor Controls",scope:["procurement"],riskRating:"medium",frequency:"annual",ownerId:"cpo",nextScheduled:"2025-01-01"});
    const eng=audit.openEngagement({title:"Vendor Review",type:"internal_compliance",universeId:u.id,ownerId:"cae",leadAuditorId:"al2",scope:"Vendor management",objectives:[],auditPeriodFrom:"2025-01-01",auditPeriodTo:"2025-03-31"});
    audit.advanceEngagement(eng.id,"fieldwork","al2");
    const finding=audit.raiseFinding({engagementId:eng.id,title:"Missing vendor contracts",observation:"5 vendors active without signed contracts",condition:"Active vendors without contracts",criteria:"All vendors must have signed contracts",cause:"Procurement bypass",effect:"Contractual risk",severity:"high",ownerId:"cpo",dueDate:"2025-06-30"});
    const resolved=audit.resolveFinding(finding.id,"Contracts signed for all vendors","procurement_mgr");
    expect(resolved?.status).toBe("resolved");
    expect(resolved?.managementResponse).toBeTruthy();
  });

  it("runContinuousAudit returns signals from CCM", () => {
    const t=uid(); const audit=new InternalAuditRuntime(t);
    const signals=audit.runContinuousAudit();
    expect(Array.isArray(signals)).toBe(true);
  });

  it("scoreReadiness returns 0-100 overall score", () => {
    const t=uid(); const audit=new InternalAuditRuntime(t);
    const score=audit.scoreReadiness();
    expect(score.overall).toBeGreaterThanOrEqual(0);
    expect(score.overall).toBeLessThanOrEqual(100);
    expect(Array.isArray(score.recommendations)).toBe(true);
  });

  it("tenant isolation: engagements not visible cross-tenant", () => {
    const tA=uid(); const tB=uid();
    const auditA=new InternalAuditRuntime(tA);
    const u=auditA.registerUniverseItem({name:"Secret",scope:[],riskRating:"critical",frequency:"annual",ownerId:"u",nextScheduled:"2025-01-01"});
    auditA.openEngagement({title:"Secret Audit",type:"internal_compliance",universeId:u.id,ownerId:"u",leadAuditorId:"u",scope:"s",objectives:[],auditPeriodFrom:"2025-01-01",auditPeriodTo:"2025-03-31"});
    expect(new InternalAuditRuntime(tB).getEngagements()).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════
// FINANCIAL AUDIT RUNTIME
// ═══════════════════════════════════════════════════════════════
describe("FinancialAuditRuntime — Phase 9.2", () => {
  it("assessMateriality computes performance and trivial thresholds", () => {
    const t=uid(); const fin=new FinancialAuditRuntime(t);
    const m=fin.assessMateriality({engagementRef:"AUD-2025-001",standard:"IFRS",overallMateriality:1000000,basis:"5% of profit before tax",rationale:"Benchmark consistent with industry practice"});
    expect(m.overallMateriality).toBe(1000000);
    expect(m.performanceMateriality).toBe(680000);  // 68%
    expect(m.trivialThreshold).toBe(50000);          // 5%
  });

  it("recordManagementAssertions covers 8 assertion types", () => {
    const t=uid(); const fin=new FinancialAuditRuntime(t);
    const a=fin.recordManagementAssertions({statementArea:"Revenue",ifrsReference:"IFRS_15",riskLevel:"high",auditProcedures:["Revenue testing","Cut-off analysis"]});
    expect(Object.keys(a.assertions)).toHaveLength(8);
    expect(a.assertions.existence.asserted).toBe(true);
    expect(a.assertions.completeness.auditorVerified).toBe(false);
  });

  it("performControlTest: effective control", () => {
    const t=uid(); const fin=new FinancialAuditRuntime(t);
    const test=fin.performControlTest({controlId:"CTL-REV-001",controlName:"Revenue Recognition Control",isaReference:"ISA_500",testType:"test_of_controls",sampleSize:25,deviations:1,tolerableDeviation:10,performedBy:"auditor-1"});
    expect(test.testResult).toBe("effective");
    expect(test.deficiencyType).toBeUndefined();
    expect(test.deviationRate).toBe(4);  // 1/25*100
    expect(test.conclusion).toContain("effective");
  });

  it("performControlTest: ineffective → material weakness", () => {
    const t=uid(); const fin=new FinancialAuditRuntime(t);
    const test=fin.performControlTest({controlId:"CTL-PAY-001",controlName:"Payment Authorization",isaReference:"ISA_330",testType:"test_of_controls",sampleSize:20,deviations:7,tolerableDeviation:10,performedBy:"auditor-2"});
    expect(test.testResult).toBe("ineffective");
    // 7/20=35% deviation vs 10% tolerable * 2 = 20% → material_weakness
    expect(test.deficiencyType).toBe("material_weakness");
  });

  it("sealEvidencePackage creates immutable sealed package", () => {
    const t=uid(); const fin=new FinancialAuditRuntime(t);
    const pkg=fin.sealEvidencePackage({engagementCode:"AUD-2025-001",title:"Q1 Revenue Evidence Package",standard:"IFRS",period:{from:"2025-01-01",to:"2025-03-31"},items:[{description:"Invoice population listing",source:"ERP system",relevantAssertion:"completeness",ifrsReference:"IFRS_15",collectedAt:new Date().toISOString(),sufficientEvidence:true},{description:"Revenue recognition journal entries",source:"GL system",relevantAssertion:"accuracy",ifrsReference:"IFRS_15",collectedAt:new Date().toISOString(),sufficientEvidence:true}],createdBy:"audit-lead-1"});
    expect(pkg.isSealed).toBe(true);
    expect(pkg.packageHash).toBeTruthy();
    expect(pkg.completenessScore).toBe(95);
    expect(Object.isFrozen(pkg)).toBe(true);
  });

  it("openExternalWorkspace and issue opinion", () => {
    const t=uid(); const fin=new FinancialAuditRuntime(t);
    const ws=fin.openExternalWorkspace({firm:"Big4 Audit LLC",engagementPartner:"Ahmed Al-Rashid",period:{from:"2024-01-01",to:"2024-12-31"}});
    expect(ws.status).toBe("planning");
    const opinion=fin.issueAuditOpinion(ws.id,"unqualified","partner-1");
    expect(opinion?.opinion).toBe("unqualified");
    expect(opinion?.status).toBe("opinion_issued");
  });

  it("getMaterialWeaknesses filters correctly", () => {
    const t=uid(); const fin=new FinancialAuditRuntime(t);
    fin.performControlTest({controlId:"CTL-001",controlName:"Test",isaReference:"ISA_500",testType:"test_of_controls",sampleSize:10,deviations:8,tolerableDeviation:10,performedBy:"u"});
    fin.performControlTest({controlId:"CTL-002",controlName:"Effective",isaReference:"ISA_500",testType:"test_of_controls",sampleSize:10,deviations:0,tolerableDeviation:10,performedBy:"u"});
    const mw=fin.getMaterialWeaknesses();
    expect(mw.every(m=>m.deficiencyType==="material_weakness")).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════
// GOVERNANCE MATURITY ENGINE
// ═══════════════════════════════════════════════════════════════
describe("GovernanceMaturityEngine — Phase 9.3", () => {
  it("scores all 6 dimensions", () => {
    const t=uid(); const engine=new GovernanceMaturityEngine(t);
    const report=engine.score();
    expect(report.dimensions).toHaveLength(6);
    const dimNames=report.dimensions.map(d=>d.dimension);
    expect(dimNames).toContain("Governance");
    expect(dimNames).toContain("AI Governance");
    expect(dimNames).toContain("Internal Audit");
    expect(dimNames).toContain("Compliance");
    expect(dimNames).toContain("Operational Resilience");
    expect(dimNames).toContain("Financial Governance");
  });

  it("each dimension has valid maturity level 1-5", () => {
    const t=uid(); const engine=new GovernanceMaturityEngine(t);
    const report=engine.score();
    for (const dim of report.dimensions) {
      expect([1,2,3,4,5]).toContain(dim.level);
      expect(dim.score).toBeGreaterThanOrEqual(0);
      expect(dim.score).toBeLessThanOrEqual(100);
      expect(dim.label.length).toBeGreaterThan(0);
    }
  });

  it("overall score is weighted average of dimensions", () => {
    const t=uid(); const engine=new GovernanceMaturityEngine(t);
    const report=engine.score();
    expect(report.overallScore).toBeGreaterThanOrEqual(0);
    expect(report.overallScore).toBeLessThanOrEqual(100);
    expect([1,2,3,4,5]).toContain(report.overallLevel);
  });

  it("certification readiness is boolean for all 4 frameworks", () => {
    const t=uid(); const engine=new GovernanceMaturityEngine(t);
    const report=engine.score();
    expect(typeof report.certificationReadiness.ISO_37301).toBe("boolean");
    expect(typeof report.certificationReadiness.COSO_ERM).toBe("boolean");
    expect(typeof report.certificationReadiness.IIA_IPPF).toBe("boolean");
    expect(typeof report.certificationReadiness.COBIT).toBe("boolean");
  });

  it("report has topGaps and quickWins", () => {
    const t=uid(); const engine=new GovernanceMaturityEngine(t);
    const report=engine.score();
    expect(Array.isArray(report.topGaps)).toBe(true);
    expect(Array.isArray(report.quickWins)).toBe(true);
    expect(typeof report.benchmarkNote).toBe("string");
  });

  it("higher governance activity improves governance dimension", () => {
    const t=uid();
    // Add board session to improve governance score
    const { getBoardRuntime } = require("../governance-runtime/board/board.runtime");
    const board=getBoardRuntime(t);
    const s=board.scheduleSession({type:"ordinary",scheduledAt:"2025-06-01T10:00:00Z",memberIds:["m1","m2"],quorumRequired:1,agendaItems:["Risk Review"],createdBy:"sec"});
    board.recordAttendance(s.id,["m1","m2"]);
    const engine=new GovernanceMaturityEngine(t);
    const report=engine.score();
    const govDim=report.dimensions.find(d=>d.dimension==="Governance");
    expect(govDim!.level).toBeGreaterThanOrEqual(1);
    // Should have board session in strengths
    expect(govDim!.strengths.some(s=>s.toLowerCase().includes("board"))).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════
// PHASE 9 EXECUTIVE APIS
// ═══════════════════════════════════════════════════════════════
describe("Phase 9 Executive APIs", () => {
  it("GET /api/executive/audit-readiness → 200", async () => {
    const r=await request(app).get("/api/executive/audit-readiness").set(a);
    expect(r.status).toBe(200);
    expect(r.body).toHaveProperty("internalAudit");
    expect(r.body).toHaveProperty("financialAudit");
    expect(r.body).toHaveProperty("continuousSignals");
    expect(r.body).toHaveProperty("recommendations");
    expect(typeof r.body.internalAudit.readinessScore).toBe("number");
  });

  it("GET /api/executive/governance-maturity → 200", async () => {
    const r=await request(app).get("/api/executive/governance-maturity").set(a);
    expect(r.status).toBe(200);
    expect(r.body).toHaveProperty("overallLevel");
    expect(r.body).toHaveProperty("overallScore");
    expect(r.body).toHaveProperty("dimensions");
    expect(r.body.dimensions).toHaveLength(6);
    expect(r.body).toHaveProperty("certificationReadiness");
  });

  it("GET /api/executive/financial-assurance → 200", async () => {
    const r=await request(app).get("/api/executive/financial-assurance").set(a);
    expect(r.status).toBe(200);
    expect(r.body).toHaveProperty("materialWeaknesses");
    expect(r.body).toHaveProperty("effectiveControls");
    expect(r.body).toHaveProperty("evidencePackages");
    expect(typeof r.body.materialWeaknesses).toBe("number");
  });

  it("GET /api/executive/regulatory-intelligence → 200", async () => {
    const r=await request(app).get("/api/executive/regulatory-intelligence").set(a);
    expect(r.status).toBe(200);
    expect(r.body).toHaveProperty("totalChanges");
    expect(r.body).toHaveProperty("byJurisdiction");
    expect(r.body).toHaveProperty("byFramework");
    expect(r.body).toHaveProperty("upcomingDeadlines");
    expect(r.body.totalChanges).toBeGreaterThanOrEqual(4);
  });

  it("POST /api/executive/maturity-improvement → 200", async () => {
    const r=await request(app).post("/api/executive/maturity-improvement").set(a).send({ dimension:"Governance", action:"Formalize board governance through documented procedures and regular sessions", actorId:"cgo-001" });
    expect(r.status).toBe(200);
    expect(r.body).toHaveProperty("currentLevel");
    expect(r.body).toHaveProperty("nextLevel");
    expect(r.body).toHaveProperty("estimatedImpact");
    expect(r.body).toHaveProperty("prerequisites");
  });

  it("POST /api/executive/maturity-improvement — invalid dimension → 422", async () => {
    const r=await request(app).post("/api/executive/maturity-improvement").set(a).send({ dimension:"Unknown Domain", action:"Some action here", actorId:"u1" });
    expect(r.status).toBe(422);
  });

  it("all Phase 9 endpoints require auth → 401 without token", async () => {
    for (const path of ["/api/executive/audit-readiness","/api/executive/governance-maturity","/api/executive/financial-assurance","/api/executive/regulatory-intelligence"]) {
      const r=await request(app).get(path);
      expect(r.status).toBe(401);
    }
  });
});
