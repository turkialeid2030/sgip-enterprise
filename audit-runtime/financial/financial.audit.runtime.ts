/**
 * Financial Audit & Assurance Runtime — Phase 9.2
 * IFRS-aware evidence mapping, ISA workflow support,
 * materiality assessment, management assertions, external auditor workspace.
 */
import { v4 as uuidv4 } from "uuid";
import * as crypto from "crypto";
import { getEventStore } from "../../runtime/persistence/persistent.event.store";
import { getInternalAuditRuntime } from "../internal/internal.audit.runtime";

export type AccountingStandard = "IFRS"|"GAAP"|"Saudi_GAAP"|"IFRS_for_SME";
export type IFRSStandard = "IFRS_9"|"IFRS_16"|"IFRS_17"|"IAS_1"|"IAS_16"|"IAS_36"|"IAS_37"|"IAS_38"|"IAS_40"|"IAS_41"|"IFRS_15";
export type ISAStandard  = "ISA_200"|"ISA_210"|"ISA_220"|"ISA_230"|"ISA_240"|"ISA_250"|"ISA_315"|"ISA_320"|"ISA_330"|"ISA_500"|"ISA_700"|"ISA_720";
export type AuditOpinionType = "unqualified"|"qualified"|"adverse"|"disclaimer_of_opinion";
export type ManagementAssertion = "existence"|"completeness"|"rights_and_obligations"|"valuation"|"presentation_disclosure"|"accuracy"|"cut_off"|"classification";

export interface MaterialityAssessment {
  id:              string;
  tenantId:        string;
  engagementRef:   string;
  standard:        AccountingStandard;
  benchmark:       string;             // e.g. "5% of profit before tax"
  overallMateriality:  number;         // SAR
  performanceMateriality:number;       // policy-derived percentage of overall materiality
  trivialThreshold:number;             // policy-derived posting/reporting threshold
  performanceMaterialityPct:number;    // explicit engagement policy input (default 68%, not a statutory mandate)
  trivialThresholdPct:number;          // explicit engagement policy input (default 5%, not a statutory mandate)
  basis:           string;
  rationale:       string;
  approvedBy?:     string;
  createdAt:       string;
}

export interface ManagementAssertionRecord {
  id:              string;
  tenantId:        string;
  statementArea:   string;            // "Revenue", "Inventory", "PPE"
  ifrsReference:   IFRSStandard;
  assertions:      Record<ManagementAssertion, {asserted:boolean; evidence:string[]; auditorVerified:boolean}>;
  riskLevel:       "high"|"medium"|"low";
  auditProcedures: string[];
  createdAt:       string;
}

export interface FinancialControlTest {
  id:              string;
  tenantId:        string;
  controlId:       string;
  controlName:     string;
  isaReference:    ISAStandard;
  testType:        "test_of_controls"|"substantive_procedure"|"analytical_procedure"|"dual_purpose";
  testResult:      "effective"|"ineffective"|"not_tested";
  deficiencyType?: "material_weakness"|"significant_deficiency"|"control_deficiency";
  sampleSize:      number;
  deviations:      number;
  deviationRate:   number;            // %
  tolerable_deviation:number;
  conclusion:      string;
  evidenceIds:     string[];
  performedBy:     string;
  performedAt:     string;
}

export interface AuditEvidencePackage {
  id:              string;
  tenantId:        string;
  engagementCode:  string;
  title:           string;
  standard:        AccountingStandard;
  period:          { from:string; to:string };
  items:           AuditEvidenceItem[];
  packageHash:     string;            // integrity seal
  sealedAt?:       string;
  isSealed:        boolean;
  completenessScore:number;
  createdAt:       string;
  createdBy:       string;
}

export interface AuditEvidenceItem {
  id:              string;
  description:     string;
  source:          string;
  relevantAssertion:ManagementAssertion;
  ifrsReference:   IFRSStandard;
  hash:            string;
  collectedAt:     string;
  sufficientEvidence:boolean;
}

export interface ExternalAuditorWorkspace {
  id:              string;
  tenantId:        string;
  firm:            string;
  engagementPartner:string;
  period:          { from:string; to:string };
  status:          "planning"|"interim"|"final"|"opinion_issued";
  opinion?:        AuditOpinionType;
  materialityRef?: string;
  evidencePackages:string[];
  findings:        string[];
  managementLetterPoints:string[];
  opinionDate?:    string;
  createdAt:       string;
}

const materialityStore = new Map<string,MaterialityAssessment[]>();
const assertionStore   = new Map<string,ManagementAssertionRecord[]>();
const controlTestStore = new Map<string,FinancialControlTest[]>();
const evidencePackStore= new Map<string,AuditEvidencePackage[]>();
const workspaceStore   = new Map<string,ExternalAuditorWorkspace[]>();

export class FinancialAuditRuntime {
  constructor(private readonly tenantId: string) {}

  assessMateriality(params: {engagementRef:string;standard:AccountingStandard;overallMateriality:number;basis:string;rationale:string;performanceMaterialityPct?:number;trivialThresholdPct?:number}): MaterialityAssessment {
    if (!Number.isFinite(params.overallMateriality) || params.overallMateriality <= 0) {
      throw Object.assign(new RangeError("overallMateriality must be a finite positive amount"), { statusCode:422, code:"VALIDATION_ERROR" });
    }
    // These are engagement-policy defaults, not ISA/IFRS mandated percentages.
    // Making them explicit prevents a professional-judgement assumption from being mistaken for a regulatory formula.
    const performanceMaterialityPct = params.performanceMaterialityPct ?? 0.68;
    const trivialThresholdPct = params.trivialThresholdPct ?? 0.05;
    if (!Number.isFinite(performanceMaterialityPct) || performanceMaterialityPct <= 0 || performanceMaterialityPct > 1) {
      throw Object.assign(new RangeError("performanceMaterialityPct must be > 0 and <= 1"), { statusCode:422, code:"VALIDATION_ERROR" });
    }
    if (!Number.isFinite(trivialThresholdPct) || trivialThresholdPct < 0 || trivialThresholdPct >= performanceMaterialityPct) {
      throw Object.assign(new RangeError("trivialThresholdPct must be >= 0 and lower than performanceMaterialityPct"), { statusCode:422, code:"VALIDATION_ERROR" });
    }
    const m: MaterialityAssessment = {
      id:uuidv4(), tenantId:this.tenantId,
      benchmark: params.basis, standard:params.standard,
      engagementRef: params.engagementRef,
      overallMateriality: params.overallMateriality,
      performanceMateriality: Math.round(params.overallMateriality * performanceMaterialityPct),
      trivialThreshold: Math.round(params.overallMateriality * trivialThresholdPct),
      performanceMaterialityPct, trivialThresholdPct,
      basis:params.basis, rationale:params.rationale,
      createdAt:new Date().toISOString(),
    };
    if (!materialityStore.has(this.tenantId)) materialityStore.set(this.tenantId,[]);
    materialityStore.get(this.tenantId)!.push(m);
    return m;
  }

  recordManagementAssertions(params: {statementArea:string;ifrsReference:IFRSStandard;riskLevel:"high"|"medium"|"low";auditProcedures:string[]}): ManagementAssertionRecord {
    const assertions: Record<ManagementAssertion, {asserted:boolean;evidence:string[];auditorVerified:boolean}> = {
      existence:             {asserted:true, evidence:[], auditorVerified:false},
      completeness:          {asserted:true, evidence:[], auditorVerified:false},
      rights_and_obligations:{asserted:true, evidence:[], auditorVerified:false},
      valuation:             {asserted:true, evidence:[], auditorVerified:false},
      presentation_disclosure:{asserted:true,evidence:[], auditorVerified:false},
      accuracy:              {asserted:true, evidence:[], auditorVerified:false},
      cut_off:               {asserted:true, evidence:[], auditorVerified:false},
      classification:        {asserted:true, evidence:[], auditorVerified:false},
    };
    const rec: ManagementAssertionRecord = { id:uuidv4(), tenantId:this.tenantId, ...params, assertions, createdAt:new Date().toISOString() };
    if (!assertionStore.has(this.tenantId)) assertionStore.set(this.tenantId,[]);
    assertionStore.get(this.tenantId)!.push(rec);
    return rec;
  }

  performControlTest(params: {controlId:string;controlName:string;isaReference:ISAStandard;testType:FinancialControlTest["testType"];sampleSize:number;deviations:number;tolerableDeviation:number;auditProcedures?:string[];performedBy:string}): FinancialControlTest {
    const validInteger = (n:number) => Number.isInteger(n) && n >= 0;
    if (!validInteger(params.sampleSize) || !validInteger(params.deviations)) {
      throw Object.assign(new RangeError("sampleSize and deviations must be non-negative integers"), { statusCode:422, code:"VALIDATION_ERROR" });
    }
    if (!Number.isFinite(params.tolerableDeviation) || params.tolerableDeviation < 0 || params.tolerableDeviation > 100) {
      throw Object.assign(new RangeError("tolerableDeviation must be between 0 and 100"), { statusCode:422, code:"VALIDATION_ERROR" });
    }
    if (params.deviations > params.sampleSize) {
      throw Object.assign(new RangeError("deviations cannot exceed sampleSize"), { statusCode:422, code:"VALIDATION_ERROR" });
    }
    const tested       = params.sampleSize > 0;
    const deviationRate = tested ? Math.round(params.deviations/params.sampleSize*100) : 0;
    const effective     = tested && deviationRate <= params.tolerableDeviation;
    let deficiencyType: FinancialControlTest["deficiencyType"] = undefined;
    if (tested && !effective) deficiencyType = deviationRate > params.tolerableDeviation*2 ? "material_weakness" : deviationRate > params.tolerableDeviation*1.5 ? "significant_deficiency" : "control_deficiency";

    const test: FinancialControlTest = {
      id:uuidv4(), tenantId:this.tenantId,
      controlId:params.controlId, controlName:params.controlName,
      isaReference:params.isaReference, testType:params.testType,
      testResult:!tested?"not_tested":effective?"effective":"ineffective", deficiencyType,
      sampleSize:params.sampleSize, deviations:params.deviations,
      deviationRate, tolerable_deviation:params.tolerableDeviation,
      conclusion: !tested ? "Control not tested — sampleSize must be greater than zero" : effective ? `Control effective — deviation rate ${deviationRate}% within tolerable ${params.tolerableDeviation}%` : `Control deficiency — deviation rate ${deviationRate}% exceeds tolerable ${params.tolerableDeviation}%`,
      evidenceIds:[], performedBy:params.performedBy, performedAt:new Date().toISOString(),
    };
    if (!controlTestStore.has(this.tenantId)) controlTestStore.set(this.tenantId,[]);
    controlTestStore.get(this.tenantId)!.push(test);
    if (tested && !effective) getEventStore(this.tenantId).append({ topic:`audit.financial.control.${deficiencyType?.replace("_",".") ?? "deficiency"}`, payload:{controlId:params.controlId,deficiencyType,deviationRate}, actorId:params.performedBy, actorRole:"auditor" });
    return test;
  }

  sealEvidencePackage(params: {engagementCode:string;title:string;standard:AccountingStandard;period:{from:string;to:string};items:Omit<AuditEvidenceItem,"id"|"hash">[];createdBy:string}): AuditEvidencePackage {
    const canonicalItem = (item: Omit<AuditEvidenceItem,"id"|"hash">) => JSON.stringify({
      description:item.description,
      source:item.source,
      relevantAssertion:item.relevantAssertion,
      ifrsReference:item.ifrsReference,
      collectedAt:item.collectedAt,
      sufficientEvidence:item.sufficientEvidence,
    });
    const items: AuditEvidenceItem[] = params.items.map(item => Object.freeze({
      ...item, id:uuidv4(),
      hash:crypto.createHash("sha256").update(canonicalItem(item)).digest("hex").slice(0,24),
    }));
    const sufficientCount = items.filter(i=>i.sufficientEvidence).length;
    const completenessScore = items.length === 0 ? 0 : sufficientCount === items.length ? 95 : Math.round(sufficientCount/items.length*100);
    const sealedPeriod = Object.freeze({ ...params.period });
    const frozenItems = Object.freeze([...items]) as unknown as AuditEvidenceItem[];
    const packageHash = crypto.createHash("sha256").update(JSON.stringify({
      engagementCode:params.engagementCode, title:params.title, standard:params.standard,
      period:sealedPeriod, createdBy:params.createdBy,
      items:items.map(i=>({id:i.id,hash:i.hash,relevantAssertion:i.relevantAssertion,ifrsReference:i.ifrsReference,sufficientEvidence:i.sufficientEvidence})),
    })).digest("hex").slice(0,32);
    const pkg: AuditEvidencePackage = {
      id:uuidv4(), tenantId:this.tenantId,
      engagementCode:params.engagementCode, title:params.title,
      standard:params.standard, period:sealedPeriod,
      items:frozenItems, packageHash, isSealed:true, sealedAt:new Date().toISOString(),
      completenessScore,
      createdAt:new Date().toISOString(), createdBy:params.createdBy,
    };
    Object.freeze(pkg);
    if (!evidencePackStore.has(this.tenantId)) evidencePackStore.set(this.tenantId,[]);
    evidencePackStore.get(this.tenantId)!.push(pkg);
    getEventStore(this.tenantId).append({ topic:"audit.evidence_package.sealed", payload:{pkgId:pkg.id,engagementCode:params.engagementCode,packageHash,completenessScore:pkg.completenessScore}, actorId:params.createdBy, actorRole:"audit_lead", idempotencyKey:`pkg:${pkg.packageHash}` });
    return pkg;
  }

  openExternalWorkspace(params: {firm:string;engagementPartner:string;period:{from:string;to:string}}): ExternalAuditorWorkspace {
    const ws: ExternalAuditorWorkspace = { id:uuidv4(), tenantId:this.tenantId, ...params, status:"planning", evidencePackages:[], findings:[], managementLetterPoints:[], createdAt:new Date().toISOString() };
    if (!workspaceStore.has(this.tenantId)) workspaceStore.set(this.tenantId,[]);
    workspaceStore.get(this.tenantId)!.push(ws);
    return ws;
  }

  issueAuditOpinion(workspaceId:string, opinion:AuditOpinionType, issuedBy:string): ExternalAuditorWorkspace|null {
    const ws = workspaceStore.get(this.tenantId)?.find(w=>w.id===workspaceId);
    if (!ws||ws.tenantId!==this.tenantId) return null;
    const updated = {...ws, opinion, status:"opinion_issued" as const, opinionDate:new Date().toISOString()};
    const idx = workspaceStore.get(this.tenantId)!.findIndex(w=>w.id===workspaceId);
    workspaceStore.get(this.tenantId)![idx] = updated;
    getEventStore(this.tenantId).append({ topic:"audit.external.opinion.issued", payload:{workspaceId,opinion,firm:ws.firm}, actorId:issuedBy, actorRole:"external_auditor" });
    return updated;
  }

  getMaterialWeaknesses(): FinancialControlTest[] { return (controlTestStore.get(this.tenantId)??[]).filter(t=>t.deficiencyType==="material_weakness"); }
  getControlTests():       FinancialControlTest[] { return controlTestStore.get(this.tenantId)??[]; }
  getEvidencePackages():   AuditEvidencePackage[] { return evidencePackStore.get(this.tenantId)??[]; }
  getExternalWorkspaces(): ExternalAuditorWorkspace[] { return workspaceStore.get(this.tenantId)??[]; }
  getMateriality():        MaterialityAssessment[] { return materialityStore.get(this.tenantId)??[]; }
  getAssertions():         ManagementAssertionRecord[] { return assertionStore.get(this.tenantId)??[]; }
}

const finAuditCache = new Map<string,FinancialAuditRuntime>();
export function getFinancialAuditRuntime(tenantId:string): FinancialAuditRuntime {
  if (!finAuditCache.has(tenantId)) finAuditCache.set(tenantId,new FinancialAuditRuntime(tenantId));
  return finAuditCache.get(tenantId)!;
}
