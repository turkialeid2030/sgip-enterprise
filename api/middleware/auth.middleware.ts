import { runInTenantScope } from "../services/db.service";
import { requireSecret } from "../config/secrets";

import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";

export interface AuthPayload {
  userId:   string;
  email:    string;
  role:     string;
  tenantId: string;
  nameAr:   string;
}

declare global {
  namespace Express {
    interface Request { user?: AuthPayload; }
  }
}

export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Missing or invalid Authorization header" });
    return;
  }
  const token = header.slice(7);
  let payload: AuthPayload;
  try {
    payload = jwt.verify(token, requireSecret("JWT_SECRET")) as AuthPayload;
  } catch (err) {
    // jwt.verify throws on invalid/expired token — 401 is the correct response
    void err;  // error detail not exposed to client for security
    res.status(401).json({ error: "Invalid or expired token" });
    return;
  }
  req.user = payload;

  // Bind the tenant for the whole downstream request so every DAO query runs
  // with app.tenant_id set. Kept OUTSIDE the jwt try/catch: a scope-binding
  // failure is a 403 tenancy error, not an invalid token.
  if (payload.tenantId) {
    // runInTenantScope is async: synchronous validation failures are surfaced as
    // rejected promises, so a surrounding try/catch cannot observe them. Route
    // the rejection into Express' unified error boundary instead of allowing an
    // unhandled rejection or fabricating an authentication error.
    void runInTenantScope(payload.tenantId, async () => { next(); }).catch(next);
    return;
  }
  next();
}

export function requireRole(...roles: string[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) { res.status(401).json({ error: "Unauthorized" }); return; }
    if (roles.length && !roles.includes(req.user.role)) {
      res.status(403).json({ error: `Role "${req.user.role}" not permitted. Required: ${roles.join("|")}` });
      return;
    }
    next();
  };
}
