/**
 * Frameworks API — operational framework intelligence.
 * /api/frameworks/* — registry, crosswalk, gap analysis, maturity scoring.
 */
import { Router, Request, Response } from "express";
import { z } from "zod";
import { authMiddleware } from "../middleware/auth.middleware";
import { checkPermission } from "../middleware/rbac.middleware";
import { validate, validateQuery } from "../middleware/validate.middleware";
import { injectTenantContext } from "../../tenant/tenant.context";
import { FRAMEWORK_REGISTRY, getFrameworksByDomain, getMandatoryFrameworks } from "../../frameworks/framework.registry";
import { getControlsByFramework, CANONICAL_CONTROL_LIBRARY } from "../../controls/control.library";
import { frameworkCrosswalkEngine } from "../../mappings/framework.crosswalk.engine";
import { maturityScoringEngine } from "../../assessments/maturity.scoring.engine";
import { gapAnalysisEngine } from "../../assessments/gap.analysis.engine";
import type { FrameworkId } from "../../frameworks/framework.types";

export const frameworksRouter = Router();
frameworksRouter.use(authMiddleware);
frameworksRouter.use(injectTenantContext);

const CrosswalkSchema = z.object({
  sourceId:           z.string().min(1),
  targetId:           z.string().min(1),
});
const MaturitySchema = z.object({
  frameworkId:        z.string().min(1),
  implementedControls:z.array(z.string()).default([]),
  mode:               z.enum(["startup","sme","enterprise","regulated_enterprise","government"]).default("enterprise"),
  targetLevel:        z.coerce.number().int().min(1).max(5).optional(),
});
const GapSchema = z.object({
  frameworkId:        z.string().min(1),
  implementedControls:z.array(z.string()).default([]),
});
const OverlapSchema = z.object({
  frameworks:         z.array(z.string()).min(2).max(6),
});

// GET /api/frameworks — list all frameworks
frameworksRouter.get("/", checkPermission("entity:read"), (_req, res) => {
  res.json(Object.values(FRAMEWORK_REGISTRY));
});

// GET /api/frameworks/:id — get one framework
frameworksRouter.get("/:id", checkPermission("entity:read"), (req, res) => {
  const f = FRAMEWORK_REGISTRY[req.params.id as FrameworkId];
  if (!f) { res.status(404).json({ error:`Framework ${req.params.id} not found` }); return; }
  const controls = getControlsByFramework(req.params.id as FrameworkId);
  res.json({ framework: f, controlCount: controls.length, controls });
});

// POST /api/frameworks/crosswalk — map controls between two frameworks
frameworksRouter.post("/crosswalk", checkPermission("entity:read"), validate(CrosswalkSchema), (req, res) => {
  const { sourceId, targetId } = req.body;
  const result = frameworkCrosswalkEngine.crosswalk(sourceId as FrameworkId, targetId as FrameworkId);
  res.json(result);
});

// POST /api/frameworks/overlap — compare multiple frameworks
frameworksRouter.post("/overlap", checkPermission("entity:read"), validate(OverlapSchema), (req, res) => {
  const result = frameworkCrosswalkEngine.analyzeOverlap(req.body.frameworks as FrameworkId[]);
  res.json(result);
});

// POST /api/frameworks/maturity — score maturity for a framework
frameworksRouter.post("/maturity", checkPermission("entity:read"), validate(MaturitySchema), (req, res) => {
  const result = maturityScoringEngine.score({
    tenantId:            req.tenantCtx!.tenantId,
    frameworkId:         req.body.frameworkId as FrameworkId,
    implementedControls: req.body.implementedControls,
    mode:                req.body.mode,
    targetLevel:         req.body.targetLevel,
    assessedBy:          req.user!.userId,
  });
  res.json(result);
});

// POST /api/frameworks/gaps — gap analysis against a framework
frameworksRouter.post("/gaps", checkPermission("entity:read"), validate(GapSchema), (req, res) => {
  const result = gapAnalysisEngine.analyze({
    tenantId:            req.tenantCtx!.tenantId,
    frameworkId:         req.body.frameworkId as FrameworkId,
    implementedControls: req.body.implementedControls,
  });
  res.json(result);
});

// GET /api/frameworks/mandatory/:jurisdiction — frameworks required for jurisdiction
frameworksRouter.get("/mandatory/:jurisdiction", checkPermission("entity:read"), (req, res) => {
  const frameworks = getMandatoryFrameworks(String(req.params.jurisdiction));
  res.json({ jurisdiction: req.params.jurisdiction, frameworks, count: frameworks.length });
});
