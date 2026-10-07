/**
 * Enterprise Risk Intelligence Runtime — Phase 7.2
 * Live ERM: register, score, quantify, propagate, monitor KRIs.
 */
import { v4 as uuidv4 } from "uuid";
import { getEventStore } from "../../runtime/persistence/persistent.event.store";
import { getGRCOntology } from "../../grc-ontology/grc.ontology.engine";

export type RiskCategory = "strategic" | "operational" | "cyber" | "financial" | "regulatory" | "ai" | "third_party" | "data" | "esg" | "model";
export type RiskStatus    = "identified" | "assessed" | "mitigated" | "accepted" | "closed" | "escalated";
export type RiskSeverity  = "critical" | "high" | "medium" | "low";
export type LikelihoodScore = 1|2|3|4|5;
export type ImpactScore     = 1|2|3|4|5;

export interface RiskEntry {
  readonly id:                string;
  readonly tenantId:          string;
  readonly code:              string;
  readonly title:             string;
  readonly description:       string;
  readonly category:          RiskCategory;
  readonly status:            RiskStatus;
  readonly ownerId:           string;
  readonly inherentLikelihood:LikelihoodScore;
  readonly inherentImpact:    ImpactScore;
  readonly inherentScore:     number;          // likelihood × impact
  readonly residualLikelihood:LikelihoodScore;
  readonly residualImpact:    ImpactScore;
  readonly residualScore:     number;
  readonly appetiteScore:     number;          // board-approved tolerance
  readonly toleranceBreached: boolean;
  readonly controlIds:        string[];
  readonly evidenceIds:       string[];
  readonly linkedRisks:       string[];        // cascading risk links
  readonly version:           number;
  readonly lastReviewedAt?:   string;
  readonly closedAt?:         string;
  readonly createdAt:         string;
  readonly updatedAt:         string;
}

export interface RiskKRI {
  readonly riskId:    string;
  readonly tenantId:  string;
  readonly metric:    string;
  readonly threshold: number;
  readonly current:   number;
  readonly breached:  boolean;
  readonly trend:     "improving" | "stable" | "deteriorating";
  readonly updatedAt: string;
}

export interface CascadeAnalysis {
  rootRiskId:    string;
  affectedRisks: RiskEntry[];
  totalExposure: number;
  criticalPath:  string[];
  severity:      RiskSeverity;
}

const riskStore = new Map<string, RiskEntry>();
const kriStore  = new Map<string, RiskKRI[]>();
let   riskSeq   = 0;

export class RiskIntelligenceRuntime {
  constructor(private readonly tenantId: string) {}

  private assertScore(name:string, value:number): void {
    if (!Number.isInteger(value) || value < 1 || value > 5) {
      throw Object.assign(new RangeError(`${name} must be an integer from 1 to 5`), {statusCode:422, code:"VALIDATION_ERROR"});
    }
  }

  register(params: {
    title:               string;
    description:         string;
    category:            RiskCategory;
    ownerId:             string;
    inherentLikelihood:  LikelihoodScore;
    inherentImpact:      ImpactScore;
    appetiteScore?:      number;
    controlIds?:         string[];
    linkedRisks?:        string[];
    createdBy:           string;
  }): RiskEntry {
    this.assertScore("inherentLikelihood", params.inherentLikelihood);
    this.assertScore("inherentImpact", params.inherentImpact);
    if (params.appetiteScore !== undefined && (!Number.isFinite(params.appetiteScore) || params.appetiteScore < 0 || params.appetiteScore > 25)) {
      throw Object.assign(new RangeError("appetiteScore must be between 0 and 25"), {statusCode:422, code:"VALIDATION_ERROR"});
    }
    riskSeq++;
    const id = uuidv4();
    const inherentScore = params.inherentLikelihood * params.inherentImpact;
    const appetiteScore = params.appetiteScore ?? 6;  // default moderate appetite
    const entry: RiskEntry = Object.freeze({
      id, tenantId:this.tenantId,
      code:               `RSK-${this.tenantId.slice(-4).toUpperCase()}-${String(riskSeq).padStart(4,"0")}`,
      title:              params.title, description:params.description,
      category:           params.category, status:"identified",
      ownerId:            params.ownerId,
      inherentLikelihood: params.inherentLikelihood,
      inherentImpact:     params.inherentImpact,
      inherentScore,
      residualLikelihood: params.inherentLikelihood,
      residualImpact:     params.inherentImpact,
      residualScore:      inherentScore,
      appetiteScore,
      toleranceBreached:  inherentScore > appetiteScore,
      controlIds:         params.controlIds ?? [],
      evidenceIds:        [],
      linkedRisks:        params.linkedRisks ?? [],
      version:            1,
      createdAt:          new Date().toISOString(),
      updatedAt:          new Date().toISOString(),
    });
    riskStore.set(id, entry);

    // Register in GRC Ontology
    try {
      const grcTypeMap: Record<string, string> = { "strategic":"strategic_risk","operational":"operational_risk","cyber":"cyber_risk","financial":"financial_risk","regulatory":"regulatory_risk","ai":"ai_risk","third_party":"third_party_risk","data":"data_risk","esg":"esg_risk","model":"model_risk" };
      const mappedType = grcTypeMap[params.category] ?? "enterprise_risk";
      getGRCOntology(this.tenantId).upsert({ entityType:mappedType as any, code:entry.code, title:params.title, description:params.description, ownerId:params.ownerId, ownerRole:"risk_owner", createdBy:params.createdBy });
    } catch {}

    getEventStore(this.tenantId).append({ topic:"risk.registered", payload:{ riskId:id, code:entry.code, category:params.category, inherentScore, toleranceBreached:entry.toleranceBreached }, actorId:params.createdBy, actorRole:"risk_analyst" });
    return entry;
  }

  updateResidual(riskId: string, residualLikelihood: LikelihoodScore, residualImpact: ImpactScore, updatedBy: string): RiskEntry {
    this.assertScore("residualLikelihood", residualLikelihood);
    this.assertScore("residualImpact", residualImpact);
    const risk = riskStore.get(riskId);
    if (!risk || risk.tenantId !== this.tenantId) throw Object.assign(new Error("Risk not found"), {statusCode:404});
    const residualScore   = residualLikelihood * residualImpact;
    const toleranceBreached = residualScore > risk.appetiteScore;
    const updated: RiskEntry = Object.freeze({ ...risk, residualLikelihood, residualImpact, residualScore, toleranceBreached, version:risk.version+1, updatedAt:new Date().toISOString() });
    riskStore.set(riskId, updated);
    if (toleranceBreached) {
      getEventStore(this.tenantId).append({ topic:"risk.tolerance.breached", payload:{ riskId, residualScore, appetiteScore:risk.appetiteScore }, actorId:updatedBy, actorRole:"risk_analyst" });
    }
    return updated;
  }

  updateKRI(riskId: string, metric: string, value: number, threshold: number): RiskKRI {
    if (!Number.isFinite(value) || !Number.isFinite(threshold)) throw Object.assign(new RangeError("KRI value and threshold must be finite"), {statusCode:422, code:"VALIDATION_ERROR"});
    if (!kriStore.has(riskId)) kriStore.set(riskId, []);
    const existing = kriStore.get(riskId)!.find(k => k.metric === metric);
    const prev     = existing?.current ?? threshold;
    const trend: RiskKRI["trend"] = value < prev ? "improving" : value > prev ? "deteriorating" : "stable";
    const kri: RiskKRI = Object.freeze({ riskId, tenantId:this.tenantId, metric, threshold, current:value, breached:value>threshold, trend, updatedAt:new Date().toISOString() });
    const kris = kriStore.get(riskId)!.filter(k => k.metric !== metric);
    kris.push(kri);
    kriStore.set(riskId, kris);
    if (kri.breached) getEventStore(this.tenantId).append({ topic:"risk.kri.breached", payload:{ riskId, metric, value, threshold }, actorId:"system", actorRole:"system" });
    return kri;
  }

  analyzeCascade(rootRiskId: string): CascadeAnalysis {
    const root = riskStore.get(rootRiskId);
    if (!root || root.tenantId !== this.tenantId) return { rootRiskId, affectedRisks:[], totalExposure:0, criticalPath:[], severity:"low" };
    const visited   = new Set<string>([rootRiskId]);
    const affected: RiskEntry[] = [];
    const queue     = [...root.linkedRisks];
    while (queue.length > 0) {
      const id = queue.shift()!;
      if (visited.has(id)) continue;
      visited.add(id);
      const r = riskStore.get(id);
      if (r && r.tenantId === this.tenantId) {
        affected.push(r);
        queue.push(...r.linkedRisks);
      }
    }
    const totalExposure = [root, ...affected].reduce((s, r) => s + r.residualScore, 0);
    const severity: RiskSeverity = totalExposure >= 20 ? "critical" : totalExposure >= 12 ? "high" : totalExposure >= 6 ? "medium" : "low";
    return { rootRiskId, affectedRisks:affected, totalExposure, criticalPath:[rootRiskId, ...affected.map(r=>r.id)], severity };
  }

  getAll(category?: RiskCategory): RiskEntry[] {
    return [...riskStore.values()].filter(r => r.tenantId===this.tenantId && (!category||r.category===category));
  }
  getById(id: string): RiskEntry | undefined { const r = riskStore.get(id); return r?.tenantId===this.tenantId?r:undefined; }
  getBreachingTolerance(): RiskEntry[] { return this.getAll().filter(r=>r.toleranceBreached); }
  getKRIs(riskId: string): RiskKRI[] { return kriStore.get(riskId)?.filter(k=>k.tenantId===this.tenantId) ?? []; }
}

const riskCache = new Map<string, RiskIntelligenceRuntime>();
export function getRiskRuntime(tenantId: string): RiskIntelligenceRuntime {
  if (!riskCache.has(tenantId)) riskCache.set(tenantId, new RiskIntelligenceRuntime(tenantId));
  return riskCache.get(tenantId)!;
}
