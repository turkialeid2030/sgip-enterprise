/**
 * Cyber Governance Runtime
 * Security controls, breach evidence, cyber KRIs, readiness scoring, resilience.
 */
import { v4 as uuidv4 } from "uuid";
import { TenantContext } from "../../types/tenant.types";
import { requireTenantContext } from "../../tenant/tenant.context";
import { getEvidenceEngine } from "../../evidence/lineage/evidence.lineage.engine";

export type CyberRiskLevel = "critical" | "high" | "medium" | "low";
export type VulnerabilityStatus = "open" | "in_remediation" | "accepted_risk" | "resolved";

export interface CyberPosture {
  tenantId:         string;
  assessedAt:       string;
  overallScore:     number;           // 0-100 (100 = excellent)
  readinessScore:   number;
  resilienceScore:  number;
  controlCoverage:  number;
  incidentReadiness:number;
  vulnerabilityExposure:number;
  activeVulnerabilities:number;
  unresolvedIncidents:  number;
  recommendations:  string[];
  cyberKRIs: {
    patchComplianceRate: number;
    mttd: number;                     // Mean Time to Detect (hours)
    mttr: number;                     // Mean Time to Respond (hours)
    criticalVulnerabilities: number;
  };
}

export interface SecurityControl {
  id:             string;
  tenantId:       string;
  code:           string;
  name:           string;
  type:           "preventive" | "detective" | "corrective" | "compensating";
  domain:         string;
  status:         "active" | "degraded" | "failed" | "under_review";
  lastTestedAt?:  string;
  testScore?:     number;
  evidenceId?:    string;
  linkedRisks:    string[];
  owner:          string;
  createdAt:      string;
}

const cyberControlStore = new Map<string, SecurityControl>();
const postureHistory:   CyberPosture[] = [];

export class CyberGovernanceRuntime {
  constructor(private readonly tenantId: string) {}

  registerControl(params: Omit<SecurityControl, "id" | "tenantId" | "createdAt">): SecurityControl {
    const ctrl: SecurityControl = { ...params, id:uuidv4(), tenantId:this.tenantId, createdAt:new Date().toISOString() };
    cyberControlStore.set(ctrl.id, ctrl);
    return ctrl;
  }

  testControl(controlId: string, score: number, evidenceContent: string, ctx: TenantContext): SecurityControl {
    requireTenantContext(ctx, "CyberGovernanceRuntime.testControl");
    const ctrl = cyberControlStore.get(controlId);
    if (!ctrl || ctrl.tenantId !== this.tenantId) throw Object.assign(new Error("Control not found"), { statusCode:404 });
    const ev  = getEvidenceEngine(this.tenantId);
    const rec = ev.createRecord({ entityId:controlId, entityType:"security_control", title:`Control test: ${ctrl.name}`, sourceType:"control_test", content:evidenceContent, collectedBy:ctx.userId, correlationId:uuidv4() });
    const updated: SecurityControl = { ...ctrl, status: score >= 80 ? "active" : score >= 50 ? "degraded" : "failed", lastTestedAt:new Date().toISOString(), testScore:score, evidenceId:rec.id };
    cyberControlStore.set(controlId, updated);
    return updated;
  }

  assessPosture(ctx: TenantContext): CyberPosture {
    requireTenantContext(ctx, "CyberGovernanceRuntime.assessPosture");
    const controls       = this.getControls();
    const active         = controls.filter(c => c.status === "active").length;
    const failed         = controls.filter(c => c.status === "failed").length;
    const controlCoverage= controls.length > 0 ? Math.round((active / controls.length) * 100) : 100;
    const avgTestScore   = controls.filter(c => c.testScore !== undefined).length > 0
      ? Math.round(controls.filter(c=>c.testScore!==undefined).reduce((s,c)=>s+(c.testScore!),0) / controls.filter(c=>c.testScore!==undefined).length)
      : 75;

    const overallScore = Math.round(controlCoverage * 0.4 + avgTestScore * 0.4 + 80 * 0.2);
    const posture: CyberPosture = {
      tenantId:    this.tenantId,
      assessedAt:  new Date().toISOString(),
      overallScore,
      readinessScore:  Math.min(100, overallScore + 5),
      resilienceScore: Math.min(100, overallScore - 5),
      controlCoverage,
      incidentReadiness: 75,
      vulnerabilityExposure: failed * 20,
      activeVulnerabilities: failed,
      unresolvedIncidents: 0,
      recommendations: failed > 0 ? [`${failed} controls failed — remediate immediately`] : ["Cyber posture is satisfactory"],
      cyberKRIs: { patchComplianceRate:controlCoverage, mttd:4, mttr:24, criticalVulnerabilities:failed },
    };
    postureHistory.push(posture);
    return posture;
  }

  getControls(): SecurityControl[] {
    return [...cyberControlStore.values()].filter(c => c.tenantId === this.tenantId);
  }

  getLatestPosture(): CyberPosture | undefined {
    return postureHistory.filter(p => p.tenantId === this.tenantId).at(-1);
  }
}

const cyberCache = new Map<string, CyberGovernanceRuntime>();
export function getCyberGovernanceRuntime(tenantId: string): CyberGovernanceRuntime {
  if (!cyberCache.has(tenantId)) cyberCache.set(tenantId, new CyberGovernanceRuntime(tenantId));
  return cyberCache.get(tenantId)!;
}
