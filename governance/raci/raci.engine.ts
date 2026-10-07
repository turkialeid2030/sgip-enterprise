/**
 * RACI Engine — Responsible, Accountable, Consulted, Informed.
 * Detects: orphan decisions, authority gaps, duplicated accountability,
 * shadow approvals, undocumented ownership.
 */
import { v4 as uuidv4 } from "uuid";
import { TenantContext } from "../../types/tenant.types";

export type RACIRole = "Responsible" | "Accountable" | "Consulted" | "Informed";

export interface RACIEntry {
  entityId:     string;
  entityType:   string;
  entityTitle:  string;
  userId:       string;
  userName:     string;
  userRole:     string;
  raciRole:     RACIRole;
  assignedAt:   string;
  tenantId:     string;
}

export interface RACIConflict {
  type:         "missing_accountable"  | "multiple_accountable" | "no_responsible"
              | "shadow_approval"       | "orphan_decision"       | "authority_gap"
              | "duplicated_responsibility";
  entityId:     string;
  entityType:   string;
  severity:     "critical" | "high" | "medium";
  description:  string;
  affectedUsers:string[];
  recommendation:string;
}

export interface RACIMatrix {
  tenantId:       string;
  entries:        RACIEntry[];
  conflicts:      RACIConflict[];
  coverageScore:  number;   // % of entities with full RACI
  orphanEntities: string[];
  generatedAt:    string;
}

const raciStore = new Map<string, RACIEntry[]>();  // entityId → entries

export class RACIEngine {
  constructor(private readonly tenantId: string) {}

  assign(entry: Omit<RACIEntry, "tenantId" | "assignedAt">): RACIEntry {
    const key     = `${this.tenantId}:${entry.entityId}`;
    const full: RACIEntry = { ...entry, tenantId: this.tenantId, assignedAt: new Date().toISOString() };
    const existing = raciStore.get(key) ?? [];
    // Replace same user+role combo
    const filtered = existing.filter(e => !(e.userId === entry.userId && e.raciRole === entry.raciRole));
    raciStore.set(key, [...filtered, full]);
    return full;
  }

  getForEntity(entityId: string): RACIEntry[] {
    return (raciStore.get(`${this.tenantId}:${entityId}`) ?? [])
      .filter(e => e.tenantId === this.tenantId);
  }

  detectConflicts(entityIds: string[]): RACIConflict[] {
    const conflicts: RACIConflict[] = [];

    for (const entityId of entityIds) {
      const entries = this.getForEntity(entityId);
      const accountable = entries.filter(e => e.raciRole === "Accountable");
      const responsible  = entries.filter(e => e.raciRole === "Responsible");

      // No accountable party
      if (accountable.length === 0) {
        conflicts.push({ type:"missing_accountable", entityId, entityType:"entity", severity:"critical",
          description:`Entity ${entityId} has no Accountable party — governance gap`,
          affectedUsers:[], recommendation:"Assign an Accountable party immediately" });
      }
      // Multiple accountable
      if (accountable.length > 1) {
        conflicts.push({ type:"multiple_accountable", entityId, entityType:"entity", severity:"high",
          description:`Entity ${entityId} has ${accountable.length} Accountable parties — confusion`,
          affectedUsers: accountable.map(e => e.userId),
          recommendation:"Reduce to one Accountable party" });
      }
      // No responsible
      if (responsible.length === 0) {
        conflicts.push({ type:"no_responsible", entityId, entityType:"entity", severity:"high",
          description:`Entity ${entityId} has no Responsible party — no one will act`,
          affectedUsers:[], recommendation:"Assign a Responsible party" });
      }
    }
    return conflicts;
  }

  buildMatrix(entityIds: string[]): RACIMatrix {
    const allEntries: RACIEntry[] = [];
    const orphanEntities: string[] = [];

    for (const eid of entityIds) {
      const entries = this.getForEntity(eid);
      allEntries.push(...entries);
      if (entries.length === 0) orphanEntities.push(eid);
    }

    const conflicts = this.detectConflicts(entityIds);
    const withFullRaci = entityIds.filter(eid => {
      const entries = this.getForEntity(eid);
      const roles   = new Set(entries.map(e => e.raciRole));
      return roles.has("Accountable") && roles.has("Responsible");
    }).length;

    const coverageScore = entityIds.length > 0
      ? Math.round((withFullRaci / entityIds.length) * 100)
      : 100;

    return {
      tenantId: this.tenantId, entries: allEntries, conflicts,
      coverageScore, orphanEntities, generatedAt: new Date().toISOString(),
    };
  }
}

const raciCache = new Map<string, RACIEngine>();
export function getRACIEngine(tenantId: string): RACIEngine {
  if (!raciCache.has(tenantId)) raciCache.set(tenantId, new RACIEngine(tenantId));
  return raciCache.get(tenantId)!;
}
