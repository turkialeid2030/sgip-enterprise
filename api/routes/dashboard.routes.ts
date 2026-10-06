
import { Router, Request, Response } from "express";
import { query, queryOne } from "../services/db.service";
import { AuditDAO } from "../services/audit.dao";
import { AgentDAO } from "../services/agent.dao";
import { authMiddleware } from "../middleware/auth.middleware";
import { validateQuery } from "../middleware/validate.middleware";
import { AuditLogQuerySchema } from "../validation/entity.schemas";
import { checkPermission } from "../middleware/rbac.middleware";

export const dashboardRouter = Router();

// PUBLIC — infrastructure health check, intentionally unauthenticated.
dashboardRouter.get("/health", async (_req, res) => {
  try {
    await queryOne("SELECT 1 AS ok");
    res.json({ status: "healthy", db: "connected", timestamp: new Date().toISOString() });
  } catch (_err) {
    res.status(503).json({ status: "unhealthy", db: "disconnected", error: "Database unavailable", code: "DATA_UNAVAILABLE" });
  }
});

dashboardRouter.use(authMiddleware);

dashboardRouter.get("/summary",
  checkPermission("dashboard:read"),
  async (req: Request, res: Response): Promise<void> => {
    const tid = req.user!.tenantId;
    const [
      counts, breachCount, openFindings, overdueCapas,
      pendingOutputs, edgeCount, recentLogs,
    ] = await Promise.all([
      query<{ type:string; count:string }>(
        `SELECT type, COUNT(*) AS count FROM "GovernanceEntity"
         WHERE "tenantId"=$1 AND status!='archived' GROUP BY type`, [tid],
      ),
      query<{ count:string }>(
        `SELECT COUNT(*) AS count FROM "GovernanceEntity"
         WHERE "tenantId"=$1 AND type='risk'
           AND "dataJson"->>'toleranceBreached' = 'true'`, [tid],
      ),
      query<{ count:string }>(
        `SELECT COUNT(*) AS count FROM "GovernanceEntity"
         WHERE "tenantId"=$1 AND type='audit_finding'
           AND status IN ('active','draft','under_review')`, [tid],
      ),
      query<{ count:string }>(
        `SELECT COUNT(*) AS count FROM "GovernanceEntity"
         WHERE "tenantId"=$1 AND type='capa' AND status='overdue'`, [tid],
      ),
      AgentDAO.count(tid, "pending"),
      queryOne<{ count:string }>(
        `SELECT COUNT(*) AS count FROM "GraphEdge" WHERE "tenantId"=$1`, [tid],
      ),
      AuditDAO.findRecent(tid, 10),
    ]);

    const byType: Record<string, number> = {};
    for (const r of counts) byType[r.type] = parseInt(r.count);

    res.json({
      totalEntities:    Object.values(byType).reduce((a, b) => a + b, 0),
      byType,
      criticalRisks:    byType["risk"] ?? 0,
      breachedRisks:    parseInt(breachCount[0]?.count ?? "0"),
      openFindings:     parseInt(openFindings[0]?.count ?? "0"),
      overdueCapas:     parseInt(overdueCapas[0]?.count ?? "0"),
      pendingOutputs,
      graphEdgeCount:   parseInt(edgeCount?.count ?? "0"),
      recentActivity:   recentLogs,
      generatedAt:      new Date().toISOString(),
    });
  },
);

dashboardRouter.get("/audit-logs",
  checkPermission("dashboard:read"),
  validateQuery(AuditLogQuerySchema),
  async (req: Request, res: Response): Promise<void> => {
    const { limit, entityType } = (req as any).validatedQuery as { limit: number; entityType?: string };
    const logs = await AuditDAO.findRecent(req.user!.tenantId, limit, entityType);
    res.json(logs);
  },
);

