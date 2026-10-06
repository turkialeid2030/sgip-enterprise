/**
 * Persistent Event Store — Phase 5.1
 * Append-only, hash-chained, immutable event log.
 * Production: replace fileStore with PostgreSQL/Redis backend via injected adapter.
 *
 * Properties:
 *   - Each event has a SHA-256 hash of its content
 *   - Each event links to previousHash (blockchain-style chain)
 *   - Writes are append-only — no update, no delete
 *   - Tenant-isolated — no query without tenantId
 *   - Idempotency keys prevent duplicate writes
 *   - Replay support: by tenant, correlationId, timestamp range
 */
import * as crypto from "crypto";
import { v4 as uuidv4 } from "uuid";

export interface PersistedEvent {
  readonly eventId:        string;
  readonly tenantId:       string;
  readonly topic:          string;
  readonly version:        number;
  readonly correlationId:  string;
  readonly causationId?:   string;
  readonly actorId:        string;
  readonly actorRole:      string;
  readonly payload:        Readonly<Record<string, unknown>>;
  readonly metadata:       Readonly<Record<string, unknown>>;
  readonly hash:           string;   // SHA-256 of eventId+tenantId+topic+payload
  readonly previousHash:   string;   // hash of previous event in tenant chain (or "GENESIS")
  readonly timestamp:      string;
  readonly sequenceNumber: number;   // monotonically increasing per tenant
  readonly idempotencyKey?: string;  // optional caller-supplied dedup key
}

export interface EventStoreStats {
  tenantId:        string;
  totalEvents:     number;
  topicCounts:     Record<string, number>;
  latestSeq:       number;
  latestTimestamp: string;
  chainValid:      boolean;
}

export interface ReplayFilter {
  tenantId:        string;
  topic?:          string;
  correlationId?:  string;
  fromTimestamp?:  string;
  toTimestamp?:    string;
  fromSeq?:        number;
  toSeq?:          number;
  limit?:          number;
}

// ── Append-only storage ────────────────────────────────────────
// Production adapter interface — swap for DB backend
export interface EventStoreAdapter {
  append(event: PersistedEvent): void;
  query(filter: ReplayFilter): PersistedEvent[];
  getLatest(tenantId: string): PersistedEvent | undefined;
  getByIdempotencyKey(tenantId: string, key: string): PersistedEvent | undefined;
}

// Default: durable in-memory (replace with PostgresAdapter in production)
class InMemoryEventStoreAdapter implements EventStoreAdapter {
  private readonly journal = new Map<string, PersistedEvent[]>();        // tenantId → events
  private readonly idempotencyIdx = new Map<string, string>();            // tenantId:key → eventId

  append(event: PersistedEvent): void {
    if (!this.journal.has(event.tenantId)) this.journal.set(event.tenantId, []);
    this.journal.get(event.tenantId)!.push(event);
    if (event.idempotencyKey) {
      this.idempotencyIdx.set(`${event.tenantId}:${event.idempotencyKey}`, event.eventId);
    }
  }

  query(filter: ReplayFilter): PersistedEvent[] {
    const events = this.journal.get(filter.tenantId) ?? [];
    return events.filter(e => {
      if (filter.topic         && e.topic         !== filter.topic)         return false;
      if (filter.correlationId && e.correlationId !== filter.correlationId) return false;
      if (filter.fromTimestamp && e.timestamp     <  filter.fromTimestamp)  return false;
      if (filter.toTimestamp   && e.timestamp     >  filter.toTimestamp)    return false;
      if (filter.fromSeq       && e.sequenceNumber < filter.fromSeq)        return false;
      if (filter.toSeq         && e.sequenceNumber > filter.toSeq)          return false;
      return true;
    }).slice(0, filter.limit ?? 10000);
  }

  getLatest(tenantId: string): PersistedEvent | undefined {
    const events = this.journal.get(tenantId) ?? [];
    return events.at(-1);
  }

  getByIdempotencyKey(tenantId: string, key: string): PersistedEvent | undefined {
    const eventId = this.idempotencyIdx.get(`${tenantId}:${key}`);
    if (!eventId) return undefined;
    return (this.journal.get(tenantId) ?? []).find(e => e.eventId === eventId);
  }
}

// Sequence counters per tenant
const seqCounters = new Map<string, number>();

function nextSeq(tenantId: string): number {
  const next = (seqCounters.get(tenantId) ?? 0) + 1;
  seqCounters.set(tenantId, next);
  return next;
}

function computeHash(eventId: string, tenantId: string, topic: string, payload: unknown, previousHash: string): string {
  const canonical = JSON.stringify({ eventId, tenantId, topic, payload, previousHash });
  return crypto.createHash("sha256").update(canonical).digest("hex");
}

export class PersistentEventStore {
  private readonly adapter: EventStoreAdapter;

  constructor(
    private readonly tenantId: string,
    adapter?: EventStoreAdapter,
  ) {
    this.adapter = adapter ?? defaultAdapter;
  }

  /**
   * Append an event to the persistent store.
   * Idempotent: same idempotencyKey returns existing event without creating duplicate.
   */
  append(params: {
    topic:          string;
    payload:        Record<string, unknown>;
    actorId:        string;
    actorRole:      string;
    correlationId?: string;
    causationId?:   string;
    metadata?:      Record<string, unknown>;
    idempotencyKey?:string;
    version?:       number;
  }): PersistedEvent {
    // Idempotency check
    if (params.idempotencyKey) {
      const existing = this.adapter.getByIdempotencyKey(this.tenantId, params.idempotencyKey);
      if (existing) return existing;  // Return same result, no duplicate
    }

    const prevEvent  = this.adapter.getLatest(this.tenantId);
    const prevHash   = prevEvent?.hash ?? "GENESIS";
    const eventId    = uuidv4();
    const seqNum     = nextSeq(this.tenantId);
    const timestamp  = new Date().toISOString();
    const correlId   = params.correlationId ?? uuidv4();

    const hash = computeHash(eventId, this.tenantId, params.topic, params.payload, prevHash);

    const event: PersistedEvent = Object.freeze({
      eventId,
      tenantId:        this.tenantId,
      topic:           params.topic,
      version:         params.version ?? 1,
      correlationId:   correlId,
      causationId:     params.causationId,
      actorId:         params.actorId,
      actorRole:       params.actorRole,
      payload:         Object.freeze({ ...params.payload }),
      metadata:        Object.freeze({ ...params.metadata }),
      hash,
      previousHash:    prevHash,
      timestamp,
      sequenceNumber:  seqNum,
      idempotencyKey:  params.idempotencyKey,
    });

    this.adapter.append(event);
    return event;
  }

  /**
   * Replay events matching filter.
   * Tenant-isolated — only this tenant's events are returned.
   */
  replay(filter: Omit<ReplayFilter, "tenantId">): PersistedEvent[] {
    return this.adapter.query({ ...filter, tenantId: this.tenantId });
  }

  /**
   * Validate the hash chain for this tenant.
   * Any break in the chain indicates tampering.
   */
  validateChain(): { valid: boolean; brokenAt?: number; reason?: string } {
    const events = this.adapter.query({ tenantId: this.tenantId });
    if (events.length === 0) return { valid: true };

    for (let i = 0; i < events.length; i++) {
      const e = events[i];
      // Recompute hash
      const expected = computeHash(e.eventId, e.tenantId, e.topic, e.payload, e.previousHash);
      if (e.hash !== expected) {
        return { valid:false, brokenAt:e.sequenceNumber, reason:`Hash mismatch at seq ${e.sequenceNumber}` };
      }
      // Verify previousHash chain
      if (i > 0 && e.previousHash !== events[i-1].hash) {
        return { valid:false, brokenAt:e.sequenceNumber, reason:`Chain break at seq ${e.sequenceNumber}: previousHash mismatch` };
      }
    }
    return { valid: true };
  }

  getStats(): EventStoreStats {
    const events = this.adapter.query({ tenantId: this.tenantId });
    const topicCounts: Record<string, number> = {};
    for (const e of events) topicCounts[e.topic] = (topicCounts[e.topic] ?? 0) + 1;
    const chainResult = this.validateChain();
    return {
      tenantId: this.tenantId,
      totalEvents: events.length,
      topicCounts,
      latestSeq: events.at(-1)?.sequenceNumber ?? 0,
      latestTimestamp: events.at(-1)?.timestamp ?? "",
      chainValid: chainResult.valid,
    };
  }

  getLatestEvent(): PersistedEvent | undefined {
    return this.adapter.getLatest(this.tenantId);
  }
}

// Singleton default adapter
const defaultAdapter = new InMemoryEventStoreAdapter();

const storeCache = new Map<string, PersistentEventStore>();
export function getEventStore(tenantId: string): PersistentEventStore {
  if (!storeCache.has(tenantId)) storeCache.set(tenantId, new PersistentEventStore(tenantId));
  return storeCache.get(tenantId)!;
}
