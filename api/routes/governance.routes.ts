/**
 * Governance API — decisions, RACI, culture signals, executive intelligence.
 */
import { Router, Request, Response } from "express";
import { z } from "zod";
import { authMiddleware } from "../middleware/auth.middleware";
import { checkPermission } from "../middleware/rbac.middleware";
import { validate } from "../middleware/validate.middleware";
import { injectTenantContext } from "../../tenant/tenant.context";
import { getDecisionEngine } from "../../governance/decisions/decision.engine";
import { getRACIEngine } from "../../governance/raci/raci.engine";
import { getCultureEngine } from "../../governance/culture/culture.signal.engine";
import { executiveSummaryEngine } from "../../governance/narrative/executive.summary.engine";

export const governanceRouter = Router();
governanceRouter.use(authMiddleware);
governanceRouter.use(injectTenantContext);

const CreateDecisionSchema = z.object({
  title:             z.string().min(1).max(500),
  description:       z.string().min(1),
  decisionType:      z.enum(["strategic","operational","financial","risk_acceptance","policy_approval","exception_approval","investment","vendor_onboarding","regulatory_response","board_resolution","audit_closure","system_change"]),
  owner:             z.string().min(1),
  ownerRole:         z.string().min(1),
  accountableParty:  z.string().min(1),
  approver:          z.string().min(1),
  approverRole:      z.string().min(1),
  linkedControls:    z.array(z.string()).default([]),
  linkedRisks:       z.array(z.string()).default([]),
  linkedEvidence:    z.array(z.string()).default([]),
  linkedPolicies:    z.array(z.string()).default([]),
  linkedRegulations: z.array(z.string()).default([]),
  businessImpact:    z.string().min(1),
  financialImpact:   z.number().optional(),
  riskImpact:        z.enum(["increases","decreases","neutral","unknown"]).default("unknown"),
  urgency:           z.enum(["immediate","standard","deferred"]).default("standard"),
});

const RACISchema = z.object({
  entityId:    z.string().min(1),
  entityType:  z.string().min(1),
  entityTitle: z.string().min(1),
  userId:      z.string().min(1),
  userName:    z.string().min(1),
  userRole:    z.string().min(1),
  raciRole:    z.enum(["Responsible","Accountable","Consulted","Informed"]),
});

// ── Decisions ─────────────────────────────────────────────────

// POST /api/governance/decisions
governanceRouter.post("/decisions", checkPermission("entity:create"), validate(CreateDecisionSchema), async (req: Request, res: Response): Promise<void> => {
  const engine   = getDecisionEngine(req.tenantCtx!.tenantId);
  const decision = await engine.create(req.body, req.tenantCtx!);
  res.status(201).json(decision);
});

// GET /api/governance/decisions
governanceRouter.get("/decisions", checkPermission("entity:read"), async (req: Request, res: Response): Promise<void> => {
  const engine    = getDecisionEngine(req.tenantCtx!.tenantId);
  const { status } = req.query as { status?: string };
  const decisions = engine.findAll(status as any);
  res.json({ decisions, count: decisions.length });
});

// POST /api/governance/decisions/:id/validate
governanceRouter.post("/decisions/:id/validate", checkPermission("entity:read"), async (req: Request, res: Response): Promise<void> => {
  const engine = getDecisionEngine(req.tenantCtx!.tenantId);
  const result = await engine.validate(String(req.params.id), req.tenantCtx!);
  res.json(result);
});

// POST /api/governance/decisions/:id/approve
governanceRouter.post("/decisions/:id/approve", checkPermission("entity:update"), async (req: Request, res: Response): Promise<void> => {
  const engine   = getDecisionEngine(req.tenantCtx!.tenantId);
  const decision = await engine.approve(String(req.params.id), req.user!.userId, req.tenantCtx!);
  res.json(decision);
});

// GET /api/governance/decisions/orphans
governanceRouter.get("/decisions/orphans", checkPermission("entity:read"), async (req: Request, res: Response): Promise<void> => {
  const engine  = getDecisionEngine(req.tenantCtx!.tenantId);
  const orphans = engine.getOrphanDecisions();
  res.json({ orphans, count: orphans.length });
});

// ── RACI ─────────────────────────────────────────────────────

// POST /api/governance/raci
governanceRouter.post("/raci", checkPermission("entity:create"), validate(RACISchema), (req: Request, res: Response): void => {
  const engine = getRACIEngine(req.tenantCtx!.tenantId);
  const entry  = engine.assign(req.body);
  res.status(201).json(entry);
});

// GET /api/governance/raci/:entityId
governanceRouter.get("/raci/:entityId", checkPermission("entity:read"), (req: Request, res: Response): void => {
  const engine  = getRACIEngine(req.tenantCtx!.tenantId);
  const entries = engine.getForEntity(String(req.params.entityId));
  res.json({ entityId: String(req.params.entityId), entries });
});

// POST /api/governance/accountability-map — generate RACI matrix for multiple entities
governanceRouter.post("/accountability-map", checkPermission("entity:read"), (req: Request, res: Response): void => {
  const { entityIds } = req.body as { entityIds: string[] };
  if (!Array.isArray(entityIds) || entityIds.length === 0) { res.status(422).json({ error:"entityIds array required" }); return; }
  const engine = getRACIEngine(req.tenantCtx!.tenantId);
  const matrix = engine.buildMatrix(entityIds);
  res.json(matrix);
});

// ── Culture signals ───────────────────────────────────────────

// GET /api/governance/culture-signals
governanceRouter.get("/culture-signals", checkPermission("dashboard:read"), (req: Request, res: Response): void => {
  const engine = getCultureEngine(req.tenantCtx!.tenantId);
  const report = engine.generateReport();
  res.json(report);
});

// POST /api/governance/culture-signals/record (internal use)
governanceRouter.post("/culture-signals/record", checkPermission("entity:create"), (req: Request, res: Response): void => {
  const { action, entityType } = req.body as { action: string; entityType: string };
  const engine = getCultureEngine(req.tenantCtx!.tenantId);
  engine.recordAction(req.user!.userId, req.user!.role, action, entityType);
  res.json({ recorded: true });
});

// GET /api/governance/executive-dashboard
governanceRouter.get("/executive-dashboard", checkPermission("dashboard:read"), (req: Request, res: Response): void => {
  const summary = executiveSummaryEngine.generate(req.tenantCtx!);
  res.json(summary);
});

// GET /api/governance/maturity-score (quick score using existing entity data)
governanceRouter.get("/maturity-score", checkPermission("dashboard:read"), (req: Request, res: Response): void => {
  const { frameworkId = "ISO_27001", mode = "enterprise" } = req.query as { frameworkId?: string; mode?: string };
  const result = maturityScoringEngine.score({
    tenantId: req.tenantCtx!.tenantId,
    frameworkId: frameworkId as any,
    implementedControls: [],
    mode: mode as any,
    assessedBy: req.user!.userId,
  });
  res.json(result);
});

// GET /api/governance/authority-risks
governanceRouter.get("/authority-risks", checkPermission("dashboard:read"), (req: Request, res: Response): void => {
  const engine   = getDecisionEngine(req.tenantCtx!.tenantId);
  const orphans  = engine.getOrphanDecisions();
  const pending  = engine.findAll("pending_validation");
  res.json({
    orphanDecisions:    orphans.length,
    pendingValidation:  pending.length,
    risks: [
      ...orphans.map(d => ({ decisionId: d.id, code: d.code, risk: "Missing evidence or policy validation" })),
      ...pending.map(d => ({ decisionId: d.id, code: d.code, risk: "Awaiting validation — cannot be approved" })),
    ],
  });
});

import { maturityScoringEngine } from "../../assessments/maturity.scoring.engine";
