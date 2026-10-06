/**
 * Tenant Context Layer
 * The ONLY way to get a TenantContext.
 * Every service, repository, and graph operation must receive it.
 * No operation proceeds without a valid, verified tenant context.
 */
import { v4 as uuidv4 } from "uuid";
import { TenantContext, TenantViolation } from "../types/tenant.types";
import { AuditDAO } from "../api/services/audit.dao";

// ── Express request enrichment ────────────────────────────────
declare global {
  namespace Express {
    interface Request {
      tenantCtx?: TenantContext;
    }
  }
}

export function buildTenantContext(params: {
  tenantId:       string;
  organizationId: string;
  userId:         string;
  userRole:       string;
  sessionId?:     string;
  requestId?:     string;
}): TenantContext {
  if (!params.tenantId || params.tenantId.trim() === "") {
    throw new Error("TenantContext: tenantId is required and cannot be empty");
  }
  if (!params.userId || params.userId.trim() === "") {
    throw new Error("TenantContext: userId is required and cannot be empty");
  }
  return {
    tenantId:       params.tenantId,
    organizationId: params.organizationId,
    userId:         params.userId,
    userRole:       params.userRole,
    sessionId:      params.sessionId  ?? uuidv4(),
    requestId:      params.requestId  ?? uuidv4(),
    timestamp:      new Date().toISOString(),
  };
}

// ── Middleware: inject TenantContext from JWT ─────────────────
export function injectTenantContext(
  req: import("express").Request,
  res: import("express").Response,
  next: import("express").NextFunction,
): void {
  if (!req.user) {
    // Public routes — no context needed
    next();
    return;
  }
  try {
    req.tenantCtx = buildTenantContext({
      tenantId:       req.user.tenantId,
      organizationId: process.env.ORG_ID ?? "default",
      userId:         req.user.userId,
      userRole:       req.user.role,
      requestId:      String(res.locals.correlationId ?? req.headers["x-request-id"] ?? "") || undefined,
    });
    next();
  } catch (_err) {
    res.status(400).json({ error: "Invalid tenant context", code: "TENANT_CONTEXT_REQUIRED" });
  }
}

// ── Guard: enforce entity belongs to tenant ───────────────────
export function assertTenantOwnership(
  ctx:      TenantContext,
  entityTenantId: string,
  entityId: string,
  entityType: string,
): void {
  if (entityTenantId !== ctx.tenantId) {
    const violation: TenantViolation = {
      type:        "cross_tenant_access",
      sourceId:    ctx.tenantId,
      targetId:    entityTenantId,
      entityType,
      actorId:     ctx.userId,
      timestamp:   new Date().toISOString(),
      blocked:     true,
    };
    // Log asynchronously — don't let logging delay the throw
    logViolation(violation, ctx).catch((e: Error) => {
      console.error("[TenantContext] Failed to log violation:", e.message);
    });
    throw Object.assign(
      new Error(`Cross-tenant access blocked: entity ${entityId} (${entityType}) belongs to a different tenant`),
      { statusCode: 403, code: "CROSS_TENANT_ACCESS", violation },
    );
  }
}

// ── Validation helpers ────────────────────────────────────────
export function requireTenantContext(
  ctx: TenantContext | undefined,
  operation: string,
): asserts ctx is TenantContext {
  if (!ctx) {
    throw Object.assign(
      new Error(`Missing TenantContext for operation: ${operation}`),
      { statusCode: 400, code: "MISSING_TENANT_CONTEXT" },
    );
  }
}

// ── Violation logging ─────────────────────────────────────────
async function logViolation(violation: TenantViolation, ctx: TenantContext): Promise<void> {
  await AuditDAO.log({
    action:      `tenant.${violation.type}`,
    entityType:  violation.entityType as any,
    performedBy: ctx.userId,
    role:        ctx.userRole,
    tenantId:    ctx.tenantId,
    traceId:     ctx.requestId,
    next:        violation,
  });
}
