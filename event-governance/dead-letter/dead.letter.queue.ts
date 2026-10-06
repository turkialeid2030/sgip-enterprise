/**
 * Dead Letter Queue — captures failed/unprocessable events.
 * Failed events go here for investigation, replay, or discard.
 * Production: persist to dedicated DLQ table + alerting integration.
 */
import { v4 as uuidv4 } from "uuid";
import { GovernanceEvent, GovernanceEventType } from "../../types/events.v3.types";

export interface DLQEntry {
  id:            string;
  tenantId:      string;
  originalEvent: GovernanceEvent;
  failureReason: string;
  failureCount:  number;
  firstFailedAt: string;
  lastFailedAt:  string;
  resolvedAt?:   string;
  resolved:      boolean;
  action:        "pending" | "replayed" | "discarded" | "investigating";
}

const dlqStore: DLQEntry[] = [];
const MAX_DLQ = 1000;

export class DeadLetterQueue {
  enqueue(event: GovernanceEvent, reason: string): DLQEntry {
    // Check if already in DLQ
    const existing = dlqStore.find(e => e.originalEvent.eventId === event.eventId && e.tenantId === event.tenantId);
    if (existing) {
      existing.failureCount++;
      existing.lastFailedAt = new Date().toISOString();
      existing.failureReason = reason;
      return existing;
    }
    const now   = new Date().toISOString();
    const entry: DLQEntry = {
      id:            uuidv4(),
      tenantId:      event.tenantId,
      originalEvent: event,
      failureReason: reason,
      failureCount:  1,
      firstFailedAt: now,
      lastFailedAt:  now,
      resolved:      false,
      action:        "pending",
    };
    if (dlqStore.length >= MAX_DLQ) dlqStore.shift();
    dlqStore.push(entry);
    console.error(`[DLQ] Event ${event.eventType} (${event.eventId}) enqueued: ${reason}`);
    return entry;
  }

  getEntries(tenantId: string, resolved = false): DLQEntry[] {
    return dlqStore.filter(e => e.tenantId === tenantId && e.resolved === resolved);
  }

  markResolved(entryId: string, action: DLQEntry["action"]): void {
    const entry = dlqStore.find(e => e.id === entryId);
    if (entry) {
      entry.resolved    = true;
      entry.resolvedAt  = new Date().toISOString();
      entry.action      = action;
    }
  }

  getStats(tenantId: string) {
    const entries = dlqStore.filter(e => e.tenantId === tenantId);
    const byType: Record<string, number> = {};
    for (const e of entries) {
      const type = e.originalEvent.eventType;
      byType[type] = (byType[type] ?? 0) + 1;
    }
    return { total: entries.length, unresolved: entries.filter(e => !e.resolved).length, byType };
  }
}

export const globalDLQ = new DeadLetterQueue();
