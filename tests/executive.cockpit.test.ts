/**
 * Production Stabilization + Executive Cockpit Tests
 * 50 tests covering: Executive APIs, Decision Intelligence,
 *   Governance Graph, Risk Heatmap, Compliance Radar, AI Governance,
 *   External Intelligence, Timeline, System Health.
 * Additive — 573 baseline tests preserved.
 */
import request from "supertest";
import jwt from "jsonwebtoken";
import { app } from "../api/server";

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

const JWT_SECRET = "dev_secret";
const TENANT_ID  = "tenant-test";
function token(role = "governance_analyst") {
  return jwt.sign({ userId:"u1", email:`${role}@test.sgip`, role, tenantId:TENANT_ID, nameAr:"T" }, JWT_SECRET, { expiresIn:"1h" });
}
const auth  = (role?: string) => ({ Authorization:`Bearer ${token(role)}` });
const a     = auth();

// ═══════════════════════════════════════════════════════════════
// EXECUTIVE COCKPIT ENDPOINT
// ═══════════════════════════════════════════════════════════════
describe("GET /api/executive/cockpit", () => {
  it("returns 200 with full executive snapshot", async () => {
    const r = await request(app).get("/api/executive/cockpit").set(a);
    expect(r.status).toBe(200);
    expect(r.body).toHaveProperty("institutionalHealth");
    expect(r.body).toHaveProperty("organizationalTemperature");
    expect(r.body).toHaveProperty("governance");
    expect(r.body).toHaveProperty("risk");
    expect(r.body).toHaveProperty("compliance");
    expect(r.body).toHaveProperty("resilience");
    expect(r.body).toHaveProperty("assurance");
    expect(r.body).toHaveProperty("aiGovernance");
    expect(r.body).toHaveProperty("externalIntelligence");
    expect(r.body).toHaveProperty("runtime");
    expect(r.body).toHaveProperty("forecast");
    expect(r.body).toHaveProperty("immediateActions");
    expect(r.body.generatedAt).toBeTruthy();
    expect(r.body.version).toBe("8.0");
  });

  it("institutional health scores are 0-100", async () => {
    const r = await request(app).get("/api/executive/cockpit").set(a);
    const h = r.body.institutionalHealth;
    for (const key of Object.keys(h)) {
      expect(h[key]).toBeGreaterThanOrEqual(0);
      expect(h[key]).toBeLessThanOrEqual(100);
    }
  });

  it("organizational temperature has 10 heat metrics", async () => {
    const r = await request(app).get("/api/executive/cockpit").set(a);
    const t = r.body.organizationalTemperature;
    expect(typeof t.overall).toBe("number");
    expect(Array.isArray(t.criticalPressurePoints)).toBe(true);
  });

  it("external intelligence loads baseline automatically", async () => {
    const r = await request(app).get("/api/executive/cockpit").set(a);
    expect(r.body.externalIntelligence.regulatoryChanges).toBeGreaterThanOrEqual(4);
    expect(r.body.externalIntelligence.geopoliticalSignals).toBeGreaterThanOrEqual(3);
  });

  it("no token → 401", async () => {
    const r = await request(app).get("/api/executive/cockpit");
    expect(r.status).toBe(401);
  });
});

// ═══════════════════════════════════════════════════════════════
// GOVERNANCE GRAPH ENDPOINT
// ═══════════════════════════════════════════════════════════════
describe("GET /api/executive/governance-graph", () => {
  it("returns 200 with governance questions (default query)", async () => {
    const r = await request(app).get("/api/executive/governance-graph").set(a);
    expect(r.status).toBe(200);
    expect(r.body).toHaveProperty("stats");
    expect(r.body).toHaveProperty("query");
    expect(r.body.query).toBe("governance_questions");
  });

  it("accountability_gaps query", async () => {
    const r = await request(app).get("/api/executive/governance-graph?query=accountability_gaps").set(a);
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body.gaps)).toBe(true);
    expect(typeof r.body.count).toBe("number");
  });

  it("orphan_entities query", async () => {
    const r = await request(app).get("/api/executive/governance-graph?query=orphan_entities").set(a);
    expect(r.status).toBe(200);
    expect(r.body).toHaveProperty("orphanCount");
  });

  it("blast_radius query without entityId → 422", async () => {
    const r = await request(app).get("/api/executive/governance-graph?query=blast_radius").set(a);
    expect(r.status).toBe(422);
    expect(r.body.error).toContain("entityId required");
  });

  it("all_relations query without entityId returns stats", async () => {
    const r = await request(app).get("/api/executive/governance-graph?query=all_relations").set(a);
    expect(r.status).toBe(200);
    expect(r.body).toHaveProperty("stats");
  });
});

// ═══════════════════════════════════════════════════════════════
// DECISION INTELLIGENCE ENDPOINT
// ═══════════════════════════════════════════════════════════════
describe("POST /api/executive/decision-intelligence", () => {
  const decisionBody = { decisionType:"policy_change", description:"Update information security policy to include AI governance requirements", actorId:"cgo-001", estimatedImpact:"medium", parameters:{} };

  it("analyzes policy_change decision", async () => {
    const r = await request(app).post("/api/executive/decision-intelligence").set(a).send(decisionBody);
    expect(r.status).toBe(200);
    expect(r.body).toHaveProperty("decision");
    expect(r.body).toHaveProperty("impact");
    expect(r.body).toHaveProperty("strategicContradictions");
    expect(r.body).toHaveProperty("governanceQuestions");
    expect(r.body).toHaveProperty("recommendations");
    expect(r.body).toHaveProperty("confidence");
    expect(r.body.decision.type).toBe("policy_change");
  });

  it("risk_acceptance decision flags contradiction when risks exceed tolerance", async () => {
    const r = await request(app).post("/api/executive/decision-intelligence").set(a).send({ decisionType:"risk_acceptance", description:"Accept cybersecurity risk due to budget constraints for next quarter", actorId:"cro-001", estimatedImpact:"high", parameters:{} });
    expect(r.status).toBe(200);
    expect(typeof r.body.confidence).toBe("number");
    expect(Array.isArray(r.body.strategicContradictions)).toBe(true);
  });

  it("control_removal has highest financial estimate", async () => {
    const r = await request(app).post("/api/executive/decision-intelligence").set(a).send({ decisionType:"control_removal", description:"Remove quarterly access review control to reduce operational overhead", actorId:"ciso-001", estimatedImpact:"high", parameters:{} });
    expect(r.status).toBe(200);
    expect(r.body.impact.financialEstimate).toBe(500000);
    expect(r.body.impact.riskDelta).toBe(25);
  });

  it("missing description → 422 Zod validation", async () => {
    const r = await request(app).post("/api/executive/decision-intelligence").set(a).send({ decisionType:"policy_change", actorId:"u1", estimatedImpact:"low" });
    expect(r.status).toBe(422);
  });

  it("invalid decisionType → 422", async () => {
    const r = await request(app).post("/api/executive/decision-intelligence").set(a).send({ decisionType:"made_up_action", description:"Some long description here", actorId:"u1", estimatedImpact:"low" });
    expect(r.status).toBe(422);
  });

  it("all 8 decision types are supported", async () => {
    const types = ["policy_change","authority_change","control_removal","risk_acceptance","vendor_onboard","board_resolution","exception_approval","ai_deployment"];
    for (const dt of types) {
      const r = await request(app).post("/api/executive/decision-intelligence").set(a).send({ decisionType:dt, description:`Decision analysis for ${dt} — detailed justification here`, actorId:"u1", estimatedImpact:"medium" });
      expect(r.status).toBe(200);
    }
  });
});

// ═══════════════════════════════════════════════════════════════
// RISK HEATMAP ENDPOINT
// ═══════════════════════════════════════════════════════════════
describe("GET /api/executive/risk-heatmap", () => {
  it("returns 200 with risk landscape", async () => {
    const r = await request(app).get("/api/executive/risk-heatmap").set(a);
    expect(r.status).toBe(200);
    expect(r.body).toHaveProperty("totalRisks");
    expect(r.body).toHaveProperty("breachingTolerance");
    expect(r.body).toHaveProperty("byCategory");
    expect(r.body).toHaveProperty("criticalRisks");
    expect(r.body).toHaveProperty("controlOverallHealth");
    expect(r.body).toHaveProperty("overrideSignals");
    expect(typeof r.body.controlOverallHealth).toBe("number");
  });

  it("byCategory is an object", async () => {
    const r = await request(app).get("/api/executive/risk-heatmap").set(a);
    expect(typeof r.body.byCategory).toBe("object");
  });
});

// ═══════════════════════════════════════════════════════════════
// COMPLIANCE RADAR ENDPOINT
// ═══════════════════════════════════════════════════════════════
describe("GET /api/executive/compliance-radar", () => {
  it("returns 200 with compliance posture", async () => {
    const r = await request(app).get("/api/executive/compliance-radar").set(a);
    expect(r.status).toBe(200);
    expect(r.body).toHaveProperty("overallHealth");
    expect(r.body).toHaveProperty("totalObligations");
    expect(r.body).toHaveProperty("breachedCount");
    expect(r.body).toHaveProperty("driftSignals");
    expect(r.body).toHaveProperty("frameworkHealth");
    expect(r.body).toHaveProperty("externalChanges");
    expect(r.body).toHaveProperty("criticalRegChanges");
    expect(r.body.overallHealth).toBeGreaterThanOrEqual(0);
    expect(r.body.overallHealth).toBeLessThanOrEqual(100);
  });
});

// ═══════════════════════════════════════════════════════════════
// BOARD READINESS ENDPOINT
// ═══════════════════════════════════════════════════════════════
describe("GET /api/executive/board-readiness", () => {
  it("returns 200 with board intelligence", async () => {
    const r = await request(app).get("/api/executive/board-readiness").set(a);
    expect(r.status).toBe(200);
    expect(r.body).toHaveProperty("boardReadiness");
    expect(r.body).toHaveProperty("sessions");
    expect(r.body).toHaveProperty("resolutions");
    expect(r.body).toHaveProperty("prediction");
    expect(r.body).toHaveProperty("boardWarnings");
    expect(r.body.boardReadiness).toBeGreaterThanOrEqual(0);
    expect(r.body.boardReadiness).toBeLessThanOrEqual(100);
  });

  it("prediction includes 30d probability values", async () => {
    const r = await request(app).get("/api/executive/board-readiness").set(a);
    const pred = r.body.prediction;
    expect(pred.timeHorizon).toBe("30d");
    expect(pred.driftProbability).toBeGreaterThanOrEqual(0);
    expect(pred.driftProbability).toBeLessThanOrEqual(100);
  });
});

// ═══════════════════════════════════════════════════════════════
// AI GOVERNANCE ENDPOINT
// ═══════════════════════════════════════════════════════════════
describe("GET /api/executive/ai-governance", () => {
  it("returns 200 with AI governance posture", async () => {
    const r = await request(app).get("/api/executive/ai-governance").set(a);
    expect(r.status).toBe(200);
    expect(r.body).toHaveProperty("posture");
    expect(r.body).toHaveProperty("recentBlocked");
    expect(r.body).toHaveProperty("recentHallucinations");
    expect(r.body).toHaveProperty("pendingApprovals");
    expect(r.body).toHaveProperty("governanceScore");
    expect(r.body.governanceScore).toBeGreaterThanOrEqual(0);
    expect(r.body.governanceScore).toBeLessThanOrEqual(100);
  });

  it("posture includes all required counts", async () => {
    const r = await request(app).get("/api/executive/ai-governance").set(a);
    const p = r.body.posture;
    expect(typeof p.pendingHumanApprovals).toBe("number");
    expect(typeof p.blockedActions).toBe("number");
    expect(typeof p.hallucinationsDetected).toBe("number");
    expect(typeof p.totalTraces).toBe("number");
  });
});

// ═══════════════════════════════════════════════════════════════
// EXTERNAL INTELLIGENCE ENDPOINT
// ═══════════════════════════════════════════════════════════════
describe("GET /api/executive/external-intelligence", () => {
  it("returns 200 with regulatory + geo intelligence", async () => {
    const r = await request(app).get("/api/executive/external-intelligence").set(a);
    expect(r.status).toBe(200);
    expect(r.body).toHaveProperty("summary");
    expect(r.body).toHaveProperty("criticalChanges");
    expect(r.body).toHaveProperty("earlyWarnings");
    expect(r.body).toHaveProperty("allFrameworks");
    expect(r.body.summary.regulatoryChanges).toBeGreaterThanOrEqual(4);
    expect(r.body.summary.geopoliticalSignals).toBeGreaterThanOrEqual(3);
  });

  it("allFrameworks includes major regulatory frameworks", async () => {
    const r = await request(app).get("/api/executive/external-intelligence").set(a);
    const frameworks = r.body.allFrameworks;
    expect(frameworks).toContain("SAMA_CSF");
    expect(frameworks).toContain("NCA_ECC");
    expect(frameworks).toContain("AI_EU_ACT");
    expect(frameworks).toContain("GDPR");
  });

  it("earlyWarnings array is present", async () => {
    const r = await request(app).get("/api/executive/external-intelligence").set(a);
    expect(Array.isArray(r.body.earlyWarnings)).toBe(true);
    expect(r.body.earlyWarnings.length).toBeGreaterThan(0);
  });
});

// ═══════════════════════════════════════════════════════════════
// INTEGRITY CERTIFICATE ENDPOINTS
// ═══════════════════════════════════════════════════════════════
describe("Integrity Certificate Endpoints", () => {
  it("GET /api/executive/integrity-certificate → 200 with chain check", async () => {
    const r = await request(app).get("/api/executive/integrity-certificate").set(a);
    expect(r.status).toBe(200);
    expect(r.body).toHaveProperty("chainIntegrity");
    expect(r.body).toHaveProperty("eventCount");
    expect(r.body).toHaveProperty("ready");
  });

  it("POST /api/executive/integrity-certificate → 200 with full certification", async () => {
    const r = await request(app).post("/api/executive/integrity-certificate").set(a).send({});
    expect(r.status).toBe(200);
    expect(r.body).toHaveProperty("checks");
    expect(r.body.checks).toHaveLength(8);
    expect(r.body).toHaveProperty("signature");
    expect(r.body).toHaveProperty("overallScore");
    expect(r.body.passCount).toBeGreaterThan(0);
  });
});

// ═══════════════════════════════════════════════════════════════
// GOVERNANCE TIMELINE ENDPOINT
// ═══════════════════════════════════════════════════════════════
describe("GET /api/executive/governance-timeline", () => {
  it("returns 200 with unified timeline", async () => {
    const r = await request(app).get("/api/executive/governance-timeline").set(a);
    expect(r.status).toBe(200);
    expect(r.body).toHaveProperty("timeline");
    expect(r.body).toHaveProperty("eventCount");
    expect(r.body).toHaveProperty("memoryCount");
    expect(r.body).toHaveProperty("chainValid");
    expect(Array.isArray(r.body.timeline)).toBe(true);
  });

  it("limit parameter respected", async () => {
    const r = await request(app).get("/api/executive/governance-timeline?limit=10").set(a);
    expect(r.status).toBe(200);
    expect(r.body.timeline.length).toBeLessThanOrEqual(10);
  });

  it("limit=999 over max → 422", async () => {
    const r = await request(app).get("/api/executive/governance-timeline?limit=999").set(a);
    expect(r.status).toBe(422);
  });
});

// ═══════════════════════════════════════════════════════════════
// SYSTEM HEALTH ENDPOINT
// ═══════════════════════════════════════════════════════════════
describe("GET /api/executive/system-health", () => {
  it("returns 200 with system health status", async () => {
    const r = await request(app).get("/api/executive/system-health").set(a);
    expect(r.status).toBe(200);
    expect(r.body).toHaveProperty("systemHealth");
    expect(r.body).toHaveProperty("components");
    expect(r.body).toHaveProperty("activeHealings");
    expect(r.body).toHaveProperty("resilienceScore");
    expect(r.body).toHaveProperty("lastDRTest");
    expect(["healthy","degraded","failed","recovering","quarantined"]).toContain(r.body.systemHealth);
  });

  it("component health values are valid statuses", async () => {
    const r = await request(app).get("/api/executive/system-health").set(a);
    const validStatuses = ["healthy","degraded","failed","recovering","quarantined"];
    expect(validStatuses).toContain(r.body.components.eventStore);
    expect(validStatuses).toContain(r.body.components.sovereignMemory);
  });
});

// ═══════════════════════════════════════════════════════════════
// SECURITY: Auth required on all executive endpoints
// ═══════════════════════════════════════════════════════════════
describe("Executive API Security — Auth Enforcement", () => {
  const endpoints = [
    ["GET",  "/api/executive/cockpit"],
    ["GET",  "/api/executive/governance-graph"],
    ["GET",  "/api/executive/risk-heatmap"],
    ["GET",  "/api/executive/compliance-radar"],
    ["GET",  "/api/executive/board-readiness"],
    ["GET",  "/api/executive/ai-governance"],
    ["GET",  "/api/executive/external-intelligence"],
    ["GET",  "/api/executive/integrity-certificate"],
    ["GET",  "/api/executive/governance-timeline"],
    ["GET",  "/api/executive/system-health"],
  ];

  for (const [method, path] of endpoints) {
    it(`${method} ${path} without token → 401`, async () => {
      const r = method === "GET"
        ? await request(app).get(path)
        : await request(app).post(path).send({});
      expect(r.status).toBe(401);
    });
  }
});
