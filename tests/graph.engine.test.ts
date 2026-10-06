import { SovereignKnowledgeGraph } from "../graph/graph.engine";
import { EventBus }   from "../core/event-bus";
import { AuditLogger } from "../audit/audit.logger";

describe("SovereignKnowledgeGraph", () => {
  let graph: SovereignKnowledgeGraph;

  beforeEach(() => {
    const bus   = new EventBus();
    const audit = new AuditLogger("tenant-test");
    graph = new SovereignKnowledgeGraph(bus, audit, "tenant-test");
  });

  test("upsertNode creates a retrievable node", () => {
    const node = graph.upsertNode({
      id: "risk-001", type: "risk", label: "Test Risk",
      properties: { riskLevel: "high" }, createdBy: "test",
    });
    expect(node.id).toBe("risk-001");
    expect(graph.getNode("risk-001")).toBeDefined();
    expect(graph.getNode("risk-001")!.label).toBe("Test Risk");
  });

  test("createEdge creates a typed directed edge", () => {
    graph.upsertNode({ id: "ctrl-001", type: "control", label: "C-001", properties: {}, createdBy: "test" });
    graph.upsertNode({ id: "risk-001", type: "risk",    label: "R-001", properties: {}, createdBy: "test" });
    const edge = graph.createEdge({
      fromId: "ctrl-001", fromType: "control",
      toId: "risk-001",   toType: "risk",
      relationship: "mitigates", createdBy: "test",
    });
    expect(edge).not.toBeNull();
    expect(edge!.relationship).toBe("mitigates");
  });

  test("createEdge prevents self-loops", () => {
    graph.upsertNode({ id: "risk-001", type: "risk", label: "R-001", properties: {}, createdBy: "test" });
    const edge = graph.createEdge({
      fromId: "risk-001", fromType: "risk",
      toId: "risk-001",   toType: "risk",
      relationship: "linked_to", createdBy: "test",
    });
    expect(edge).toBeNull();
  });

  test("createEdge prevents duplicate edges", () => {
    graph.upsertNode({ id: "ctrl-001", type: "control", label: "C", properties: {}, createdBy: "test" });
    graph.upsertNode({ id: "risk-001", type: "risk",    label: "R", properties: {}, createdBy: "test" });
    graph.createEdge({ fromId:"ctrl-001", fromType:"control", toId:"risk-001", toType:"risk", relationship:"mitigates", createdBy:"test" });
    const dup = graph.createEdge({ fromId:"ctrl-001", fromType:"control", toId:"risk-001", toType:"risk", relationship:"mitigates", createdBy:"test" });
    expect(dup!.id).toBe(graph.findEdge("ctrl-001","risk-001","mitigates")!.id);
  });

  test("getTraceabilityChain returns path from start node", () => {
    graph.upsertNode({ id: "ev-001",   type: "evidence",      label: "E-001", properties: {}, createdBy: "test" });
    graph.upsertNode({ id: "find-001", type: "audit_finding", label: "F-001", properties: {}, createdBy: "test" });
    graph.upsertNode({ id: "risk-001", type: "risk",          label: "R-001", properties: {}, createdBy: "test" });
    graph.createEdge({ fromId:"ev-001",   fromType:"evidence",      toId:"find-001", toType:"audit_finding", relationship:"supports",     createdBy:"test" });
    graph.createEdge({ fromId:"find-001", fromType:"audit_finding", toId:"risk-001", toType:"risk",          relationship:"creates_risk", createdBy:"test" });
    const chain = graph.getTraceabilityChain("ev-001");
    expect(chain.nodes.length).toBeGreaterThanOrEqual(2);
  });

  test("detectBlindSpots finds risks with no control edges", () => {
    graph.upsertNode({ id: "risk-orphan", type: "risk", label: "Orphan Risk", properties: {}, createdBy: "test" });
    const spots = graph.detectBlindSpots();
    expect(spots.isolatedRisks.some(n => n.id === "risk-orphan")).toBe(true);
  });

  test("analyzeImpact returns direct and indirect impact", () => {
    graph.upsertNode({ id: "r1", type: "risk",    label: "R1", properties: {}, createdBy: "test" });
    graph.upsertNode({ id: "c1", type: "control", label: "C1", properties: {}, createdBy: "test" });
    graph.upsertNode({ id: "f1", type: "audit_finding", label: "F1", properties: {}, createdBy: "test" });
    graph.createEdge({ fromId:"r1", fromType:"risk", toId:"c1", toType:"control", relationship:"enforced_by", createdBy:"test" });
    graph.createEdge({ fromId:"r1", fromType:"risk", toId:"f1", toType:"audit_finding", relationship:"creates_risk", createdBy:"test" });
    const impact = graph.analyzeImpact("r1");
    expect(impact.directImpact.length).toBe(2);
    expect(impact.propagationScore).toBeGreaterThan(0);
  });

  test("stats returns correct node/edge counts", () => {
    graph.upsertNode({ id: "n1", type: "risk",    label: "N1", properties: {}, createdBy: "test" });
    graph.upsertNode({ id: "n2", type: "control", label: "N2", properties: {}, createdBy: "test" });
    graph.createEdge({ fromId:"n1", fromType:"risk", toId:"n2", toType:"control", relationship:"enforced_by", createdBy:"test" });
    const stats = graph.getStats();
    expect(stats.nodeCount).toBeGreaterThanOrEqual(2);
    expect(stats.edgeCount).toBeGreaterThanOrEqual(1);
  });
});
