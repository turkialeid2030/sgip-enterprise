import { auditedMutation } from "../services/db.service";
/**
 * Policy API Routes — full CRUD + lifecycle + evaluation
 */
import { Router, Request, Response, NextFunction } from "express";
import { z } from "zod";
import { authMiddleware } from "../middleware/auth.middleware";
import { checkPermission } from "../middleware/rbac.middleware";
import { validate, validateQuery } from "../middleware/validate.middleware";
import { injectTenantContext } from "../../tenant/tenant.context";
import { PolicyService, policyEvaluator } from "../../policy-engine";
import { AuditDAO } from "../services/audit.dao";

export const policyRouter = Router();
policyRouter.use(authMiddleware);
policyRouter.use(injectTenantContext);

// ── Validation schemas ────────────────────────────────────────
const CreatePolicySchema = z.object({
  code:              z.string().min(1).max(50).optional(),
  title:             z.string().min(1).max(500),
  description:       z.string().max(2000).optional(),
  category:          z.enum(["governance","risk","compliance","security","financial","legal","hr","operational","ai","privacy","data"]),
  rules:             z.array(z.object({
    id:          z.string().default(() => require("uuid").v4().slice(0,8)),
    description: z.string(),
    trigger:     z.object({ type: z.string() }).passthrough(),
    action:      z.object({ type: z.string() }).passthrough(),
    priority:    z.number().int().default(5),
    isHard:      z.boolean().default(false),
  })).default([]),
  linkedRegulations: z.array(z.string()).default([]),
  linkedControls:    z.array(z.string()).default([]),
  linkedRisks:       z.array(z.string()).default([]),
  scope:             z.object({ entityTypes: z.array(z.string()).default([]), roles: z.array(z.string()).default([]), departments: z.array(z.string()).default([]), riskLevels: z.array(z.string()).default([]), conditions: z.array(z.any()).default([]) }).optional(),
  effectiveFrom:     z.string().datetime().optional(),
  reviewCycle:       z.enum(["monthly","quarterly","semi_annual","annual"]).default("annual"),
});

const EvalSchema = z.object({
  entityType:  z.string().min(1),
  entityId:    z.string().optional(),
  action:      z.string().min(1),
  entityData:  z.record(z.unknown()).default({}),
});

const PolicyQuerySchema = z.object({
  status:   z.string().optional(),
  category: z.string().optional(),
  limit:    z.coerce.number().int().min(1).max(100).default(50),
  offset:   z.coerce.number().int().min(0).default(0),
});

// ── Routes ────────────────────────────────────────────────────

// GET /api/policies
policyRouter.get("/",
  checkPermission("entity:read"),
  validateQuery(PolicyQuerySchema),
  async (req: Request, res: Response): Promise<void> => {
    const { status, category } = (req as any).validatedQuery as { status?: string; category?: string };
    const policies = await PolicyService.findAll(req.tenantCtx!, { status, category });
    res.json({ policies, total: policies.length });
  },
);

// POST /api/policies
policyRouter.post("/",
  checkPermission("entity:create"),
  validate(CreatePolicySchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    // V5.2A: policy + audit in ONE transaction via the tx-aware service variant.
    let policy;
    try {
      policy = await auditedMutation(
        req.user!.tenantId,
        (tx) => PolicyService.createIn(tx, req.body, req.tenantCtx!),
        async (tx, created) => {
          await AuditDAO.logIn(tx, {
            action: "policy.created", entityId: created.id, entityType: "policy",
            performedBy: req.user!.userId, role: req.user!.role,
            tenantId: req.user!.tenantId, next: { code: created.code, title: created.title },
          });
        },
      );
    } catch (err) {
      next(err);
      return;
    }
    res.status(201).json(policy);
  },
);

// GET /api/policies/:id
policyRouter.get("/:id",
  checkPermission("entity:read"),
  async (req: Request, res: Response): Promise<void> => {
    const policy = await PolicyService.findById(String(req.params.id), req.tenantCtx!);
    if (!policy) { res.status(404).json({ error: "Policy not found" }); return; }
    res.json(policy);
  },
);

// PATCH /api/policies/:id/activate
policyRouter.patch("/:id/activate",
  checkPermission("entity:update"),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      await auditedMutation(
        req.user!.tenantId,
        (tx) => PolicyService.activateIn(tx, String(req.params.id), req.tenantCtx!),
        async (tx) => {
          await AuditDAO.logIn(tx, { action: "policy.activated", entityId: String(req.params.id),
            entityType: "policy", performedBy: req.user!.userId,
            role: req.user!.role, tenantId: req.user!.tenantId });
        },
      );
    } catch (err) {
      next(err);
      return;
    }
    res.json({ message: "Policy activated" });
  },
);

// PATCH /api/policies/:id/retire
policyRouter.patch("/:id/retire",
  checkPermission("entity:archive"),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      await auditedMutation(
        req.user!.tenantId,
        (tx) => PolicyService.retireIn(tx, String(req.params.id), req.tenantCtx!),
        async (tx) => {
          await AuditDAO.logIn(tx, { action: "policy.retired", entityId: String(req.params.id),
            entityType: "policy", performedBy: req.user!.userId,
            role: req.user!.role, tenantId: req.user!.tenantId });
        },
      );
    } catch (err) {
      next(err);
      return;
    }
    res.json({ message: "Policy retired" });
  },
);

// GET /api/policies/:id/conflicts
policyRouter.get("/:id/conflicts",
  checkPermission("entity:read"),
  async (req: Request, res: Response): Promise<void> => {
    const conflicts = await PolicyService.detectConflicts(String(req.params.id), req.tenantCtx!);
    res.json({ policyId: String(req.params.id), conflicts, conflictCount: conflicts.length });
  },
);

// POST /api/policies/evaluate — check if action is allowed
policyRouter.post("/evaluate",
  checkPermission("entity:read"),
  validate(EvalSchema),
  async (req: Request, res: Response): Promise<void> => {
    const { entityType, entityId, action, entityData } = req.body;
    const result = await policyEvaluator.evaluate({
      context:    req.tenantCtx!,
      entityType, entityId, action, entityData,
      actorRole:  req.user!.role,
      actorId:    req.user!.userId,
    });
    res.json(result);
  },
);
