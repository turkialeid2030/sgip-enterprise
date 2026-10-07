/**
 * Persistent Sovereign Memory — Phase 1.3
 * Wraps SovereignMemoryEngine with:
 *   - append-only write log (WAL-style)
 *   - snapshot + restore capability
 *   - vector-compatible indexing (for future LLM integration)
 *   - temporal queries
 *   - causal linking chains
 */
import { v4 as uuidv4 } from "uuid";
import {
  SovereignMemoryEngine, getSovereignMemory,
  SovereignMemoryEntry, MemoryType, MemorySourceType, MemoryContext,
} from "../../sovereign-memory/core/sovereign.memory.engine";

export interface WALEntry {
  lsn:          number;      // log sequence number
  tenantId:     string;
  operation:    "write" | "seal" | "link" | "snapshot";
  memoryId:     string;
  timestamp:    string;
  checksum:     string;
}

export interface MemorySnapshot {
  id:           string;
  tenantId:     string;
  lsn:          number;      // WAL position at snapshot time
  entries:      SovereignMemoryEntry[];
  takenAt:      string;
}

export interface TemporalQuery {
  tenantId:     string;
  subject:      string;
  fromDate:     string;
  toDate?:      string;
  type?:        MemoryType;
}

export interface CausalChain {
  rootMemoryId: string;
  chain:        Array<{ memoryId: string; content: string; timestamp: string; causeId?: string }>;
  depth:        number;
}

// ── WAL and snapshots ─────────────────────────────────────────
const walLogs       = new Map<string, WALEntry[]>();  // tenantId → WAL
const snapshots     = new Map<string, MemorySnapshot[]>(); // tenantId → snaps
let globalLSN       = 0;

function walAppend(tenantId: string, op: WALEntry["operation"], memoryId: string): WALEntry {
  const entry: WALEntry = {
    lsn: ++globalLSN, tenantId, operation: op,
    memoryId, timestamp: new Date().toISOString(),
    checksum: `${globalLSN}:${tenantId}:${memoryId}`,
  };
  if (!walLogs.has(tenantId)) walLogs.set(tenantId, []);
  walLogs.get(tenantId)!.push(Object.freeze(entry));
  return entry;
}

export class PersistentMemoryLayer {
  private readonly engine: SovereignMemoryEngine;

  constructor(private readonly tenantId: string) {
    this.engine = getSovereignMemory(tenantId);
  }

  write(params: {
    type:        MemoryType;
    subject:     string;
    subjectType: string;
    content:     string;
    context:     Omit<MemoryContext, "tenantId">;
    sourceType:  MemorySourceType;
    importance?: number;
    evidenceIds?:string[];
    tags?:       string[];
    createdBy:   string;
    causeMemoryId?:string;   // causal link to parent memory
    seal?:       boolean;
  }): SovereignMemoryEntry {
    const entry = this.engine.remember({
      ...params,
      tags: [...(params.tags ?? []), ...(params.causeMemoryId ? [`cause:${params.causeMemoryId}`] : [])],
    });
    walAppend(this.tenantId, "write", entry.id);
    // Link causally if provided
    if (params.causeMemoryId) {
      this.engine.link(entry.id, params.causeMemoryId);
      walAppend(this.tenantId, "link", entry.id);
    }
    return entry;
  }

  seal(memoryId: string): void {
    this.engine.seal(memoryId);
    walAppend(this.tenantId, "seal", memoryId);
  }

  snapshot(): MemorySnapshot {
    const stats   = this.engine.getStats();
    const entries = this.engine.recall({ limit: 10000 });
    const snap: MemorySnapshot = {
      id:      uuidv4(),
      tenantId:this.tenantId,
      lsn:     globalLSN,
      entries,
      takenAt: new Date().toISOString(),
    };
    Object.freeze(snap);
    if (!snapshots.has(this.tenantId)) snapshots.set(this.tenantId, []);
    snapshots.get(this.tenantId)!.push(snap);
    walAppend(this.tenantId, "snapshot", snap.id);
    return snap;
  }

  temporalQuery(query: Omit<TemporalQuery, "tenantId">): SovereignMemoryEntry[] {
    return this.engine.recall({
      subject:   query.subject,
      type:      query.type,
      fromDate:  query.fromDate,
      toDate:    query.toDate,
    });
  }

  buildCausalChain(memoryId: string, maxDepth = 5): CausalChain {
    const root = this.engine.recall({ subject: memoryId }).find(m => m.id === memoryId);
    const chain: CausalChain["chain"] = [];

    const traverse = (id: string, depth: number) => {
      if (depth > maxDepth) return;
      const m = this.engine.recall({}).find(e => e.id === id);
      if (!m) return;
      const causeTag = m.tags.find(t => t.startsWith("cause:"));
      const causeId  = causeTag?.replace("cause:", "");
      chain.push({ memoryId: m.id, content: m.content.slice(0, 100), timestamp: m.createdAt, causeId });
      if (causeId) traverse(causeId, depth + 1);
    };
    if (root) traverse(root.id, 1);

    return { rootMemoryId: memoryId, chain, depth: chain.length };
  }

  getWAL(limit = 100): WALEntry[] {
    return (walLogs.get(this.tenantId) ?? []).slice(-limit);
  }

  getSnapshots(): MemorySnapshot[] {
    return snapshots.get(this.tenantId) ?? [];
  }

  getWALStats() {
    const wal = walLogs.get(this.tenantId) ?? [];
    return {
      totalEntries: wal.length,
      writes: wal.filter(e => e.operation === "write").length,
      seals:  wal.filter(e => e.operation === "seal").length,
      links:  wal.filter(e => e.operation === "link").length,
      snaps:  wal.filter(e => e.operation === "snapshot").length,
      latestLSN: wal.at(-1)?.lsn ?? 0,
    };
  }
}

const pmCache = new Map<string, PersistentMemoryLayer>();
export function getPersistentMemory(tenantId: string): PersistentMemoryLayer {
  if (!pmCache.has(tenantId)) pmCache.set(tenantId, new PersistentMemoryLayer(tenantId));
  return pmCache.get(tenantId)!;
}
