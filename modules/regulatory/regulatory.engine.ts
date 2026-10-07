/**
 * Regulatory Intelligence Engine
 * Manages regulatory obligations, framework mappings, compliance monitoring.
 * Links: regulations → obligations → controls → evidence → decisions.
 */
import { v4 as uuidv4 } from "uuid";
import { TenantContext } from "../../types/tenant.types";
import { FRAMEWORK_REGISTRY } from "../../frameworks/framework.registry";
import type { FrameworkId } from "../../frameworks/framework.types";

export type ObligationType = "mandatory" | "advisory" | "conditional" | "aspirational";
export type ObligationStatus = "active" | "remediated" | "breached" | "waived" | "expired";

export interface RegulatoryObligation {
  id:             string;
  tenantId:       string;
  code:           string;             // OBL-NCA-001
  frameworkId:    FrameworkId;
  article:        string;
  title:          string;
  description:    string;
  obligationType: ObligationType;
  status:         ObligationStatus;
  dueDate?:       string;
  controlIds:     string[];
  evidenceIds:    string[];
  assessedAt?:    string;
  remediatedAt?:  string;
  penaltyRange?:  string;
  escalateTo:     string;
  createdAt:      string;
  updatedAt:      string;
}

export interface CompliancePosition {
  tenantId:             string;
  frameworkId:          FrameworkId;
  total:                number;
  compliant:            number;
  nonCompliant:         number;
  partialCompliant:     number;
  breached:             number;
  complianceScore:      number;        // 0-100
  riskExposure:         "critical" | "high" | "medium" | "low";
  regulatorAlerts:      string[];
  nextDueDates:         Array<{ obligationId:string; dueDate:string; title:string }>;
  dataSufficiency:      "sufficient"|"insufficient";
}

const obligationStore = new Map<string, RegulatoryObligation>();

export class RegulatoryIntelligenceEngine {
  constructor(private readonly tenantId: string) {}

  registerObligation(params: Omit<RegulatoryObligation, "id" | "tenantId" | "createdAt" | "updatedAt">): RegulatoryObligation {
    const ob: RegulatoryObligation = { ...params, id:uuidv4(), tenantId:this.tenantId, createdAt:new Date().toISOString(), updatedAt:new Date().toISOString() };
    obligationStore.set(ob.id, ob);
    return ob;
  }

  updateStatus(id: string, status: ObligationStatus, ctx: TenantContext): RegulatoryObligation {
    const ob = obligationStore.get(`${id}`);
    if (!ob || ob.tenantId !== this.tenantId) throw Object.assign(new Error("Obligation not found"), { statusCode:404 });
    const updated = { ...ob, status, remediatedAt: status==="remediated" ? new Date().toISOString() : ob.remediatedAt, updatedAt:new Date().toISOString() };
    obligationStore.set(id, updated);
    return updated;
  }

  getAll(frameworkId?: FrameworkId): RegulatoryObligation[] {
    return [...obligationStore.values()].filter(o => o.tenantId === this.tenantId && (!frameworkId || o.frameworkId === frameworkId));
  }

  getBreached(): RegulatoryObligation[] {
    return this.getAll().filter(o => o.status === "breached");
  }

  getCompliancePosition(frameworkId: FrameworkId): CompliancePosition {
    const obligations = this.getAll(frameworkId);
    const fw          = FRAMEWORK_REGISTRY[frameworkId];
    const compliant   = obligations.filter(o => o.status === "remediated").length;
    const breached    = obligations.filter(o => o.status === "breached").length;
    const nonCompliant= obligations.filter(o => ["active","breached"].includes(o.status)).length;
    const total       = obligations.length;
    const complianceScore = total > 0 ? Math.round((compliant / total) * 100) : 0;
    const riskExposure: CompliancePosition["riskExposure"] = breached >= 3 ? "critical" : breached >= 1 ? "high" : nonCompliant >= 5 ? "medium" : "low";

    const now = new Date().toISOString();
    const nextDueDates = obligations
      .filter(o => o.dueDate && o.dueDate > now && o.status === "active")
      .sort((a,b) => (a.dueDate ?? "").localeCompare(b.dueDate ?? ""))
      .slice(0, 5)
      .map(o => ({ obligationId:o.id, dueDate:o.dueDate!, title:o.title }));

    const regulatorAlerts: string[] = total===0 ? [`No obligations loaded for ${frameworkId} — compliance score is unassessed/fail-closed`] : [];
    if (breached > 0) regulatorAlerts.push(`${breached} regulatory obligations breached — immediate regulatory notification may be required`);
    if (fw?.mandatoryFor?.length && complianceScore < 80) regulatorAlerts.push(`${fw.name} compliance below 80% — mandatory framework — regulatory risk is elevated`);

    return { tenantId:this.tenantId, frameworkId, total, compliant, nonCompliant, partialCompliant:0, breached, complianceScore, riskExposure, regulatorAlerts, nextDueDates, dataSufficiency:total>0?"sufficient":"insufficient" };
  }
}

const regulatoryCache = new Map<string, RegulatoryIntelligenceEngine>();
export function getRegulatoryEngine(tenantId: string): RegulatoryIntelligenceEngine {
  if (!regulatoryCache.has(tenantId)) regulatoryCache.set(tenantId, new RegulatoryIntelligenceEngine(tenantId));
  return regulatoryCache.get(tenantId)!;
}
