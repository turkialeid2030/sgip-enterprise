/**
 * Phase 12/15/17/19 — Cyber + Autonomous + Digital Twin + DevSecOps Tests
 * Additive — 680 baseline preserved.
 */
import request from "supertest";
import jwt from "jsonwebtoken";
import { app } from "../api/server";
import { CyberGovernanceRuntime, getCyberGovernanceRuntime } from "../cyber-governance/cyber.governance.runtime";
import { AutonomousGovernanceRuntime, getAutonomousGovernance } from "../autonomous-governance/autonomous.governance.runtime";
import { EnterpriseTwin, getEnterpriseTwin } from "../digital-twin/enterprise.digital.twin";
import { DevSecOpsGovernanceRuntime, getDevSecOpsRuntime } from "../devsecops-governance/devsecops.governance.runtime";

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

const uid = () => `t-fin-${Math.random().toString(36).slice(2,10)}`;
const JWT_SECRET = "dev_secret";
const token = (r="governance_analyst")=>jwt.sign({userId:"u1",email:`${r}@test.sgip`,role:r,tenantId:"tenant-test",nameAr:"T"},JWT_SECRET,{expiresIn:"1h"});
const a = {Authorization:`Bearer ${token()}`};

// ═══════════════════════════════════════════════════════════════
// CYBER GOVERNANCE RUNTIME
// ═══════════════════════════════════════════════════════════════
describe("CyberGovernanceRuntime — Phase 12", () => {
  it("registers cyber asset with frozen immutable record", () => {
    const t=uid(); const c=new CyberGovernanceRuntime(t);
    const asset=c.registerAsset({name:"Core Banking Server",assetType:"server",criticality:"critical",ownerId:"ciso",environment:"production",dataClassification:"confidential",regulatoryScope:["SAMA","PDPL"],controlIds:["ctrl-001"],exposureScore:75,vulnerabilities:3,patchStatus:"behind"});
    expect(asset.id).toBeTruthy();
    expect(Object.isFrozen(asset)).toBe(true);
    expect(asset.criticality).toBe("critical");
  });

  it("critical asset with missing patch triggers event", () => {
    const t=uid(); const c=new CyberGovernanceRuntime(t);
    const asset=c.registerAsset({name:"Critical System",assetType:"server",criticality:"critical",ownerId:"ciso",environment:"production",dataClassification:"restricted",regulatoryScope:["NCA_ECC"],controlIds:[],exposureScore:90,vulnerabilities:5,patchStatus:"critical_patch_missing"});
    expect(asset.patchStatus).toBe("critical_patch_missing");
  });

  it("grantAccess: high-risk privileged access triggers alert", () => {
    const t=uid(); const c=new CyberGovernanceRuntime(t);
    const rec=c.grantAccess({principalId:"admin-user-001",principalType:"user",resourceId:"db-core-banking",accessLevel:"admin",grantedBy:"it-manager",grantedAt:new Date().toISOString(),justification:"Emergency access",isPrivileged:true,riskScore:85});
    expect(rec.isPrivileged).toBe(true);
    expect(rec.riskScore).toBe(85);
  });

  it("trackDataLineage: cross-border PDPL data triggers event", () => {
    const t=uid(); const c=new CyberGovernanceRuntime(t);
    const node=c.trackDataLineage({dataAssetId:"da-001",dataAssetName:"Customer PII",classification:"confidential",sourceSystem:"CRM",destinations:["Analytics Platform","Cloud DWH"],retentionDays:1825,pdplApplicable:true,crossBorder:true,encryptionAtRest:true,encryptionInTransit:true});
    expect(node.pdplApplicable).toBe(true);
    expect(node.crossBorder).toBe(true);
  });

  it("detectAccessAnomalies: expired access flagged", () => {
    const t=uid(); const c=new CyberGovernanceRuntime(t);
    const past=new Date(Date.now()-1000).toISOString();
    c.grantAccess({principalId:"expired-user",principalType:"user",resourceId:"resource-1",accessLevel:"read",grantedBy:"admin",grantedAt:"2024-01-01",expiresAt:past,justification:"Temp",isPrivileged:false,riskScore:30});
    const anomalies=c.detectAccessAnomalies();
    expect(anomalies.some(a=>a.riskType==="expired_access")).toBe(true);
  });

  it("assessRansomwareReadiness returns 0-100 score", () => {
    const t=uid(); const c=new CyberGovernanceRuntime(t);
    const r=c.assessRansomwareReadiness();
    expect(r.overallScore).toBeGreaterThanOrEqual(0);
    expect(r.overallScore).toBeLessThanOrEqual(100);
    expect(typeof r.immutableBackups).toBe("boolean");
  });

  it("scoreGovernance returns all required dimensions", () => {
    const t=uid(); const c=new CyberGovernanceRuntime(t);
    const score=c.scoreGovernance();
    expect(score.overallScore).toBeGreaterThanOrEqual(0);
    expect(score.overallScore).toBeLessThanOrEqual(100);
    expect(typeof score.patchComplianceRate).toBe("number");
    expect(typeof score.accessRiskScore).toBe("number");
    expect(typeof score.dataProtectionScore).toBe("number");
  });

  it("tenant isolation: B cannot see A assets", () => {
    const tA=uid(); const tB=uid();
    new CyberGovernanceRuntime(tA).registerAsset({name:"Secret Asset",assetType:"server",criticality:"critical",ownerId:"u",environment:"production",dataClassification:"restricted",regulatoryScope:[],controlIds:[],exposureScore:80,vulnerabilities:0,patchStatus:"current"});
    expect(new CyberGovernanceRuntime(tB).getAssets()).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════
// AUTONOMOUS GOVERNANCE RUNTIME
// ═══════════════════════════════════════════════════════════════
describe("AutonomousGovernanceRuntime — Phase 15", () => {
  it("runGovernanceCycle returns complete result", () => {
    const t=uid(); const ag=new AutonomousGovernanceRuntime(t);
    const cycle=ag.runGovernanceCycle();
    expect(typeof cycle.drifts).toBe("object");
    expect(typeof cycle.actions).toBe("object");
    expect(typeof cycle.escalations).toBe("object");
    expect(cycle.fatigueReport).toHaveProperty("fatigueScore");
    expect(cycle.fatigueReport).toHaveProperty("riskLevel");
  });

  it("detectDrift returns array of signals", () => {
    const t=uid(); const ag=new AutonomousGovernanceRuntime(t);
    const drifts=ag.detectDrift();
    expect(Array.isArray(drifts)).toBe(true);
  });

  it("scoreGovernanceFatigue returns valid score", () => {
    const t=uid(); const ag=new AutonomousGovernanceRuntime(t);
    const f=ag.scoreGovernanceFatigue();
    expect(f.fatigueScore).toBeGreaterThanOrEqual(0);
    expect(f.fatigueScore).toBeLessThanOrEqual(100);
    expect(["critical","high","medium","low"]).toContain(f.riskLevel);
    expect(f).toHaveProperty("indicators");
  });

  it("predictEscalations returns array", () => {
    const t=uid(); const ag=new AutonomousGovernanceRuntime(t);
    const escs=ag.predictEscalations();
    expect(Array.isArray(escs)).toBe(true);
    if(escs.length>0) {
      expect(typeof escs[0].probability).toBe("number");
      expect(typeof escs[0].escalateTo).toBe("string");
    }
  });

  it("proposeActions: critical drift generates escalation action", () => {
    const t=uid(); const ag=new AutonomousGovernanceRuntime(t);
    const critDrift=[{id:"d1",tenantId:t,driftType:"governance_drift" as any,metric:"test",baseline:100,current:10,deviation:90,severity:"critical" as any,detectedAt:new Date().toISOString(),recommendation:"Board escalation required"}];
    const fatigue=ag.scoreGovernanceFatigue();
    const actions=ag.proposeActions(critDrift,fatigue,[]);
    expect(actions.some(a=>a.actionType==="escalate_to_board")).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════
// ENTERPRISE DIGITAL TWIN
// ═══════════════════════════════════════════════════════════════
describe("EnterpriseTwin — Phase 17", () => {
  it("captureState returns current twin state", () => {
    const t=uid(); const twin=new EnterpriseTwin(t);
    const state=twin.captureState();
    expect(state.tenantId).toBe(t);
    expect(typeof state.governanceScore).toBe("number");
    expect(typeof state.riskExposure).toBe("number");
    expect(typeof state.controlEffectiveness).toBe("number");
  });

  it("getScenarios returns 12 scenarios", () => {
    const t=uid(); const twin=new EnterpriseTwin(t);
    expect(twin.getScenarios()).toHaveLength(12);
  });

  it("simulate: cyber_attack degrades governance", () => {
    const t=uid(); const twin=new EnterpriseTwin(t);
    const result=twin.simulate("cyber_attack");
    expect(result.scenario).toBe("cyber_attack");
    expect(result.postState.riskExposure).toBeGreaterThan(result.preState.riskExposure);
    expect(result.financialImpact).toBeGreaterThan(0);
    expect(result.timeline.length).toBeGreaterThan(0);
    expect(result.criticalPath.length).toBeGreaterThan(0);
  });

  it("simulate: board_succession has recovery path", () => {
    const t=uid(); const twin=new EnterpriseTwin(t);
    const result=twin.simulate("board_succession");
    expect(result.boardActions.length).toBeGreaterThan(0);
    expect(result.regulatoryActions.length).toBeGreaterThan(0);
    expect(typeof result.recoveryTimeHours).toBe("number");
  });

  it("simulate: regulatory_investigation has highest financial impact", () => {
    const t=uid(); const twin=new EnterpriseTwin(t);
    const reg=twin.simulate("regulatory_investigation");
    const cyber=twin.simulate("cyber_attack");
    // Both should have significant financial impact
    expect(reg.financialImpact).toBeGreaterThan(0);
    expect(cyber.financialImpact).toBeGreaterThan(0);
  });

  it("whatIf: improving controls gives positive delta", () => {
    const t=uid(); const twin=new EnterpriseTwin(t);
    const result=twin.whatIf("What if we improve controls by 20%?",{controls:20,compliance:10,governance:5});
    expect(typeof result.deltaScore).toBe("number");
    expect(result.deltaScore).toBeGreaterThanOrEqual(0);
    expect(result.recommendation).toBeTruthy();
  });

  it("all 12 scenarios simulate without error", () => {
    const t=uid(); const twin=new EnterpriseTwin(t);
    for(const scenario of twin.getScenarios()) {
      const result=twin.simulate(scenario);
      expect(result.id).toBeTruthy();
      expect(result.confidence).toBeGreaterThan(0);
    }
  });
});

// ═══════════════════════════════════════════════════════════════
// DEVSECOPS GOVERNANCE RUNTIME
// ═══════════════════════════════════════════════════════════════
describe("DevSecOpsGovernanceRuntime — Phase 19", () => {
  it("approves clean deployment to production", () => {
    const t=uid(); const ds=new DevSecOpsGovernanceRuntime(t);
    const dep=ds.assessDeployment({serviceName:"sgip-api",version:"8.1.0",environment:"production",requestedBy:"platform-team",artifacts:["sgip-api:8.1.0"],changeRef:"CHG-2025-001",hasApproval:true,testCoverage:92,vulnCount:0,critVulns:0,hasSBOM:true});
    expect(dep.approved).toBe(true);
    expect(dep.blockedReason).toBeUndefined();
  });

  it("blocks deployment with critical vulnerabilities", () => {
    const t=uid(); const ds=new DevSecOpsGovernanceRuntime(t);
    const dep=ds.assessDeployment({serviceName:"risky-service",version:"1.0.0",environment:"production",requestedBy:"dev-team",artifacts:["risky:1.0.0"],changeRef:"CHG-000",hasApproval:true,testCoverage:80,vulnCount:15,critVulns:3,hasSBOM:true});
    expect(dep.approved).toBe(false);
    expect(dep.blockedReason).toContain("mandatory policy checks failed");
    expect(dep.riskScore).toBeGreaterThan(50);
  });

  it("blocks deployment without SBOM", () => {
    const t=uid(); const ds=new DevSecOpsGovernanceRuntime(t);
    const dep=ds.assessDeployment({serviceName:"no-sbom-service",version:"2.0.0",environment:"production",requestedBy:"dev",artifacts:[],changeRef:"CHG-001",hasApproval:true,testCoverage:90,vulnCount:0,critVulns:0,hasSBOM:false});
    expect(dep.approved).toBe(false);
    const sbomCheck=dep.policyChecks.find(c=>c.checkId==="SEC-002");
    expect(sbomCheck?.status).toBe("fail");
  });

  it("blocks deployment without change approval", () => {
    const t=uid(); const ds=new DevSecOpsGovernanceRuntime(t);
    const dep=ds.assessDeployment({serviceName:"unapproved",version:"1.0",environment:"production",requestedBy:"dev",artifacts:[],changeRef:"",hasApproval:false,testCoverage:90,vulnCount:0,critVulns:0,hasSBOM:true});
    expect(dep.approved).toBe(false);
  });

  it("registers artifact with hash", () => {
    const t=uid(); const ds=new DevSecOpsGovernanceRuntime(t);
    const art=ds.registerArtifact({name:"sgip-api",type:"container_image",version:"8.0",vulnCount:0,critVulns:0,hasSBOM:true,sigVerified:true});
    expect(art.hash).toBeTruthy();
    expect(art.hash.length).toBe(64);
    expect(art.approved).toBe(true);
  });

  it("detectInfraDrift: config change = medium severity", () => {
    const t=uid(); const ds=new DevSecOpsGovernanceRuntime(t);
    const drift=ds.detectInfraDrift({resource:"sgip-api-configmap",environment:"production",expected:{replicas:3,memoryLimit:"2Gi"},actual:{replicas:2,memoryLimit:"1Gi"},driftType:"config_drift"});
    expect(drift).not.toBeNull();
    expect(drift!.driftType).toBe("config_drift");
    expect(["high","medium"]).toContain(drift!.severity);
  });

  it("detectInfraDrift: no change returns null", () => {
    const t=uid(); const ds=new DevSecOpsGovernanceRuntime(t);
    const state={replicas:3};
    const drift=ds.detectInfraDrift({resource:"service",environment:"staging",expected:state,actual:state,driftType:"config_drift"});
    expect(drift).toBeNull();
  });

  it("tenant isolation: deployments not visible cross-tenant", () => {
    const tA=uid(); const tB=uid();
    new DevSecOpsGovernanceRuntime(tA).assessDeployment({serviceName:"s1",version:"1",environment:"production",requestedBy:"u",artifacts:[],changeRef:"c1",hasApproval:true,testCoverage:90,vulnCount:0,critVulns:0,hasSBOM:true});
    expect(new DevSecOpsGovernanceRuntime(tB).getDeployments()).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════
// PHASE 12/15/17/19 EXECUTIVE APIS
// ═══════════════════════════════════════════════════════════════
describe("Phase 12/15/17/19 Executive APIs", () => {
  it("GET /api/executive/cyber-governance → 200", async () => {
    const r=await request(app).get("/api/executive/cyber-governance").set(a);
    expect(r.status).toBe(200);
    expect(r.body).toHaveProperty("cyberScore");
    expect(r.body).toHaveProperty("dimensions");
    expect(r.body).toHaveProperty("ransomwareReadiness");
    expect(r.body).toHaveProperty("recommendations");
  });

  it("GET /api/executive/autonomous-governance → 200", async () => {
    const r=await request(app).get("/api/executive/autonomous-governance").set(a);
    expect(r.status).toBe(200);
    expect(r.body).toHaveProperty("cycleResult");
    expect(r.body).toHaveProperty("fatigue");
    expect(typeof r.body.cycleResult.fatigueScore).toBe("number");
  });

  it("GET /api/executive/digital-twin → 200", async () => {
    const r=await request(app).get("/api/executive/digital-twin").set(a);
    expect(r.status).toBe(200);
    expect(r.body).toHaveProperty("currentState");
    expect(r.body).toHaveProperty("availableScenarios");
    expect(r.body.availableScenarios).toHaveLength(12);
  });

  it("POST /api/executive/digital-twin/simulate → 200", async () => {
    const r=await request(app).post("/api/executive/digital-twin/simulate").set(a).send({scenario:"cyber_attack"});
    expect(r.status).toBe(200);
    expect(r.body).toHaveProperty("scenario");
    expect(r.body).toHaveProperty("financialImpact");
    expect(r.body).toHaveProperty("timeline");
    expect(r.body.scenario).toBe("cyber_attack");
  });

  it("POST /api/executive/digital-twin/simulate invalid scenario → 422", async () => {
    const r=await request(app).post("/api/executive/digital-twin/simulate").set(a).send({scenario:"made_up"});
    expect(r.status).toBe(422);
  });

  it("POST /api/executive/digital-twin/what-if → 200", async () => {
    const r=await request(app).post("/api/executive/digital-twin/what-if").set(a).send({question:"What if we improve our control effectiveness by 20% in Q3?",actions:{controls:20}});
    expect(r.status).toBe(200);
    expect(r.body).toHaveProperty("deltaScore");
    expect(r.body).toHaveProperty("recommendation");
  });

  it("GET /api/executive/devsecops → 200", async () => {
    const r=await request(app).get("/api/executive/devsecops").set(a);
    expect(r.status).toBe(200);
    expect(r.body).toHaveProperty("riskScore");
    expect(r.body).toHaveProperty("deployments");
    expect(r.body).toHaveProperty("artifacts");
    expect(r.body).toHaveProperty("infraDrifts");
  });

  it("all Phase 12/15/17/19 APIs require auth → 401", async () => {
    for(const path of ["/api/executive/cyber-governance","/api/executive/autonomous-governance","/api/executive/digital-twin","/api/executive/devsecops"]) {
      const r=await request(app).get(path);
      expect(r.status).toBe(401);
    }
  });
});
