/**
 * Audit Logger — Immutable audit trail
 * Every entity mutation, agent action, and governance decision
 * is logged here. Log entries are append-only.
 *
 * Production: persist to immutable storage (WORM / blockchain hash)
 */
import { v4 as uuidv4 } from "uuid";
import { AuditEntry } from "../types/governance.types";
import { UGOMType } from "../types/governance.types";

interface LogParams {
  action:      string;
  entityId:    string;
  entityType:  UGOMType;
  performedBy: string;
  role?:       string;
  details?:    unknown;
  previousValue?: unknown;
  newValue?:   unknown;
  correlationId?: string;
}

export class AuditLogger {
  private readonly entries: AuditEntry[] = [];

  constructor(
    private readonly tenantId: string,
    private readonly organizationId: string = "default",
  ) {}

  log(params: LogParams): AuditEntry {
    const entry: AuditEntry = {
      id:             uuidv4(),
      entityId:       params.entityId,
      entityType:     params.entityType,
      action:         params.action,
      performedBy:    params.performedBy,
      role:           params.role ?? "system",
      timestamp:      new Date().toISOString(),
      previousValue:  params.previousValue,
      newValue:       params.newValue,
      traceId:        params.correlationId ?? uuidv4(),
      tenantId:       this.tenantId,
      isImmutable:    true,
    };
    // Append-only — no mutation allowed after insert
    Object.freeze(entry);
    this.entries.push(entry);
    return entry;
  }

  getEntriesForEntity(entityId: string): AuditEntry[] {
    return this.entries.filter(e => e.entityId === entityId);
  }

  getEntriesByAction(action: string): AuditEntry[] {
    return this.entries.filter(e => e.action === action);
  }

  getEntriesByUser(userId: string): AuditEntry[] {
    return this.entries.filter(e => e.performedBy === userId);
  }

  getAll(limit = 100, offset = 0): AuditEntry[] {
    return this.entries.slice(offset, offset + limit);
  }

  getStats() {
    const byAction: Record<string, number> = {};
    for (const e of this.entries) byAction[e.action] = (byAction[e.action] ?? 0) + 1;
    return { total: this.entries.length, byAction };
  }
}
