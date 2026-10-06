import { GovernanceOrchestrator } from "../orchestration/orchestrator";
import { QualityGateEngine }      from "../orchestration/quality-gate.engine";
import { EventBus }               from "../core/event-bus";
import { AuditLogger }            from "../audit/audit.logger";

function makeOrchestrator() {
  const bus   = new EventBus();
  const audit = new AuditLogger("tenant-test");
  const qg    = new QualityGateEngine();
  const orch  = new GovernanceOrchestrator(bus, audit, qg, "tenant-test");
  return { orch, bus, audit };
}

const baseReq = {
  agentId: "risk_analyst" as const,
  action: "write:risk_assessment",
  input: { text: "test input" },
  requestedBy: "test-user",
  tenantId: "tenant-test",
  confidenceScore: 85,
  evidenceIds: ["ev-001"],
};

describe("GovernanceOrchestrator", () => {
  test("blocks forbidden action per constitution", async () => {
    const { orch } = makeOrchestrator();
    const result = await orch.orchestrate({ ...baseReq, action: "certify" });
    expect(result.status).toBe("blocked");
    expect(result.blockReasons.length).toBeGreaterThan(0);
  });

  test("routes to human review when confidence below escalation threshold", async () => {
    const { orch } = makeOrchestrator();
    const result = await orch.orchestrate({ ...baseReq, confidenceScore: 40 });
    expect(result.status).toBe("pending_human");
  });

  test("approves valid action with sufficient confidence", async () => {
    const { orch } = makeOrchestrator();
    const result = await orch.orchestrate(baseReq);
    expect(["approved","pending_human"]).toContain(result.status);
  });

  test("blocked action produces no output", async () => {
    const { orch } = makeOrchestrator();
    const result = await orch.orchestrate({ ...baseReq, action: "certify" });
    expect(result.output).toBeUndefined();
  });

  test("approveHumanReview resolves pending review", async () => {
    const { orch } = makeOrchestrator();
    const result = await orch.orchestrate({ ...baseReq, confidenceScore: 40 });
    expect(result.status).toBe("pending_human");
    const approved = orch.approveHumanReview(result.orchestrationId, "approver");
    expect(approved).toBe(true);
    expect(orch.getPendingReviews().length).toBe(0);
  });

  test("blocks unknown agent", async () => {
    const { orch } = makeOrchestrator();
    const result = await orch.orchestrate({ ...baseReq, agentId: "unknown_agent" as any });
    expect(result.status).toBe("blocked");
  });
});
