import { requireSecret } from "../config/secrets";

import { Router, Request, Response, NextFunction } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { v4 as uuidv4 } from "uuid";
import { query, queryOne, withTenant, runInTenantScope, auditedMutation } from "../services/db.service";
import { AuditDAO } from "../services/audit.dao";
import { validate } from "../middleware/validate.middleware";
import { checkPermission } from "../middleware/rbac.middleware";
import { authMiddleware } from "../middleware/auth.middleware";
import { LoginSchema, RegisterSchema } from "../validation/entity.schemas";

export const authRouter = Router();

// PUBLIC — no auth required (issues JWT)
authRouter.post("/login", validate(LoginSchema), async (req: Request, res: Response): Promise<void> => {
  const { email, password, tenantId } = req.body as { email: string; password: string; tenantId: string };
  // FORCE RLS is enabled on "User": a read without app.tenant_id returns nothing.
  // Bind the tenant context for the requested tenant inside a transaction.
  const user = await withTenant(tenantId, (tx) => tx.queryOne<{
    id:string; email:string; nameAr:string; role:string; tenantId:string;
    passwordHash:string; isActive:boolean;
  }>(
    `SELECT id, email, "nameAr", role, "tenantId", "passwordHash", "isActive"
       FROM "User" WHERE email = $1 AND "tenantId" = $2 LIMIT 1`,
    [email, tenantId],
  ));
  if (!user || !user.isActive) {
    res.status(401).json({ error: "Invalid credentials" });
    return;
  }
  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    res.status(401).json({ error: "Invalid credentials" });
    return;
  }
  const token = jwt.sign(
    { userId: user.id, email: user.email, role: user.role, tenantId: user.tenantId, nameAr: user.nameAr },
    requireSecret("JWT_SECRET"),
    { expiresIn: (process.env.JWT_EXPIRES_IN ?? "8h") as jwt.SignOptions["expiresIn"] },
  );
  // ── AUDIT CLASSIFICATION (V5.2A item 1) ──────────────────────
  // login/refresh/logout are SECURITY TELEMETRY, not governance mutations.
  // They are deliberately NOT wrapped in auditedMutation():
  //   * lastLoginAt is telemetry — losing it does not misstate governance
  //   * failing a successful authentication because a telemetry row could not
  //     be written would be a denial-of-service on login
  // Governance mutations (entity/policy/approval/graph/user) DO use the atomic
  // contract. This separation is intentional and documented.
  await runInTenantScope(user.tenantId, async () => {
    await query(`UPDATE "User" SET "lastLoginAt" = NOW() WHERE id = $1`, [user.id]);
    await AuditDAO.log({ action: "user.login", entityId: user.id, entityType: "user" as any,
                         performedBy: user.id, role: user.role, tenantId });
  });
  // Issue both access token (15m) and refresh token (7d)
  const refreshToken = jwt.sign(
    { userId: user.id, tenantId: user.tenantId, role: user.role, type: "refresh" },
    requireSecret("JWT_REFRESH_SECRET"),
    { expiresIn: "7d" },
  );
  res.json({
    token,
    refreshToken,
    expiresIn: process.env.JWT_EXPIRES_IN ?? "8h",
    user: { id: user.id, email: user.email, nameAr: user.nameAr, role: user.role },
  });
});

// POST /api/auth/refresh — exchange refresh token for new access token
authRouter.post("/refresh", async (req: Request, res: Response): Promise<void> => {
  const { refreshToken } = req.body as { refreshToken?: string };
  if (!refreshToken) {
    res.status(401).json({ error: "Refresh token required" });
    return;
  }

  // Authentication failures are 401; persistence/audit failures below must NOT
  // be collapsed into a fake auth failure. Express 5 forwards async rejections
  // to the unified error boundary.
  let payload: { userId: string; tenantId: string; role: string; email?: string; nameAr?: string; type?: string };
  try {
    payload = jwt.verify(refreshToken, requireSecret("JWT_REFRESH_SECRET")) as typeof payload;
  } catch (_err) {
    res.status(401).json({ error: "Invalid or expired refresh token" });
    return;
  }

  if (payload.type !== "refresh") {
    res.status(401).json({ error: "Invalid token type" });
    return;
  }

  // Fetch current user to ensure still active. DB failures propagate as governed 5xx.
  const user = await withTenant(payload.tenantId, (tx) => tx.queryOne<{
    id:string; email:string; nameAr:string; role:string; tenantId:string; isActive:boolean }>(
    `SELECT id, email, "nameAr", role, "tenantId", "isActive"
       FROM "User" WHERE id = $1 AND "tenantId" = $2 LIMIT 1`,
    [payload.userId, payload.tenantId],
  ));
  if (!user || !user.isActive) {
    res.status(401).json({ error: "User not found or inactive" });
    return;
  }

  const newToken = jwt.sign(
    { userId: user.id, email: user.email, role: user.role, tenantId: user.tenantId, nameAr: user.nameAr },
    requireSecret("JWT_SECRET"),
    { expiresIn: (process.env.JWT_EXPIRES_IN ?? "8h") as jwt.SignOptions["expiresIn"] },
  );
  const newRefreshToken = jwt.sign(
    { userId: user.id, tenantId: user.tenantId, role: user.role, type: "refresh" },
    requireSecret("JWT_REFRESH_SECRET"),
    { expiresIn: "7d" },
  );

  await runInTenantScope(user.tenantId, () => AuditDAO.log({ action: "user.token_refresh",
    entityId: user.id, entityType: "user" as any, performedBy: user.id,
    role: user.role, tenantId: user.tenantId }));

  res.json({
    token:        newToken,
    refreshToken: newRefreshToken,
    expiresIn:    process.env.JWT_EXPIRES_IN ?? "8h",
  });
});

// POST /api/auth/logout — invalidate session (client drops tokens)
authRouter.post("/logout", authMiddleware, async (req: Request, res: Response): Promise<void> => {
  await runInTenantScope(req.user!.tenantId, () => AuditDAO.log({ action: "user.logout",
    entityId: req.user!.userId, entityType: "user" as any, performedBy: req.user!.userId,
    role: req.user!.role, tenantId: req.user!.tenantId }));
  res.json({ message: "Logged out successfully" });
});

authRouter.post(
  "/register",
  authMiddleware,
  checkPermission("auth:register"),
  validate(RegisterSchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const { email, password, nameAr, role, tenantId } = req.body as { email:string; password:string; nameAr:string; role:string; tenantId:string };
    const exists = await queryOne(`SELECT id FROM "User" WHERE email=$1 AND "tenantId"=$2`, [email, tenantId]);
    if (exists) { res.status(409).json({ error: "User already exists" }); return; }
    // user creation IS a governance mutation — atomic contract applies below.
    // P0: the tenant for a new user comes from the authenticated caller's JWT.
    // Honouring a body-supplied tenantId would let tenant A create users in B.
    const callerTenant = req.user?.tenantId;
    if (!callerTenant) { res.status(401).json({ error: "Authentication required" }); return; }
    if (tenantId && tenantId !== callerTenant) {
      res.status(403).json({ error: "Cannot create a user in another tenant." });
      return;
    }
    const effectiveTenantId = callerTenant;
    const passwordHash = await bcrypt.hash(password, 12);
    const id = uuidv4();
    try {
      await auditedMutation(
        effectiveTenantId,
        (tx) => tx.query(
          `INSERT INTO "User" (id, email, "passwordHash", "nameAr", role, "tenantId") VALUES ($1,$2,$3,$4,$5,$6)`,
          [id, email, passwordHash, nameAr, role, effectiveTenantId]),
        async (tx) => {
          await AuditDAO.logIn(tx, { action: "user.created", entityId: id, entityType: "user",
            performedBy: req.user!.userId, role: req.user!.role,
            tenantId: effectiveTenantId, next: { email, role } });
        },
      );
    } catch (err) {
      next(err);
      return;
    }
    res.status(201).json({ id, email, nameAr, role });
  },
);
