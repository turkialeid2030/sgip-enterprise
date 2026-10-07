/**
 * Vendor Governance Engine
 * Third-party risk: onboarding, risk scoring, contract governance, continuous monitoring.
 */
import { v4 as uuidv4 } from "uuid";
import { TenantContext } from "../../types/tenant.types";
import { requireTenantContext } from "../../tenant/tenant.context";

export type VendorStatus = "onboarding" | "active" | "under_review" | "suspended" | "offboarded";
export type VendorRiskTier = "critical" | "high" | "medium" | "low";

export interface Vendor {
  id:               string;
  tenantId:         string;
  code:             string;            // VND-001
  name:             string;
  country:          string;
  industry:         string;
  status:           VendorStatus;
  riskTier:         VendorRiskTier;
  riskScore:        number;            // 0-100 (100 = highest risk)
  services:         string[];
  criticalService:  boolean;
  accessLevel:      "none" | "data_read" | "data_write" | "system_access" | "privileged";
  isoCompliant:     boolean;
  soc2Compliant:    boolean;
  contractExpiry:   string;
  reviewDueAt:      string;
  assessmentScore?: number;
  lastReviewedAt?:  string;
  linkedRisks:      string[];
  linkedControls:   string[];
  owner:            string;
  correlationId:    string;
  createdAt:        string;
  updatedAt:        string;
}

const vendorStore = new Map<string, Vendor>();

export class VendorGovernanceEngine {
  constructor(private readonly tenantId: string) {}

  onboard(params: Omit<Vendor, "id" | "tenantId" | "code" | "status" | "riskScore" | "riskTier" | "correlationId" | "createdAt" | "updatedAt">, ctx: TenantContext): Vendor {
    requireTenantContext(ctx, "VendorGovernanceEngine.onboard");
    const count = [...vendorStore.values()].filter(v => v.tenantId === this.tenantId).length + 1;
    // Auto-calculate risk score
    let riskScore = 20;
    if (params.criticalService)             riskScore += 30;
    if (params.accessLevel === "privileged") riskScore += 25;
    if (params.accessLevel === "system_access") riskScore += 15;
    if (!params.isoCompliant)               riskScore += 15;
    if (!params.soc2Compliant)              riskScore += 10;
    riskScore = Math.min(100, riskScore);
    const riskTier: VendorRiskTier = riskScore >= 75 ? "critical" : riskScore >= 50 ? "high" : riskScore >= 25 ? "medium" : "low";

    const vendor: Vendor = { ...params, id:uuidv4(), tenantId:this.tenantId, code:`VND-${String(count).padStart(3,"0")}`, status:"onboarding", riskScore, riskTier, correlationId:uuidv4(), createdAt:new Date().toISOString(), updatedAt:new Date().toISOString() };
    vendorStore.set(vendor.id, vendor);
    return vendor;
  }

  updateRiskScore(vendorId: string, newScore: number, ctx: TenantContext): Vendor {
    requireTenantContext(ctx, "VendorGovernanceEngine.updateRiskScore");
    const v = this.getById(vendorId);
    if (!v) throw Object.assign(new Error(`Vendor ${vendorId} not found`), { statusCode:404 });
    const riskTier: VendorRiskTier = newScore >= 75 ? "critical" : newScore >= 50 ? "high" : newScore >= 25 ? "medium" : "low";
    const updated = { ...v, riskScore:newScore, riskTier, updatedAt:new Date().toISOString() };
    vendorStore.set(vendorId, updated);
    return updated;
  }

  getById(id: string): Vendor | undefined {
    const v = vendorStore.get(id);
    if (v && v.tenantId !== this.tenantId) return undefined;
    return v;
  }

  getHighRisk(): Vendor[] {
    return [...vendorStore.values()].filter(v => v.tenantId === this.tenantId && (v.riskTier === "critical" || v.riskTier === "high"));
  }

  getAll(): Vendor[] {
    return [...vendorStore.values()].filter(v => v.tenantId === this.tenantId);
  }

  getRiskDashboard() {
    const all      = this.getAll();
    const byTier   = { critical:0, high:0, medium:0, low:0 };
    for (const v of all) byTier[v.riskTier]++;
    return { total:all.length, byTier, criticalCount:byTier.critical, avgRiskScore: all.length > 0 ? Math.round(all.reduce((s,v) => s+v.riskScore, 0)/all.length) : 0 };
  }
}

const vendorCache = new Map<string, VendorGovernanceEngine>();
export function getVendorEngine(tenantId: string): VendorGovernanceEngine {
  if (!vendorCache.has(tenantId)) vendorCache.set(tenantId, new VendorGovernanceEngine(tenantId));
  return vendorCache.get(tenantId)!;
}
