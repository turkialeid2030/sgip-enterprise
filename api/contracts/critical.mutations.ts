/**
 * CRITICAL MUTATION MANIFEST
 *
 * Replaces the previous regex/line-window atomicity detector, which was
 * unreliable: it could borrow evidence from a neighbouring handler and it
 * proved nothing about runtime behaviour.
 *
 * Each entry here is EXECUTED by scripts/verify-audit-atomicity.cjs with the
 * audit table made unwritable. Atomicity is proven by observing that the
 * business state does not change — not by matching source text.
 *
 * classification:
 *   GOVERNANCE_MUTATION — changes regulated state; MUST be atomic with audit
 *   SECURITY_TELEMETRY  — login/refresh/logout; deliberately NOT wrapped
 *                         (failing authentication because a telemetry row could
 *                          not be written would be a denial of service, and
 *                          losing lastLoginAt does not misstate governance)
 */

export type MutationClass = "GOVERNANCE_MUTATION" | "SECURITY_TELEMETRY" | "READ_ONLY";

export interface CriticalMutation {
  id:             string;
  method:         "POST" | "PATCH" | "DELETE";
  path:           string;
  classification: MutationClass;
  auditRequired:  boolean;
  atomicContract: "auditedMutation" | "none";
  /** Table whose state must be unchanged when the audit write fails. */
  businessTable:  string | null;
  note:           string;
}

export const CRITICAL_MUTATIONS: CriticalMutation[] = [
  { id: "entity.create", method: "POST", path: "/api/entities",
    classification: "GOVERNANCE_MUTATION", auditRequired: true,
    atomicContract: "auditedMutation", businessTable: "GovernanceEntity",
    note: "creation is compensated if the audit event cannot be written" },

  { id: "entity.update", method: "PATCH", path: "/api/entities/:id",
    classification: "GOVERNANCE_MUTATION", auditRequired: true,
    atomicContract: "auditedMutation", businessTable: "GovernanceEntity",
    note: "UPDATE and audit share one transaction" },

  { id: "entity.archive", method: "DELETE", path: "/api/entities/:id",
    classification: "GOVERNANCE_MUTATION", auditRequired: true,
    atomicContract: "auditedMutation", businessTable: "GovernanceEntity",
    note: "soft archive and audit share one transaction" },

  { id: "graph.edge.create", method: "POST", path: "/api/graph/edge",
    classification: "GOVERNANCE_MUTATION", auditRequired: true,
    atomicContract: "auditedMutation", businessTable: "GraphEdge",
    note: "edge INSERT and audit share one transaction" },

  { id: "policy.create", method: "POST", path: "/api/policies",
    classification: "GOVERNANCE_MUTATION", auditRequired: true,
    atomicContract: "auditedMutation", businessTable: "GovernancePolicy",
    note: "PolicyService.createIn(tx) runs on the caller's transaction" },

  { id: "policy.activate", method: "PATCH", path: "/api/policies/:id/activate",
    classification: "GOVERNANCE_MUTATION", auditRequired: true,
    atomicContract: "auditedMutation", businessTable: "GovernancePolicy",
    note: "supersede-previous + activate + audit in ONE transaction; " +
          "invariant: at most one ACTIVE policy per (tenant, code)" },

  { id: "policy.retire", method: "PATCH", path: "/api/policies/:id/retire",
    classification: "GOVERNANCE_MUTATION", auditRequired: true,
    atomicContract: "auditedMutation", businessTable: "GovernancePolicy",
    note: "PolicyService.retireIn(tx)" },

  { id: "approval.create", method: "POST", path: "/api/approvals",
    classification: "GOVERNANCE_MUTATION", auditRequired: true,
    atomicContract: "auditedMutation", businessTable: "ApprovalRequest",
    note: "approvalRuntime.createRequest(..., tx)" },

  { id: "approval.decide", method: "PATCH", path: "/api/approvals/:id/decide",
    classification: "GOVERNANCE_MUTATION", auditRequired: true,
    atomicContract: "auditedMutation", businessTable: "ApprovalRequest",
    note: "approvalRuntime.processDecision(..., tx)" },

  { id: "user.create", method: "POST", path: "/api/auth/register",
    classification: "GOVERNANCE_MUTATION", auditRequired: true,
    atomicContract: "auditedMutation", businessTable: "User",
    note: "tenant taken from the JWT, never the body" },

  { id: "auth.login", method: "POST", path: "/api/auth/login",
    classification: "SECURITY_TELEMETRY", auditRequired: false,
    atomicContract: "none", businessTable: null,
    note: "lastLoginAt is telemetry; blocking a valid login on a telemetry " +
          "write would be a denial of service" },

  { id: "auth.refresh", method: "POST", path: "/api/auth/refresh",
    classification: "SECURITY_TELEMETRY", auditRequired: false,
    atomicContract: "none", businessTable: null,
    note: "token rotation telemetry" },

  { id: "auth.logout", method: "POST", path: "/api/auth/logout",
    classification: "SECURITY_TELEMETRY", auditRequired: false,
    atomicContract: "none", businessTable: null,
    note: "session end telemetry" },
];

export const GOVERNANCE_MUTATIONS = CRITICAL_MUTATIONS.filter(
  m => m.classification === "GOVERNANCE_MUTATION");
