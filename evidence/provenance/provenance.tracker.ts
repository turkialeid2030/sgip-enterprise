/**
 * Provenance Tracker — tracks the origin and transformation chain of every
 * governance artifact. Answers: where did this data come from? Who touched it?
 */
import { v4 as uuidv4 } from "uuid";

export interface ProvenanceRecord {
  id:             string;
  tenantId:       string;
  artifactId:     string;
  artifactType:   string;
  origin: {
    source:       string;   // system, user, agent, external
    actorId:      string;
    actorRole:    string;
    timestamp:    string;
    method:       string;   // create, import, derive, transform
  };
  transformations: ProvenanceTransform[];
  lineageDepth:   number;
  trustScore:     number;   // 0-100: how trustworthy is this data?
  correlationId:  string;
  createdAt:      string;
}

export interface ProvenanceTransform {
  step:           number;
  actorId:        string;
  actorRole:      string;
  action:         string;   // updated, reviewed, approved, merged
  timestamp:      string;
  changes:        string[];
  evidenceId?:    string;
}

const provenanceStore = new Map<string, ProvenanceRecord>();

export class ProvenanceTracker {
  constructor(private readonly tenantId: string) {}

  record(params: {
    artifactId:   string;
    artifactType: string;
    actorId:      string;
    actorRole:    string;
    method:       string;
    source:       string;
    correlationId:string;
  }): ProvenanceRecord {
    const rec: ProvenanceRecord = {
      id:            uuidv4(),
      tenantId:      this.tenantId,
      artifactId:    params.artifactId,
      artifactType:  params.artifactType,
      origin: {
        source:      params.source,
        actorId:     params.actorId,
        actorRole:   params.actorRole,
        timestamp:   new Date().toISOString(),
        method:      params.method,
      },
      transformations: [],
      lineageDepth:   0,
      trustScore:     params.source === "agent" ? 75 : params.source === "system" ? 90 : 85,
      correlationId:  params.correlationId,
      createdAt:      new Date().toISOString(),
    };
    provenanceStore.set(`${this.tenantId}:${params.artifactId}`, rec);
    return rec;
  }

  addTransform(artifactId: string, params: { actorId: string; actorRole: string; action: string; changes: string[]; evidenceId?: string }): void {
    const key = `${this.tenantId}:${artifactId}`;
    const rec = provenanceStore.get(key);
    if (!rec) return;
    const step = rec.transformations.length + 1;
    rec.transformations.push({ step, ...params, timestamp: new Date().toISOString() });
    rec.lineageDepth = step;
    // Trust score adjustments
    if (params.action === "approved" && params.evidenceId) rec.trustScore = Math.min(100, rec.trustScore + 5);
    if (params.actorRole === "agent") rec.trustScore = Math.max(0, rec.trustScore - 3);
  }

  get(artifactId: string): ProvenanceRecord | undefined {
    return provenanceStore.get(`${this.tenantId}:${artifactId}`);
  }

  getTrustScore(artifactId: string): number {
    return provenanceStore.get(`${this.tenantId}:${artifactId}`)?.trustScore ?? 0;
  }
}

// Per-tenant factory
const trackerCache = new Map<string, ProvenanceTracker>();
export function getProvenanceTracker(tenantId: string): ProvenanceTracker {
  if (!trackerCache.has(tenantId)) trackerCache.set(tenantId, new ProvenanceTracker(tenantId));
  return trackerCache.get(tenantId)!;
}
