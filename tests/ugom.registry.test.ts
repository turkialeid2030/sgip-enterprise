import { UGOMRegistry }  from "../core/ugom.registry";
import { SovereignKnowledgeGraph } from "../graph/graph.engine";
import { EventBus }      from "../core/event-bus";
import { AuditLogger }   from "../audit/audit.logger";
import { BaseGovernanceObject } from "../types/governance.types";

function makeRegistry() {
  const bus    = new EventBus();
  const audit  = new AuditLogger("tenant-test");
  const graph  = new SovereignKnowledgeGraph(bus, audit, "tenant-test");
  const reg    = new UGOMRegistry(graph, bus, audit, "tenant-test", "org-test");
  return { reg, graph, bus, audit };
}

// Minimal valid risk-shaped object (will be further validated by Zod schema)
function riskInput(overrides = {}) {
  return {
    title: "Test Risk", description: "desc",
    owner: "CISO", status: "active", priority: "high",
    riskLevel: "high", impactLevel: "high",
    linkedPolicies: [], linkedRisks: [], linkedControls: [],
    linkedEvidence: [], linkedRegulations: [], linkedFindings: [],
    linkedCAPAs: [], linkedDecisions: [], linkedObligations: [],
    escalationPath: [], approvalChain: [], confidentiality: "internal",
    tags: [], updatedBy: "system",
    code: "R-001", category: "cyber",
    probability: 3, impact: 4, inherentScore: 12, residualScore: 8,
    controlIds: [], treatmentStatus: "not_started",
    toleranceBreached: false, appetiteBreached: false, trending: "stable",
    ...overrides,
  } as any;
}

function findingInput() {
  return {
    title: "Test Finding", description: "desc",
    owner: "CAE", status: "active", priority: "high",
    riskLevel: "high", impactLevel: "high",
    linkedPolicies: [], linkedRisks: [], linkedControls: [],
    linkedEvidence: [], linkedRegulations: [], linkedFindings: [],
    linkedCAPAs: [], linkedDecisions: [], linkedObligations: [],
    escalationPath: [], approvalChain: [], confidentiality: "internal",
    tags: [], updatedBy: "system",
    code: "F-001", findingType: "gap", reviewStatus: "active", requiresHumanReview: false,
  } as any;
}

describe("UGOMRegistry", () => {
  test("create stores entity and returns typed result", async () => {
    const { reg } = makeRegistry();
    const entity = await reg.create("risk", riskInput(), "test-user");
    expect(entity.id).toBeTruthy();
    expect(entity.type).toBe("risk");
    expect(entity.tenantId).toBe("tenant-test");
    expect(entity.version).toBe(1);
    expect(entity.createdBy).toBe("test-user");
  });

  test("findById retrieves the entity by ID", async () => {
    const { reg } = makeRegistry();
    const created = await reg.create("risk", riskInput(), "test-user");
    const found = reg.findById(created.id);
    expect(found).toBeDefined();
    expect(found!.id).toBe(created.id);
    expect(found!.title).toBe("Test Risk");
  });

  test("findById returns undefined for unknown ID", () => {
    const { reg } = makeRegistry();
    expect(reg.findById("nonexistent")).toBeUndefined();
  });

  test("findByType returns all entities of that type", async () => {
    const { reg } = makeRegistry();
    await reg.create("risk", riskInput(), "u1");
    await reg.create("risk", riskInput({ title: "Risk B", code: "R-002" }), "u1");
    const risks = reg.findByType("risk");
    expect(risks.length).toBe(2);
  });

  test("update increments version", async () => {
    const { reg } = makeRegistry();
    const created = await reg.create("risk", riskInput(), "u1");
    const updated = await reg.update(created.id, { title: "Updated Risk" }, "u2", "test");
    expect(updated).toBeDefined();
    expect(updated!.version).toBe(2);
    expect(updated!.title).toBe("Updated Risk");
  });

  test("transitionStatus emits status_changed event", async () => {
    const { reg, bus } = makeRegistry();
    const events: unknown[] = [];
    bus.on("entity.status_changed", e => { events.push(e); });
    const created = await reg.create("risk", riskInput(), "u1");
    await reg.transitionStatus(created.id, "closed", "u2", "resolved");
    expect(events.length).toBe(1);
  });

  test("validateEvidenceChains detects findings without evidence", async () => {
    const { reg } = makeRegistry();
    await reg.create("audit_finding", findingInput(), "u1");
    const { broken } = reg.validateEvidenceChains();
    expect(broken.length).toBeGreaterThanOrEqual(1);
  });

  test("getStats reflects entity count", async () => {
    const { reg } = makeRegistry();
    await reg.create("risk", riskInput(), "u1");
    const stats = reg.getStats();
    expect(stats.totalEntities).toBeGreaterThan(0);
    expect(stats.byType["risk"]).toBeGreaterThanOrEqual(1);
  });
});
