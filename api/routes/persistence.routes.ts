/**
 * Persistence API Routes — Phase 5.12
 * Internal operational routes for persistence layer management.
 */
import { Router, Request, Response } from "express";
import { z } from "zod";
import { authMiddleware } from "../middleware/auth.middleware";
import { checkPermission } from "../middleware/rbac.middleware";
import { validate } from "../middleware/validate.middleware";
import { injectTenantContext } from "../../tenant/tenant.context";
import { getEventStore } from "../../runtime/persistence/persistent.event.store";
import { getReplayEngine } from "../../runtime/replay-engine/event.replay.engine";
import { getSnapshotEngine } from "../../runtime/snapshot-recovery/snapshot.recovery.engine";
import { getIdentityResolutionEngine } from "../../runtime/identity-resolution/identity.resolution.engine";
import { CorruptionGuards } from "../../runtime/corruption-guards/corruption.guards";

export const persistenceRouter = Router();
persistenceRouter.use(authMiddleware);
persistenceRouter.use(injectTenantContext);

const AppendSchema = z.object({
  topic:           z.string().min(1),
  payload:         z.record(z.unknown()).default({}),
  actorId:         z.string().min(1),
  actorRole:       z.string().min(1),
  correlationId:   z.string().optional(),
  idempotencyKey:  z.string().optional(),
});

const ReplaySchema = z.object({
  topic:          z.string().optional(),
  correlationId:  z.string().optional(),
  fromTimestamp:  z.string().optional(),
  toTimestamp:    z.string().optional(),
  fromSeq:        z.coerce.number().optional(),
  limit:          z.coerce.number().int().min(1).max(10000).optional(),
});

const ResolveSchema = z.object({
  entityType: z.string().min(1),
  code:       z.string().min(1),
  name:       z.string().min(1),
  externalId: z.string().optional(),
});

// GET /api/persistence/events — event store stats
persistenceRouter.get("/events", checkPermission("dashboard:read"), (req:Request, res:Response): void => {
  const store = getEventStore(req.tenantCtx!.tenantId);
  const stats = store.getStats();
  res.json(stats);
});

// POST /api/persistence/events — append event
persistenceRouter.post("/events", checkPermission("entity:create"), validate(AppendSchema), (req:Request, res:Response): void => {
  const store = getEventStore(req.tenantCtx!.tenantId);
  const event = store.append({ ...req.body, actorId:req.user!.userId, actorRole:req.user!.role });
  res.status(201).json(event);
});

// GET /api/persistence/events/integrity — validate hash chain
persistenceRouter.get("/events/integrity", checkPermission("dashboard:read"), (req:Request, res:Response): void => {
  const store = getEventStore(req.tenantCtx!.tenantId);
  const result = store.validateChain();
  res.json({ tenantId:req.tenantCtx!.tenantId, ...result });
});

// POST /api/persistence/replay — replay events
persistenceRouter.post("/replay", checkPermission("entity:read"), validate(ReplaySchema), async (req:Request, res:Response): Promise<void> => {
  const engine = getReplayEngine(req.tenantCtx!.tenantId);
  const result = await engine.replay(req.body);
  res.json(result);
});

// GET /api/persistence/snapshots — list snapshots
persistenceRouter.get("/snapshots", checkPermission("dashboard:read"), (req:Request, res:Response): void => {
  const engine = getSnapshotEngine(req.tenantCtx!.tenantId);
  const snaps  = engine.getSnapshots();
  res.json({ snapshots:snaps, count:snaps.length });
});

// POST /api/persistence/snapshots — take snapshot
persistenceRouter.post("/snapshots", checkPermission("entity:create"), (req:Request, res:Response): void => {
  const engine = getSnapshotEngine(req.tenantCtx!.tenantId);
  const snap   = engine.takeSnapshot(req.body);
  res.status(201).json(snap);
});

// POST /api/persistence/recovery — recover from latest snapshot
persistenceRouter.post("/recovery", checkPermission("entity:create"), async (req:Request, res:Response): Promise<void> => {
  const engine = getSnapshotEngine(req.tenantCtx!.tenantId);
  const result = await engine.recoverFromLatestSnapshot();
  res.json(result);
});

// POST /api/persistence/identity-resolution — resolve canonical entity
persistenceRouter.post("/identity-resolution", checkPermission("entity:create"), validate(ResolveSchema), (req:Request, res:Response): void => {
  const engine = getIdentityResolutionEngine(req.tenantCtx!.tenantId);
  const result = engine.resolve(req.body);
  res.json(result);
});

// GET /api/persistence/integrity-check — run all corruption guards
persistenceRouter.get("/integrity-check", checkPermission("dashboard:read"), (req:Request, res:Response): void => {
  const tenantId  = req.tenantCtx!.tenantId;
  const store     = getEventStore(tenantId);
  const chainCheck= store.validateChain();
  const violations= CorruptionGuards.getViolations(tenantId);
  const irViolations = getIdentityResolutionEngine(tenantId).getViolations();
  res.json({
    tenantId, checkedAt:new Date().toISOString(),
    chainIntegrity: chainCheck,
    corruptionViolations: violations.length,
    identityViolations:   irViolations.length,
    overallHealthy: chainCheck.valid && violations.length === 0 && irViolations.length === 0,
  });
});
