/**
 * RBAC — Real Role-Based Access Control
 * Defines which roles can perform which actions on which entity types.
 * Every protected route must call checkPermission().
 */
import { Request, Response, NextFunction } from "express";

// ── Permission matrix ────────────────────────────────────────
// action → allowed roles
const PERMISSIONS: Record<string, string[]> = {
  // Entity operations
  "entity:read":         ["governance_analyst","risk_analyst","compliance_analyst","internal_audit_agent","financial_reviewer","legal_reviewer","board_reporter","fraud_analyst","orchestrator"],
  "entity:create":       ["governance_analyst","risk_analyst","compliance_analyst","internal_audit_agent","financial_reviewer","legal_reviewer","orchestrator"],
  "entity:update":       ["governance_analyst","risk_analyst","compliance_analyst","internal_audit_agent","financial_reviewer","legal_reviewer","orchestrator"],
  "entity:archive":      ["orchestrator","governance_analyst"],

  // Graph operations
  "graph:read":          ["governance_analyst","risk_analyst","compliance_analyst","internal_audit_agent","financial_reviewer","legal_reviewer","board_reporter","fraud_analyst","orchestrator"],
  "graph:write":         ["governance_analyst","risk_analyst","compliance_analyst","orchestrator"],

  // AI operations
  "ai:analyze":          ["governance_analyst","risk_analyst","compliance_analyst","internal_audit_agent","financial_reviewer","legal_reviewer","fraud_analyst","orchestrator"],
  "ai:review_output":    ["governance_analyst","orchestrator","internal_audit_agent"],
  "ai:view_outputs":     ["governance_analyst","risk_analyst","compliance_analyst","internal_audit_agent","financial_reviewer","legal_reviewer","board_reporter","orchestrator"],

  // Dashboard
  "dashboard:read":      ["governance_analyst","risk_analyst","compliance_analyst","internal_audit_agent","financial_reviewer","legal_reviewer","board_reporter","fraud_analyst","orchestrator"],

  // Admin
  "auth:register":       ["orchestrator"],

  // Policy engine
  "policy:evaluate":     ["governance_analyst","risk_analyst","compliance_analyst","internal_audit_agent","financial_reviewer","legal_reviewer","orchestrator"],
  "policy:manage":       ["governance_analyst","orchestrator"],

  // Approval runtime
  "approval:create":     ["governance_analyst","risk_analyst","compliance_analyst","internal_audit_agent","orchestrator"],
  "approval:decide":     ["governance_analyst","orchestrator","internal_audit_agent"],
};

// Entity-type specific restrictions
const ENTITY_TYPE_RESTRICTIONS: Record<string, string[]> = {
  "financial_review": ["financial_reviewer","orchestrator","internal_audit_agent"],
  "legal_review":     ["legal_reviewer","orchestrator"],
  "fraud_case":       ["fraud_analyst","orchestrator","internal_audit_agent"],
  "board_resolution": ["governance_analyst","board_reporter","orchestrator"],
};

export function checkPermission(action: string, entityType?: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const allowed = PERMISSIONS[action];
    if (!allowed) {
      res.status(403).json({ error: `Unknown permission: ${action}` });
      return;
    }

    if (!allowed.includes(req.user.role)) {
      res.status(403).json({
        error:    `Role "${req.user.role}" cannot perform "${action}"`,
        required: allowed,
      });
      return;
    }

    // Entity-type restriction (if applicable)
    const typeToCheck = entityType ?? (req.body?.type as string | undefined) ?? (req.params?.type as string | undefined);
    if (typeToCheck && ENTITY_TYPE_RESTRICTIONS[typeToCheck]) {
      const typeAllowed = ENTITY_TYPE_RESTRICTIONS[typeToCheck];
      if (!typeAllowed.includes(req.user.role)) {
        res.status(403).json({
          error:    `Role "${req.user.role}" cannot access entity type "${typeToCheck}"`,
          required: typeAllowed,
        });
        return;
      }
    }

    next();
  };
}

// Convenience: check ownership (user can only modify their own items unless admin)
export function checkOwnership(allowedRoles = ["orchestrator"]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) { res.status(401).json({ error: "Unauthorized" }); return; }
    if (allowedRoles.includes(req.user.role)) { next(); return; }
    // Ownership checked in route handler (needs entity from DB)
    (req as Request & { ownershipCheckRequired: boolean }).ownershipCheckRequired = true;
    next();
  };
}
