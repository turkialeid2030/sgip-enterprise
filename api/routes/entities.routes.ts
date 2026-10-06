import { withTenant } from "../services/db.service";
import { auditedMutation } from "../services/db.service";

import { Router, Request, Response, NextFunction } from "express";
import { v4 as uuidv4 } from "uuid";
import { EntityDAO } from "../services/entity.dao";
import { AuditDAO } from "../services/audit.dao";
import { authMiddleware } from "../middleware/auth.middleware";
import { checkPermission } from "../middleware/rbac.middleware";
import { validate, validateQuery } from "../middleware/validate.middleware";
import { CreateEntitySchema, UpdateEntitySchema, EntityQuerySchema } from "../validation/entity.schemas";

export const entitiesRouter = Router();
entitiesRouter.use(authMiddleware);

// GET /api/entities
entitiesRouter.get(
  "/",
  checkPermission("entity:read"),
  validateQuery(EntityQuerySchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const q = (req as any).validatedQuery as { type?:string; status?:string; riskLevel?:string; limit:number; offset:number };
    try {
      const [entities, total] = await Promise.all([
        EntityDAO.findMany({ tenantId: req.user!.tenantId, ...q }),
        EntityDAO.count({ tenantId: req.user!.tenantId, ...q }),
      ]);
      res.json({ entities, total, limit: q.limit, offset: q.offset });
    } catch (dbErr) {
      next(dbErr);
    }
  },
);

// GET /api/entities/:id
entitiesRouter.get(
  "/:id",
  checkPermission("entity:read"),
  async (req: Request, res: Response): Promise<void> => {
    const entity = await EntityDAO.findOne(String(req.params.id), req.user!.tenantId);
    if (!entity) { res.status(404).json({ error: "Entity not found" }); return; }
    const [outEdges, inEdges, auditLogs] = await Promise.all([
      EntityDAO.getEdges(entity.id, entity.tenantId),
      EntityDAO.getInEdges(entity.id, entity.tenantId),
      AuditDAO.findRecent(entity.tenantId, 20),
    ]);
    res.json({ ...entity, outEdges, inEdges, auditLogs });
  },
);

// POST /api/entities
entitiesRouter.post(
  "/",
  checkPermission("entity:create"),
  validate(CreateEntitySchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const body = req.body;
    const id   = uuidv4();
    const entityPayload = {
      id, type: body.type, title: body.title, description: body.description,
      owner:     body.owner ?? req.user!.nameAr,
      ownerId:   body.ownerId ?? req.user!.userId,
      department:body.department,
      status:    body.status, priority: body.priority, riskLevel: body.riskLevel,
      impactLevel: body.impactLevel, confidentiality: body.confidentiality,
      financialImpactJson: body.financialImpact, legalImpact: body.legalImpact,
      complianceImpact: body.complianceImpact,
      dueDate:    body.dueDate ? new Date(body.dueDate) : undefined,
      reviewDate: body.reviewDate ? new Date(body.reviewDate) : undefined,
      dataJson:   body.data ?? {},
      linkedPolicies:   body.linkedPolicies, linkedRisks:     body.linkedRisks,
      linkedControls:   body.linkedControls, linkedEvidence:  body.linkedEvidence,
      linkedRegulations:body.linkedRegulations, linkedFindings: body.linkedFindings,
      linkedCAPAs:      body.linkedCAPAs, linkedDecisions: body.linkedDecisions,
      linkedObligations:body.linkedObligations, tags: body.tags,
      version: 1, tenantId: req.user!.tenantId,
      organizationId: process.env.ORG_ID ?? "default",
      createdBy: req.user!.userId, updatedBy: req.user!.userId,
    };

    // Auto-create graph edges — errors logged but do not fail the request
    const edgeMaps = [
      { ids: body.linkedRisks ?? [],        rel:"creates_risk",     toType:"risk"          },
      { ids: body.linkedControls ?? [],     rel:"enforced_by",      toType:"control"       },
      { ids: body.linkedPolicies ?? [],     rel:"governs",          toType:"policy"        },
      { ids: body.linkedEvidence ?? [],     rel:"evidenced_by",     toType:"evidence"      },
      { ids: body.linkedFindings ?? [],     rel:"produces_finding", toType:"audit_finding" },
    ];
    for (const { ids, rel, toType } of edgeMaps) {
      for (const toId of ids as string[]) {
        const target = await EntityDAO.findOne(toId, req.user!.tenantId);
        if (!target) {
          console.warn(`[entities/POST] Linked entity not found: ${toId} — edge skipped`);
          continue;
        }
        await EntityDAO.upsertEdge({
          fromId: id, fromType: body.type, toId, toType,
          relationship: rel, tenantId: req.user!.tenantId, createdBy: req.user!.userId,
        });
      }
    }

    // V5.2A unified pattern: the INSERT itself runs on the audit transaction,
    // so there is no verification SELECT and no compensating delete.
    let entity;
    try {
      entity = await auditedMutation(
        req.user!.tenantId,
        (tx) => EntityDAO.createIn(tx, entityPayload),
        async (tx, created) => {
          await AuditDAO.logIn(tx, {
            action: `${body.type}.created`, entityId: id, entityType: body.type,
            performedBy: req.user!.userId, role: req.user!.role,
            tenantId: req.user!.tenantId, next: { title: body.title, type: body.type },
          });
        },
      );
    } catch (err) {
      next(err);
      return;
    }
    res.status(201).json(entity);
  },
);

// PATCH /api/entities/:id
entitiesRouter.patch(
  "/:id",
  checkPermission("entity:update"),
  validate(UpdateEntitySchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const existing = await EntityDAO.findOne(String(req.params.id), req.user!.tenantId);
    if (!existing) { res.status(404).json({ error: "Entity not found" }); return; }
    // V5.2: the update and its audit record commit or roll back TOGETHER.
    // A governance mutation that leaves no audit trace is a integrity failure.
    let updated: Record<string, unknown> | null = null;
    try {
      updated = await auditedMutation(
        req.user!.tenantId,
        async (tx) => {
          const sets: string[] = []; const vals: unknown[] = [];
          for (const [k, v] of Object.entries(req.body as Record<string, unknown>)) {
            sets.push(`"${k}" = $${vals.length + 1}`); vals.push(v);
          }
          if (sets.length === 0) return existing as unknown as Record<string, unknown>;
          vals.push(String(req.params.id), req.user!.tenantId);
          const rows = await tx.query<Record<string, unknown>>(
            `UPDATE "GovernanceEntity" SET ${sets.join(", ")}, "updatedAt" = NOW()
              WHERE id = $${vals.length - 1} AND "tenantId" = $${vals.length} RETURNING *`, vals);
          return rows[0] ?? null;
        },
        async (tx, result) => {
          if (!result) return;
          await AuditDAO.logIn(tx, {
            action: `${existing.type}.updated`, entityId: String(req.params.id),
            entityType: existing.type, performedBy: req.user!.userId, role: req.user!.role,
            tenantId: req.user!.tenantId,
            previous: { status: existing.status, version: existing.version },
            next: req.body,
          });
        },
      );
    } catch (err) {
      next(err);
      return;
    }
    if (!updated) { res.status(404).json({ error: "Update failed" }); return; }
    res.json(updated);
  },
);

// DELETE /api/entities/:id (soft archive)
entitiesRouter.delete(
  "/:id",
  checkPermission("entity:archive"),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const entity = await EntityDAO.findOne(String(req.params.id), req.user!.tenantId);
    if (!entity) { res.status(404).json({ error: "Entity not found" }); return; }
    try {
      await auditedMutation(
        req.user!.tenantId,
        async (tx) => tx.query(
          `UPDATE "GovernanceEntity" SET status='archived', "updatedAt"=NOW()
            WHERE id=$1 AND "tenantId"=$2`, [String(req.params.id), req.user!.tenantId]),
        async (tx) => {
          await AuditDAO.logIn(tx, {
            action: `${entity.type}.archived`, entityId: String(req.params.id),
            entityType: entity.type, performedBy: req.user!.userId,
            role: req.user!.role, tenantId: req.user!.tenantId,
          });
        },
      );
    } catch (err) {
      next(err);
      return;
    }
    res.json({ message: "Archived", id: req.params.id });
  },
);
