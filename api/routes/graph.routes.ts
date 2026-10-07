import { auditedMutation } from "../services/db.service";

import { Router, Request, Response, NextFunction } from "express";
import { EntityDAO } from "../services/entity.dao";
import { AuditDAO } from "../services/audit.dao";
import { query } from "../services/db.service";
import { authMiddleware } from "../middleware/auth.middleware";
import { checkPermission } from "../middleware/rbac.middleware";
import { validate, validateQuery } from "../middleware/validate.middleware";
import { CreateEdgeSchema, TraceQuerySchema } from "../validation/entity.schemas";

export const graphRouter = Router();
graphRouter.use(authMiddleware);

// GET /api/graph/blind-spots
graphRouter.get("/blind-spots",
  checkPermission("graph:read"),
  async (req: Request, res: Response): Promise<void> => {
    const tenantId = req.user!.tenantId;
    // Risks with no mitigating controls
    const isolatedRisks = await query(
      `SELECT e.id, e.type, e.title, e."riskLevel"
       FROM "GovernanceEntity" e
       WHERE e."tenantId"=$1 AND e.type='risk' AND e.status!='archived'
         AND NOT EXISTS (
           SELECT 1 FROM "GraphEdge" g WHERE (g."fromId"=e.id OR g."toId"=e.id)
             AND g."tenantId"=$1 AND g.relationship IN ('mitigates','enforced_by')
         )`,
      [tenantId],
    );
    // Compliance obligations with no linked controls
    const uncoveredObligations = await query(
      `SELECT e.id, e.type, e.title
       FROM "GovernanceEntity" e
       WHERE e."tenantId"=$1 AND e.type='compliance_obligation' AND e.status!='archived'
         AND NOT EXISTS (
           SELECT 1 FROM "GraphEdge" g WHERE g."fromId"=e.id AND g."tenantId"=$1
             AND g.relationship IN ('addresses','enforced_by')
         )`,
      [tenantId],
    );
    // Findings with no evidence
    const findingsNoEvidence = await query(
      `SELECT e.id, e.type, e.title, e."riskLevel"
       FROM "GovernanceEntity" e
       WHERE e."tenantId"=$1 AND e.type='audit_finding' AND e.status!='archived'
         AND (e."linkedEvidence" = '{}' OR e."linkedEvidence" IS NULL)`,
      [tenantId],
    );
    res.json({ isolatedRisks, uncoveredObligations, findingsNoEvidence });
  },
);


// GET /api/graph/node/:id
graphRouter.get(["/node/:nodeId", "/:nodeId"],
  checkPermission("graph:read"),
  async (req: Request, res: Response): Promise<void> => {
    const entity = await EntityDAO.findOne(String(req.params.nodeId), req.user!.tenantId);
    if (!entity) { res.status(404).json({ error: "Node not found" }); return; }
    const [outEdges, inEdges] = await Promise.all([
      EntityDAO.getEdges(entity.id, entity.tenantId),
      EntityDAO.getInEdges(entity.id, entity.tenantId),
    ]);
    res.json({ node: { id: entity.id, type: entity.type, label: entity.title, properties: { status: entity.status, riskLevel: entity.riskLevel, owner: entity.owner } }, outEdges, inEdges });
  },
);

// POST /api/graph/edge
graphRouter.post("/edge",
  checkPermission("graph:write"),
  validate(CreateEdgeSchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const { fromId, toId, relationship, weight } = req.body as { fromId:string; toId:string; relationship:string; weight:number };
    const [from, to] = await Promise.all([
      EntityDAO.findOne(fromId, req.user!.tenantId),
      EntityDAO.findOne(toId,   req.user!.tenantId),
    ]);
    if (!from || !to) { res.status(404).json({ error: "One or both entities not found" }); return; }
    // V5.2A invariant: graph edge + audit event commit or roll back together.
    try {
      await auditedMutation(
        req.user!.tenantId,
        async (tx) => {
          await tx.query(
            `INSERT INTO "GraphEdge" (id,"fromId","fromType","toId","toType",relationship,weight,"tenantId","createdBy")
             VALUES (gen_random_uuid(),$1,$2,$3,$4,$5,$6,$7,$8)
             ON CONFLICT DO NOTHING`,
            [fromId, from.type, toId, to.type, relationship, weight ?? 1,
             req.user!.tenantId, req.user!.userId]);
          return { fromId, toId, relationship, weight };
        },
        async (tx) => {
          await AuditDAO.logIn(tx, {
            action: "graph.edge_created", entityId: fromId, entityType: from.type as string,
            performedBy: req.user!.userId, role: req.user!.role,
            tenantId: req.user!.tenantId, next: { fromId, toId, relationship },
          });
        },
      );
    } catch (err) {
      next(err);
      return;
    }
    res.status(201).json({ fromId, toId, relationship, weight });
  },
);

// GET /api/graph/trace/:id
graphRouter.get("/trace/:id",
  checkPermission("graph:read"),
  validateQuery(TraceQuerySchema),
  async (req: Request, res: Response): Promise<void> => {
    const { depth: maxDepth } = (req as any).validatedQuery as { depth: number };
    const visited  = new Set<string>();
    const nodes:   unknown[] = [];
    const edges:   unknown[] = [];

    const traverse = async (nodeId: string, depth: number): Promise<void> => {
      if (depth > maxDepth || visited.has(nodeId)) return;
      visited.add(nodeId);
      const entity = await EntityDAO.findOne(nodeId, req.user!.tenantId);
      if (!entity) return;
      nodes.push({ id: entity.id, type: entity.type, label: entity.title, depth, status: entity.status, riskLevel: entity.riskLevel });
      const outgoing = await query<{ toId:string; relationship:string; weight:number }>(
        `SELECT "toId", relationship, weight FROM "GraphEdge" WHERE "fromId"=$1 AND "tenantId"=$2`,
        [nodeId, req.user!.tenantId],
      );
      for (const e of outgoing) {
        edges.push({ fromId: nodeId, ...e });
        await traverse(e.toId, depth + 1);
      }
    };
    await traverse(String(req.params.id), 0);
    res.json({ startId: String(req.params.id), nodes, edges, maxDepth });
  },
);
