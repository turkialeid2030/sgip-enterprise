/**
 * Governance Memory Store
 * Institutional learning engine — every incident, finding, decision
 * becomes reusable intelligence.
 *
 * Production: vector DB (Pinecone/Weaviate) for semantic retrieval
 */
import { v4 as uuidv4 } from "uuid";
import { UGOMType } from "../types/governance.types";

export type MemoryType =
  | "decision"       | "lesson_learned"  | "precedent"
  | "pattern"        | "regulatory_update"| "audit_outcome"
  | "risk_evolution" | "control_failure"  | "best_practice";

export interface MemoryEntry {
  id:               string;
  type:             MemoryType;
  title:            string;
  summary:          string;
  source:           string;        // module or agent that created it
  sourceEntityId?:  string;
  sourceEntityType?:UGOMType;
  relatedEntityIds: string[];
  importance:       "critical" | "high" | "medium" | "low";
  tags:             string[];
  retrievalCount:   number;
  confidenceScore:  number;
  version:          number;
  expiresAt?:       string;
  tenantId:         string;
  createdAt:        string;
  updatedAt:        string;
  isArchived:       boolean;
}

export interface MemoryQuery {
  types?:     MemoryType[];
  tags?:      string[];
  importance?:"critical" | "high" | "medium" | "low";
  entityId?:  string;
  textSearch?:string;
  limit?:     number;
  tenantId:   string;
}

export class GovernanceMemoryStore {
  private readonly entries = new Map<string, MemoryEntry>();

  constructor(private readonly tenantId: string) {}

  store(params: Omit<MemoryEntry, "id" | "retrievalCount" | "version" | "createdAt" | "updatedAt" | "isArchived">): MemoryEntry {
    const now = new Date().toISOString();
    const entry: MemoryEntry = {
      ...params,
      id:             uuidv4(),
      retrievalCount: 0,
      version:        1,
      createdAt:      now,
      updatedAt:      now,
      isArchived:     false,
    };
    this.entries.set(entry.id, entry);
    return entry;
  }

  retrieve(query: MemoryQuery): MemoryEntry[] {
    const now = new Date().toISOString();
    let results = [...this.entries.values()].filter(e => {
      if (e.tenantId !== query.tenantId) return false;
      if (e.isArchived) return false;
      if (e.expiresAt && e.expiresAt < now) return false;
      if (query.types && !query.types.includes(e.type)) return false;
      if (query.importance && e.importance !== query.importance) return false;
      if (query.entityId && !e.relatedEntityIds.includes(query.entityId) && e.sourceEntityId !== query.entityId) return false;
      if (query.tags && !query.tags.some(t => e.tags.includes(t))) return false;
      if (query.textSearch) {
        const q = query.textSearch.toLowerCase();
        if (!e.title.toLowerCase().includes(q) && !e.summary.toLowerCase().includes(q)) return false;
      }
      return true;
    });

    // Sort: critical > high > medium > low, then by retrievalCount desc
    const imp: Record<string, number> = { critical: 4, high: 3, medium: 2, low: 1 };
    results.sort((a, b) => (imp[b.importance] - imp[a.importance]) || (b.retrievalCount - a.retrievalCount));

    const limited = results.slice(0, query.limit ?? 50);
    // Increment retrieval count
    limited.forEach(e => {
      e.retrievalCount++;
      e.updatedAt = now;
    });
    return limited;
  }

  update(id: string, patch: Partial<MemoryEntry>): MemoryEntry | undefined {
    const e = this.entries.get(id);
    if (!e) return undefined;
    const updated = { ...e, ...patch, id: e.id, version: e.version + 1, updatedAt: new Date().toISOString() };
    this.entries.set(id, updated);
    return updated;
  }

  archive(id: string): void {
    const e = this.entries.get(id);
    if (e) this.entries.set(id, { ...e, isArchived: true, updatedAt: new Date().toISOString() });
  }

  getById(id: string): MemoryEntry | undefined {
    return this.entries.get(id);
  }

  getStats() {
    const entries = [...this.entries.values()].filter(e => !e.isArchived);
    const byType: Record<string, number> = {};
    const byImp:  Record<string, number> = {};
    for (const e of entries) {
      byType[e.type] = (byType[e.type] ?? 0) + 1;
      byImp[e.importance] = (byImp[e.importance] ?? 0) + 1;
    }
    return { total: entries.length, byType, byImportance: byImp };
  }
}
