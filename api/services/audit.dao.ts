/**
 * Audit DAO — immutable audit log writes/reads.
 */
import { v4 as uuidv4 } from "uuid";
import { query } from "./db.service";

export const AuditDAO = {
  async log(params: {
    entityId?:   string;
    entityType?: string;
    action:      string;
    performedBy: string;
    role?:       string;
    previous?:   unknown;
    next?:       unknown;
    tenantId:    string;
    traceId?:    string;
  }): Promise<void> {
    await query(
      `INSERT INTO "AuditLog"
       (id, "entityId", "entityType", action, "performedBy", role,
        "previousValue", "newValue", "traceId", "tenantId")
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        uuidv4(),
        params.entityId    ?? null,
        params.entityType  ?? null,
        params.action,
        params.performedBy,
        params.role        ?? "system",
        params.previous != null ? JSON.stringify(params.previous) : null,
        params.next     != null ? JSON.stringify(params.next)     : null,
        params.traceId  ?? uuidv4(),
        params.tenantId,
      ],
    );
  },

  /**
   * Emit the audit event on an EXISTING transaction client.
   * Used by auditedMutation() so a business change and its audit record commit
   * or roll back together — a governance platform cannot have a mutation that
   * left no trace.
   */
  async logIn(tx: { query: (sql: string, p?: unknown[]) => Promise<unknown> }, params: {
    entityId?: string; entityType?: string; action: string; performedBy: string;
    role?: string; previous?: unknown; next?: unknown; tenantId: string; traceId?: string;
  }): Promise<void> {
    await tx.query(
      `INSERT INTO "AuditLog"
       (id, "entityId", "entityType", action, "performedBy", role,
        "previousValue", "newValue", "traceId", "tenantId")
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        uuidv4(), params.entityId ?? null, params.entityType ?? null, params.action,
        params.performedBy, params.role ?? "system",
        params.previous != null ? JSON.stringify(params.previous) : null,
        params.next     != null ? JSON.stringify(params.next)     : null,
        params.traceId ?? uuidv4(), params.tenantId,
      ],
    );
  },

  async findRecent(tenantId: string, limit = 50, entityType?: string) {
    const cond = entityType ? `AND "entityType" = $3` : "";
    const params: unknown[] = [tenantId, limit];
    if (entityType) params.push(entityType);
    return query(
      `SELECT * FROM "AuditLog" WHERE "tenantId" = $1 ${cond} ORDER BY "createdAt" DESC LIMIT $2`,
      params,
    );
  },
};
