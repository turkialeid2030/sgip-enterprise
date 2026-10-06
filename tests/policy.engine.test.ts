/**
 * Policy Engine Tests — evaluator, SoD, approval runtime.
 */
import { PolicyEvaluator } from "../policy-engine/engine/policy.evaluator";
import { SoDEngine } from "../policy-engine/rules/sod.engine";
import { ApprovalRuntime } from "../policy-engine/approval/approval.runtime";
import { buildTenantContext } from "../tenant/tenant.context";
import { GovernancePolicy } from "../types/policy.types";

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
  query:    jest.fn().mockResolvedValue([]),
  queryOne: jest.fn().mockResolvedValue(null),
}));

jest.mock("../api/services/audit.dao", () => ({
  AuditDAO: { logIn: jest.fn().mockResolvedValue(undefined), log: jest.fn().mockResolvedValue(undefined) },
}));

const ctx = buildTenantContext({ tenantId: "t1", organizationId: "o1", userId: "u1", userRole: "governance_analyst" });

// ── Policy Evaluator ──────────────────────────────────────────
describe("PolicyEvaluator", () => {
  const evaluator = new PolicyEvaluator();

  it("allows action when no policies match (empty DB)", async () => {
    const result = await evaluator.evaluate({
      context: ctx, entityType: "risk", action: "create",
      entityData: { riskLevel: "medium" }, actorRole: "risk_analyst", actorId: "u1",
    });
    expect(result.allowed).toBe(true);
    expect(result.blocked).toBe(false);
    expect(result.policyRefs).toHaveLength(0);
  });

  it("returns traceId on every evaluation", async () => {
    const result = await evaluator.evaluate({
      context: ctx, entityType: "control", action: "update",
      entityData: {}, actorRole: "risk_analyst", actorId: "u1",
    });
    expect(result.traceId).toBeTruthy();
    expect(result.traceId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("returns evaluatedAt timestamp", async () => {
    const result = await evaluator.evaluate({
      context: ctx, entityType: "policy", action: "create",
      entityData: {}, actorRole: "governance_analyst", actorId: "u1",
    });
    expect(result.evaluatedAt).toBeTruthy();
    expect(new Date(result.evaluatedAt).getTime()).toBeLessThanOrEqual(Date.now());
  });

  it("confidence is 100 when no policies apply", async () => {
    const result = await evaluator.evaluate({
      context: ctx, entityType: "evidence", action: "create",
      entityData: {}, actorRole: "evidence_validator", actorId: "u1",
    });
    expect(result.confidenceScore).toBe(100);
  });

  it("invalidateCache does not throw", () => {
    expect(() => evaluator.invalidateCache("tenant-test")).not.toThrow();
  });

  describe("with active policy", () => {
    const mockPolicy: GovernancePolicy = {
      id: "pol-test-001", tenantId: "t1", code: "POL-TEST-001",
      title: "Test — block critical risk creation",
      description: "", category: "risk",
      status: "active", currentVersion: "1.0.0", versions: [],
      parentPolicyId: undefined, childPolicyIds: [],
      linkedRegulations: [], linkedControls: [], linkedRisks: [],
      scope: { entityTypes: ["risk"], departments: [], roles: [], riskLevels: ["critical"], conditions: [] },
      rules: [{
        id: "rule-001", description: "Critical risks require approval",
        trigger: { type: "risk_threshold", level: "critical" },
        action:  { type: "require_approval", approvers: ["CRO", "CGO"] },
        priority: 1, isHard: true,
      }],
      approvalChain: [], effectiveFrom: new Date().toISOString(),
      reviewCycle: "annual", nextReviewAt: new Date(Date.now() + 365*86400*1000).toISOString(),
      freshnessScore: 100, hasConflicts: false, conflictsWith: [],
      createdBy: "u1", updatedBy: "u1",
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    };

    beforeEach(() => {
      // Inject policy into cache directly
      (evaluator as any).loadActivePolicies = jest.fn().mockResolvedValue([mockPolicy]);
    });

    it("blocks creation of critical risk (hard rule)", async () => {
      const result = await evaluator.evaluate({
        context: ctx, entityType: "risk", action: "create",
        entityData: { riskLevel: "critical" }, actorRole: "risk_analyst", actorId: "u1",
      });
      expect(result.blocked).toBe(true);
      expect(result.allowed).toBe(false);
      expect(result.appliedRules).toContain("rule-001");
      expect(result.policyRefs).toContain("pol-test-001");
      expect(result.requiredActions[0].type).toBe("require_approval");
    });

    it("allows creation of medium risk (rule doesn't fire)", async () => {
      const result = await evaluator.evaluate({
        context: ctx, entityType: "risk", action: "create",
        entityData: { riskLevel: "medium" }, actorRole: "risk_analyst", actorId: "u1",
      });
      expect(result.allowed).toBe(true);
      expect(result.appliedRules).toHaveLength(0);
    });

    it("confidence is 85 when policies exist", async () => {
      const result = await evaluator.evaluate({
        context: ctx, entityType: "risk", action: "create",
        entityData: { riskLevel: "medium" }, actorRole: "risk_analyst", actorId: "u1",
      });
      expect(result.confidenceScore).toBe(85);
    });
  });
});

// ── SoD Engine ────────────────────────────────────────────────
describe("SoDEngine", () => {
  let sod: SoDEngine;
  beforeEach(() => { sod = new SoDEngine(); });

  it("no violation for first action", () => {
    const violation = sod.checkAction(ctx, "u1", "create", "entity-1");
    expect(violation).toBeNull();
  });

  it("detects create+approve SoD violation", () => {
    sod.recordAction(ctx, "u1", "create");
    const violation = sod.checkAction(ctx, "u1", "approve", "entity-1");
    expect(violation).not.toBeNull();
    expect(violation!.blocked).toBe(true);
    expect(violation!.conflictId).toBe("sod-001");
  });

  it("no violation for different users", () => {
    sod.recordAction(ctx, "u1", "create");
    const ctxU2 = buildTenantContext({ tenantId: "t1", organizationId: "o1", userId: "u2", userRole: "r" });
    const violation = sod.checkAction(ctxU2, "u2", "approve", "entity-1");
    expect(violation).toBeNull();
  });

  it("detects journal_entry+approve SoD violation", () => {
    sod.recordAction(ctx, "u1", "write:journal_entry");
    const violation = sod.checkAction(ctx, "u1", "approve", "entity-JE");
    expect(violation).not.toBeNull();
    expect(violation!.conflictId).toBe("sod-002");
  });

  it("detects policy_write+approve SoD violation", () => {
    sod.recordAction(ctx, "u1", "write:policy");
    const violation = sod.checkAction(ctx, "u1", "approve", "pol-1");
    expect(violation).not.toBeNull();
    expect(violation!.conflictId).toBe("sod-005");
  });

  it("clearUserSession removes action history", () => {
    sod.recordAction(ctx, "u1", "create");
    sod.clearUserSession("t1", "u1");
    const violation = sod.checkAction(ctx, "u1", "approve", "entity-1");
    expect(violation).toBeNull();
  });

  it("getConflictMatrix returns all built-in conflicts", () => {
    const matrix = sod.getConflictMatrix();
    expect(matrix.length).toBeGreaterThanOrEqual(5);
    expect(matrix.every(c => c.id && c.severity && c.action1 && c.action2)).toBe(true);
  });

  it("cross-tenant: u1 in t1 action doesn't affect u1 in t2", () => {
    sod.recordAction(ctx, "u1", "create");
    const ctxT2 = buildTenantContext({ tenantId: "t2", organizationId: "o2", userId: "u1", userRole: "r" });
    const violation = sod.checkAction(ctxT2, "u1", "approve", "entity-1");
    expect(violation).toBeNull();  // different tenant = different session key
  });
});

// ── Approval Runtime ──────────────────────────────────────────
describe("ApprovalRuntime", () => {
  let runtime: ApprovalRuntime;
  const { query, queryOne } = jest.requireMock("../api/services/db.service");

  beforeEach(() => {
    runtime = new ApprovalRuntime();
    (query as jest.Mock).mockReset();
    (queryOne as jest.Mock).mockReset();
  });

  it("createRequest inserts to DB and returns typed ApprovalRequest", async () => {
    (query as jest.Mock).mockResolvedValueOnce([]);
    const request = await runtime.createRequest({
      ctx: ctx,
      entityId: "risk-001", entityType: "risk", action: "approve_risk",
      steps: [{ order: 1, approver: "cro-user", approverType: "user", required: true, slaHours: 24 }],
      policyRef: "pol-001",
    });
    expect(request.id).toBeTruthy();
    expect(request.status).toBe("pending");
    expect(request.tenantId).toBe("t1");
    expect(request.steps).toHaveLength(1);
    expect(request.steps[0].status).toBe("pending");
    expect(request.correlationId).toBeTruthy();
    expect(request.slaDeadline).toBeTruthy();
  });

  it("processDecision approves and advances to next step", async () => {
    const existingRequest = {
      id: "req-001", tenantId: "t1", entityId: "risk-001", entityType: "risk",
      action: "approve_risk", requestedBy: "u1", currentStep: 0, status: "pending",
      slaDeadline: new Date(Date.now() + 86400*1000).toISOString(),
      policyRef: "pol-001", correlationId: "corr-001",
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      steps: JSON.stringify([
        { order: 0, approver: "cro-user", approverType: "user", required: true, slaHours: 24, status: "pending" },
        { order: 1, approver: "cgo-user", approverType: "user", required: true, slaHours: 24, status: "pending" },
      ]),
    };
    (queryOne as jest.Mock).mockResolvedValueOnce(existingRequest);
    (query as jest.Mock).mockResolvedValueOnce([{ id: "req-001" }]);

    const result = await runtime.processDecision({
      ctx, requestId: "req-001", decision: "approved",
      approverId: "cro-user",
    });
    expect(result.currentStep).toBe(1);  // advanced
    expect(result.status).toBe("pending");  // still pending (2 steps)
  });

  it("processDecision completes when last step approved", async () => {
    const existingRequest = {
      id: "req-002", tenantId: "t1", entityId: "risk-001", entityType: "risk",
      action: "approve_risk", requestedBy: "u1", currentStep: 0, status: "pending",
      slaDeadline: new Date(Date.now() + 86400*1000).toISOString(),
      policyRef: "", correlationId: "corr-002",
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      steps: JSON.stringify([
        { order: 0, approver: "cro-user", approverType: "user", required: true, slaHours: 24, status: "pending" },
      ]),
    };
    (queryOne as jest.Mock).mockResolvedValueOnce(existingRequest);
    (query as jest.Mock).mockResolvedValueOnce([{ id: "req-002" }]);

    const result = await runtime.processDecision({
      ctx, requestId: "req-002", decision: "approved",
      approverId: "cro-user",
    });
    expect(result.status).toBe("approved");
  });

  it("processDecision rejects when decision is rejected", async () => {
    const existingRequest = {
      id: "req-003", tenantId: "t1", entityId: "risk-001", entityType: "risk",
      action: "approve_risk", requestedBy: "u1", currentStep: 0, status: "pending",
      slaDeadline: new Date(Date.now() + 86400*1000).toISOString(),
      policyRef: "", correlationId: "corr-003",
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      steps: JSON.stringify([
        { order: 0, approver: "cro-user", approverType: "user", required: true, slaHours: 24, status: "pending" },
      ]),
    };
    (queryOne as jest.Mock).mockResolvedValueOnce(existingRequest);
    (query as jest.Mock).mockResolvedValueOnce([{ id: "req-003" }]);

    const result = await runtime.processDecision({
      ctx, requestId: "req-003", decision: "rejected",
      approverId: "cro-user", notes: "Does not meet criteria",
    });
    expect(result.status).toBe("rejected");
  });

  it("processDecision throws 404 for unknown requestId", async () => {
    (queryOne as jest.Mock).mockResolvedValueOnce(null);
    await expect(runtime.processDecision({
      ctx, requestId: "ghost-req", decision: "approved", approverId: "u1",
    })).rejects.toMatchObject({ statusCode: 404 });
  });
});
