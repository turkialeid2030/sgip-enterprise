/**
 * AI Model Registry + Drift Detection — Phase 11
 * Model lineage, bias detection, drift monitoring, responsible AI scoring.
 * Supports: ISO 42001, NIST AI RMF, EU AI Act concepts, SDAIA AI Governance.
 */
import { v4 as uuidv4 } from "uuid";
import { getEventStore } from "../../runtime/persistence/persistent.event.store";

export type AIRiskTier = "prohibited"|"high_risk"|"limited_risk"|"minimal_risk";
export type ModelStage  = "development"|"validation"|"staging"|"production"|"retired"|"suspended";
export type DriftType   = "data_drift"|"concept_drift"|"performance_drift"|"bias_drift"|"distribution_shift";

export interface AIModel {
  readonly id:              string;
  readonly tenantId:        string;
  readonly code:            string;            // MDL-001
  readonly name:            string;
  readonly version:         string;
  readonly modelType:       string;            // classification, regression, generative, etc.
  readonly useCase:         string;
  readonly riskTier:        AIRiskTier;
  readonly stage:           ModelStage;
  readonly ownerId:         string;
  readonly teamId:          string;
  readonly trainedOn:       string;            // dataset description
  readonly approvedBy?:     string;
  readonly approvedAt?:     string;
  readonly frameworks:      string[];          // ISO_42001, NIST_AI_RMF, etc.
  readonly explainabilityScore:number;         // 0-100
  readonly biasAuditedAt?:  string;
  readonly biasResult?:     "pass"|"fail"|"in_progress";
  readonly driftStatus:     "nominal"|"warning"|"alert"|"suspended";
  readonly lastDriftCheckAt?:string;
  readonly sdaiaRegistered: boolean;           // Required for high-risk AI in Saudi Arabia
  readonly humanOversightRequired:boolean;
  readonly createdAt:       string;
  readonly updatedAt:       string;
}

export interface ModelDriftEvent {
  id:         string;
  tenantId:   string;
  modelId:    string;
  modelCode:  string;
  driftType:  DriftType;
  metric:     string;              // e.g. "accuracy", "F1", "PSI"
  baseline:   number;
  current:    number;
  threshold:  number;
  deviation:  number;             // percentage
  severity:   "critical"|"high"|"medium"|"low";
  action:     "alert"|"suspend"|"retrain"|"review";
  detectedAt: string;
  resolvedAt?:string;
}

export interface ModelLineage {
  modelId:         string;
  parentModelId?:  string;
  dataset:         string;
  dataVersion:     string;
  trainingDate:    string;
  validationScore: number;
  featureCount:    number;
  epochs?:         number;
  hyperparameters: Record<string, unknown>;
  artifacts:       string[];
}

export interface BiasAssessment {
  id:         string;
  tenantId:   string;
  modelId:    string;
  assessedAt: string;
  assessedBy: string;
  dimensions: Array<{
    dimension:  string;     // age, gender, nationality, etc.
    metric:     string;     // demographic_parity, equalized_odds, etc.
    score:      number;
    threshold:  number;
    passed:     boolean;
    notes:      string;
  }>;
  overallResult:  "pass"|"fail";
  recommendations:string[];
  certifiedAt?:   string;
}

export interface ResponsibleAIScore {
  tenantId:       string;
  scoredAt:       string;
  overallScore:   number;           // 0-100
  dimensions: {
    explainability:     number;
    fairness:           number;
    robustness:         number;
    privacy:            number;
    human_oversight:    number;
    transparency:       number;
  };
  highRiskModels:         number;
  unregisteredModels:     number;
  driftAlerts:            number;
  biasFailures:           number;
  recommendations:        string[];
}

const modelStore    = new Map<string, AIModel[]>();
const driftStore    = new Map<string, ModelDriftEvent[]>();
const lineageStore  = new Map<string, ModelLineage>();
const biasStore     = new Map<string, BiasAssessment[]>();
let   modelSeq      = 0;

export class AIModelRegistry {
  constructor(private readonly tenantId: string) {}

  registerModel(params: Omit<AIModel,"id"|"tenantId"|"code"|"driftStatus"|"createdAt"|"updatedAt">): AIModel {
    modelSeq++;
    const now = new Date().toISOString();
    const model: AIModel = Object.freeze({
      ...params, id:uuidv4(), tenantId:this.tenantId,
      code: `MDL-${String(modelSeq).padStart(3,"0")}`,
      driftStatus: "nominal", createdAt:now, updatedAt:now,
    });
    if (!modelStore.has(this.tenantId)) modelStore.set(this.tenantId, []);
    modelStore.get(this.tenantId)!.push(model);

    // Check: high-risk AI must be approved for production
    if (model.riskTier === "high_risk" && model.stage === "production" && !model.approvedBy) {
      getEventStore(this.tenantId).append({ topic:"ai.model.high_risk.unapproved", payload:{ modelId:model.id, code:model.code, name:model.name }, actorId:"system", actorRole:"system" });
    }
    // Check: SDAIA registration for Saudi context
    if (model.riskTier === "high_risk" && !model.sdaiaRegistered) {
      getEventStore(this.tenantId).append({ topic:"ai.model.sdaia_registration.required", payload:{ modelId:model.id, code:model.code }, actorId:"system", actorRole:"system" });
    }

    getEventStore(this.tenantId).append({ topic:"ai.model.registered", payload:{ modelId:model.id, code:model.code, riskTier:model.riskTier, stage:model.stage }, actorId:params.ownerId, actorRole:"ai_engineer" });
    return model;
  }

  recordDrift(modelId: string, params: {driftType:DriftType; metric:string; baseline:number; current:number; threshold:number}): ModelDriftEvent {
    const model = this.getModel(modelId);
    if (!model || model.tenantId !== this.tenantId) throw Object.assign(new Error("Model not found"), {statusCode:404});
    const deviation = Math.abs(params.current - params.baseline) / Math.max(1,params.baseline) * 100;
    const severity  = deviation > 30 ? "critical" : deviation > 20 ? "high" : deviation > 10 ? "medium" : "low";
    const action    = deviation > 30 ? "suspend" : deviation > 20 ? "retrain" : deviation > 10 ? "alert" : "review";

    const evt: ModelDriftEvent = { id:uuidv4(), tenantId:this.tenantId, modelId, modelCode:model.code, driftType:params.driftType, metric:params.metric, baseline:params.baseline, current:params.current, threshold:params.threshold, deviation, severity, action, detectedAt:new Date().toISOString() };

    if (!driftStore.has(this.tenantId)) driftStore.set(this.tenantId, []);
    driftStore.get(this.tenantId)!.push(evt);

    // Update model drift status
    const models = modelStore.get(this.tenantId)!;
    const idx = models.findIndex(m => m.id === modelId);
    if (idx >= 0) {
      const driftStatus = severity === "critical" || action === "suspend" ? "alert" : severity === "high" ? "warning" : "nominal";
      models[idx] = { ...models[idx], driftStatus, lastDriftCheckAt:new Date().toISOString(), updatedAt:new Date().toISOString() };
    }

    getEventStore(this.tenantId).append({ topic:`ai.model.drift.${severity}`, payload:{ modelId, modelCode:model.code, driftType:params.driftType, metric:params.metric, deviation }, actorId:"drift_monitor", actorRole:"system" });
    return evt;
  }

  conductBiasAssessment(modelId: string, assessedBy: string, dimensions: BiasAssessment["dimensions"]): BiasAssessment {
    const model = this.getModel(modelId);
    if (!model || model.tenantId !== this.tenantId) throw Object.assign(new Error("Model not found"), {statusCode:404});
    const failed = dimensions.filter(d => !d.passed);
    const result: BiasAssessment = {
      id:uuidv4(), tenantId:this.tenantId, modelId,
      assessedAt:new Date().toISOString(), assessedBy, dimensions,
      overallResult: failed.length === 0 ? "pass" : "fail",
      recommendations: failed.map(d=>`Investigate ${d.dimension} bias — ${d.metric} score ${d.score.toFixed(2)} below threshold ${d.threshold}`),
    };
    if (!biasStore.has(this.tenantId)) biasStore.set(this.tenantId, []);
    biasStore.get(this.tenantId)!.push(result);
    if (result.overallResult === "fail") {
      getEventStore(this.tenantId).append({ topic:"ai.model.bias.detected", payload:{ modelId, assessmentId:result.id, failedDimensions:failed.length }, actorId:assessedBy, actorRole:"ai_governance" });
    }
    return result;
  }

  setLineage(modelId: string, lineage: Omit<ModelLineage,"modelId">): ModelLineage {
    const full: ModelLineage = { ...lineage, modelId };
    lineageStore.set(`${this.tenantId}:${modelId}`, full);
    return full;
  }

  scoreResponsibleAI(): ResponsibleAIScore {
    const models    = this.getModels();
    const drifts    = (driftStore.get(this.tenantId) ?? []).filter(d=>d.severity==="critical"||d.severity==="high");
    const biases    = (biasStore.get(this.tenantId) ?? []).filter(b=>b.overallResult==="fail");
    const highRisk  = models.filter(m=>m.riskTier==="high_risk");
    const unregist  = models.filter(m=>m.riskTier==="high_risk" && !m.sdaiaRegistered);
    const avgExplain= models.length>0 ? Math.round(models.reduce((s,m)=>s+m.explainabilityScore,0)/models.length) : 50;
    const fairness  = biases.length===0 ? 90 : Math.max(0,90-biases.length*20);
    const oversight = models.filter(m=>m.humanOversightRequired&&m.stage==="production").length > 0 ? 80 : 60;
    const transparency = models.filter(m=>m.approvedBy).length/Math.max(1,models.length)*100;
    const overall   = Math.round((avgExplain+fairness+oversight+transparency+80)/5);
    const recs: string[] = [
      ...(unregist.length>0?[`${unregist.length} high-risk models not registered with SDAIA`]:[]),
      ...(biases.length>0?[`${biases.length} bias assessment failures — model governance review required`]:[]),
      ...(drifts.length>0?[`${drifts.length} critical/high drift events — consider model retraining`]:[]),
      ...(highRisk.filter(m=>!m.approvedBy).length>0?["High-risk models without board/governance approval"]:[]),
    ];
    return { tenantId:this.tenantId, scoredAt:new Date().toISOString(), overallScore:overall, dimensions:{ explainability:avgExplain, fairness, robustness:75, privacy:80, human_oversight:oversight, transparency:Math.round(transparency) }, highRiskModels:highRisk.length, unregisteredModels:unregist.length, driftAlerts:drifts.length, biasFailures:biases.length, recommendations:recs };
  }

  getModel(id: string): AIModel | undefined { return (modelStore.get(this.tenantId)??[]).find(m=>m.id===id&&m.tenantId===this.tenantId); }
  getModels(tier?: AIRiskTier): AIModel[] {
    const all = modelStore.get(this.tenantId) ?? [];
    return tier ? all.filter(m=>m.riskTier===tier) : all;
  }
  getDriftEvents(modelId?: string): ModelDriftEvent[] {
    const all = driftStore.get(this.tenantId) ?? [];
    return modelId ? all.filter(d=>d.modelId===modelId) : all;
  }
  getBiasAssessments(modelId?: string): BiasAssessment[] {
    const all = biasStore.get(this.tenantId) ?? [];
    return modelId ? all.filter(b=>b.modelId===modelId) : all;
  }
  getLineage(modelId: string): ModelLineage | undefined {
    return lineageStore.get(`${this.tenantId}:${modelId}`);
  }
}

const regCache = new Map<string,AIModelRegistry>();
export function getAIModelRegistry(tenantId:string): AIModelRegistry {
  if (!regCache.has(tenantId)) regCache.set(tenantId,new AIModelRegistry(tenantId));
  return regCache.get(tenantId)!;
}
