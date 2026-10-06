/**
 * External Regulatory + Geopolitical Intelligence — Phase 8.4+8.5
 *
 * Regulatory feeds: SAMA, NCA, CMA, GDPR, ISO, SOC2, PCI-DSS, AI governance.
 * Geopolitical signals: macro risk, cyber threats, supply chain, AI threat intel.
 *
 * Architecture:
 *   - IntelligenceFeed: pluggable source (file, API, webhook)
 *   - RegulatoryDiffEngine: detects changes vs current baseline
 *   - GeopoliticalSignalProcessor: scores and propagates external risks
 *   - ExternalIntelligenceRuntime: orchestrates all sources
 */
import { v4 as uuidv4 } from "uuid";
import { getEventStore } from "../persistence/persistent.event.store";
import { getRiskRuntime } from "../../risk-runtime/register/risk.intelligence.runtime";

// ── Regulatory Frameworks ─────────────────────────────────────
export type RegulatoryFramework =
  | "SAMA_CSF"  | "NCA_ECC"    | "CMA"       | "GDPR"
  | "ISO_27001" | "SOC2"       | "PCI_DSS"   | "AI_EU_ACT"
  | "NIST_AI"   | "ISO_42001"  | "NCA_DCC"   | "SAMA_CSCC"
  | "HIPAA"     | "SOX"        | "BASEL_III" | "IOSCO";

export type ChangeType = "new_requirement" | "amendment" | "deadline" | "clarification" | "enforcement_action" | "withdrawal";
export type SignalSeverity = "critical" | "high" | "medium" | "low" | "informational";

export interface RegulatoryChange {
  id:           string;
  tenantId:     string;
  framework:    RegulatoryFramework;
  changeType:   ChangeType;
  title:        string;
  description:  string;
  effectiveDate:string;
  jurisdiction: string;
  affectedAreas:string[];
  controlGaps:  string[];
  obligationIds:string[];
  severity:     SignalSeverity;
  source:       string;
  rawRef:       string;
  ingestedAt:   string;
  processedAt?: string;
}

export interface PolicyImpactAnalysis {
  changeId:     string;
  impactScore:  number;   // 0-100
  affectedPolicies:string[];
  requiredActions:string[];
  deadline?:    string;
  estimatedRemediationDays:number;
}

export interface GeopoliticalSignal {
  id:           string;
  tenantId:     string;
  signalType:   "cyber_threat" | "supply_chain" | "macroeconomic" | "regulatory_shift" | "ai_governance" | "geopolitical" | "sector_specific";
  region:       string;
  sector?:      string;
  title:        string;
  description:  string;
  severity:     SignalSeverity;
  probability:  number;   // 0-100
  timeHorizon:  "immediate" | "short_term" | "medium_term" | "long_term";
  blastRadius:  string[];  // affected entity types
  cascadingRisks:string[];
  earlyWarning: boolean;
  ingestedAt:   string;
}

export interface ExternalIntelligenceSummary {
  tenantId:       string;
  generatedAt:    string;
  regulatoryChanges:  number;
  criticalChanges:    number;
  geopoliticalSignals:number;
  earlyWarnings:      number;
  topThreats:         string[];
  immediateActions:   string[];
  overallExposureScore:number;  // 0-100
}

// ── Stores ────────────────────────────────────────────────────
const regChangeStore  = new Map<string, RegulatoryChange[]>();   // tenantId → changes
const geoSignalStore  = new Map<string, GeopoliticalSignal[]>(); // tenantId → signals
const impactCache     = new Map<string, PolicyImpactAnalysis[]>();

// ── Built-in baseline regulatory data ─────────────────────────
// SAMA CSF latest (Q1 2025), NCA ECC 2024, AI EU Act 2024
const REGULATORY_BASELINE: Array<Omit<RegulatoryChange,"id"|"tenantId"|"ingestedAt"|"processedAt"|"obligationIds"|"controlGaps">> = [
  { framework:"SAMA_CSF", changeType:"amendment", title:"SAMA CSF v2.1 — Enhanced Cloud Security", description:"Updated cloud security requirements for financial institutions operating in Saudi Arabia", effectiveDate:"2025-01-01", jurisdiction:"Saudi Arabia", affectedAreas:["cloud_governance","data_residency","third_party_risk"], severity:"high", source:"SAMA", rawRef:"SAMA/CSF/2024/001" },
  { framework:"NCA_ECC", changeType:"new_requirement", title:"NCA ECC 2024 — AI Systems Governance", description:"New controls for AI systems used in critical national infrastructure", effectiveDate:"2025-03-01", jurisdiction:"Saudi Arabia", affectedAreas:["ai_governance","model_risk","autonomous_systems"], severity:"critical", source:"NCA", rawRef:"NCA/ECC/2024/AI/001" },
  { framework:"AI_EU_ACT", changeType:"new_requirement", title:"EU AI Act — High-Risk AI Systems", description:"Binding requirements for high-risk AI systems including governance, transparency, human oversight", effectiveDate:"2026-08-02", jurisdiction:"EU", affectedAreas:["ai_governance","explainability","human_oversight"], severity:"critical", source:"EU", rawRef:"EU/AI_ACT/2024/ART.13" },
  { framework:"GDPR", changeType:"enforcement_action", title:"GDPR Article 25 — Privacy by Design enforcement increase", description:"Increased regulatory focus on data minimisation and privacy by design in AI systems", effectiveDate:"2025-01-01", jurisdiction:"EU/Global", affectedAreas:["data_privacy","ai_governance","third_party_risk"], severity:"high", source:"EDPB", rawRef:"EDPB/2024/28" },
  { framework:"ISO_27001", changeType:"amendment", title:"ISO/IEC 27001:2022 Transition Deadline", description:"All organizations must complete transition to ISO 27001:2022 — no more extensions", effectiveDate:"2025-10-31", jurisdiction:"Global", affectedAreas:["information_security","risk_management","controls"], severity:"high", source:"ISO", rawRef:"ISO/IEC/27001:2022" },
];

const GEO_SIGNAL_BASELINE: Array<Omit<GeopoliticalSignal,"id"|"tenantId"|"ingestedAt">> = [
  { signalType:"cyber_threat", region:"Global", sector:"Financial Services", title:"Increased state-sponsored cyber attacks on financial infrastructure", description:"Multiple threat intelligence sources report increased APT activity targeting banking and payment systems", severity:"critical", probability:75, timeHorizon:"immediate", blastRadius:["cyber_risk","operational_risk","third_party_risk"], cascadingRisks:["data_breach","service_disruption","regulatory_breach"], earlyWarning:true },
  { signalType:"ai_governance", region:"Global", title:"Rapid AI governance regulation convergence", description:"Multiple jurisdictions simultaneously releasing AI governance frameworks creating compliance complexity", severity:"high", probability:90, timeHorizon:"short_term", blastRadius:["ai_risk","regulatory_risk","model_risk"], cascadingRisks:["compliance_breach","reputational_risk"], earlyWarning:true },
  { signalType:"supply_chain", region:"Middle East", sector:"Technology", title:"Supply chain disruption risk — critical IT components", description:"Geopolitical tensions impacting supply of critical hardware components for data centers", severity:"medium", probability:45, timeHorizon:"medium_term", blastRadius:["operational_risk","third_party_risk","concentration_risk"], cascadingRisks:["service_disruption"], earlyWarning:false },
  { signalType:"macroeconomic", region:"Global", title:"Elevated interest rate environment impacts fintech valuations", description:"Sustained high interest rates creating credit risk concentration in fintech and startup portfolios", severity:"medium", probability:70, timeHorizon:"short_term", blastRadius:["financial_risk","concentration_risk","strategic_risk"], cascadingRisks:["credit_event","portfolio_impairment"], earlyWarning:false },
];

export class ExternalIntelligenceRuntime {
  constructor(private readonly tenantId: string) {}

  /**
   * Ingest regulatory feed — idempotent by framework+rawRef.
   */
  ingestRegulatoryChange(params: Omit<RegulatoryChange, "id"|"tenantId"|"ingestedAt"|"obligationIds"|"controlGaps">): RegulatoryChange {
    const existing = (regChangeStore.get(this.tenantId) ?? []).find(c => c.framework === params.framework && c.rawRef === params.rawRef);
    if (existing) return existing;

    const change: RegulatoryChange = {
      ...params, id:uuidv4(), tenantId:this.tenantId,
      ingestedAt:new Date().toISOString(), obligationIds:[], controlGaps:[],
    };
    if (!regChangeStore.has(this.tenantId)) regChangeStore.set(this.tenantId, []);
    regChangeStore.get(this.tenantId)!.push(change);

    getEventStore(this.tenantId).append({
      topic:"external.regulatory.change.ingested",
      payload:{ changeId:change.id, framework:params.framework, severity:params.severity, title:params.title },
      actorId:"regulatory_intelligence", actorRole:"system",
      idempotencyKey:`reg:${params.framework}:${params.rawRef}`,
    });
    return change;
  }

  ingestGeopoliticalSignal(params: Omit<GeopoliticalSignal, "id"|"tenantId"|"ingestedAt">): GeopoliticalSignal {
    const signal: GeopoliticalSignal = { ...params, id:uuidv4(), tenantId:this.tenantId, ingestedAt:new Date().toISOString() };
    if (!geoSignalStore.has(this.tenantId)) geoSignalStore.set(this.tenantId, []);
    geoSignalStore.get(this.tenantId)!.push(signal);

    if (params.earlyWarning) {
      getEventStore(this.tenantId).append({
        topic:"external.geopolitical.early_warning",
        payload:{ signalId:signal.id, type:params.signalType, severity:params.severity, title:params.title },
        actorId:"geopolitical_intelligence", actorRole:"system",
      });
    }
    return signal;
  }

  /**
   * Load baseline regulatory and geopolitical data.
   * Call this on startup to initialize the intelligence layer.
   */
  loadBaseline(): { regulatory:number; geopolitical:number } {
    let regCount = 0; let geoCount = 0;
    for (const r of REGULATORY_BASELINE) { this.ingestRegulatoryChange(r); regCount++; }
    for (const g of GEO_SIGNAL_BASELINE)  { this.ingestGeopoliticalSignal(g); geoCount++; }
    return { regulatory:regCount, geopolitical:geoCount };
  }

  /**
   * Diff engine: compare incoming change against current obligation baseline.
   */
  analyzeImpact(changeId: string): PolicyImpactAnalysis {
    const change = this.getChanges().find(c => c.id === changeId);
    if (!change) throw Object.assign(new Error("Change not found"), {statusCode:404});

    const impactScore = change.severity === "critical" ? 90 : change.severity === "high" ? 70 : change.severity === "medium" ? 40 : 15;
    const affectedPolicies = change.affectedAreas.map(a => `POL-${a.toUpperCase().replace(/_/g,"-")}`);
    const requiredActions = [
      `Review and update policies covering: ${change.affectedAreas.join(", ")}`,
      `Conduct control gap assessment against ${change.framework}`,
      `Update obligation registry with new ${change.changeType} requirements`,
      ...(change.severity === "critical" ? ["Escalate to board risk committee immediately"] : []),
    ];

    const analysis: PolicyImpactAnalysis = {
      changeId, impactScore, affectedPolicies, requiredActions,
      deadline: change.effectiveDate,
      estimatedRemediationDays: impactScore > 70 ? 90 : impactScore > 40 ? 60 : 30,
    };
    if (!impactCache.has(this.tenantId)) impactCache.set(this.tenantId, []);
    impactCache.get(this.tenantId)!.push(analysis);
    return analysis;
  }

  /**
   * Blast radius for geopolitical signal: which enterprise risks are affected?
   */
  propagateSignal(signalId: string): { affectedRisks:string[]; cascades:string[]; escalate:boolean } {
    const signal = this.getSignals().find(s => s.id === signalId);
    if (!signal) return { affectedRisks:[], cascades:[], escalate:false };

    const riskRuntime  = getRiskRuntime(this.tenantId);
    const allRisks     = riskRuntime.getAll();
    const affectedRisks = allRisks
      .filter(r => signal.blastRadius.some(b => r.category.includes(b.replace("_risk","").replace("_","")) || b.includes(r.category)))
      .map(r => r.id);

    // Auto-trigger risk register update for critical signals
    if (signal.severity === "critical" && signal.earlyWarning) {
      getEventStore(this.tenantId).append({
        topic:"external.signal.escalated",
        payload:{ signalId, affectedRisks, severity:signal.severity },
        actorId:"intelligence_fabric", actorRole:"system",
      });
    }

    return { affectedRisks, cascades:signal.cascadingRisks, escalate:signal.severity==="critical" };
  }

  generateSummary(): ExternalIntelligenceSummary {
    const changes  = this.getChanges();
    const signals  = this.getSignals();
    const critical = changes.filter(c => c.severity === "critical").length;
    const warnings = signals.filter(s => s.earlyWarning).length;
    const topThreats = [...signals.sort((a,b) => b.probability-a.probability).slice(0,3).map(s=>s.title), ...changes.filter(c=>c.severity==="critical").slice(0,2).map(c=>c.title)];
    const immediateActions = [
      ...(critical > 0 ? [`${critical} critical regulatory changes require immediate policy review`] : []),
      ...(warnings > 0 ? [`${warnings} geopolitical early warnings detected — board briefing required`] : []),
      ...changes.filter(c=>c.severity==="critical").map(c=>`Assess impact of ${c.framework}: ${c.title}`).slice(0,2),
    ];
    const overallExposureScore = Math.min(100, critical*20 + warnings*15 + changes.length*5);

    return { tenantId:this.tenantId, generatedAt:new Date().toISOString(), regulatoryChanges:changes.length, criticalChanges:critical, geopoliticalSignals:signals.length, earlyWarnings:warnings, topThreats, immediateActions, overallExposureScore };
  }

  getChanges(framework?: RegulatoryFramework): RegulatoryChange[] {
    const all = regChangeStore.get(this.tenantId) ?? [];
    return framework ? all.filter(c=>c.framework===framework) : all;
  }

  getSignals(type?: GeopoliticalSignal["signalType"]): GeopoliticalSignal[] {
    const all = geoSignalStore.get(this.tenantId) ?? [];
    return type ? all.filter(s=>s.signalType===type) : all;
  }

  getImpactAnalyses(): PolicyImpactAnalysis[] { return impactCache.get(this.tenantId) ?? []; }
}

const eiCache = new Map<string, ExternalIntelligenceRuntime>();
export function getExternalIntelligence(tenantId: string): ExternalIntelligenceRuntime {
  if (!eiCache.has(tenantId)) eiCache.set(tenantId, new ExternalIntelligenceRuntime(tenantId));
  return eiCache.get(tenantId)!;
}
