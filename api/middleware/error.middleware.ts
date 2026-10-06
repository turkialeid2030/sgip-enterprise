import type { Request, Response, NextFunction } from "express";

type ErrorLike = Error & { statusCode?: number; status?: number; code?: string; cause?: unknown };

const SAFE_CODES = new Set([
  "VALIDATION_ERROR",
  "AUTHENTICATION_REQUIRED",
  "ACCESS_DENIED",
  "RESOURCE_NOT_FOUND",
  "RESOURCE_CONFLICT",
  "CONCURRENT_APPROVAL_STATE_CHANGED",
  "TENANT_CONTEXT_REQUIRED",
  "CROSS_TENANT_ACCESS",
  "MISSING_TENANT_CONTEXT",
  "DATA_UNAVAILABLE",
  "AI_SERVICE_UNAVAILABLE",
]);

function redact(value: string): string {
  let out = value;
  // Redact configured secrets if they appear in provider/driver diagnostics.
  for (const name of ["JWT_SECRET", "JWT_REFRESH_SECRET", "ANTHROPIC_API_KEY", "APP_DB_PASSWORD", "MIGRATOR_DB_PASSWORD"]) {
    const secret = process.env[name];
    if (secret && secret.length >= 8) out = out.split(secret).join(`[REDACTED:${name}]`);
  }
  // Redact credentials embedded in connection URLs and common header/key forms.
  out = out.replace(/(postgres(?:ql)?:\/\/[^:\s]+:)[^@\s]+(@)/gi, "$1[REDACTED]$2");
  out = out.replace(/(authorization\s*[:=]\s*bearer\s+)[A-Za-z0-9._~+\/-]+/gi, "$1[REDACTED]");
  out = out.replace(/((?:api[_-]?key|password|secret|token)\s*[:=]\s*)[^,;\s]+/gi, "$1[REDACTED]");
  return out;
}

function isDbUnavailable(err: ErrorLike): boolean {
  const msg = String(err.message ?? "").toLowerCase();
  const code = String(err.code ?? "");
  return ["ECONNREFUSED", "ECONNRESET", "57P01", "57P02", "57P03", "08000", "08001", "08003", "08004", "08006", "08007", "08P01"].includes(code)
    || msg.includes("connection refused")
    || msg.includes("database did not become available")
    || msg.includes("database unreachable");
}

function classify(err: ErrorLike): { status: number; code: string; message: string } {
  const explicit = Number(err.statusCode ?? err.status);
  const code = String(err.code ?? "");

  if (isDbUnavailable(err) || code === "DATA_UNAVAILABLE") {
    return { status: 503, code: "DATA_UNAVAILABLE", message: "Service temporarily unavailable" };
  }
  if (code === "AI_SERVICE_UNAVAILABLE") {
    return { status: 503, code, message: "AI service temporarily unavailable" };
  }
  if (Number.isInteger(explicit) && explicit >= 400 && explicit <= 599) {
    const safeCode = SAFE_CODES.has(code) ? code : ({
      400: "VALIDATION_ERROR", 401: "AUTHENTICATION_REQUIRED", 403: "ACCESS_DENIED",
      404: "RESOURCE_NOT_FOUND", 409: "RESOURCE_CONFLICT", 422: "VALIDATION_ERROR",
      503: "DATA_UNAVAILABLE",
    } as Record<number, string>)[explicit] ?? "INTERNAL_ERROR";
    const safeMessage = ({
      400: "Invalid request", 401: "Authentication required", 403: "Access denied",
      404: "Resource not found", 409: "Resource conflict", 422: "Validation failed",
      503: "Service temporarily unavailable",
    } as Record<number, string>)[explicit] ?? "Internal server error";
    return { status: explicit, code: safeCode, message: safeMessage };
  }
  return { status: 500, code: "INTERNAL_ERROR", message: "Internal server error" };
}

/**
 * Unified fail-closed HTTP error boundary. Raw diagnostics stay in the internal
 * log only; the response contract is identical in development and production.
 */
export function errorMiddleware(err: ErrorLike, req: Request, res: Response, next: NextFunction): void {
  const correlationId = String(res.locals.correlationId ?? "unknown");
  const classified = classify(err);
  const message = redact(String(err.message ?? err));
  const stack = redact(String(err.stack ?? "NO_STACK"));
  const route = `${req.method} ${req.originalUrl}`;

  console.error(JSON.stringify({
    level: "error",
    event: "request_failed",
    correlationId,
    route,
    status: classified.status,
    code: classified.code,
    errorName: err.name ?? "Error",
    message,
    stack,
  }));

  if (res.headersSent) { next(err); return; }
  res.status(classified.status).json({
    error: classified.message,
    code: classified.code,
    correlationId,
  });
}
