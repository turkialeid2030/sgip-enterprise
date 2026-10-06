/**
 * Approval Runtime Engine
 * Manages multi-step approval chains with SLA timers and delegation.
 */
import { v4 as uuidv4 } from "uuid";
import { ApprovalRequest, ApprovalStep, ApprovalStatus } from "../../types/policy.types";
import { TenantContext } from "../../types/tenant.types";
import { query, queryOne } from "../../api/services/db.service";
import { requireTenantContext } from "../../tenant/tenant.context";

// DB row type — steps stored as JSON string
interface ApprovalRow extends Record<string, unknown> {
  id: string; tenantId: string; entityId: string; entityType: string;
  action: string; requestedBy: string; currentStep: number; status: string;
  slaDeadline: string; policyRef: string; correlationId: string;
  createdAt: string; updatedAt: string;
  steps: string;
}

interface ApprovalTx {
  query: <R extends Record<string, unknown> = Record<string, unknown>>(sql: string, params?: unknown[]) => Promise<R[]>;
  queryOne: <R extends Record<string, unknown> = Record<string, unknown>>(sql: string, params?: unknown[]) => Promise<R | null>;
}

function parseRow(row: ApprovalRow): ApprovalRequest {
  return {
    ...row,
    status: row.status as ApprovalStatus,
    steps: typeof row.steps === "string" ? JSON.parse(row.steps) as ApprovalStep[] : row.steps as ApprovalStep[],
  };
}

export class ApprovalRuntime {
  async createRequest(params: {
    ctx:        TenantContext;
    entityId:   string;
    entityType: string;
    action:     string;
    steps:      Omit<ApprovalStep, "status" | "approvedAt" | "approvedBy">[];
    policyRef?: string;
  }, tx?: ApprovalTx): Promise<ApprovalRequest> {
    requireTenantContext(params.ctx, "ApprovalRuntime.createRequest");
    const steps: ApprovalStep[] = params.steps.map(s => ({ ...s, status: "pending" as ApprovalStatus }));
    const slaHours   = steps[0]?.slaHours ?? 24;
    const slaDeadline = new Date(Date.now() + slaHours * 3600 * 1000).toISOString();
    const request: ApprovalRequest = {
      id: uuidv4(), tenantId: params.ctx.tenantId,
      entityId: params.entityId, entityType: params.entityType,
      action: params.action, requestedBy: params.ctx.userId,
      steps, currentStep: 0, status: "pending",
      slaDeadline, policyRef: params.policyRef ?? "",
      correlationId: uuidv4(),
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    };
    const exec = tx ? (sql: string, p?: unknown[]) => tx.query(sql, p) : query;
    await exec(
      `INSERT INTO "ApprovalRequest"
       (id,"tenantId","entityId","entityType",action,"requestedBy",steps,"currentStep",
        status,"slaDeadline","policyRef","correlationId")
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [request.id, request.tenantId, request.entityId, request.entityType,
       request.action, request.requestedBy, JSON.stringify(request.steps),
       request.currentStep, request.status, request.slaDeadline,
       request.policyRef, request.correlationId],
    );
    return request;
  }

  async processDecision(params: {
    ctx:        TenantContext;
    requestId:  string;
    decision:   "approved" | "rejected" | "escalated" | "delegated";
    approverId: string;
    notes?:     string;
    delegateTo?:string;
  }, tx?: ApprovalTx): Promise<ApprovalRequest> {
    requireTenantContext(params.ctx, "ApprovalRuntime.processDecision");
    // When called from auditedMutation (the HTTP path), use the SAME transaction
    // and lock the row before evaluating its state. This closes the TOCTOU window
    // where two approvers could both observe `pending` and both commit a decision.
    const readOne = tx
      ? <R extends Record<string, unknown>>(sql: string, p?: unknown[]) => tx.queryOne<R>(sql, p)
      : <R extends Record<string, unknown>>(sql: string, p?: unknown[]) => queryOne<R>(sql, p);
    const raw = await readOne<ApprovalRow>(
      `SELECT id,"tenantId","entityId","entityType",action,"requestedBy","currentStep",
              status,"slaDeadline","policyRef","correlationId","createdAt","updatedAt",
              steps::text AS steps
       FROM "ApprovalRequest" WHERE id = $1 AND "tenantId" = $2${tx ? " FOR UPDATE" : ""}`,
      [params.requestId, params.ctx.tenantId],
    );
    if (!raw) throw Object.assign(new Error("Approval request not found"), {
      statusCode: 404, code: "RESOURCE_NOT_FOUND",
    });
    const existing = parseRow(raw);
    if (existing.status !== "pending") throw Object.assign(
      new Error(`Cannot process: status is ${existing.status}`),
      { statusCode: 409, code: "CONCURRENT_APPROVAL_STATE_CHANGED" },
    );

    const steps = [...existing.steps];
    const stepIndex = existing.currentStep;
    const currentStep = steps[stepIndex];
    if (!currentStep) throw new Error("Invalid approval step index");

    if (currentStep.approverType === "user" && currentStep.approver !== params.approverId) {
      throw Object.assign(new Error(`User ${params.approverId} not authorized for step ${stepIndex}`), { statusCode: 403 });
    }
    steps[stepIndex] = {
      ...currentStep, status: params.decision as ApprovalStatus,
      approvedAt: new Date().toISOString(), approvedBy: params.approverId,
      notes: params.notes, delegateTo: params.delegateTo,
    };

    let overallStatus: ApprovalStatus = "pending";
    let nextStep = stepIndex;
    if (params.decision === "rejected")  { overallStatus = "rejected"; }
    else if (params.decision === "escalated") { overallStatus = "escalated"; }
    else if (params.decision === "approved") {
      nextStep = stepIndex + 1;
      if (nextStep >= steps.length) overallStatus = "approved";
    }

    const exec2 = tx
      ? <R extends Record<string, unknown>>(sql: string, p?: unknown[]) => tx.query<R>(sql, p)
      : <R extends Record<string, unknown>>(sql: string, p?: unknown[]) => query<R>(sql, p);
    const changed = await exec2<{ id: string }>(
      `UPDATE "ApprovalRequest"
          SET steps=$1,"currentStep"=$2,status=$3,"updatedAt"=NOW()
        WHERE id=$4 AND "tenantId"=$5 AND status='pending'
        RETURNING id`,
      [JSON.stringify(steps), nextStep, overallStatus, params.requestId, params.ctx.tenantId],
    );
    if (changed.length !== 1) throw Object.assign(
      new Error("Approval state changed concurrently"),
      { statusCode: 409, code: "CONCURRENT_APPROVAL_STATE_CHANGED" },
    );
    return { ...existing, steps, currentStep: nextStep, status: overallStatus };
  }

  async getPendingForApprover(ctx: TenantContext, approverId: string): Promise<ApprovalRequest[]> {
    requireTenantContext(ctx, "ApprovalRuntime.getPendingForApprover");
    const rows = await query<ApprovalRow>(
      `SELECT id,"tenantId","entityId","entityType",action,"requestedBy","currentStep",
              status,"slaDeadline","policyRef","correlationId","createdAt","updatedAt",
              steps::text AS steps
       FROM "ApprovalRequest"
       WHERE "tenantId"=$1 AND status='pending'
       ORDER BY "slaDeadline" ASC LIMIT 50`,
      [ctx.tenantId],
    );
    return rows
      .map(r => parseRow(r))
      .filter(r => {
        const step = r.steps[r.currentStep];
        return step && (step.approver === approverId || step.approverType === "role");
      });
  }

  async checkSLABreaches(ctx: TenantContext): Promise<ApprovalRequest[]> {
    requireTenantContext(ctx, "ApprovalRuntime.checkSLABreaches");
    const rows = await query<ApprovalRow>(
      `SELECT * FROM "ApprovalRequest"
       WHERE "tenantId"=$1 AND status='pending' AND "slaDeadline"<NOW()`,
      [ctx.tenantId],
    );
    return rows.map(r => parseRow(r));
  }
}

export const approvalRuntime = new ApprovalRuntime();
