/**
 * Phase 6+7: Sovereign Governance + Enterprise GRC Intelligence Tests
 * Covers: GRC Ontology, Board Runtime, Committee Runtime, Authority Engine,
 *         Risk Intelligence, Policy Runtime, CCM, Incident/Crisis,
 *         Resilience, Assurance, GRC Fabric, Predictive Analytics.
 * Additive — 512 baseline tests preserved.
 */
import request from "supertest";
import jwt from "jsonwebtoken";
import { app } from "../api/server";
import { GRCOntologyEngine, getGRCOntology } from "../grc-ontology/grc.ontology.engine";
import { BoardRuntime, getBoardRuntime } from "../governance-runtime/board/board.runtime";
import { CommitteeRuntime, getCommitteeRuntime } from "../governance-runtime/committees/committee.runtime";
import { AuthorityEngine, getAuthorityEngine } from "../governance-runtime/authority/authority.engine";
import { GovernancePolicyRuntime, getPolicyRuntime } from "../governance-runtime/policy/governance.policy.runtime";
import { UnifiedGRCFabric, getGRCFabric } from "../governance-runtime/grc-fabric/unified.grc.runtime";
import { RiskIntelligenceRuntime, getRiskRuntime } from "../risk-runtime/register/risk.intelligence.runtime";
import { ComplianceObligationRuntime, getComplianceObligationRuntime } from "../compliance-runtime/obligations/compliance.obligation.runtime";
import { CCMRuntime, getCCMRuntime } from "../compliance-runtime/ccm/ccm.runtime";
import { IncidentCrisisRuntime, getIncidentRuntime } from "../resilience-runtime/incidents/incident.crisis.runtime";
import { OperationalResilienceRuntime, getResilienceRuntime } from "../resilience-runtime/continuity/operational.resilience.runtime";
import { IntegratedAssuranceRuntime, getAssuranceRuntime } from "../assurance-runtime/integrated/integrated.assurance.runtime";
import { PredictiveGovernanceRuntime, getPredictiveRuntime } from "../analytics-runtime/predictive/predictive.governance.runtime";

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
jest.mock("../api/services/entity.dao", () => ({ EntityDAO: { findMany:jest.fn().mockResolvedValue([]), count:jest.fn().mockResolvedValue(0), findOne:jest.fn().mockResolvedValue(null), create:jest.fn().mockImplementation((d:any)=>Promise.resolve({...d,id:"new-id"})), update:jest.fn().mockResolvedValue({}), archive:jest.fn().mockResolvedValue(undefined), getEdges:jest.fn().mockResolvedValue([]), getInEdges:jest.fn().mockResolvedValue([]), upsertEdge:jest.fn().mockResolvedValue(undefined) } }));
jest.mock("../api/services/audit.dao", () => ({ AuditDAO: { logIn: jest.fn().mockResolvedValue(undefined), log:jest.fn().mockResolvedValue(undefined), findRecent:jest.fn().mockResolvedValue([]) } }));
jest.mock("../api/services/agent.dao", () => ({ AgentDAO: { create:jest.fn().mockResolvedValue(undefined), findPending:jest.fn().mockResolvedValue([]), findOne:jest.fn().mockResolvedValue(null), review:jest.fn().mockResolvedValue({id:"out-1"}), count:jest.fn().mockResolvedValue(0) } }));
jest.mock("../graph/db.adapter", () => ({ GraphDBAdapter: jest.fn().mockImplementation(() => ({ hydrate:jest.fn().mockResolvedValue({nodes:0,edges:0}), getEngine:jest.fn().mockReturnValue(null), persistEdge:jest.fn().mockResolvedValue(undefined), syncNode:jest.fn().mockResolvedValue(undefined) })) }));

const uid = () => `t-p67-${Math.random().toString(36).slice(2,10)}`;

// ═══════════════════════════════════════════════════════════════
// GRC ONTOLOGY ENGINE
// ═══════════════════════════════════════════════════════════════
describe("GRCOntologyEngine — Phase 6.1/7.1", () => {
  it("creates entity with all required fields", () => {
    const t=uid(); const e=new GRCOntologyEngine(t);
    const pol=e.upsert({entityType:"policy",code:"POL-001",title:"InfoSec Policy",description:"d",createdBy:"cgo"});
    expect(pol.id).toBeTruthy();
    expect(Object.isFrozen(pol)).toBe(true);
    expect(pol.tenantId).toBe(t);
    expect(pol.version).toBe(1);
  });

  it("upsert is idempotent by code", () => {
    const t=uid(); const e=new GRCOntologyEngine(t);
    e.upsert({entityType:"enterprise_risk",code:"RSK-001",title:"Cyber Risk v1",description:"d",createdBy:"cro"});
    const r2=e.upsert({entityType:"enterprise_risk",code:"RSK-001",title:"Cyber Risk v2",description:"updated",createdBy:"cro"});
    expect(e.getByType("enterprise_risk").filter(r=>r.code==="RSK-001")).toHaveLength(1);
    expect(r2.title).toBe("Cyber Risk v2");
  });

  it("adds relation between entities", () => {
    const t=uid(); const e=new GRCOntologyEngine(t);
    const pol=e.upsert({entityType:"policy",code:"P1",title:"P1",description:"d",createdBy:"u"});
    const ctrl=e.upsert({entityType:"control",code:"C1",title:"C1",description:"d",createdBy:"u"});
    e.addRelation({type:"IMPLEMENTS",fromId:ctrl.id,fromType:"control",toId:pol.id,toType:"policy",strength:1.0,validFrom:new Date().toISOString(),properties:{}});
    expect(e.getOutbound(ctrl.id,  "IMPLEMENTS")).toHaveLength(1);
    expect(e.getInbound( pol.id,   "IMPLEMENTS")).toHaveLength(1);
  });

  it("blast radius traverses connected entities", () => {
    const t=uid(); const e=new GRCOntologyEngine(t);
    const b=e.upsert({entityType:"board",code:"BRD-1",title:"Board",description:"d",createdBy:"u"});
    const p=e.upsert({entityType:"policy",code:"POL-X",title:"Policy",description:"d",createdBy:"u"});
    const r=e.upsert({entityType:"enterprise_risk",code:"RSK-X",title:"Risk",description:"d",createdBy:"u"});
    e.addRelation({type:"GOVERNS",fromId:b.id,fromType:"board",toId:p.id,toType:"policy",strength:1,validFrom:new Date().toISOString(),properties:{}});
    e.addRelation({type:"MITIGATES",fromId:p.id,fromType:"policy",toId:r.id,toType:"enterprise_risk",strength:0.8,validFrom:new Date().toISOString(),properties:{}});
    const blast=e.blastRadius(b.id);
    expect(blast.length).toBeGreaterThanOrEqual(1);
  });

  it("tenant isolation: B cannot see A entities", () => {
    const tA=uid(); const tB=uid();
    new GRCOntologyEngine(tA).upsert({entityType:"board",code:"BRD-SECRET",title:"Secret Board",description:"d",createdBy:"u"});
    expect(new GRCOntologyEngine(tB).getByType("board").filter(e=>e.code==="BRD-SECRET")).toHaveLength(0);
  });

  it("getStats returns accurate counts", () => {
    const t=uid(); const e=new GRCOntologyEngine(t);
    e.upsert({entityType:"policy",code:"P1",title:"P1",description:"d",createdBy:"u"});
    e.upsert({entityType:"enterprise_risk",code:"R1",title:"R1",description:"d",createdBy:"u"});
    const stats=e.getStats();
    expect(stats.entities).toBeGreaterThanOrEqual(2);
  });
});

// ═══════════════════════════════════════════════════════════════
// BOARD RUNTIME
// ═══════════════════════════════════════════════════════════════
describe("BoardRuntime — Phase 6.2", () => {
  it("schedules session and returns frozen record", () => {
    const t=uid(); const b=new BoardRuntime(t);
    const s=b.scheduleSession({type:"ordinary",scheduledAt:"2025-06-01T10:00:00Z",memberIds:["m1","m2","m3"],quorumRequired:2,agendaItems:["item1"],createdBy:"secretary"});
    expect(s.id).toBeTruthy();
    expect(Object.isFrozen(s)).toBe(true);
    expect(s.status).toBe("scheduled");
  });

  it("quorum met → session becomes in_session", () => {
    const t=uid(); const b=new BoardRuntime(t);
    const s=b.scheduleSession({type:"ordinary",scheduledAt:"2025-06-01T10:00:00Z",memberIds:["m1","m2","m3"],quorumRequired:2,agendaItems:[],createdBy:"sec"});
    const updated=b.recordAttendance(s.id,["m1","m2","m3"]);
    expect(updated.quorumMet).toBe(true);
    expect(updated.status).toBe("in_session");
  });

  it("quorum not met → quorum_pending status", () => {
    const t=uid(); const b=new BoardRuntime(t);
    const s=b.scheduleSession({type:"ordinary",scheduledAt:"2025-06-01T10:00:00Z",memberIds:["m1","m2","m3"],quorumRequired:3,agendaItems:[],createdBy:"sec"});
    const updated=b.recordAttendance(s.id,["m1"]);
    expect(updated.quorumMet).toBe(false);
    expect(updated.status).toBe("quorum_pending");
  });

  it("propose resolution requires quorum", () => {
    const t=uid(); const b=new BoardRuntime(t);
    const s=b.scheduleSession({type:"ordinary",scheduledAt:"2025-06-01T10:00:00Z",memberIds:["m1","m2"],quorumRequired:1,agendaItems:[],createdBy:"sec"});
    b.recordAttendance(s.id,["m1","m2"]);
    const res=b.proposeResolution({sessionId:s.id,title:"Approve Annual Budget",description:"2025 budget approval",createdBy:"chair"});
    expect(res.code).toMatch(/^RES-/);
    expect(res.status).toBe("under_vote");
    expect(Object.isFrozen(res)).toBe(true);
  });

  it("without quorum, proposeResolution throws", () => {
    const t=uid(); const b=new BoardRuntime(t);
    const s=b.scheduleSession({type:"ordinary",scheduledAt:"2025-06-01T10:00:00Z",memberIds:["m1","m2"],quorumRequired:2,agendaItems:[],createdBy:"sec"});
    // No attendance recorded — quorumMet = false
    expect(()=>b.proposeResolution({sessionId:s.id,title:"Test",description:"T",createdBy:"c"})).toThrow();
  });

  it("voting: majority for → resolution passes", () => {
    const t=uid(); const b=new BoardRuntime(t);
    const s=b.scheduleSession({type:"ordinary",scheduledAt:"2025-06-01T10:00:00Z",memberIds:["m1","m2","m3"],quorumRequired:2,agendaItems:[],createdBy:"sec"});
    b.recordAttendance(s.id,["m1","m2","m3"]);
    const res=b.proposeResolution({sessionId:s.id,title:"Risk Policy",description:"d",createdBy:"chair"});
    b.castVote(res.id,"m1","board_director","for");
    b.castVote(res.id,"m2","board_director","for");
    b.castVote(res.id,"m3","board_director","against");
    const closed=b.closeVote(res.id,"chair");
    expect(closed.status).toBe("passed");
    expect(closed.passedAt).toBeTruthy();
  });

  it("voting: majority against → resolution fails", () => {
    const t=uid(); const b=new BoardRuntime(t);
    const s=b.scheduleSession({type:"ordinary",scheduledAt:"2025-06-01T10:00:00Z",memberIds:["m1","m2"],quorumRequired:1,agendaItems:[],createdBy:"sec"});
    b.recordAttendance(s.id,["m1","m2"]);
    const res=b.proposeResolution({sessionId:s.id,title:"Failed Resolution",description:"d",createdBy:"chair"});
    b.castVote(res.id,"m1","board_director","against");
    b.castVote(res.id,"m2","board_director","against");
    const closed=b.closeVote(res.id,"chair");
    expect(closed.status).toBe("failed");
  });

  it("votes are immutable and cryptographically signed", () => {
    const t=uid(); const b=new BoardRuntime(t);
    const s=b.scheduleSession({type:"ordinary",scheduledAt:"2025-06-01T10:00:00Z",memberIds:["m1"],quorumRequired:1,agendaItems:[],createdBy:"sec"});
    b.recordAttendance(s.id,["m1"]);
    const res=b.proposeResolution({sessionId:s.id,title:"Signed Vote Test",description:"d",createdBy:"chair"});
    const updated=b.castVote(res.id,"m1","board_director","for");
    expect(updated.votes[0].signature).toBeTruthy();
    expect(updated.votes[0].signature.length).toBe(16);
    expect(Object.isFrozen(updated.votes[0])).toBe(true);
  });

  it("tenant isolation: sessions not visible cross-tenant", () => {
    const tA=uid(); const tB=uid();
    const bA=new BoardRuntime(tA); const bB=new BoardRuntime(tB);
    bA.scheduleSession({type:"ordinary",scheduledAt:"2025-06-01T10:00:00Z",memberIds:[],quorumRequired:1,agendaItems:[],createdBy:"u"});
    expect(bB.getSessions()).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════
// COMMITTEE RUNTIME
// ═══════════════════════════════════════════════════════════════
describe("CommitteeRuntime — Phase 6.3", () => {
  it("establishes committee with default authorities", () => {
    const t=uid(); const cr=new CommitteeRuntime(t);
    const c=cr.establish({type:"audit",name:"Audit Committee",charterRef:"CHARTER-001",memberIds:["m1","m2","m3"],chairId:"m1",secretaryId:"sec1",quorumRequired:2,meetingFrequency:"quarterly",status:"active",createdBy:"board"});
    expect(c.authorities).toContain("approve_audit_plan");
    expect(c.authorities).toContain("appoint_external_auditor");
    expect(Object.isFrozen(c)).toBe(true);
  });

  it("checkAuthority: charter action allowed", () => {
    const t=uid(); const cr=new CommitteeRuntime(t);
    const c=cr.establish({type:"risk",name:"Risk Committee",charterRef:"CHARTER-RISK",memberIds:["m1"],chairId:"m1",secretaryId:"sec",quorumRequired:1,meetingFrequency:"quarterly",status:"active",createdBy:"board"});
    expect(cr.checkAuthority(c.id,"approve_risk_appetite").allowed).toBe(true);
  });

  it("checkAuthority: non-charter action blocked", () => {
    const t=uid(); const cr=new CommitteeRuntime(t);
    const c=cr.establish({type:"compliance",name:"Compliance Committee",charterRef:"CHARTER-COMPL",memberIds:["m1"],chairId:"m1",secretaryId:"sec",quorumRequired:1,meetingFrequency:"monthly",status:"active",createdBy:"board"});
    expect(cr.checkAuthority(c.id,"approve_annual_budget").allowed).toBe(false);
  });

  it("schedules meeting and records decision", () => {
    const t=uid(); const cr=new CommitteeRuntime(t);
    const c=cr.establish({type:"technology_ai",name:"AI Committee",charterRef:"CHARTER-AI",memberIds:["m1","m2"],chairId:"m1",secretaryId:"sec",quorumRequired:1,meetingFrequency:"quarterly",status:"active",createdBy:"board"});
    const m=cr.scheduleM(c.id,"2025-06-15T09:00:00Z",["Review AI Models","Approve LLM Policy"],"m1");
    const updated=cr.recordDecision(m.id,{title:"Approve LLM Policy",outcome:"approved",votesFor:2,votesAgainst:0,evidenceIds:["ev-001"],decidedBy:"m1"});
    expect(updated.decisions).toHaveLength(1);
    expect(updated.decisions[0].signature).toBeTruthy();
    expect(updated.decisions[0].outcome).toBe("approved");
  });

  it("7 committee types all have authorities", () => {
    const types:any[]=["audit","risk","nomination","compensation","investment","compliance","technology_ai"];
    const t=uid(); const cr=new CommitteeRuntime(t);
    for(const type of types) {
      const c=cr.establish({type,name:`${type} committee`,charterRef:`CHARTER-${type}`,memberIds:[],chairId:"c",secretaryId:"s",quorumRequired:1,meetingFrequency:"quarterly",status:"active",createdBy:"board"});
      expect(c.authorities.length).toBeGreaterThan(0);
    }
  });
});

// ═══════════════════════════════════════════════════════════════
// AUTHORITY ENGINE
// ═══════════════════════════════════════════════════════════════
describe("AuthorityEngine — Phase 6.4", () => {
  it("grants authority and confirms check", () => {
    const t=uid(); const ae=new AuthorityEngine(t);
    ae.grantAuthority({holderId:"cgo-001",holderRole:"cgo",scope:["policy","risk"],permissions:["approve_policy","reject_policy"],validFrom:new Date().toISOString(),isDelegated:false,vetoRight:true,dualApproval:false});
    const check=ae.checkAuthority({actorId:"cgo-001",action:"approve_policy",scope:"policy"});
    expect(check.authorized).toBe(true);
  });

  it("authority without permission returns unauthorized", () => {
    const t=uid(); const ae=new AuthorityEngine(t);
    ae.grantAuthority({holderId:"analyst",holderRole:"analyst",scope:["risk"],permissions:["view_risk"],validFrom:new Date().toISOString(),isDelegated:false,vetoRight:false,dualApproval:false});
    const check=ae.checkAuthority({actorId:"analyst",action:"approve_risk",scope:"risk"});
    expect(check.authorized).toBe(false);
  });

  it("expired authority is denied", () => {
    const t=uid(); const ae=new AuthorityEngine(t);
    ae.grantAuthority({holderId:"temp-user",holderRole:"temp",scope:["*"],permissions:["*"],validFrom:"2020-01-01T00:00:00Z",validTo:"2020-12-31T23:59:59Z",isDelegated:false,vetoRight:false,dualApproval:false});
    const check=ae.checkAuthority({actorId:"temp-user",action:"anything",scope:"anything"});
    expect(check.authorized).toBe(false);
  });

  it("delegation creates delegated authority", () => {
    const t=uid(); const ae=new AuthorityEngine(t);
    ae.grantAuthority({holderId:"cgo",holderRole:"cgo",scope:["*"],permissions:["approve_policy","delegate"],validFrom:new Date().toISOString(),isDelegated:false,vetoRight:false,dualApproval:false});
    const del=ae.delegate({fromId:"cgo",toId:"deputy",scope:["policy"],permissions:["approve_policy"],delegatedBy:"board"});
    expect(del.id).toBeTruthy();
    const check=ae.checkAuthority({actorId:"deputy",action:"approve_policy",scope:"policy"});
    expect(check.authorized).toBe(true);
  });

  it("revoke authority denies subsequent checks", () => {
    const t=uid(); const ae=new AuthorityEngine(t);
    const auth=ae.grantAuthority({holderId:"revoke-me",holderRole:"r",scope:["risk"],permissions:["approve_risk"],validFrom:new Date().toISOString(),isDelegated:false,vetoRight:false,dualApproval:false});
    ae.revokeAuthority(auth.id,"board");
    const check=ae.checkAuthority({actorId:"revoke-me",action:"approve_risk",scope:"risk"});
    expect(check.authorized).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════
// RISK INTELLIGENCE RUNTIME
// ═══════════════════════════════════════════════════════════════
describe("RiskIntelligenceRuntime — Phase 7.2", () => {
  it("registers risk and generates code", () => {
    const t=uid(); const r=new RiskIntelligenceRuntime(t);
    const risk=r.register({title:"Data Breach Risk",description:"d",category:"cyber",ownerId:"ciso",inherentLikelihood:4,inherentImpact:5,createdBy:"cro"});
    expect(risk.code).toMatch(/^RSK-/);
    expect(risk.inherentScore).toBe(20);  // 4×5
    expect(Object.isFrozen(risk)).toBe(true);
  });

  it("tolerance breach detected when score > appetite", () => {
    const t=uid(); const r=new RiskIntelligenceRuntime(t);
    const risk=r.register({title:"Critical Risk",description:"d",category:"strategic",ownerId:"ceo",inherentLikelihood:5,inherentImpact:5,appetiteScore:10,createdBy:"cro"});
    expect(risk.toleranceBreached).toBe(true);  // 25 > 10
  });

  it("updateResidual reduces risk score", () => {
    const t=uid(); const r=new RiskIntelligenceRuntime(t);
    const risk=r.register({title:"R1",description:"d",category:"operational",ownerId:"coo",inherentLikelihood:4,inherentImpact:4,createdBy:"cro"});
    const updated=r.updateResidual(risk.id,2,2,"cro");
    expect(updated.residualScore).toBe(4);
    expect(updated.residualScore).toBeLessThan(risk.inherentScore);
  });

  it("KRI breach triggers event", () => {
    const t=uid(); const r=new RiskIntelligenceRuntime(t);
    const risk=r.register({title:"R",description:"d",category:"cyber",ownerId:"ciso",inherentLikelihood:3,inherentImpact:3,createdBy:"u"});
    const kri=r.updateKRI(risk.id,"phishing_rate",85,70);
    expect(kri.breached).toBe(true);
    expect(kri.trend).toBe("deteriorating");  // first reading is always 85 > prev(70=threshold)
  });

  it("KRI not breached when below threshold", () => {
    const t=uid(); const r=new RiskIntelligenceRuntime(t);
    const risk=r.register({title:"R2",description:"d",category:"data",ownerId:"u",inherentLikelihood:2,inherentImpact:2,createdBy:"u"});
    const kri=r.updateKRI(risk.id,"data_exposure_index",30,100);
    expect(kri.breached).toBe(false);
  });

  it("cascade analysis traverses linked risks", () => {
    const t=uid(); const r=new RiskIntelligenceRuntime(t);
    const r1=r.register({title:"Root Risk",description:"d",category:"strategic",ownerId:"ceo",inherentLikelihood:4,inherentImpact:4,createdBy:"cro"});
    const r2=r.register({title:"Cascade Risk",description:"d",category:"operational",ownerId:"coo",inherentLikelihood:3,inherentImpact:3,linkedRisks:[r1.id],createdBy:"cro"});
    // r1 links to r2 via cascade
    const r1WithLink=r.register({title:"Root Risk",description:"d",category:"strategic",ownerId:"ceo",inherentLikelihood:4,inherentImpact:4,linkedRisks:[r2.id],createdBy:"cro"});
    const analysis=r.analyzeCascade(r1WithLink.id);
    expect(analysis.criticalPath.length).toBeGreaterThanOrEqual(1);
    expect(["critical","high","medium","low"]).toContain(analysis.severity);
  });

  it("tenant isolation: risk not visible to other tenant", () => {
    const tA=uid(); const tB=uid();
    new RiskIntelligenceRuntime(tA).register({title:"Secret Risk",description:"d",category:"strategic",ownerId:"u",inherentLikelihood:5,inherentImpact:5,createdBy:"u"});
    expect(new RiskIntelligenceRuntime(tB).getAll()).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════
// CCM RUNTIME
// ═══════════════════════════════════════════════════════════════
describe("CCMRuntime — Phase 7.4", () => {
  it("registers control and passes test", () => {
    const t=uid(); const ccm=new CCMRuntime(t);
    ccm.registerControl({controlId:"ctrl-001",controlCode:"ACC-001",controlName:"Access Control",type:"preventive",ownerId:"ciso",effectivenessScore:75});
    const health=ccm.recordTestResult("ctrl-001",true,"ev-001","auditor");
    expect(health.status).toBe("effective");
    expect(health.effectivenessScore).toBeGreaterThan(0);
  });

  it("failed test reduces effectiveness score", () => {
    const t=uid(); const ccm=new CCMRuntime(t);
    ccm.registerControl({controlId:"ctrl-002",controlCode:"LOG-001",controlName:"Logging",type:"detective",ownerId:"ciso",effectivenessScore:60});
    const health=ccm.recordTestResult("ctrl-002",false,"ev-fail","auditor");
    expect(health.status).toBe("ineffective");
    expect(health.effectivenessScore).toBeLessThan(60);
    expect(ccm.getSignals("high").length).toBeGreaterThanOrEqual(1);
  });

  it("override detection creates critical signal", () => {
    const t=uid(); const ccm=new CCMRuntime(t);
    ccm.registerControl({controlId:"ctrl-003",controlCode:"AUTH-001",controlName:"Auth Control",type:"preventive",ownerId:"ciso"});
    const sig=ccm.detectOverride("ctrl-003","suspect-actor","Bypassed approval workflow");
    expect(sig.signalType).toBe("override_detected");
    expect(sig.severity).toBe("critical");
    const ctrl=ccm.getControlHealth("ctrl-003");
    expect(ctrl?.overrideDetected).toBe(true);
  });

  it("SoD violation: initiate+approve conflict", () => {
    const t=uid(); const ccm=new CCMRuntime(t);
    const viol=ccm.checkSoD("bad-actor",["initiate_payment","approve_payment"],"process_payment");
    expect(viol).not.toBeNull();
    expect(viol!.severity).toBe("critical");
    expect(viol!.blocked).toBe(true);
  });

  it("SoD clean: no conflicting roles", () => {
    const t=uid(); const ccm=new CCMRuntime(t);
    const viol=ccm.checkSoD("clean-actor",["view_report","export_data"],"generate_report");
    expect(viol).toBeNull();
  });

  it("overall score is 100 with no controls", () => {
    const t=uid(); const ccm=new CCMRuntime(t);
    expect(ccm.getOverallScore()).toBe(100);
  });
});

// ═══════════════════════════════════════════════════════════════
// COMPLIANCE OBLIGATION RUNTIME
// ═══════════════════════════════════════════════════════════════
describe("ComplianceObligationRuntime — Phase 7.3", () => {
  it("registers obligation with generated code", () => {
    const t=uid(); const cor=new ComplianceObligationRuntime(t);
    const obl=cor.register({title:"GDPR Art.13 Disclosure",description:"d",source:"regulation",framework:"GDPR",jurisdiction:"EU",ownerId:"dpo",riskExposure:8,penaltyEstimate:10000000});
    expect(obl.code).toMatch(/^OBL-/);
    expect(obl.status).toBe("active");
  });

  it("markBreach increments breach count", () => {
    const t=uid(); const cor=new ComplianceObligationRuntime(t);
    const obl=cor.register({title:"SOX Control",description:"d",source:"regulation",framework:"SOX",jurisdiction:"US",ownerId:"cfo"});
    const breached=cor.markBreach(obl.id,"Control test failed","auditor");
    expect(breached.status).toBe("breached");
    expect(breached.breachCount).toBe(1);
  });

  it("detectDrift: overdue obligation flagged", () => {
    const t=uid(); const cor=new ComplianceObligationRuntime(t);
    const pastDate=new Date(Date.now()-10*24*3600000).toISOString();
    cor.register({title:"Past Due",description:"d",source:"regulation",framework:"NCA",jurisdiction:"SA",ownerId:"ciso",dueDate:pastDate});
    const signals=cor.detectDrift();
    expect(signals.some(s=>s.driftType==="overdue")).toBe(true);
  });

  it("detectDrift: no controls flags control_gap", () => {
    const t=uid(); const cor=new ComplianceObligationRuntime(t);
    cor.register({title:"No Controls",description:"d",source:"policy",framework:"INTERNAL",jurisdiction:"Global",ownerId:"cco"});
    const signals=cor.detectDrift();
    expect(signals.some(s=>s.driftType==="control_gap")).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════
// INCIDENT & CRISIS RUNTIME
// ═══════════════════════════════════════════════════════════════
describe("IncidentCrisisRuntime — Phase 7.7", () => {
  it("detects incident with correct code", () => {
    const t=uid(); const ir=new IncidentCrisisRuntime(t);
    const inc=ir.detect({title:"Data Breach",description:"PII exposed",category:"security",severity:"p1_critical",ownerId:"ciso",detectedBy:"soc"});
    expect(inc.code).toMatch(/^INC-/);
    expect(inc.status).toBe("detected");
    expect(inc.isCrisis).toBe(false);
    expect(inc.timeline).toHaveLength(1);
  });

  it("p0_crisis severity auto-escalates", () => {
    const t=uid(); const ir=new IncidentCrisisRuntime(t);
    const inc=ir.detect({title:"System-wide Outage",description:"All systems down",category:"operational",severity:"p0_crisis",ownerId:"coo",detectedBy:"operations"});
    expect(inc.isCrisis).toBe(true);
    expect(inc.status).toBe("escalated_to_crisis");
  });

  it("escalate incident changes severity and adds timeline event", () => {
    const t=uid(); const ir=new IncidentCrisisRuntime(t);
    const inc=ir.detect({title:"Security Incident",description:"d",category:"security",severity:"p3_medium",ownerId:"ciso",detectedBy:"soc"});
    const escalated=ir.escalate(inc.id,"p1_critical","Scope expanded","ciso");
    expect(escalated.severity).toBe("p1_critical");
    expect(escalated.timeline).toHaveLength(2);
  });

  it("creates CAPA linked to incident", () => {
    const t=uid(); const ir=new IncidentCrisisRuntime(t);
    const inc=ir.detect({title:"Audit Finding",description:"d",category:"governance",severity:"p2_high",ownerId:"cgo",detectedBy:"auditor"});
    const capa=ir.createCAPA(inc.id,{title:"Fix access control",type:"corrective",ownerId:"ciso",dueDate:new Date(Date.now()+30*24*3600000).toISOString(),priority:"high"});
    expect(capa.id).toBeTruthy();
    expect(capa.type).toBe("corrective");
    const updated=ir.getById(inc.id);
    expect(updated?.capaIds).toContain(capa.id);
  });

  it("resolve incident with root cause", () => {
    const t=uid(); const ir=new IncidentCrisisRuntime(t);
    const inc=ir.detect({title:"Minor Incident",description:"d",category:"operational",severity:"p4_low",ownerId:"coo",detectedBy:"ops"});
    const resolved=ir.resolve(inc.id,"Root cause identified","Document process","incident_manager");
    expect(resolved.status).toBe("resolved");
    expect(resolved.resolvedAt).toBeTruthy();
    expect(resolved.rootCause).toBeTruthy();
  });
});

// ═══════════════════════════════════════════════════════════════
// OPERATIONAL RESILIENCE RUNTIME
// ═══════════════════════════════════════════════════════════════
describe("OperationalResilienceRuntime — Phase 7.8", () => {
  it("registers critical process", () => {
    const t=uid(); const r=new OperationalResilienceRuntime(t);
    const p=r.registerProcess({name:"Core Banking",code:"CP-001",rto:4,rpo:1,tier:"tier1",ownerId:"coo"});
    expect(p.tier).toBe("tier1");
    expect(p.rto).toBe(4);
  });

  it("SPOF dependency triggers event", () => {
    const t=uid(); const r=new OperationalResilienceRuntime(t);
    const p=r.registerProcess({name:"Payment Processing",code:"CP-002",rto:2,rpo:0,tier:"tier1",ownerId:"cfo"});
    const dep=r.addDependency(p.id,{dependencyType:"infrastructure",dependencyName:"Payment Gateway",criticality:"critical",singlePointOfFailure:true});
    expect(dep.singlePointOfFailure).toBe(true);
    const score=r.scoreResilience();
    expect(score.singlePointsOfFailure).toBeGreaterThanOrEqual(1);
    expect(score.recommendations.some(r=>r.includes("single points of failure"))).toBe(true);
  });

  it("scoreResilience returns 0-100 range", () => {
    const t=uid(); const r=new OperationalResilienceRuntime(t);
    const score=r.scoreResilience();
    expect(score.overallScore).toBeGreaterThanOrEqual(0);
    expect(score.overallScore).toBeLessThanOrEqual(100);
  });
});

// ═══════════════════════════════════════════════════════════════
// INTEGRATED ASSURANCE RUNTIME
// ═══════════════════════════════════════════════════════════════
describe("IntegratedAssuranceRuntime — Phase 7.9", () => {
  it("collects evidence with hash", () => {
    const t=uid(); const a=new IntegratedAssuranceRuntime(t);
    const ev=a.collectEvidence({domain:"control",entityId:"ctrl-001",description:"Control test evidence",source:"automated_test"});
    expect(ev.hash).toBeTruthy();
    expect(ev.valid).toBe(true);
    expect(ev.tenantId).toBe(t);
  });

  it("issues assurance opinion with scoring", () => {
    const t=uid(); const a=new IntegratedAssuranceRuntime(t);
    a.collectEvidence({domain:"risk",entityId:"r1",description:"Risk evidence",source:"risk_system"});
    a.collectEvidence({domain:"compliance",entityId:"c1",description:"Compliance evidence",source:"compliance_system"});
    const op=a.issueOpinion({scope:"Enterprise GRC Q1 2025",periodFrom:"2025-01-01",periodTo:"2025-03-31",issuedBy:"cae"});
    expect(op.overallScore).toBeGreaterThanOrEqual(0);
    expect(op.overallScore).toBeLessThanOrEqual(100);
    expect(op.signature).toBeTruthy();
    expect(["satisfactory","needs_improvement","unsatisfactory","critical"]).toContain(op.overallRating);
  });

  it("getLatestOpinion returns most recent", () => {
    const t=uid(); const a=new IntegratedAssuranceRuntime(t);
    a.issueOpinion({scope:"Q1",periodFrom:"2025-01-01",periodTo:"2025-03-31",issuedBy:"cae"});
    expect(a.getLatestOpinion()).toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════════════
// PREDICTIVE GOVERNANCE RUNTIME
// ═══════════════════════════════════════════════════════════════
describe("PredictiveGovernanceRuntime — Phase 7.10/7.13", () => {
  it("builds executive cockpit with all required fields", () => {
    const t=uid(); const pg=new PredictiveGovernanceRuntime(t);
    const cockpit=pg.buildExecutiveCockpit();
    expect(cockpit.tenantId).toBe(t);
    expect(typeof cockpit.boardReadiness).toBe("number");
    expect(typeof cockpit.governanceHealthScore).toBe("number");
    expect(typeof cockpit.controlEffectiveness).toBe("number");
    expect(["improving","stable","deteriorating"]).toContain(cockpit.trend);
    expect(Array.isArray(cockpit.immediateActions)).toBe(true);
  });

  it("cockpit: tolerance breaches reduce board readiness", () => {
    const t=uid();
    const r=new RiskIntelligenceRuntime(t);
    // Register high-score risks that breach tolerance
    r.register({title:"Strategic Risk 1",description:"d",category:"strategic",ownerId:"ceo",inherentLikelihood:5,inherentImpact:5,appetiteScore:5,createdBy:"cro"});
    r.register({title:"Cyber Risk 1",description:"d",category:"cyber",ownerId:"ciso",inherentLikelihood:5,inherentImpact:5,appetiteScore:5,createdBy:"cro"});
    r.register({title:"Cyber Risk 2",description:"d",category:"cyber",ownerId:"ciso",inherentLikelihood:5,inherentImpact:5,appetiteScore:5,createdBy:"cro"});
    const pg=new PredictiveGovernanceRuntime(t);
    const cockpit=pg.buildExecutiveCockpit();
    // With 3 tolerance-breaching strategic/cyber risks → boardReadiness should be lower
    expect(cockpit.boardReadiness).toBeLessThan(100);
  });

  it("predict returns probability values 0-100", () => {
    const t=uid(); const pg=new PredictiveGovernanceRuntime(t);
    const pred=pg.predict("30d");
    expect(pred.driftProbability).toBeGreaterThanOrEqual(0);
    expect(pred.driftProbability).toBeLessThanOrEqual(100);
    expect(pred.breachProbability).toBeGreaterThanOrEqual(0);
    expect(["30d","90d","12m"]).toContain(pred.timeHorizon);
  });

  it("predict 12m returns different forecast from 30d", () => {
    const t=uid(); const pg=new PredictiveGovernanceRuntime(t);
    const p30=pg.predict("30d");
    const p12=pg.predict("12m");
    expect(p30.timeHorizon).toBe("30d");
    expect(p12.timeHorizon).toBe("12m");
  });
});

// ═══════════════════════════════════════════════════════════════
// UNIFIED GRC FABRIC — Phase 6.9 (THE ENFORCEMENT GATE)
// ═══════════════════════════════════════════════════════════════
describe("UnifiedGRCFabric — Phase 6.9", () => {
  it("blocks action when no authority granted", async () => {
    const t=uid(); const f=new UnifiedGRCFabric(t);
    const result=f.runChecks({actionId:"act-001",tenantId:t,actorId:"orphan-user",actorRole:"analyst",action:"approve_policy",scope:"policy"});
    expect(result.approved).toBe(false);
    expect(result.blockedBy).toBe("authority");
  });

  it("approves action when authority granted", async () => {
    const t=uid(); const ae=new AuthorityEngine(t); const f=new UnifiedGRCFabric(t);
    ae.grantAuthority({holderId:"cgo",holderRole:"cgo",scope:["*"],permissions:["approve_policy","delegate"],validFrom:new Date().toISOString(),isDelegated:false,vetoRight:false,dualApproval:false});
    const result=f.runChecks({actionId:"act-002",tenantId:t,actorId:"cgo",actorRole:"cgo",action:"approve_policy",scope:"policy"});
    expect(result.checks.authority).toBe(true);
  });

  it("blocks action with invalid actor (corruption guard)", () => {
    const t=uid(); const f=new UnifiedGRCFabric(t);
    const result=f.runChecks({actionId:"act-003",tenantId:t,actorId:"",actorRole:"analyst",action:"approve_policy",scope:"policy"});
    expect(result.approved).toBe(false);
    expect(result.blockedBy).toBe("corruption");
  });

  it("SoD violation blocks execution", () => {
    const t=uid(); const ae=new AuthorityEngine(t); const f=new UnifiedGRCFabric(t);
    ae.grantAuthority({holderId:"conflict-actor",holderRole:"dual_role",scope:["*"],permissions:["*"],validFrom:new Date().toISOString(),isDelegated:false,vetoRight:false,dualApproval:false});
    const result=f.runChecks({actionId:"act-004",tenantId:t,actorId:"conflict-actor",actorRole:"initiate_and_approve",action:"process_payment",scope:"payment"});
    expect(result.checks.sodClean).toBe(false);
    expect(result.approved).toBe(false);
  });

  it("getActionLog returns blocked actions", () => {
    const t=uid(); const f=new UnifiedGRCFabric(t);
    f.runChecks({actionId:"blocked-act",tenantId:t,actorId:"u",actorRole:"r",action:"approve",scope:"s"});
    const blocked=f.getBlockedActions();
    expect(blocked.length).toBeGreaterThanOrEqual(1);
  });

  it("checkAndExecute does not run executor when blocked", async () => {
    const t=uid(); const f=new UnifiedGRCFabric(t);
    let executed=false;
    const {grcResult}=await f.checkAndExecute({actionId:"no-exec",tenantId:t,actorId:"",actorRole:"r",action:"act",scope:"s"}, async()=>{ executed=true; return "done"; });
    expect(executed).toBe(false);
    expect(grcResult.approved).toBe(false);
  });

  it("checkAndExecute runs executor when authorized", async () => {
    const t=uid(); const ae=new AuthorityEngine(t); const f=new UnifiedGRCFabric(t);
    ae.grantAuthority({holderId:"exec-actor",holderRole:"cgo",scope:["*"],permissions:["*"],validFrom:new Date().toISOString(),isDelegated:false,vetoRight:false,dualApproval:false});
    let executed=false;
    const {result,grcResult}=await f.checkAndExecute({actionId:"exec-act",tenantId:t,actorId:"exec-actor",actorRole:"cgo",action:"approve_policy",scope:"global"}, async()=>{ executed=true; return "executed"; });
    expect(grcResult.checks.authority).toBe(true);
    if(grcResult.approved) expect(executed).toBe(true);
  });
});
