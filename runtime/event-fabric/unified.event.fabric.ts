/**
 * Unified Event Fabric — SCEOS Layer 1
 * Every significant institutional event flows through this fabric.
 * Immutable, replay-protected, tenant-isolated, evidence-linked.
 */
import { v4 as uuidv4 } from "uuid";
import * as crypto from "crypto";

export type SCEOSEventType =
  | "DecisionCreated"       | "PolicyChanged"          | "RiskEscalated"
  | "EvidenceAttached"      | "ApprovalRequested"      | "ApprovalGranted"
  | "KPIBreached"           | "ControlFailed"          | "AuditFindingCreated"
  | "RemediationStarted"    | "BoardResolutionIssued"  | "VendorRiskChanged"
  | "AIActionRequested"     | "MemoryUpdated"          | "GovernanceDriftDetected"
  | "AuthorityViolation"    | "EvidenceExpired"        | "StakeholderChanged";

export interface AuthorityContext {
  actorId:      string;
  actorRole:    string;
  permissions:  string[];
  delegatedBy?: string;
  scope:        string;
}

export interface SCEOSEvent {
  eventId:          string;
  eventType:        SCEOSEventType;
  eventVersion:     string;
  tenantId:         string;
  correlationId:    string;
  causationId?:     string;          // parent event that caused this
  actorId:          string;
  actorRole:        string;
  authorityContext: AuthorityContext;
  payload:          Record<string, unknown>;
  evidenceLinks:    string[];
  memoryRefs:       string[];        // sovereign memory IDs
  graphNodeId?:     string;
  integrityHash:    string;          // SHA-256 of canonical fields
  timestamp:        string;
  processedAt?:     string;
  status:           "pending" | "processed" | "failed" | "dead_lettered";
  retryCount:       number;
}

export interface EventValidationResult {
  valid:       boolean;
  isReplay:    boolean;
  errors:      string[];
  warnings:    string[];
}

// ── Stores ───────────────────────────────────────────────────
const eventStore      = new Map<string, SCEOSEvent>();
const seenEventIds    = new Map<string, string>();  // eventId → tenantId (replay prevention)
const deadLetterQueue: SCEOSEvent[] = [];
const eventSubscribers = new Map<string, Array<(e: SCEOSEvent) => void>>();

function computeHash(e: Partial<SCEOSEvent>): string {
  const canonical = JSON.stringify({
    eventType: e.eventType, tenantId: e.tenantId,
    correlationId: e.correlationId, actorId: e.actorId,
    timestamp: e.timestamp, payload: e.payload,
  });
  return crypto.createHash("sha256").update(canonical).digest("hex").slice(0, 32);
}

export class UnifiedEventFabric {
  constructor(private readonly tenantId: string) {}

  emit(params: {
    eventType:        SCEOSEventType;
    actorId:          string;
    actorRole:        string;
    authorityContext: AuthorityContext;
    payload:          Record<string, unknown>;
    evidenceLinks?:   string[];
    memoryRefs?:      string[];
    causationId?:     string;
    graphNodeId?:     string;
    correlationId?:   string;
  }): SCEOSEvent {
    const now = new Date().toISOString();
    const correlationId = params.correlationId ?? uuidv4();

    const partial = {
      eventType: params.eventType, tenantId: this.tenantId,
      correlationId, actorId: params.actorId, timestamp: now, payload: params.payload,
    };

    const event: SCEOSEvent = {
      eventId:          uuidv4(),
      eventType:        params.eventType,
      eventVersion:     "1.0",
      tenantId:         this.tenantId,
      correlationId,
      causationId:      params.causationId,
      actorId:          params.actorId,
      actorRole:        params.actorRole,
      authorityContext: params.authorityContext,
      payload:          params.payload,
      evidenceLinks:    params.evidenceLinks ?? [],
      memoryRefs:       params.memoryRefs ?? [],
      graphNodeId:      params.graphNodeId,
      integrityHash:    computeHash(partial),
      timestamp:        now,
      status:           "pending",
      retryCount:       0,
    };

    Object.freeze(event);  // immutable
    eventStore.set(event.eventId, event);
    seenEventIds.set(event.eventId, this.tenantId);

    // Notify subscribers
    const subs = eventSubscribers.get(`${this.tenantId}:${params.eventType}`) ?? [];
    const allSubs = eventSubscribers.get(`${this.tenantId}:*`) ?? [];
    for (const sub of [...subs, ...allSubs]) {
      try { sub(event); }
      catch (err) { this.deadLetter(event, `Subscriber error: ${(err as Error).message}`); }
    }

    // Mark processed
    const processed = { ...event, status: "processed" as const, processedAt: new Date().toISOString() };
    Object.freeze(processed);
    eventStore.set(event.eventId, processed);
    return processed;
  }

  validate(eventId: string): EventValidationResult {
    const event  = eventStore.get(eventId);
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!event) return { valid:false, isReplay:false, errors:["Event not found"], warnings:[] };
    if (event.tenantId !== this.tenantId) errors.push("Tenant isolation violation");

    // Integrity check
    const expectedHash = computeHash({
      eventType: event.eventType, tenantId: event.tenantId,
      correlationId: event.correlationId, actorId: event.actorId,
      timestamp: event.timestamp, payload: event.payload,
    });
    if (event.integrityHash !== expectedHash) errors.push("Integrity hash mismatch — event tampered");

    // Replay check
    const seen = seenEventIds.get(eventId);
    const isReplay = !!seen && seen !== this.tenantId;
    if (isReplay) errors.push("Replay attack detected — event ID already processed by another tenant");

    if (!event.actorId) errors.push("Missing actorId");
    if (!event.authorityContext) errors.push("Missing authorityContext");
    if (event.evidenceLinks.length === 0) warnings.push("No evidence links — decision auditability limited");

    return { valid: errors.length === 0, isReplay, errors, warnings };
  }

  subscribe(eventType: SCEOSEventType | "*", handler: (e: SCEOSEvent) => void): void {
    const key = `${this.tenantId}:${eventType}`;
    if (!eventSubscribers.has(key)) eventSubscribers.set(key, []);
    eventSubscribers.get(key)!.push(handler);
  }

  getEvents(eventType?: SCEOSEventType, limit = 100): SCEOSEvent[] {
    return [...eventStore.values()]
      .filter(e => e.tenantId === this.tenantId && (!eventType || e.eventType === eventType))
      .sort((a,b) => b.timestamp.localeCompare(a.timestamp))
      .slice(0, limit);
  }

  getDeadLetterQueue(): SCEOSEvent[] {
    return deadLetterQueue.filter(e => e.tenantId === this.tenantId);
  }

  getEventsByCorrelation(correlationId: string): SCEOSEvent[] {
    return [...eventStore.values()].filter(e =>
      e.tenantId === this.tenantId && e.correlationId === correlationId
    );
  }

  private deadLetter(event: SCEOSEvent, reason: string): void {
    const dl = { ...event, status: "dead_lettered" as const };
    Object.freeze(dl);
    deadLetterQueue.push(dl);
  }

  getStats() {
    const events = this.getEvents(undefined, 10000);
    const byType = {} as Record<string, number>;
    for (const e of events) byType[e.eventType] = (byType[e.eventType] ?? 0) + 1;
    return { total:events.length, byType, deadLettered:this.getDeadLetterQueue().length };
  }
}

const fabricCache = new Map<string, UnifiedEventFabric>();
export function getEventFabric(tenantId: string): UnifiedEventFabric {
  if (!fabricCache.has(tenantId)) fabricCache.set(tenantId, new UnifiedEventFabric(tenantId));
  return fabricCache.get(tenantId)!;
}

export function buildAuthority(actorId: string, role: string, permissions: string[], scope = "tenant"): AuthorityContext {
  return { actorId, actorRole:role, permissions, scope };
}
