import { randomUUID } from "crypto";
import type { Request, Response, NextFunction } from "express";

const SAFE_ID = /^[A-Za-z0-9._:-]{8,128}$/;
const DEFAULT_ERROR_CODES: Record<number, string> = {
  400: "VALIDATION_ERROR",
  401: "AUTHENTICATION_REQUIRED",
  403: "ACCESS_DENIED",
  404: "RESOURCE_NOT_FOUND",
  409: "RESOURCE_CONFLICT",
  422: "VALIDATION_ERROR",
  429: "RATE_LIMITED",
  500: "INTERNAL_ERROR",
  503: "DATA_UNAVAILABLE",
};

/**
 * Assign a request correlation id before auth/routing so every response —
 * including direct 401/403/404/422 handlers — is traceable. Error JSON bodies
 * also receive the id, while the response header remains the primary transport.
 */
export function correlationMiddleware(req: Request, res: Response, next: NextFunction): void {
  const inbound = String(req.headers["x-correlation-id"] ?? req.headers["x-request-id"] ?? "").trim();
  const correlationId = inbound && SAFE_ID.test(inbound) ? inbound : randomUUID();
  res.locals.correlationId = correlationId;
  res.setHeader("X-Correlation-Id", correlationId);

  // Several legacy handlers still return their own 4xx JSON rather than calling
  // next(err). Preserve their public schema but add the same correlation id.
  const originalJson = res.json.bind(res);
  res.json = ((body: unknown) => {
    if (res.statusCode >= 400 && body && typeof body === "object" && !Array.isArray(body)) {
      const record = body as Record<string, unknown>;
      const enriched = { ...record };
      if (enriched.code === undefined) enriched.code = DEFAULT_ERROR_CODES[res.statusCode] ?? "HTTP_ERROR";
      if (enriched.correlationId === undefined) enriched.correlationId = correlationId;
      body = enriched;
    }
    return originalJson(body);
  }) as Response["json"];

  next();
}
