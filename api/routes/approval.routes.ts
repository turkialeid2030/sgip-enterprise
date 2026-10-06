import { auditedMutation } from "../services/db.service";
/**
 * Approval Runtime API Routes
 */
import { Router, Request, Response, NextFunction } from "express";
import { z } from "zod";
import { authMiddleware } from "../middleware/auth.middleware";
import { checkPermission } from "../middleware/rbac.middleware";
import { validate } from "../middleware/validate.middleware";
import { injectTenantContext } from "../../tenant/tenant.context";
import { approvalRuntime, sodEngine } from "../../policy-engine";
import { AuditDAO } from "../services/audit.dao";

export const approvalRouter = Router();
approvalRouter.use(authMiddleware);
approvalRouter.use(injectTenantContext);

const CreateApprovalSchema = z.object({
  entityId:   z.string().min(1),
  entityType: z.string().min(1),
  action:     z.string().min(1),
  policyRef:  z.string().optional(),
  steps: z.array(z.object({
    order:        z.number().int(),
    approver:     z.string(),
    approverType: z.enum(["user","role","committee"]),
    required:     z.boolean().default(true),
    slaHours:     z.number().int().min(1).default(24),
    delegateTo:   z.string().optional(),
  })).min(1),
});

const DecisionSchema = z.object({
  decision:   z.enum(["approved","rejected","escalated","delegated"]),
  notes:      z.string().max(500).optional(),
  delegateTo: z.string().optional(),
});

// POST /api/approvals — create request
approvalRouter.post("/",
  checkPermission("entity:create"),
  validate(CreateApprovalSchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    let request;
    try {
      request = await auditedMutation(
        req.user!.tenantId,
        (tx) => approvalRuntime.createRequest({
      ctx:        req.tenantCtx!,
      entityId:   req.body.entityId,
      entityType: req.body.entityType,
      action:     req.body.action,
      steps:      req.body.steps,
      policyRef:  req.body.policyRef,
    }, tx),
        async (tx, created) => {
          await AuditDAO.logIn(tx, { action: "approval.created", entityId: created.id,
            entityType: "approval", performedBy: req.user!.userId, role: req.user!.role,
            tenantId: req.user!.tenantId,
            next: { entityId: req.body.entityId, action: req.body.action } });
        },
      );
    } catch (err) {
      next(err);
      return;
    }
    res.status(201).json(request);
  },
);

// GET /api/approvals/pending — my pending approvals
approvalRouter.get("/pending",
  checkPermission("entity:read"),
  async (req: Request, res: Response): Promise<void> => {
    const pending = await approvalRuntime.getPendingForApprover(req.tenantCtx!, req.user!.userId);
    res.json({ approvals: pending, count: pending.length });
  },
);

// PATCH /api/approvals/:id/decide — approve/reject/escalate
approvalRouter.patch("/:id/decide",
  checkPermission("entity:update"),
  validate(DecisionSchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    // SoD check before approving
    const violation = sodEngine.checkAction(req.tenantCtx!, req.user!.userId, "approve", String(req.params.id));
    if (violation && violation.blocked) {
      res.status(409).json({ error: `SoD violation: ${violation.action1} + ${violation.action2} cannot be performed by same user`, conflict: violation.conflictId });
      return;
    }
    let updated;
    try {
      updated = await auditedMutation(
        req.user!.tenantId,
        (tx) => approvalRuntime.processDecision({
      ctx:        req.tenantCtx!,
      requestId:  String(req.params.id),
      decision:   req.body.decision,
      approverId: req.user!.userId,
      notes:      req.body.notes,
      delegateTo: req.body.delegateTo,
    }, tx),
        async (tx, result) => {
          await AuditDAO.logIn(tx, { action: `approval.${req.body.decision}`,
            entityId: String(req.params.id), entityType: "approval",
            performedBy: req.user!.userId, role: req.user!.role,
            tenantId: req.user!.tenantId, next: { decision: req.body.decision } });
        },
      );
    } catch (err) {
      next(err);
      return;
    }
    res.json(updated);
  },
);

// GET /api/approvals/sod-matrix — SoD conflict matrix
approvalRouter.get("/sod-matrix",
  checkPermission("entity:read"),
  (_req, res) => {
    res.json(sodEngine.getConflictMatrix());
  },
);
