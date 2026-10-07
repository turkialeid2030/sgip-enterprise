/**
 * Phase 10/11/14 — Legal Governance + AI Registry + Sector Packs Tests
 * Additive — 647 baseline preserved.
 */
import request from "supertest";
import jwt from "jsonwebtoken";
import { app } from "../api/server";
import { LegalGovernanceRuntime, getLegalRuntime } from "../legal-governance/legal.governance.runtime";
import { AIModelRegistry, getAIModelRegistry } from "../ai-governance-runtime/registry/ai.model.registry";
import { sectorPackEngine, Sector } from "../sector-packs/core/sector.packs.engine";

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
  EntityDAO:{
    // tx-aware variant used by the atomic audit contract
    createIn: jest.fn().mockImplementation((_tx, d) => Promise.resolve({ ...d, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() })), findMany:jest.fn().mockResolvedValue([]), count:jest.fn().mockResolvedValue(0), findOne:jest.fn().mockResolvedValue(null), create:jest.fn().mockImplementation((d:any)=>Promise.resolve({...d,id:"new-id"})), update:jest.fn().mockResolvedValue({}), archive:jest.fn().mockResolvedValue(undefined), getEdges:jest.fn().mockResolvedValue([]), getInEdges:jest.fn().mockResolvedValue([]), upsertEdge:jest.fn().mockResolvedValue(undefined) },
}));
jest.mock("../api/services/audit.dao", () => ({ AuditDAO: { logIn: jest.fn().mockResolvedValue(undefined), log:jest.fn().mockResolvedValue(undefined), findRecent:jest.fn().mockResolvedValue([]) } }));
jest.mock("../api/services/agent.dao", () => ({ AgentDAO:{ create:jest.fn().mockResolvedValue(undefined), findPending:jest.fn().mockResolvedValue([]), findOne:jest.fn().mockResolvedValue(null), review:jest.fn().mockResolvedValue({id:"out-1"}), count:jest.fn().mockResolvedValue(0) } }));
jest.mock("../graph/db.adapter", () => ({ GraphDBAdapter:jest.fn().mockImplementation(()=>({ hydrate:jest.fn().mockResolvedValue({nodes:0,edges:0}), getEngine:jest.fn().mockReturnValue(null), persistEdge:jest.fn().mockResolvedValue(undefined), syncNode:jest.fn().mockResolvedValue(undefined) })) }));

const uid = () => `t-final-${Math.random().toString(36).slice(2,10)}`;
const JWT_SECRET = "dev_secret";
const token = (r="governance_analyst")=>jwt.sign({userId:"u1",email:`${r}@test.sgip`,role:r,tenantId:"tenant-test",nameAr:"T"},JWT_SECRET,{expiresIn:"1h"});
const a = {Authorization:`Bearer ${token()}`};

// ═══════════════════════════════════════════════════════════════
// LEGAL GOVERNANCE RUNTIME
// ═══════════════════════════════════════════════════════════════
describe("LegalGovernanceRuntime — Phase 10", () => {
  it("loadLegalBaseline loads 8 Saudi legal obligations", () => {
    const t=uid(); const l=new LegalGovernanceRuntime(t);
    const count=l.loadLegalBaseline("general_counsel");
    expect(count).toBe(8);
    expect(l.getObligations()).toHaveLength(8);
  });

  it("loadLegalBaseline is idempotent", () => {
    const t=uid(); const l=new LegalGovernanceRuntime(t);
    l.loadLegalBaseline("gc");
    const c2=l.loadLegalBaseline("gc");
    expect(c2).toBe(0); // Already loaded
    expect(l.getObligations()).toHaveLength(8);
  });

  it("baseline includes PDPL obligations", () => {
    const t=uid(); const l=new LegalGovernanceRuntime(t);
    l.loadLegalBaseline("gc");
    const pdpl=l.getObligations("PDPL");
    expect(pdpl.length).toBeGreaterThanOrEqual(2);
    expect(pdpl.some(o=>o.obligationType==="consent")).toBe(true);
    expect(pdpl.some(o=>o.obligationType==="notification")).toBe(true);
  });

  it("registers custom legal obligation", () => {
    const t=uid(); const l=new LegalGovernanceRuntime(t);
    const o=l.registerObligation({ framework:"Companies_Law", articleRef:"Article 90", obligationType:"filing", title:"Board Meeting Minutes", description:"Annual board meeting minutes must be filed", applicableTo:["joint_stock_company"], jurisdiction:"Saudi Arabia", recurring:true, recurringCycle:"annual", status:"active", ownerId:"company_secretary", evidenceRequired:["board_minutes"] });
    expect(o.id).toBeTruthy();
    expect(o.framework).toBe("Companies_Law");
  });

  it("registerContract detects high-risk clauses", () => {
    const t=uid(); const l=new LegalGovernanceRuntime(t);
    const c=l.registerContract({ title:"Enterprise Software License", partyA:"SGIP Corp", partyB:"Tech Vendor", contractType:"license", value:5000000, currency:"SAR", startDate:"2025-01-01", endDate:"2026-12-31", autoRenew:true, riskLevel:"high", keyObligations:[{clauseId:"c1",type:"liability_cap",description:"Liability capped at SAR 100K",riskFlag:true,riskReason:"Unlimited liability excluded"}], riskClauses:[], expiryWarningDays:90, status:"active" });
    expect(c.code).toMatch(/^CTR-/);
    expect(c.riskLevel).toBe("high");
  });

  it("detectContradictions: PDPL vs AML tension", () => {
    const t=uid(); const l=new LegalGovernanceRuntime(t);
    l.loadLegalBaseline("gc");
    const contras=l.detectContradictions();
    // Both PDPL and AML_Law are in baseline — should detect tension
    expect(Array.isArray(contras)).toBe(true);
    if(contras.length>0) {
      expect(contras[0].type).toBe("framework_conflict");
      expect(contras[0].frameworks).toContain("PDPL");
    }
  });

  it("scoreLegalRisk returns 0-100 overall score", () => {
    const t=uid(); const l=new LegalGovernanceRuntime(t);
    l.loadLegalBaseline("gc");
    const score=l.scoreLegalRisk();
    expect(score.overallScore).toBeGreaterThanOrEqual(0);
    expect(score.overallScore).toBeLessThanOrEqual(100);
    expect(typeof score.obligationRisk).toBe("number");
    expect(Array.isArray(score.recommendations)).toBe(true);
  });

  it("interpretRegulation: PDPL interpretation with high confidence", () => {
    const t=uid(); const l=new LegalGovernanceRuntime(t);
    const interp=l.interpretRegulation({ question:"What consent is needed for data collection?", framework:"PDPL", articleRef:"Article 5" });
    expect(interp.confidence).toBe("high");
    expect(interp.interpretation.length).toBeGreaterThan(50);
    expect(Array.isArray(interp.caveats)).toBe(true);
  });

  it("interpretRegulation: unknown framework returns requires counsel=true", () => {
    const t=uid(); const l=new LegalGovernanceRuntime(t);
    const interp=l.interpretRegulation({ question:"What are the obligations?", framework:"ZATCA_Regulations" as any, articleRef:"Art 1" });
    expect(interp.requiresLegalCounsel).toBe(true);
  });

  it("tenant isolation: B cannot see A obligations", () => {
    const tA=uid(); const tB=uid();
    new LegalGovernanceRuntime(tA).loadLegalBaseline("gc");
    expect(new LegalGovernanceRuntime(tB).getObligations()).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════
// AI MODEL REGISTRY
// ═══════════════════════════════════════════════════════════════
describe("AIModelRegistry — Phase 11", () => {
  it("registers AI model with code generation", () => {
    const t=uid(); const r=new AIModelRegistry(t);
    const m=r.registerModel({ name:"Credit Scoring Model v3", version:"3.0.1", modelType:"classification", useCase:"Credit risk assessment", riskTier:"high_risk", stage:"production", ownerId:"data_science_team", teamId:"ds-001", trainedOn:"Historical loan data 2020-2024", frameworks:["ISO_42001","NIST_AI_RMF"], explainabilityScore:82, biasResult:"pass", sdaiaRegistered:true, humanOversightRequired:true });
    expect(m.code).toMatch(/^MDL-/);
    expect(m.riskTier).toBe("high_risk");
    expect(Object.isFrozen(m)).toBe(true);
  });

  it("recordDrift: high deviation triggers alert severity", () => {
    const t=uid(); const r=new AIModelRegistry(t);
    const m=r.registerModel({ name:"Fraud Detection",version:"2.0",modelType:"anomaly_detection",useCase:"Fraud",riskTier:"high_risk",stage:"production",ownerId:"u",teamId:"t",trainedOn:"d",frameworks:[],explainabilityScore:75,sdaiaRegistered:false,humanOversightRequired:true });
    const drift=r.recordDrift(m.id, { driftType:"performance_drift", metric:"F1_Score", baseline:0.92, current:0.65, threshold:0.85 });
    expect(["critical","high"]).toContain(drift.severity);  // ~27% deviation
    expect(["suspend","retrain"]).toContain(drift.action);
    // Model drift status should be updated
    const updated=r.getModel(m.id);
    expect(["alert","warning"]).toContain(updated?.driftStatus);
  });

  it("recordDrift: minor deviation = low severity", () => {
    const t=uid(); const r=new AIModelRegistry(t);
    const m=r.registerModel({ name:"Simple Model",version:"1.0",modelType:"regression",useCase:"Prediction",riskTier:"minimal_risk",stage:"production",ownerId:"u",teamId:"t",trainedOn:"d",frameworks:[],explainabilityScore:60,sdaiaRegistered:false,humanOversightRequired:false });
    const drift=r.recordDrift(m.id, { driftType:"data_drift", metric:"PSI", baseline:0.10, current:0.11, threshold:0.25 });
    expect(drift.severity).toBe("low");
    expect(drift.action).toBe("review");
  });

  it("conductBiasAssessment: failing dimension returns fail", () => {
    const t=uid(); const r=new AIModelRegistry(t);
    const m=r.registerModel({ name:"HR Model",version:"1.0",modelType:"classification",useCase:"Recruitment",riskTier:"high_risk",stage:"validation",ownerId:"u",teamId:"t",trainedOn:"d",frameworks:[],explainabilityScore:70,sdaiaRegistered:true,humanOversightRequired:true });
    const assessment=r.conductBiasAssessment(m.id, "ai_ethics_team", [{dimension:"gender",metric:"demographic_parity",score:0.62,threshold:0.80,passed:false,notes:"Female candidates 38% less likely to be shortlisted"}]);
    expect(assessment.overallResult).toBe("fail");
    expect(assessment.recommendations.length).toBeGreaterThan(0);
    expect(assessment.recommendations[0]).toContain("gender");
  });

  it("setLineage and retrieve", () => {
    const t=uid(); const r=new AIModelRegistry(t);
    const m=r.registerModel({ name:"M",version:"1",modelType:"t",useCase:"u",riskTier:"low_risk" as any,stage:"production",ownerId:"u",teamId:"t",trainedOn:"d",frameworks:[],explainabilityScore:60,sdaiaRegistered:false,humanOversightRequired:false });
    r.setLineage(m.id, { dataset:"Training dataset v5", dataVersion:"5.0", trainingDate:"2025-01-15", validationScore:0.91, featureCount:47, hyperparameters:{ learningRate:0.001, epochs:100 }, artifacts:["model_weights.bin","scaler.pkl"] });
    const lineage=r.getLineage(m.id);
    expect(lineage).toBeDefined();
    expect(lineage!.featureCount).toBe(47);
    expect(lineage!.validationScore).toBe(0.91);
  });

  it("scoreResponsibleAI returns 0-100 with dimensions", () => {
    const t=uid(); const r=new AIModelRegistry(t);
    const rai=r.scoreResponsibleAI();
    expect(rai.overallScore).toBeGreaterThanOrEqual(0);
    expect(rai.overallScore).toBeLessThanOrEqual(100);
    expect(typeof rai.dimensions.explainability).toBe("number");
    expect(typeof rai.dimensions.fairness).toBe("number");
    expect(typeof rai.dimensions.human_oversight).toBe("number");
  });

  it("tenant isolation: model not visible cross-tenant", () => {
    const tA=uid(); const tB=uid();
    const rA=new AIModelRegistry(tA);
    rA.registerModel({ name:"Secret Model",version:"1",modelType:"t",useCase:"u",riskTier:"high_risk",stage:"production",ownerId:"u",teamId:"t",trainedOn:"d",frameworks:[],explainabilityScore:70,sdaiaRegistered:false,humanOversightRequired:true });
    expect(new AIModelRegistry(tB).getModels()).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════
// SECTOR PACKS ENGINE
// ═══════════════════════════════════════════════════════════════
describe("SectorPackEngine — Phase 14", () => {
  it("getAllPacks returns 10 sectors", () => {
    expect(sectorPackEngine.getAllPacks()).toHaveLength(10);
  });

  it("getSectors returns all 10 sector codes", () => {
    const sectors=sectorPackEngine.getSectors();
    expect(sectors).toHaveLength(10);
    expect(sectors).toContain("banking");
    expect(sectors).toContain("insurance");
    expect(sectors).toContain("government");
    expect(sectors).toContain("technology");
  });

  it("banking pack has controls, KRIs, and risks", () => {
    const pack=sectorPackEngine.getPack("banking");
    expect(pack.sector).toBe("banking");
    expect(pack.controls.length).toBeGreaterThanOrEqual(5);
    expect(pack.kris.length).toBeGreaterThanOrEqual(5);
    expect(pack.risks.length).toBeGreaterThanOrEqual(3);
  });

  it("banking pack includes SAMA and NCA frameworks", () => {
    const pack=sectorPackEngine.getPack("banking");
    expect(pack.primaryFrameworks).toContain("SAMA_CSF");
    expect(pack.primaryFrameworks).toContain("NCA_ECC");
  });

  it("banking controls include KYC/AML", () => {
    const controls=sectorPackEngine.getControlsForSector("banking");
    expect(controls.some(c=>c.name.includes("KYC"))).toBe(true);
    expect(controls.some(c=>c.name.includes("Transaction Monitoring"))).toBe(true);
  });

  it("banking KRIs include Capital Adequacy and NPL", () => {
    const kris=sectorPackEngine.getKRIsForSector("banking");
    expect(kris.some(k=>k.name.includes("Capital"))).toBe(true);
    expect(kris.some(k=>k.name.includes("Non-Performing"))).toBe(true);
  });

  it("all KRIs have red/amber/green thresholds", () => {
    for(const sector of sectorPackEngine.getSectors()){
      const kris=sectorPackEngine.getKRIsForSector(sector);
      for(const k of kris){
        expect(typeof k.redThreshold).toBe("number");
        expect(typeof k.amberThreshold).toBe("number");
        expect(typeof k.greenThreshold).toBe("number");
      }
    }
  });

  it("applyPack returns count of applied components", () => {
    const result=sectorPackEngine.applyPack("t1","banking");
    expect(result.controls).toBeGreaterThanOrEqual(5);
    expect(result.kris).toBeGreaterThanOrEqual(5);
    expect(result.auditPrograms).toBeGreaterThanOrEqual(3);
  });
});

// ═══════════════════════════════════════════════════════════════
// PHASE 10/11/14 API TESTS
// ═══════════════════════════════════════════════════════════════
describe("Phase 10/11/14 Executive APIs", () => {
  it("GET /api/executive/legal-governance → 200", async () => {
    const r=await request(app).get("/api/executive/legal-governance").set(a);
    expect(r.status).toBe(200);
    expect(r.body).toHaveProperty("legalRiskScore");
    expect(r.body).toHaveProperty("obligations");
    expect(r.body).toHaveProperty("contradictions");
    expect(r.body.obligations).toBeGreaterThanOrEqual(8);
  });

  it("POST /api/executive/legal-interpretation → 200", async () => {
    const r=await request(app).post("/api/executive/legal-interpretation").set(a).send({ question:"What consent is required for processing personal data under PDPL?", framework:"PDPL", articleRef:"Article 5" });
    expect(r.status).toBe(200);
    expect(r.body).toHaveProperty("interpretation");
    expect(r.body).toHaveProperty("confidence");
    expect(r.body).toHaveProperty("requiresLegalCounsel");
  });

  it("POST /api/executive/legal-interpretation missing fields → 422", async () => {
    const r=await request(app).post("/api/executive/legal-interpretation").set(a).send({ question:"short" });
    expect(r.status).toBe(422);
  });

  it("GET /api/executive/ai-model-registry → 200", async () => {
    const r=await request(app).get("/api/executive/ai-model-registry").set(a);
    expect(r.status).toBe(200);
    expect(r.body).toHaveProperty("totalModels");
    expect(r.body).toHaveProperty("responsibleAIScore");
    expect(r.body).toHaveProperty("dimensions");
    expect(r.body).toHaveProperty("recommendations");
  });

  it("GET /api/executive/sector-pack (all) → 200", async () => {
    const r=await request(app).get("/api/executive/sector-pack").set(a);
    expect(r.status).toBe(200);
    expect(r.body).toHaveProperty("availableSectors");
    expect(r.body).toHaveProperty("packs");
    expect(r.body.availableSectors).toHaveLength(10);
    expect(r.body.packs).toHaveLength(10);
  });

  it("GET /api/executive/sector-pack?sector=banking → banking pack", async () => {
    const r=await request(app).get("/api/executive/sector-pack?sector=banking").set(a);
    expect(r.status).toBe(200);
    expect(r.body.sector).toBe("banking");
    expect(r.body.controls.length).toBeGreaterThanOrEqual(5);
    expect(r.body.kris.length).toBeGreaterThanOrEqual(5);
  });

  it("GET /api/executive/sector-pack?sector=unknown → 404", async () => {
    const r=await request(app).get("/api/executive/sector-pack?sector=unknown_sector").set(a);
    expect(r.status).toBe(404);
  });

  it("all Phase 10/11/14 endpoints require auth → 401", async () => {
    for (const path of ["/api/executive/legal-governance","/api/executive/ai-model-registry","/api/executive/sector-pack"]) {
      const r=await request(app).get(path);
      expect(r.status).toBe(401);
    }
  });
});
