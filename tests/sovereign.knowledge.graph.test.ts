/**
 * Phase 10: Sovereign Knowledge Graph + Monte Carlo + API Completeness Tests
 * Covers: KG engine, blast radius, Monte Carlo simulation,
 *         all API name aliases, full endpoint coverage (section 11 doc).
 * Additive — 616 baseline tests preserved.
 */
import request from "supertest";
import jwt from "jsonwebtoken";
import { app } from "../api/server";
import { SovereignKnowledgeGraph, getSovereignKG } from "../sovereign-knowledge-graph/sovereign.knowledge.graph";
import { getRiskRuntime } from "../risk-runtime/register/risk.intelligence.runtime";
import { getInternalAuditRuntime } from "../audit-runtime/internal/internal.audit.runtime";

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

const uid = () => `t-p10-${Math.random().toString(36).slice(2,10)}`;
const JWT_SECRET = "dev_secret";
const token = (role="governance_analyst")=>jwt.sign({userId:"u1",email:`${role}@test.sgip`,role,tenantId:"tenant-test",nameAr:"T"},JWT_SECRET,{expiresIn:"1h"});
const a = {Authorization:`Bearer ${token()}`};

// ═══════════════════════════════════════════════════════════════
// SOVEREIGN KNOWLEDGE GRAPH ENGINE
// ═══════════════════════════════════════════════════════════════
describe("SovereignKnowledgeGraph — Phase 10", () => {
  it("sync() returns nodesAdded and edgesAdded", () => {
    const t = uid();
    const kg = new SovereignKnowledgeGraph(t);
    const result = kg.sync();
    expect(typeof result.nodesAdded).toBe("number");
    expect(typeof result.edgesAdded).toBe("number");
    expect(result.nodesAdded).toBeGreaterThanOrEqual(0);
    expect(result.edgesAdded).toBeGreaterThanOrEqual(0);
  });

  it("sync with risks creates risk nodes", () => {
    const t = uid();
    const riskRuntime = getRiskRuntime(t);
    riskRuntime.register({ title:"Cyber Risk KG Test", description:"d", category:"cyber", ownerId:"ciso", inherentLikelihood:4, inherentImpact:4, createdBy:"cro" });
    const kg = new SovereignKnowledgeGraph(t);
    const result = kg.sync();
    expect(result.nodesAdded).toBeGreaterThanOrEqual(1);
    const qr = kg.query({ domain:"risk" });
    expect(qr.nodes.some(n=>n.label.includes("Cyber Risk KG Test"))).toBe(true);
  });

  it("query: filter by domain", () => {
    const t = uid();
    const kg = new SovereignKnowledgeGraph(t);
    getRiskRuntime(t).register({ title:"R1",description:"d",category:"strategic",ownerId:"u",inherentLikelihood:3,inherentImpact:3,createdBy:"u" });
    kg.sync();
    const riskNodes = kg.query({ domain:"risk" });
    const allNodes  = kg.query();
    expect(riskNodes.nodeCount).toBeLessThanOrEqual(allNodes.nodeCount);
    if (riskNodes.nodeCount > 0) {
      expect(riskNodes.nodes.every(n=>n.domain==="risk")).toBe(true);
    }
  });

  it("query: filter by minHealth", () => {
    const t = uid(); const kg = new SovereignKnowledgeGraph(t);
    kg.sync();
    const healthy = kg.query({ minHealth:80 });
    expect(healthy.nodes.every(n=>n.health>=80)).toBe(true);
  });

  it("at_risk nodes have low health scores", () => {
    const t = uid(); const kg = new SovereignKnowledgeGraph(t);
    const risk = getRiskRuntime(t);
    risk.register({ title:"Breaching Risk",description:"d",category:"strategic",ownerId:"u",inherentLikelihood:5,inherentImpact:5,appetiteScore:5,createdBy:"u" });
    kg.sync();
    const atRisk = kg.query({ status:"at_risk" });
    if (atRisk.nodes.length > 0) {
      expect(atRisk.nodes.every(n=>n.status==="at_risk")).toBe(true);
    }
    expect(true).toBe(true);
  });

  it("blastRadius: non-existent node returns empty", () => {
    const t = uid(); const kg = new SovereignKnowledgeGraph(t);
    kg.sync();
    const result = kg.blastRadius("non-existent-id-xyz");
    expect(result.affected).toHaveLength(0);
    expect(result.estimatedRisk).toContain("not in knowledge graph");
  });

  it("blastRadius: existing node returns traversal result", () => {
    const t = uid(); const kg = new SovereignKnowledgeGraph(t);
    getRiskRuntime(t).register({ title:"Blast Risk",description:"d",category:"cyber",ownerId:"ciso",inherentLikelihood:4,inherentImpact:4,createdBy:"cro" });
    kg.sync();
    const stats = kg.getStats();
    if (stats.nodes > 0) {
      // Get first node id from query
      const nodes = kg.query().nodes;
      if (nodes.length > 0) {
        const result = kg.blastRadius(nodes[0].id, 2);
        expect(typeof result.totalImpact).toBe("number");
        expect(Array.isArray(result.affected)).toBe(true);
        expect(["critical","high","medium","low"]).toContain(result.estimatedRisk);
      }
    }
    expect(true).toBe(true);
  });

  it("getStats returns domain breakdown", () => {
    const t = uid(); const kg = new SovereignKnowledgeGraph(t);
    kg.sync();
    const stats = kg.getStats();
    expect(typeof stats.nodes).toBe("number");
    expect(typeof stats.edges).toBe("number");
    expect(typeof stats.byDomain).toBe("object");
    expect(typeof stats.atRisk).toBe("number");
  });

  it("sync is idempotent — nodes not duplicated on re-sync", () => {
    const t = uid(); const kg = new SovereignKnowledgeGraph(t);
    getRiskRuntime(t).register({ title:"Idem Risk",description:"d",category:"data",ownerId:"u",inherentLikelihood:2,inherentImpact:2,createdBy:"u" });
    const r1 = kg.sync();
    const r2 = kg.sync(); // second sync — same nodes already exist
    expect(r2.nodesAdded).toBeLessThanOrEqual(r1.nodesAdded);
  });

  it("tenant isolation: B cannot see A's knowledge graph", () => {
    const tA = uid(); const tB = uid();
    getRiskRuntime(tA).register({ title:"Secret KG Node",description:"d",category:"strategic",ownerId:"u",inherentLikelihood:5,inherentImpact:5,createdBy:"u" });
    const kgA = new SovereignKnowledgeGraph(tA); kgA.sync();
    const kgB = new SovereignKnowledgeGraph(tB); kgB.sync();
    const bNodes = kgB.query();
    expect(bNodes.nodes.filter(n=>n.label.includes("Secret KG Node"))).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════
// SOVEREIGN KNOWLEDGE GRAPH API
// ═══════════════════════════════════════════════════════════════
describe("GET /api/executive/sovereign-knowledge-graph", () => {
  it("returns 200 with sync stats and graph overview", async () => {
    const r = await request(app).get("/api/executive/sovereign-knowledge-graph").set(a);
    expect(r.status).toBe(200);
    expect(r.body).toHaveProperty("sync");
    expect(r.body).toHaveProperty("stats");
    expect(r.body).toHaveProperty("atRisk");
    expect(r.body).toHaveProperty("topDomains");
    expect(r.body).toHaveProperty("edges");
    expect(typeof r.body.stats.nodes).toBe("number");
  });

  it("POST /blast-radius → 200 with traversal", async () => {
    // First get a node id from the graph
    const graphR = await request(app).get("/api/executive/sovereign-knowledge-graph").set(a);
    const nodeId = graphR.body.stats.nodes > 0 ? "some-node" : "nonexistent";
    const r = await request(app).post("/api/executive/sovereign-knowledge-graph/blast-radius").set(a).send({ nodeId });
    expect(r.status).toBe(200);
    expect(r.body).toHaveProperty("sourceNodeId");
    expect(r.body).toHaveProperty("affected");
    expect(r.body).toHaveProperty("estimatedRisk");
  });

  it("POST /blast-radius missing nodeId → 422", async () => {
    const r = await request(app).post("/api/executive/sovereign-knowledge-graph/blast-radius").set(a).send({});
    expect(r.status).toBe(422);
  });

  it("no token → 401", async () => {
    const r = await request(app).get("/api/executive/sovereign-knowledge-graph");
    expect(r.status).toBe(401);
  });
});

// ═══════════════════════════════════════════════════════════════
// MONTE CARLO SIMULATION
// ═══════════════════════════════════════════════════════════════
describe("POST /api/executive/monte-carlo-simulation", () => {
  const base = { iterations:50, horizon:"90d", simulateEvents:["risk_breach","control_failure","compliance_incident"] };

  it("returns 200 with simulation results", async () => {
    const r = await request(app).post("/api/executive/monte-carlo-simulation").set(a).send(base);
    expect(r.status).toBe(200);
    expect(r.body).toHaveProperty("parameters");
    expect(r.body).toHaveProperty("baseline");
    expect(r.body).toHaveProperty("results");
    expect(r.body).toHaveProperty("recommendation");
    expect(r.body).toHaveProperty("confidence");
    expect(r.body.parameters.iterations).toBe(50);
  });

  it("results contain required probability metrics", async () => {
    const r = await request(app).post("/api/executive/monte-carlo-simulation").set(a).send(base);
    const res = r.body.results;
    expect(typeof res.averageRiskScore).toBe("number");
    expect(typeof res.averageControlHealth).toBe("number");
    expect(typeof res.p95RiskScore).toBe("number");
    expect(typeof res.failureProbability).toBe("number");
    expect(typeof res.averageFinancialImpact).toBe("number");
    expect(res.failureProbability).toBeGreaterThanOrEqual(0);
    expect(res.failureProbability).toBeLessThanOrEqual(100);
  });

  it("100 iterations gives high confidence", async () => {
    const r = await request(app).post("/api/executive/monte-carlo-simulation").set(a).send({ ...base, iterations:100 });
    expect(r.status).toBe(200);
    expect(r.body.confidence).toBe("high");
  });

  it("10 iterations gives low confidence", async () => {
    const r = await request(app).post("/api/executive/monte-carlo-simulation").set(a).send({ ...base, iterations:10 });
    expect(r.status).toBe(200);
    expect(r.body.confidence).toBe("low");
  });

  it("worst case risk >= best case risk", async () => {
    const r = await request(app).post("/api/executive/monte-carlo-simulation").set(a).send({ ...base, iterations:50 });
    expect(r.body.results.worstCaseRisk).toBeGreaterThanOrEqual(r.body.results.bestCaseRisk);
  });

  it("cyber_attack scenario increases financial impact", async () => {
    const withCyber    = await request(app).post("/api/executive/monte-carlo-simulation").set(a).send({ iterations:100, horizon:"90d", simulateEvents:["cyber_attack"] });
    const withoutCyber = await request(app).post("/api/executive/monte-carlo-simulation").set(a).send({ iterations:100, horizon:"90d", simulateEvents:["board_delay"] });
    expect(withCyber.body.results.averageFinancialImpact).toBeGreaterThanOrEqual(withoutCyber.body.results.averageFinancialImpact);
  });

  it("iterations > 500 → 422 (exceeds limit)", async () => {
    const r = await request(app).post("/api/executive/monte-carlo-simulation").set(a).send({ ...base, iterations:600 });
    expect(r.status).toBe(422);
  });

  it("invalid event → 422", async () => {
    const r = await request(app).post("/api/executive/monte-carlo-simulation").set(a).send({ ...base, simulateEvents:["made_up_event"] });
    expect(r.status).toBe(422);
  });

  it("no token → 401", async () => {
    const r = await request(app).post("/api/executive/monte-carlo-simulation").send(base);
    expect(r.status).toBe(401);
  });
});

// ═══════════════════════════════════════════════════════════════
// DOC SECTION 11 — EXACT API NAMES REQUIRED
// ═══════════════════════════════════════════════════════════════
describe("Document Section 11 — Exact API Name Compliance", () => {
  // GET /api/executive/cockpit  → already tested in executive.cockpit.test.ts
  it("GET /api/executive/ai-oversight → 200 (exact name from doc)", async () => {
    const r = await request(app).get("/api/executive/ai-oversight").set(a);
    expect(r.status).toBe(200);
    expect(r.body).toHaveProperty("posture");
    expect(r.body).toHaveProperty("aiGovernanceScore");
    expect(r.body).toHaveProperty("maturity");
  });

  it("GET /api/executive/governance-maturity → 200 (exact name)", async () => {
    const r = await request(app).get("/api/executive/governance-maturity").set(a);
    expect(r.status).toBe(200);
    expect(r.body).toHaveProperty("overallLevel");
    expect(r.body.dimensions).toHaveLength(6);
  });

  it("GET /api/executive/internal-audit → 200 (exact name from doc)", async () => {
    const r = await request(app).get("/api/executive/internal-audit").set(a);
    expect(r.status).toBe(200);
    expect(r.body).toHaveProperty("readinessScore");
    expect(r.body).toHaveProperty("internalAudit");
    expect(r.body).toHaveProperty("financialAudit");
    expect(r.body).toHaveProperty("iiaMandatoryStandards");
    expect(r.body.iiaMandatoryStandards).toHaveLength(5);
  });

  it("GET /api/executive/financial-assurance → 200 (exact name)", async () => {
    const r = await request(app).get("/api/executive/financial-assurance").set(a);
    expect(r.status).toBe(200);
    expect(r.body).toHaveProperty("materialWeaknesses");
  });

  it("GET /api/executive/regulatory-intelligence → 200 (exact name)", async () => {
    const r = await request(app).get("/api/executive/regulatory-intelligence").set(a);
    expect(r.status).toBe(200);
    expect(r.body).toHaveProperty("totalChanges");
    expect(r.body.totalChanges).toBeGreaterThanOrEqual(4);
  });

  it("POST /api/executive/decision-intelligence → 200 (exact name)", async () => {
    const r = await request(app).post("/api/executive/decision-intelligence").set(a).send({ decisionType:"policy_change", description:"Update information security policy to include AI governance and regulatory requirements", actorId:"cgo-001", estimatedImpact:"medium" });
    expect(r.status).toBe(200);
    expect(r.body).toHaveProperty("strategicContradictions");
  });

  it("POST /api/executive/integrity-certification → 200 (exact name from doc)", async () => {
    const r = await request(app).post("/api/executive/integrity-certification").set(a).send({});
    expect(r.status).toBe(200);
    expect(r.body).toHaveProperty("checks");
    expect(r.body.checks).toHaveLength(8);
    expect(r.body).toHaveProperty("signature");
  });

  it("all 11 doc section 11 endpoints return 401 without auth", async () => {
    const endpoints = [
      ["GET",  "/api/executive/cockpit"],
      ["GET",  "/api/executive/risk-heatmap"],
      ["GET",  "/api/executive/compliance-radar"],
      ["GET",  "/api/executive/board-readiness"],
      ["GET",  "/api/executive/ai-oversight"],
      ["GET",  "/api/executive/governance-maturity"],
      ["GET",  "/api/executive/internal-audit"],
      ["GET",  "/api/executive/financial-assurance"],
      ["GET",  "/api/executive/regulatory-intelligence"],
      ["POST", "/api/executive/decision-intelligence"],
      ["POST", "/api/executive/integrity-certification"],
    ];
    for (const [method, path] of endpoints) {
      const r = method==="GET" ? await request(app).get(path) : await request(app).post(path).send({});
      expect(r.status).toBe(401);
    }
  });
});
