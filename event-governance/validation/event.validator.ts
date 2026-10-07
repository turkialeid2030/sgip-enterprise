/**
 * Event Validator — enforces governance on all events.
 * Every event must have: eventId, tenantId, correlationId, actorId, timestamp, payloadVersion.
 * Detects replay attacks via idempotency checking.
 */
import { v4 as uuidv4 } from "uuid";
import { GovernanceEvent, GovernanceEventType } from "../../types/events.v3.types";
import { globalAnomalyDetector } from "../../observability";

const seenEvents = new Map<string, number>(); // eventId → timestamp
const DEDUP_WINDOW_MS = 60 * 60 * 1000; // 1 hour

export interface EventValidationResult {
  valid:    boolean;
  issues:   string[];
  isReplay: boolean;
}

export function validateEvent(event: Partial<GovernanceEvent>): EventValidationResult {
  const issues: string[] = [];

  if (!event.eventId)        issues.push("Missing eventId");
  if (!event.tenantId)       issues.push("Missing tenantId");
  if (!event.correlationId)  issues.push("Missing correlationId");
  if (!event.actorId)        issues.push("Missing actorId");
  if (!event.timestamp)      issues.push("Missing timestamp");
  if (!event.payloadVersion) issues.push("Missing payloadVersion");
  if (!event.source)         issues.push("Missing source");
  if (!event.eventType)      issues.push("Missing eventType");

  // Check replay
  let isReplay = false;
  if (event.eventId && event.tenantId) {
    const seen = seenEvents.get(event.eventId);
    const now  = Date.now();
    if (seen && (now - seen) < DEDUP_WINDOW_MS) {
      issues.push(`Replay detected: eventId ${event.eventId} seen ${now - seen}ms ago`);
      isReplay = true;
      globalAnomalyDetector.checkEventReplay(event.tenantId, event.eventId);
    } else {
      // Purge old entries periodically
      if (seenEvents.size > 10000) {
        for (const [id, ts] of seenEvents) {
          if (now - ts > DEDUP_WINDOW_MS) seenEvents.delete(id);
        }
      }
      seenEvents.set(event.eventId, now);
    }
  }

  return { valid: issues.length === 0 && !isReplay, issues, isReplay };
}

export function enrichEvent<T>(
  type:    GovernanceEventType,
  source:  string,
  tenantId:string,
  actorId: string,
  actorRole:string,
  payload: T,
  correlationId?: string,
): GovernanceEvent<T> {
  return {
    eventId:        uuidv4(),
    eventType:      type,
    tenantId,
    correlationId:  correlationId ?? uuidv4(),
    actorId,
    actorRole,
    source,
    timestamp:      new Date().toISOString(),
    payloadVersion: "1.0",
    payload,
  };
}
