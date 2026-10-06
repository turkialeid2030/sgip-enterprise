/**
 * Idempotency Store — prevents duplicate event processing.
 * Checks event IDs against a time-windowed seen-set.
 * Used by event validator and all event consumers.
 */
const seenKeys = new Map<string, { seenAt: number; count: number }>();
const WINDOW_MS = 60 * 60 * 1000;  // 1 hour

export function markSeen(tenantId: string, eventId: string): void {
  const key = `${tenantId}:${eventId}`;
  const existing = seenKeys.get(key);
  if (existing) {
    existing.count++;
    existing.seenAt = Date.now();
  } else {
    seenKeys.set(key, { seenAt: Date.now(), count: 1 });
  }
  // Periodic cleanup
  if (seenKeys.size > 50000) {
    const cutoff = Date.now() - WINDOW_MS;
    for (const [k, v] of seenKeys) {
      if (v.seenAt < cutoff) seenKeys.delete(k);
    }
  }
}

export function isSeen(tenantId: string, eventId: string): boolean {
  const key  = `${tenantId}:${eventId}`;
  const seen = seenKeys.get(key);
  if (!seen) return false;
  if (Date.now() - seen.seenAt > WINDOW_MS) { seenKeys.delete(key); return false; }
  return true;
}

export function getSeenCount(tenantId: string, eventId: string): number {
  return seenKeys.get(`${tenantId}:${eventId}`)?.count ?? 0;
}

export function getStats() {
  return { tracked: seenKeys.size, windowMs: WINDOW_MS };
}
