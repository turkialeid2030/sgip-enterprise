/**
 * Sovereign Memory Engine — SCEOS Layer A
 *
 * The institutional brain. NOT a database. NOT a cache.
 * A living, queryable, traceable memory of everything the enterprise
 * has decided, learned, done, approved, and experienced.
 *
 * Memory types:
 *   Episodic:      What happened? When? Who decided?
 *   Semantic:      What does this entity mean in THIS enterprise?
 *   Procedural:    How does this org actually operate?
 *   Institutional: Lessons learned from governance failures/wins.
 *   Declarative:   Policies, rules, obligations (what SHOULD be).
 *   Prophylactic:  Risk memories, near-misses, warnings.
 *
 * Every memory entry is:
 *   immutable once sealed | tenant-isolated | evidence-linked
 *   correlation-ID tracked | queryable by AI agents
 */
import { v4 as uuidv4 } from "uuid";

export type MemoryType =
  | "episodic" | "semantic" | "procedural"
  | "institutional" | "declarative" | "prophylactic";

export type MemoryStrength = "fragile" | "developing" | "consolidated" | "entrenched";

export type MemorySourceType =
  | "decision" | "audit" | "incident" | "policy"
  | "risk_event" | "evidence" | "workflow" | "board_action"
  | "executive_act" | "compliance" | "ai_output" | "human_input"
  | "system_event" | "external";

export interface MemoryContext {
  tenantId:         string;
  actors:           string[];
  affectedEntities: string[];
  regulatoryRefs:   string[];
  policyRefs:       string[];
  timeframe:        string;
  jurisdiction?:    string;
  confidentiality:  "public" | "internal" | "confidential" | "highly_confidential";
}

export interface SovereignMemoryEntry {
  id:               string;
  tenantId:         string;
  type:             MemoryType;
  subject:          string;
  subjectType:      string;
  content:          string;
  context:          MemoryContext;
  strength:         MemoryStrength;
  reinforcements:   number;
  evidenceIds:      string[];
  linkedMemoryIds:  string[];
  correlationId:    string;
  sourceType:       MemorySourceType;
  importance:       number;   // 0-100
  decayRate:        number;   // 0-1
  tags:             string[];
  isSealed:         boolean;
  accessCount:      number;
  lastAccessedAt:   string;
  createdAt:        string;
  createdBy:        string;
  sealedAt?:        string;
}

export interface MemoryInsight {
  pattern:        string;
  frequency:      number;
  risk:           string;
  recommendation: string;
  supportingIds:  string[];
  confidence:     number;
}

// ── In-memory store with tenant isolation ─────────────────────
const memStore  = new Map<string, SovereignMemoryEntry>();
const subjIdx   = new Map<string, Set<string>>();
const typeIdx   = new Map<string, Set<string>>();
const tagIdx    = new Map<string, Set<string>>();

function idxEntry(e: SovereignMemoryEntry): void {
  const sk = `${e.tenantId}:${e.subject}`;
  if (!subjIdx.has(sk)) subjIdx.set(sk, new Set());
  subjIdx.get(sk)!.add(e.id);
  const tk = `${e.tenantId}:${e.type}`;
  if (!typeIdx.has(tk)) typeIdx.set(tk, new Set());
  typeIdx.get(tk)!.add(e.id);
  for (const tag of e.tags) {
    const ttk = `${e.tenantId}:${tag}`;
    if (!tagIdx.has(ttk)) tagIdx.set(ttk, new Set());
    tagIdx.get(ttk)!.add(e.id);
  }
}

export class SovereignMemoryEngine {
  constructor(private readonly tenantId: string) {}

  remember(params: {
    type:         MemoryType;
    subject:      string;
    subjectType:  string;
    content:      string;
    context:      Omit<MemoryContext, "tenantId">;
    sourceType:   MemorySourceType;
    importance?:  number;
    evidenceIds?: string[];
    tags?:        string[];
    createdBy:    string;
    seal?:        boolean;
  }): SovereignMemoryEntry {
    const now = new Date().toISOString();
    const imp = params.importance ?? 50;
    const baseDecay: Record<MemoryType, number> = {
      episodic:0.05, semantic:0.02, procedural:0.10,
      institutional:0.01, declarative:0.02, prophylactic:0.03,
    };
    const entry: SovereignMemoryEntry = {
      id:             uuidv4(), tenantId:this.tenantId,
      type:           params.type, subject:params.subject, subjectType:params.subjectType,
      content:        params.content,
      context:        { ...params.context, tenantId:this.tenantId },
      strength:       "developing", reinforcements:0,
      evidenceIds:    params.evidenceIds ?? [],
      linkedMemoryIds:[],
      correlationId:  uuidv4(), sourceType:params.sourceType,
      importance:     imp, decayRate:baseDecay[params.type] * (1 - imp/200),
      tags:           params.tags ?? [],
      isSealed:       params.seal ?? false,
      accessCount:0, lastAccessedAt:now, createdAt:now, createdBy:params.createdBy,
      sealedAt:       params.seal ? now : undefined,
    };
    if (params.seal) Object.freeze(entry);
    memStore.set(entry.id, entry);
    idxEntry(entry);
    return entry;
  }

  recall(query: {
    type?: MemoryType; subject?: string; subjectType?: string;
    tags?: string[]; minImportance?: number; sourceType?: MemorySourceType;
    fromDate?: string; toDate?: string; limit?: number;
  }): SovereignMemoryEntry[] {
    let candidates: Set<string>;
    if (query.subject) {
      candidates = subjIdx.get(`${this.tenantId}:${query.subject}`) ?? new Set();
    } else if (query.type) {
      candidates = typeIdx.get(`${this.tenantId}:${query.type}`) ?? new Set();
    } else if (query.tags?.length) {
      candidates = new Set();
      for (const tag of query.tags) {
        for (const id of tagIdx.get(`${this.tenantId}:${tag}`) ?? []) candidates.add(id);
      }
    } else {
      candidates = new Set([...memStore.values()].filter(m => m.tenantId===this.tenantId).map(m=>m.id));
    }

    const now = new Date().toISOString();
    const results: SovereignMemoryEntry[] = [];
    for (const id of candidates) {
      const e = memStore.get(id);
      if (!e || e.tenantId !== this.tenantId) continue;
      if (query.type        && e.type        !== query.type)        continue;
      if (query.subjectType && e.subjectType !== query.subjectType) continue;
      if (query.minImportance !== undefined && e.importance < query.minImportance) continue;
      if (query.sourceType  && e.sourceType  !== query.sourceType)  continue;
      if (query.fromDate    && e.createdAt   < query.fromDate)      continue;
      if (query.toDate      && e.createdAt   > query.toDate)        continue;
      // Reinforce
      if (!e.isSealed) {
        (e as any).accessCount++;
        (e as any).lastAccessedAt = now;
        (e as any).reinforcements++;
        if (e.reinforcements >= 10) (e as any).strength = "entrenched";
        else if (e.reinforcements >= 5) (e as any).strength = "consolidated";
      }
      results.push(e);
    }
    return results.sort((a,b) => b.importance-a.importance).slice(0, query.limit ?? 100);
  }

  seal(memoryId: string): void {
    const e = memStore.get(memoryId);
    if (!e || e.tenantId !== this.tenantId || e.isSealed) return;
    const sealed = { ...e, isSealed:true, sealedAt:new Date().toISOString(), strength:"entrenched" as MemoryStrength };
    Object.freeze(sealed);
    memStore.set(memoryId, sealed);
  }

  link(id1: string, id2: string): void {
    const m1 = memStore.get(id1), m2 = memStore.get(id2);
    if (!m1 || !m2 || m1.tenantId !== this.tenantId || m2.tenantId !== this.tenantId) return;
    if (!m1.isSealed && !m1.linkedMemoryIds.includes(id2)) (m1 as any).linkedMemoryIds = [...m1.linkedMemoryIds, id2];
    if (!m2.isSealed && !m2.linkedMemoryIds.includes(id1)) (m2 as any).linkedMemoryIds = [...m2.linkedMemoryIds, id1];
  }

  detectPatterns(): MemoryInsight[] {
    const all = this.recall({ limit: 2000 });
    const insights: MemoryInsight[] = [];

    // Repeated violations on same subject
    const bySubject = new Map<string, SovereignMemoryEntry[]>();
    for (const m of all) {
      if (!bySubject.has(m.subject)) bySubject.set(m.subject, []);
      bySubject.get(m.subject)!.push(m);
    }
    for (const [subject, mems] of bySubject) {
      const violations = mems.filter(m => m.tags.includes("violation") || m.tags.includes("breach"));
      if (violations.length >= 2) {
        insights.push({ pattern:`Repeated violations: ${subject}`, frequency:violations.length,
          risk:"Systemic governance failure", recommendation:"Escalate to CGO — root cause review",
          supportingIds:violations.map(m=>m.id), confidence:Math.min(95, 60+violations.length*10) });
      }
    }
    // Evidence-free decisions
    const noEvidence = all.filter(m => m.type==="episodic" && m.evidenceIds.length===0 && m.sourceType==="decision");
    if (noEvidence.length >= 3) {
      insights.push({ pattern:"Evidence-free decisions", frequency:noEvidence.length,
        risk:"Audit traceability gap", recommendation:"Enforce evidence gate",
        supportingIds:noEvidence.map(m=>m.id), confidence:90 });
    }
    // High-importance forgotten memories
    const forgotten = all.filter(m => m.importance>=70 && m.reinforcements===0);
    if (forgotten.length >= 2) {
      insights.push({ pattern:"Critical governance knowledge not being accessed", frequency:forgotten.length,
        risk:"Institutional knowledge loss — governance drift",
        recommendation:"Reinforce critical memory entries",
        supportingIds:forgotten.map(m=>m.id), confidence:75 });
    }
    return insights;
  }

  getStats() {
    const all = [...memStore.values()].filter(m => m.tenantId===this.tenantId);
    const byType = {} as Record<MemoryType, number>;
    for (const t of ["episodic","semantic","procedural","institutional","declarative","prophylactic"] as MemoryType[]) {
      byType[t] = all.filter(m => m.type===t).length;
    }
    return { total:all.length, sealed:all.filter(m=>m.isSealed).length, byType,
      avgImportance:all.length>0 ? Math.round(all.reduce((s,m)=>s+m.importance,0)/all.length):0,
      patterns:this.detectPatterns().length };
  }
}

const smCache = new Map<string, SovereignMemoryEngine>();
export function getSovereignMemory(tenantId: string): SovereignMemoryEngine {
  if (!smCache.has(tenantId)) smCache.set(tenantId, new SovereignMemoryEngine(tenantId));
  return smCache.get(tenantId)!;
}
