/**
 * GRC Evidence Hub — Central evidence registry.
 * Links ALL governance objects to their evidence:
 * policies, risks, controls, KRIs, audits, incidents, vendors, AI, cyber, decisions, remediations.
 *
 * Provides: scoring, completeness, lineage, integrity, lifecycle retention.
 */
import { v4 as uuidv4 } from "uuid";
import { TenantContext } from "../../types/tenant.types";
import { requireTenantContext } from "../../tenant/tenant.context";
import { getEvidenceEngine } from "../../evidence/lineage/evidence.lineage.engine";
import type { EvidenceRecord } from "../../types/evidence.types";

export type EvidenceCategory =
  | "policy"      | "risk"           | "control"         | "audit"
  | "incident"    | "vendor"         | "ai_governance"   | "cyber"
  | "decision"    | "remediation"    | "compliance"       | "kri_kpi"
  | "board"       | "regulatory"     | "assurance"        | "operational";

export interface EvidenceHubEntry {
  id:               string;
  tenantId:         string;
  entityId:         string;
  entityType:       string;
  entityTitle:      string;
  category:         EvidenceCategory;
  evidenceId:       string;
  evidenceTitle:    string;
  evidenceSource:   string;
  integrityScore:   number;     // 0-100
  completenessScore:number;     // 0-100 — has all required evidence?
  chainVerified:    boolean;
  legalHold:        boolean;
  expiresAt?:       string;
  linkedAt:         string;
  linkedBy:         string;
  correlationId:    string;
}

export interface EvidenceHubStats {
  tenantId:            string;
  totalEntries:        number;
  byCategory:          Record<EvidenceCategory, number>;
  avgIntegrityScore:   number;
  avgCompletenessScore:number;
  chainVerified:       number;
  legalHolds:          number;
  expiringSoon:        number;
  tamperAlerts:        number;
  generatedAt:         string;
}

export interface EvidenceCompleteness {
  entityId:         string;
  entityType:       string;
  requiredEvidenceTypes: string[];
  presentEvidenceTypes:  string[];
  missingEvidenceTypes:  string[];
  completenessScore:number;
  isComplete:       boolean;
  recommendations:  string[];
}

const hubStore: EvidenceHubEntry[] = [];

// Required evidence by entity type
const REQUIRED_EVIDENCE: Record<string, string[]> = {
  control:    ["control_test", "attestation", "audit_report"],
  risk:       ["risk_assessment", "board_resolution"],
  policy:     ["approval_records", "distribution_log"],
  incident:   ["system_log", "process_log"],
  vendor:     ["contract", "audit_report", "attestation"],
  decision:   ["board_resolution", "attestation"],
  audit:      ["audit_report", "process_log"],
  remediation:["process_log", "control_test"],
};

export class EvidenceHub {
  constructor(private readonly tenantId: string) {}

  link(params: {
    entityId:      string;
    entityType:    string;
    entityTitle:   string;
    category:      EvidenceCategory;
    evidenceId:    string;
    evidenceTitle: string;
    evidenceSource:string;
    legalHold?:    boolean;
    expiresAt?:    string;
    linkedBy:      string;
    correlationId: string;
  }): EvidenceHubEntry {
    const engine = getEvidenceEngine(this.tenantId);
    const record = engine.verifyRecord(params.evidenceId);
    const entry: EvidenceHubEntry = {
      id:               uuidv4(),
      tenantId:         this.tenantId,
      entityId:         params.entityId,
      entityType:       params.entityType,
      entityTitle:      params.entityTitle,
      category:         params.category,
      evidenceId:       params.evidenceId,
      evidenceTitle:    params.evidenceTitle,
      evidenceSource:   params.evidenceSource,
      integrityScore:   record.valid ? 100 : (record.tampered ? 0 : 50),
      completenessScore:this.computeCompleteness(params.entityId, params.entityType, params.evidenceSource),
      chainVerified:    record.valid && !record.tampered,
      legalHold:        params.legalHold ?? false,
      expiresAt:        params.expiresAt,
      linkedAt:         new Date().toISOString(),
      linkedBy:         params.linkedBy,
      correlationId:    params.correlationId,
    };
    hubStore.push(entry);
    return entry;
  }

  getCompleteness(entityId: string, entityType: string): EvidenceCompleteness {
    const required = REQUIRED_EVIDENCE[entityType] ?? [];
    const present  = hubStore.filter(e => e.tenantId === this.tenantId && e.entityId === entityId).map(e => e.evidenceSource);
    const missing  = required.filter(r => !present.includes(r));
    const score    = required.length === 0 ? 0 : Math.round(((required.length - missing.length) / required.length) * 100);
    return {
      entityId, entityType,
      requiredEvidenceTypes: required,
      presentEvidenceTypes:  [...new Set(present)],
      missingEvidenceTypes:  missing,
      completenessScore:     score,
      isComplete:            required.length > 0 && missing.length === 0,
      recommendations:       required.length===0 ? [`No evidence requirements configured for entity type ${entityType} — completeness is unassessed/fail-closed`] : missing.map(m => `Collect ${m} evidence for ${entityType} ${entityId}`),
    };
  }

  getForEntity(entityId: string): EvidenceHubEntry[] {
    return hubStore.filter(e => e.tenantId === this.tenantId && e.entityId === entityId);
  }

  getByCategory(category: EvidenceCategory): EvidenceHubEntry[] {
    return hubStore.filter(e => e.tenantId === this.tenantId && e.category === category);
  }

  getTamperAlerts(): EvidenceHubEntry[] {
    return hubStore.filter(e => e.tenantId === this.tenantId && !e.chainVerified);
  }

  getStats(): EvidenceHubStats {
    const entries      = hubStore.filter(e => e.tenantId === this.tenantId);
    const byCategory   = {} as Record<EvidenceCategory, number>;
    const categories: EvidenceCategory[] = ["policy","risk","control","audit","incident","vendor","ai_governance","cyber","decision","remediation","compliance","kri_kpi","board","regulatory","assurance","operational"];
    for (const c of categories) byCategory[c] = 0;
    let intSum = 0, compSum = 0;
    for (const e of entries) {
      byCategory[e.category] = (byCategory[e.category] ?? 0) + 1;
      intSum  += e.integrityScore;
      compSum += e.completenessScore;
    }
    const now = new Date().toISOString();
    return {
      tenantId: this.tenantId,
      totalEntries:          entries.length,
      byCategory,
      avgIntegrityScore:     entries.length > 0 ? Math.round(intSum / entries.length) : 0,
      avgCompletenessScore:  entries.length > 0 ? Math.round(compSum / entries.length) : 0,
      chainVerified:         entries.filter(e => e.chainVerified).length,
      legalHolds:            entries.filter(e => e.legalHold).length,
      expiringSoon:          entries.filter(e => e.expiresAt && e.expiresAt < new Date(Date.now() + 30*86400000).toISOString()).length,
      tamperAlerts:          entries.filter(e => !e.chainVerified).length,
      generatedAt:           now,
    };
  }

  private computeCompleteness(entityId: string, entityType: string, newSource: string): number {
    const required = REQUIRED_EVIDENCE[entityType] ?? [];
    if (required.length === 0) return 0;
    const existing = hubStore.filter(e => e.tenantId === this.tenantId && e.entityId === entityId).map(e => e.evidenceSource);
    const present  = new Set([...existing, newSource]);
    return Math.round((present.size / required.length) * 100);
  }
}

const hubCache = new Map<string, EvidenceHub>();
export function getEvidenceHub(tenantId: string): EvidenceHub {
  if (!hubCache.has(tenantId)) hubCache.set(tenantId, new EvidenceHub(tenantId));
  return hubCache.get(tenantId)!;
}
