/**
 * Governance Graph Runtime API — the 10 governance intelligence queries.
 * Every query goes through GraphResolver → typed graph runtime.
 * No raw SQL — all answers come from the graph knowledge layer.
 */
import { Router, Request, Response } from "express";
import { z } from "zod";
import { authMiddleware } from "../middleware/auth.middleware";
import { checkPermission } from "../middleware/rbac.middleware";
import { injectTenantContext } from "../../tenant/tenant.context";
import { GraphResolver, GraphQueryType } from "../../graph/resolvers/graph.resolver";
import { getGraphRuntime } from "../../graph/runtime/governance.graph.runtime";
import { getEvidenceEngine } from "../../evidence/lineage/evidence.lineage.engine";
import { chainVerifier } from "../../evidence/verification/chain.verifier";
import { evidenceRetentionManager } from "../../evidence/retention/evidence.retention";
import { globalSignalMonitor } from "../../observability/governance-signals/governance.signal.monitor";
import { healthMonitor } from "../../observability/health/health.monitor";
import { globalAlertEngine } from "../../observability/alerts/alert.engine";
import { validate } from "../middleware/validate.middleware";

export const graphRuntimeRouter = Router();
graphRuntimeRouter.use(authMiddleware);
graphRuntimeRouter.use(injectTenantContext);

// ── Governance Query Engine ───────────────────────────────────
const QuerySchema = z.object({
  queryType:  z.string().min(1),
  entityId:   z.string().optional(),
  fromId:     z.string().optional(),
  toId:       z.string().optional(),
  action:     z.string().optional(),
  changeType: z.string().optional(),
  maxPaths:   z.coerce.number().int().min(1).max(10).optional(),
});

// POST /api/graph-runtime/query
graphRuntimeRouter.post("/query",
  checkPermission("graph:read"),
  validate(QuerySchema),
  async (req: Request, res: Response): Promise<void> => {
    const { queryType, entityId, fromId, toId, action, changeType, maxPaths } = req.body;
    const resolver = GraphResolver.forTenant(req.tenantCtx!);
    const result = resolver.resolve(queryType as GraphQueryType, { entityId, fromId, toId, action, changeType, maxPaths });
    res.json({ queryType, result });
  },
);

// GET /api/graph-runtime/stats
graphRuntimeRouter.get("/stats",
  checkPermission("graph:read"),
  async (req: Request, res: Response): Promise<void> => {
    const runtime = getGraphRuntime(req.tenantCtx!.tenantId);
    const stats   = runtime.getStats();
    res.json(stats);
  },
);

// GET /api/graph-runtime/blind-spots (advanced)
graphRuntimeRouter.get("/blind-spots",
  checkPermission("graph:read"),
  async (req: Request, res: Response): Promise<void> => {
    const runtime = getGraphRuntime(req.tenantCtx!.tenantId);
    const orphans = runtime.detectOrphans();
    const cycles  = runtime.detectCycles();
    res.json({
      orphanNodes:     orphans.length,
      orphanDetails:   orphans.map(n => ({ id:n.id, type:n.type, label:n.label })),
      cyclesDetected:  cycles.length,
      cycles:          cycles.slice(0, 10),
    });
  },
);

// GET /api/graph-runtime/evidence-chain/:entityId
graphRuntimeRouter.get("/evidence-chain/:entityId",
  checkPermission("graph:read"),
  async (req: Request, res: Response): Promise<void> => {
    const report = chainVerifier.verify(String(req.params.entityId), req.tenantCtx!);
    res.json(report);
  },
);

// GET /api/graph-runtime/retention-scan
graphRuntimeRouter.get("/retention-scan",
  checkPermission("entity:read"),
  async (req: Request, res: Response): Promise<void> => {
    const result = evidenceRetentionManager.scan(req.tenantCtx!);
    res.json(result);
  },
);

// GET /api/graph-runtime/health
graphRuntimeRouter.get("/health",
  checkPermission("dashboard:read"),
  async (_req: Request, res: Response): Promise<void> => {
    const health = await healthMonitor.getSystemHealth();
    res.status(health.status === "unhealthy" ? 503 : 200).json(health);
  },
);

// GET /api/graph-runtime/governance-signals
graphRuntimeRouter.get("/governance-signals",
  checkPermission("dashboard:read"),
  async (req: Request, res: Response): Promise<void> => {
    const snapshot = globalSignalMonitor.getHealthSnapshot(req.tenantCtx!.tenantId);
    res.json(snapshot);
  },
);

// GET /api/graph-runtime/alerts
graphRuntimeRouter.get("/alerts",
  checkPermission("dashboard:read"),
  async (req: Request, res: Response): Promise<void> => {
    globalAlertEngine.registerBuiltinRules(req.tenantCtx!.tenantId);
    const newAlerts    = globalAlertEngine.evaluate(req.tenantCtx!.tenantId);
    const activeAlerts = globalAlertEngine.getActiveAlerts(req.tenantCtx!.tenantId);
    res.json({ activeAlerts, newAlerts, count: activeAlerts.length });
  },
);
