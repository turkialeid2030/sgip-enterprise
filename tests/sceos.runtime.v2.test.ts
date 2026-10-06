/**
 * SCEOS v2 Runtime Tests — Restored
 * Covers: Event Fabric, Institutional Kernel, Economic Cognition,
 *         Simulation, Agent Constitution, Time Intelligence, Thermodynamics,
 *         AI Readiness, SCEOS API Integration, Attack Simulations.
 */
import request from "supertest";
import jwt from "jsonwebtoken";
import { app } from "../api/server";
import { getEventFabric, buildAuthority, UnifiedEventFabric } from "../runtime/event-fabric/unified.event.fabric";
import { getKernel } from "../runtime/institutional-kernel/institutional.kernel";
import { getEconomicEngine } from "../runtime/economic-cognition/economic.cognition.engine";
import { getSimulationEngine } from "../runtime/simulation/simulation.engine";
import { getAgentConstitutionEngine, AgentConstitutionEngine } from "../agents/policies/adaptive.agent.constitution";
import { getTimeIntelligence } from "../runtime/time-intelligence/strategic.time.intelligence";
import { getThermodynamics } from "../runtime/thermodynamics/organizational.thermodynamics";
import { getAIReadinessEngine } from "../runtime/ai-readiness/ai.readiness.engine";
import { getGovernanceOntology } from "../sovereign-memory/ontology/governance.ontology.engine";

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

const uid = () => `t-sceos2-${Math.random().toString(36).slice(2,10)}`;
const JWT_SECRET = "dev_secret";
const token = (role="governance_analyst")=>jwt.sign({userId:"u1",email:`${role}@test.sgip`,role,tenantId:"tenant-test",nameAr:"T"},JWT_SECRET,{expiresIn:"1h"});
const a = {Authorization:`Bearer ${token()}`};

describe("UnifiedEventFabric — SCEOS Layer 1", () => {
  it("emits event with immutable hash",()=>{ const t=uid();const f=getEventFabric(t);const e=f.emit({eventType:"DecisionCreated",actorId:"cgo-001",actorRole:"governance_analyst",authorityContext:buildAuthority("cgo-001","governance_analyst",[]),payload:{decisionId:"dec-001"},evidenceLinks:["ev-001"]});expect(e.eventId).toBeTruthy();expect(e.integrityHash.length).toBe(32);expect(Object.isFrozen(e)).toBe(true); });
  it("replay prevention: same tenant not a replay",()=>{ const t=uid();const f=getEventFabric(t);const e=f.emit({eventType:"PolicyChanged",actorId:"u1",actorRole:"r",authorityContext:buildAuthority("u1","r",[]),payload:{}});expect(f.validate(e.eventId).isReplay).toBe(false); });
  it("subscriber receives events",()=>{ const t=uid();const f=getEventFabric(t);const received:string[]=[];f.subscribe("ControlFailed",(e)=>{received.push(e.eventType)});f.emit({eventType:"ControlFailed",actorId:"u1",actorRole:"r",authorityContext:buildAuthority("u1","r",[]),payload:{controlId:"c1"}});expect(received).toContain("ControlFailed"); });
  it("causation chain",()=>{ const t=uid();const f=getEventFabric(t);const p=f.emit({eventType:"RiskEscalated",actorId:"cro",actorRole:"r",authorityContext:buildAuthority("cro","r",[]),payload:{}});const c=f.emit({eventType:"ApprovalRequested",actorId:"cgo",actorRole:"r",authorityContext:buildAuthority("cgo","r",[]),payload:{},causationId:p.eventId});expect(c.causationId).toBe(p.eventId); });
  it("tenant isolation: B cannot see A events",()=>{ const tA=uid();const tB=uid();const fA=getEventFabric(tA);const fB=getEventFabric(tB);fA.emit({eventType:"BoardResolutionIssued",actorId:"board",actorRole:"r",authorityContext:buildAuthority("board","r",[]),payload:{secret:"yes"}});expect(fB.getEvents().filter(e=>e.payload.secret==="yes")).toHaveLength(0); });
});

describe("InstitutionalKernel — SCEOS Layer 2", () => {
  it("builds runtime context",()=>{ const t=uid();const k=getKernel(t);const ctx=k.buildRuntimeContext("cgo-001","governance_analyst");expect(ctx.tenantId).toBe(t);expect(typeof ctx.healthState.overallHealthScore).toBe("number"); });
  it("health scores 0-100",()=>{ const t=uid();const h=getKernel(t).computeHealthState();for(const s of [h.overallHealthScore,h.governancePressureIndex,h.executionFrictionIndex]){expect(s).toBeGreaterThanOrEqual(0);expect(s).toBeLessThanOrEqual(100);} });
  it("governance_analyst has memory access",()=>{ const t=uid();expect(getKernel(t).buildRuntimeContext("u1","governance_analyst").accessibleLayers).toContain("memory"); });
});

describe("EconomicCognitionEngine — SCEOS Layer 3", () => {
  it("control_failure impact",()=>{ const t=uid();const e=getEconomicEngine(t).assess({entityId:"ctrl-001",entityType:"control",scenario:"control_failure"});expect(e.financialImpact.netImpact).toBeGreaterThan(0); });
  it("compliance_breach higher than evidence_gap",()=>{ const t=uid();const e=getEconomicEngine(t);const b=e.assess({entityId:"e1",entityType:"obligation",scenario:"compliance_breach"});const g=e.assess({entityId:"e2",entityType:"evidence",scenario:"evidence_gap"});expect(b.financialImpact.netImpact).toBeGreaterThan(g.financialImpact.netImpact); });
  it("cost model positive",()=>{ const t=uid();const m=getEconomicEngine(t).buildCostModel();expect(m.annualGovernanceCost).toBeGreaterThan(0); });
});

describe("SimulationEngine — SCEOS Layer 4", () => {
  it("simulates all 10 scenarios",()=>{ const t=uid();const e=getSimulationEngine(t);const scenarios=["change_authority","approve_policy","control_failure","project_delay","kri_breach","compliance_incident","evidence_weakness","conflict_of_interest","risk_owner_loss","board_pressure"] as const;for(const s of scenarios){const r=e.simulate({scenario:s,entityId:"e1",entityType:"policy",actorId:"u1",parameters:{},simulatedBy:"test"});expect(r.id).toBeTruthy(); } });
  it("approve_policy negative risk delta",()=>{ const t=uid();const r=getSimulationEngine(t).simulate({scenario:"approve_policy",entityId:"pol-001",entityType:"policy",actorId:"cgo",parameters:{},simulatedBy:"cgo"});expect(r.riskDelta).toBeLessThanOrEqual(0); });
});

describe("AgentConstitution — SCEOS Layer 5", () => {
  it("forbidden action blocked",()=>{ const t=uid();const e=new AgentConstitutionEngine(t);e.registerAgent({agentId:"aa-001",role:"audit_agent",sector:"banking",maturityLevel:3,allowedDataAccess:[]});expect(e.checkAction("aa-001","delete_audit_trail",95).allowed).toBe(false); });
  it("low confidence requires approval",()=>{ const t=uid();const e=new AgentConstitutionEngine(t);e.registerAgent({agentId:"ca-001",role:"compliance_agent",sector:"banking",maturityLevel:2,allowedDataAccess:[]});expect(e.checkAction("ca-001","generate_report",50).requiresApproval).toBe(true); });
  it("unregistered agent denied",()=>{ const t=uid();const e=new AgentConstitutionEngine(t);expect(e.checkAction("ghost","any",99).allowed).toBe(false); });
});

describe("StrategicTimeIntelligence — SCEOS Layer 6", () => {
  it("generates 30d report",()=>{ const t=uid();const r=getTimeIntelligence(t).generateReport("30d");expect(r.period).toBe("30d");expect(["improving","stable","deteriorating"]).toContain(r.trendDirection); });
  it("EW-003 early warning on empty system",()=>{ const t=uid();const r=getTimeIntelligence(t).generateReport("30d");expect(r.earlyWarnings.some(w=>w.code==="EW-003")).toBe(true); });
});

describe("OrganizationalThermodynamics — SCEOS Layer 7", () => {
  it("measures 10 metrics",()=>{ const t=uid();const m=getThermodynamics(t).measure();const fields=["executionHeat","governanceLoad","decisionCongestion","approvalLatency","policyFriction","controlOverload","auditFatigue","teamCapacityPressure","entropyScore","organizationalDrag"];for(const f of fields){expect(typeof (m as any)[f]).toBe("number"); } });
  it("heatmap has 10 keys",()=>{ const t=uid();expect(Object.keys(getThermodynamics(t).generateReport().heatmap)).toHaveLength(10); });
});

describe("AIReadinessEngine — SCEOS Layer 8", () => {
  const intakeBase={sector:"banking" as const,companySize:"enterprise" as const,userRole:"CISO",currentAIUsage:"limited" as const,aiDepartments:["IT"],adoptionBarriers:[],timeConsumingTasks:[],willingToGrantAIAccess:true,dataMaturity:3 as const,governanceMaturity:3 as const,cyberMaturity:3 as const,complianceMaturity:3 as const,seniorLeadershipReadiness:3 as const,budgetLevel:"moderate" as const};
  it("scores intake",()=>{ const t=uid();const e=getAIReadinessEngine(t);const i=e.submitIntake(intakeBase);const s=e.scoreIntake(i.id);expect(s.aiReadinessScore).toBeGreaterThan(0);expect(s.roadmap).toHaveLength(3); });
  it("mature org has lower risk score",()=>{ const t=uid();const e=getAIReadinessEngine(t);const lI=e.submitIntake({...intakeBase,governanceMaturity:1,cyberMaturity:1});const hI=e.submitIntake({...intakeBase,governanceMaturity:5,cyberMaturity:5,budgetLevel:"strategic",currentAIUsage:"extensive"});expect(e.scoreIntake(hI.id).aiGovernanceRiskScore).toBeLessThan(e.scoreIntake(lI.id).aiGovernanceRiskScore); });
});

describe("SCEOS API Security", () => {
  it("GET /api/sceos/state → 200",async()=>{ const r=await request(app).get("/api/sceos/state").set(a);expect(r.status).toBe(200);expect(r.body).toHaveProperty("healthState"); });
  it("GET /api/sceos/thermodynamics → 200",async()=>{ const r=await request(app).get("/api/sceos/thermodynamics").set(a);expect(r.status).toBe(200);expect(Object.keys(r.body.heatmap)).toHaveLength(10); });
  it("GET /api/sceos/forecast → 200",async()=>{ const r=await request(app).get("/api/sceos/forecast").set(a);expect(r.status).toBe(200);expect(r.body).toHaveProperty("earlyWarnings"); });
  it("POST /api/sceos/simulate → 200",async()=>{ const r=await request(app).post("/api/sceos/simulate").set(a).send({scenario:"control_failure",entityId:"ctrl-001",entityType:"control",actorId:"cro",parameters:{}});expect(r.status).toBe(200); });
  it("no token → 401",async()=>{ for(const p of ["/api/sceos/state","/api/sceos/thermodynamics"]){const r=await request(app).get(p);expect(r.status).toBe(401);} });
});


describe('SCEOS API Extended Integration', () => {
  it('POST /api/sceos/event → 201',async()=>{ const r=await request(app).post('/api/sceos/event').set(a).send({eventType:'DecisionCreated',actorId:'cgo-001',actorRole:'governance_analyst',payload:{decisionId:'d1'},evidenceLinks:['ev-001']});expect(r.status).toBe(201);expect(r.body).toHaveProperty('eventId');expect(r.body).toHaveProperty('integrityHash'); });
  it('POST /api/sceos/event missing type → 422',async()=>{ const r=await request(app).post('/api/sceos/event').set(a).send({actorId:'u1'});expect(r.status).toBe(422); });
  it('GET /api/sceos/event → 200',async()=>{ const r=await request(app).get('/api/sceos/event').set(a);expect(r.status).toBe(200);expect(r.body).toHaveProperty('events');expect(r.body).toHaveProperty('stats'); });
  it('POST /api/sceos/economic-impact → 200',async()=>{ const r=await request(app).post('/api/sceos/economic-impact').set(a).send({entityId:'ctrl-001',entityType:'control',scenario:'control_failure'});expect(r.status).toBe(200);expect(r.body.financialImpact.netImpact).toBeGreaterThan(0); });
  it('POST /api/sceos/economic-impact invalid → 422',async()=>{ const r=await request(app).post('/api/sceos/economic-impact').set(a).send({entityId:'e',entityType:'t',scenario:'made_up'});expect(r.status).toBe(422); });
  it('GET /api/sceos/economic-impact → 200',async()=>{ const r=await request(app).get('/api/sceos/economic-impact').set(a);expect(r.status).toBe(200);expect(r.body).toHaveProperty('costModel'); });
  it('GET /api/sceos/simulate → 200',async()=>{ const r=await request(app).get('/api/sceos/simulate').set(a);expect(r.status).toBe(200);expect(r.body).toHaveProperty('simulations'); });
  it('POST /api/sceos/ai-readiness → 201',async()=>{ const r=await request(app).post('/api/sceos/ai-readiness').set(a).send({sector:'banking',companySize:'enterprise',userRole:'CISO',currentAIUsage:'limited',aiDepartments:['IT'],adoptionBarriers:['cost'],timeConsumingTasks:['reporting'],willingToGrantAIAccess:true,dataMaturity:3,governanceMaturity:3,cyberMaturity:4,complianceMaturity:3,seniorLeadershipReadiness:3,budgetLevel:'moderate'});expect(r.status).toBe(201);expect(r.body.score.aiReadinessScore).toBeGreaterThan(0); });
  it('POST /api/sceos/ai-readiness invalid sector → 422',async()=>{ const r=await request(app).post('/api/sceos/ai-readiness').set(a).send({sector:'invalid'});expect(r.status).toBe(422); });
  it('GET /api/sceos/stakeholders → 200',async()=>{ const r=await request(app).get('/api/sceos/stakeholders').set(a);expect(r.status).toBe(200);expect(r.body).toHaveProperty('stakeholders'); });
  it('GET /api/sceos/executive-intelligence → 200',async()=>{ const r=await request(app).get('/api/sceos/executive-intelligence').set(a);expect(r.status).toBe(200);expect(r.body).toHaveProperty('executiveSnapshot'); });
  it('GET /api/sceos/dashboards → 10 dashboards',async()=>{ const r=await request(app).get('/api/sceos/dashboards').set(a);expect(r.status).toBe(200);expect(r.body.availableDashboards).toHaveLength(10); });
  it('POST /api/sceos/agent-governance → 201',async()=>{ const r=await request(app).post('/api/sceos/agent-governance').set(a).send({agentId:'test-agent-ext-001',role:'risk_analyst',sector:'banking',maturityLevel:3,allowedDataAccess:[]});expect(r.status).toBe(201); });
  it('GET /api/sceos/agent-governance/:id → 200',async()=>{ await request(app).post('/api/sceos/agent-governance').set(a).send({agentId:'agent-for-get-ext',role:'audit_agent',sector:'banking',maturityLevel:3,allowedDataAccess:[]});const r=await request(app).get('/api/sceos/agent-governance/agent-for-get-ext').set(a);expect(r.status).toBe(200); });
  it('GET /api/sceos/agent-governance/ghost → 404',async()=>{ const r=await request(app).get('/api/sceos/agent-governance/ghost-999').set(a);expect(r.status).toBe(404); });
});
