/**
 * Segregation of Duties Engine
 * Enforces incompatible action combinations.
 * Toxic combinations are ALWAYS blocked regardless of role.
 */
import { v4 as uuidv4 } from "uuid";
import { SoDConflict, SoDViolation } from "../../types/policy.types";
import { TenantContext } from "../../types/tenant.types";
import { query } from "../../api/services/db.service";

// Built-in SoD conflict matrix (extended per tenant via DB)
const BUILTIN_SOD_CONFLICTS: SoDConflict[] = [
  { id: "sod-001", name: "Request+Approve",   description: "Cannot request AND approve same transaction",
    action1: "create",           action2: "approve",         severity: "critical", mitigations: ["dual_control","supervisor_override"] },
  { id: "sod-002", name: "JE+Approve",         description: "Cannot post journal entry AND approve it",
    action1: "write:journal_entry", action2: "approve",      severity: "critical", mitigations: ["segregated_roles"] },
  { id: "sod-003", name: "Audit+Remediate",    description: "Internal auditor cannot close their own findings",
    action1: "write:finding",    action2: "close",            severity: "high",     mitigations: ["management_closure"] },
  { id: "sod-004", name: "Evidence+Certify",   description: "Cannot upload evidence AND certify the finding",
    action1: "write:evidence",   action2: "certify",          severity: "high",     mitigations: ["independent_certification"] },
  { id: "sod-005", name: "Policy+Approve",     description: "Policy author cannot approve their own policy",
    action1: "write:policy",     action2: "approve",          severity: "high",     mitigations: ["committee_approval"] },
];

export class SoDEngine {
  private readonly conflicts: SoDConflict[];
  private readonly userActionHistory = new Map<string, Set<string>>();  // userId → actions in session

  constructor(conflicts: SoDConflict[] = BUILTIN_SOD_CONFLICTS) {
    this.conflicts = conflicts;
  }

  /**
   * Check if performing `newAction` creates a SoD conflict
   * given the actions this user has already performed in this entity context.
   */
  checkAction(
    ctx:       TenantContext,
    userId:    string,
    newAction: string,
    entityId:  string,
  ): SoDViolation | null {
    const userKey     = `${ctx.tenantId}:${userId}`;
    const priorActions = this.userActionHistory.get(userKey) ?? new Set<string>();

    for (const conflict of this.conflicts) {
      const conflictsWithNew =
        (conflict.action1 === newAction && priorActions.has(conflict.action2)) ||
        (conflict.action2 === newAction && priorActions.has(conflict.action1));

      if (conflictsWithNew) {
        const violation: SoDViolation = {
          userId,
          conflictId:  conflict.id,
          action1:     conflict.action1,
          action2:     conflict.action2,
          detectedAt:  new Date().toISOString(),
          entityId,
          tenantId:    ctx.tenantId,
          blocked:     conflict.severity === "critical" || conflict.severity === "high",
        };
        // Persist async — never let logging block the check
        this.persistViolation(violation).catch((e: Error) => {
          console.error("[SoDEngine] Failed to persist violation:", e.message);
        });
        return violation;
      }
    }

    // Record this action
    priorActions.add(newAction);
    this.userActionHistory.set(userKey, priorActions);
    return null;
  }

  /** Record that a user performed an action (for subsequent SoD checks). */
  recordAction(ctx: TenantContext, userId: string, action: string): void {
    const userKey = `${ctx.tenantId}:${userId}`;
    const actions = this.userActionHistory.get(userKey) ?? new Set<string>();
    actions.add(action);
    this.userActionHistory.set(userKey, actions);
  }

  /** Clear user session on logout. */
  clearUserSession(tenantId: string, userId: string): void {
    this.userActionHistory.delete(`${tenantId}:${userId}`);
  }

  getConflictMatrix(): SoDConflict[] {
    return [...this.conflicts];
  }

  private async persistViolation(v: SoDViolation): Promise<void> {
    await query(
      `INSERT INTO "SoDViolation"
       (id,"tenantId","userId","conflictId",action1,action2,"entityId",blocked)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [uuidv4(), v.tenantId, v.userId, v.conflictId, v.action1, v.action2, v.entityId, v.blocked],
    );
  }
}

export const sodEngine = new SoDEngine();
