/**
 * AI Governance Engine
 * Model registry, approvals, explainability evidence, bias assessment, incidents.
 * Every AI output is governed, attested, and auditable.
 */
import { v4 as uuidv4 } from "uuid";
import { TenantContext } from "../../types/tenant.types";
import { requireTenantContext } from "../../tenant/tenant.context";
import { getEvidenceEngine } from "../../evidence/lineage/evidence.lineage.engine";

export type AIModelStatus = "proposed" | "approved" | "active" | "under_review" | "suspended" | "retired";
export type AIRiskLevel   = "critical" | "high" | "medium" | "low";

export interface AIModel {
  id:                string;
  tenantId:          string;
  code:              string;              // AI-MDL-001
  name:              string;
  provider:          string;              // Anthropic, OpenAI, etc.
  modelId:           string;              // claude-sonnet-4-20250514
  version:           string;
  purpose:           string;
  status:            AIModelStatus;
  riskLevel:         AIRiskLevel;
  useCase:           string;
  domain:            string;
  approvedBy?:       string;
  approvedAt?:       string;
  biasAssessmentScore:number;             // 0-100 (100 = no detected bias)
  explainabilityScore:number;             // 0-100 (100 = fully explainable)
  complianceScore:   number;              // 0-100
  auditFrequency:    "monthly" | "quarterly" | "annual";
  lastAuditAt?:      string;
  incidents:         string[];
  evidenceIds:       string[];
  governedBy:        string[];            // agent constitution IDs
  correlationId:     string;
  createdAt:         string;
  updatedAt:         string;
}

export interface AIIncident {
  id:           string;
  tenantId:     string;
  modelId:      string;
  type:         "bias_detected" | "output_harmful" | "hallucination" | "compliance_breach" | "unauthorized_use" | "data_leakage";
  severity:     AIRiskLevel;
  description:  string;
  promptRef?:   string;
  outputRef?:   string;
  detectedBy:   string;
  detectedAt:   string;
  resolved:     boolean;
  evidenceId?:  string;
}

const aiModelStore   = new Map<string, AIModel>();
const aiIncidentStore: AIIncident[] = [];

export class AIGovernanceEngine {
  constructor(private readonly tenantId: string) {}

  registerModel(params: Omit<AIModel, "id" | "tenantId" | "code" | "status" | "incidents" | "evidenceIds" | "correlationId" | "createdAt" | "updatedAt">, ctx: TenantContext): AIModel {
    requireTenantContext(ctx, "AIGovernanceEngine.registerModel");
    const count = [...aiModelStore.values()].filter(m => m.tenantId === this.tenantId).length + 1;
    const now   = new Date().toISOString();
    const model: AIModel = { ...params, id:uuidv4(), tenantId:this.tenantId, code:`AI-MDL-${String(count).padStart(3,"0")}`, status:"proposed", incidents:[], evidenceIds:[], correlationId:uuidv4(), createdAt:now, updatedAt:now };
    aiModelStore.set(model.id, model);
    return model;
  }

  approve(modelId: string, ctx: TenantContext): AIModel {
    requireTenantContext(ctx, "AIGovernanceEngine.approve");
    const model = this.getById(modelId);
    if (!model) throw Object.assign(new Error("AI model not found"), { statusCode:404 });
    const ev = getEvidenceEngine(this.tenantId);
    const r  = ev.createRecord({ entityId:modelId, entityType:"ai_model", title:`AI Model Approved: ${model.name}`, sourceType:"process_log", content:`Approved by ${ctx.userId} — bias:${model.biasAssessmentScore} explainability:${model.explainabilityScore}`, collectedBy:ctx.userId, correlationId:model.correlationId });
    const updated = { ...model, status:"approved" as AIModelStatus, approvedBy:ctx.userId, approvedAt:new Date().toISOString(), evidenceIds:[...model.evidenceIds, r.id], updatedAt:new Date().toISOString() };
    aiModelStore.set(modelId, updated);
    return updated;
  }

  recordIncident(params: Omit<AIIncident, "id" | "tenantId" | "resolved" | "evidenceId">, ctx: TenantContext): AIIncident {
    requireTenantContext(ctx, "AIGovernanceEngine.recordIncident");
    const ev  = getEvidenceEngine(this.tenantId);
    const rec = ev.createRecord({ entityId:params.modelId, entityType:"ai_model", title:`AI Incident: ${params.type}`, sourceType:"system_log", content:`${params.description}|severity:${params.severity}`, collectedBy:params.detectedBy, correlationId:uuidv4() });
    const inc: AIIncident = { ...params, id:uuidv4(), tenantId:this.tenantId, resolved:false, evidenceId:rec.id };
    aiIncidentStore.push(inc);
    const model = this.getById(params.modelId);
    if (model) aiModelStore.set(params.modelId, { ...model, incidents:[...model.incidents, inc.id], status: params.severity === "critical" ? "under_review" : model.status });
    return inc;
  }

  getById(id: string): AIModel | undefined {
    const m = aiModelStore.get(id);
    if (m && m.tenantId !== this.tenantId) return undefined;
    return m;
  }

  getAll(): AIModel[] {
    return [...aiModelStore.values()].filter(m => m.tenantId === this.tenantId);
  }

  getActiveIncidents(): AIIncident[] {
    return aiIncidentStore.filter(i => i.tenantId === this.tenantId && !i.resolved);
  }

  getGovernanceDashboard() {
    const models   = this.getAll();
    const active   = models.filter(m => m.status === "active").length;
    const approved = models.filter(m => m.status === "approved").length;
    const incidents= this.getActiveIncidents().length;
    const avgBias  = models.length > 0 ? Math.round(models.reduce((s,m)=>s+m.biasAssessmentScore,0)/models.length) : 0;
    const avgExpl  = models.length > 0 ? Math.round(models.reduce((s,m)=>s+m.explainabilityScore,0)/models.length) : 0;
    return { totalModels:models.length, active, approved, incidents, avgBiasScore:avgBias, avgExplainabilityScore:avgExpl, riskLevel: models.length===0 ? "medium" : incidents > 0 ? "high" : avgBias < 70 ? "medium" : "low", dataSufficiency:models.length>0?"sufficient":"insufficient" as const };
  }
}

const aiGovCache = new Map<string, AIGovernanceEngine>();
export function getAIGovernanceEngine(tenantId: string): AIGovernanceEngine {
  if (!aiGovCache.has(tenantId)) aiGovCache.set(tenantId, new AIGovernanceEngine(tenantId));
  return aiGovCache.get(tenantId)!;
}
