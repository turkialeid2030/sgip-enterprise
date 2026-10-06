/**
 * Legal Governance Runtime — Phase 10
 *
 * Saudi legal intelligence + contract governance + regulatory interpretation.
 *
 * Supported legal frameworks:
 *   - نظام الشركات (Companies Law)
 *   - نظام العمل (Labor Law)
 *   - PDPL (Personal Data Protection Law)
 *   - نظام مكافحة غسل الأموال
 *   - نظام الأوراق المالية (Capital Market Law)
 *   - نظام حماية المنافسة
 *   - الأنظمة المالية والمصرفية
 */
import { v4 as uuidv4 } from "uuid";
import { getEventStore } from "../runtime/persistence/persistent.event.store";

export type LegalFramework =
  | "Companies_Law"         | "Labor_Law"           | "PDPL"
  | "AML_Law"               | "Capital_Market_Law"  | "Competition_Law"
  | "Banking_Control_Law"   | "Insurance_Law"       | "Cyber_Crime_Law"
  | "Data_AI_Governance"    | "Companies_Regulations"| "VAT_Law"
  | "SAMA_Regulations"      | "NCA_Regulations"     | "ZATCA_Regulations";

export type LegalObligationType = "disclosure"|"reporting"|"consent"|"approval"|"registration"|"filing"|"retention"|"prohibition"|"notification";
export type ContractRisk = "high"|"medium"|"low";
export type LitigationStage = "pre_dispute"|"notice"|"negotiation"|"arbitration"|"court"|"appeal"|"enforcement"|"settled";

export interface LegalObligation {
  id:              string;
  tenantId:        string;
  framework:       LegalFramework;
  articleRef:      string;            // e.g. "Article 15, Companies Law"
  obligationType:  LegalObligationType;
  title:           string;
  description:     string;
  applicableTo:    string[];          // entity types this applies to
  jurisdiction:    "Saudi Arabia" | "GCC" | "Global";
  penalty?:        string;            // penalty for non-compliance
  dueDate?:        string;
  recurring:       boolean;
  recurringCycle?: "annual"|"quarterly"|"monthly"|"on_trigger";
  status:          "active"|"superseded"|"under_review";
  lastVerifiedAt:  string;
  ownerId:         string;
  evidenceRequired:string[];
  createdAt:       string;
}

export interface Contract {
  id:              string;
  tenantId:        string;
  code:            string;
  title:           string;
  partyA:          string;
  partyB:          string;
  contractType:    "vendor"|"employment"|"lease"|"partnership"|"service"|"NDA"|"license"|"regulatory";
  value?:          number;
  currency:        string;
  startDate:       string;
  endDate?:        string;
  autoRenew:       boolean;
  riskLevel:       ContractRisk;
  keyObligations:  ContractClause[];
  riskClauses:     ContractClause[];
  expiryWarningDays:number;
  status:          "draft"|"active"|"expired"|"terminated"|"disputed";
  legalReviewedAt?:string;
  approvedBy?:     string;
  createdAt:       string;
}

export interface ContractClause {
  clauseId:    string;
  type:        "termination"|"liability_cap"|"indemnity"|"confidentiality"|"ip_ownership"|"dispute_resolution"|"governing_law"|"force_majeure"|"data_protection"|"compliance";
  description: string;
  riskFlag:    boolean;
  riskReason?: string;
}

export interface LegalRiskScore {
  tenantId:           string;
  scoredAt:           string;
  overallScore:       number;         // 0-100 (higher = more risk)
  obligationRisk:     number;
  contractRisk:       number;
  litigationRisk:     number;
  regulatoryRisk:     number;
  openObligations:    number;
  expiringContracts:  number;
  highRiskContracts:  number;
  contradictions:     LegalContradiction[];
  recommendations:    string[];
}

export interface LegalContradiction {
  id:             string;
  type:           "framework_conflict"|"contract_conflict"|"obligation_conflict";
  description:    string;
  frameworks:     string[];
  severity:       "critical"|"high"|"medium";
  detectedAt:     string;
  resolution?:    string;
}

export interface RegulatoryInterpretation {
  id:             string;
  tenantId:       string;
  question:       string;
  framework:      LegalFramework;
  articleRef:     string;
  interpretation: string;
  confidence:     "high"|"medium"|"low";
  caveats:        string[];
  requiresLegalCounsel:boolean;
  createdAt:      string;
}

// ── Saudi legal knowledge base (baseline) ─────────────────────
const SAUDI_LEGAL_BASELINE: Array<Omit<LegalObligation,"id"|"tenantId"|"lastVerifiedAt"|"createdAt"|"ownerId">> = [
  { framework:"PDPL", articleRef:"Article 5", obligationType:"consent", title:"Personal Data Collection Consent", description:"Organizations must obtain explicit consent before collecting personal data", applicableTo:["all"], jurisdiction:"Saudi Arabia", penalty:"SAR 5,000,000", recurring:false, status:"active", evidenceRequired:["consent_forms","privacy_notice"] },
  { framework:"PDPL", articleRef:"Article 23", obligationType:"notification", title:"Data Breach Notification", description:"Data controllers must notify SDAIA within 72 hours of discovering a personal data breach", applicableTo:["all"], jurisdiction:"Saudi Arabia", penalty:"SAR 3,000,000", recurring:false, status:"active", evidenceRequired:["breach_report","notification_evidence"] },
  { framework:"Companies_Law", articleRef:"Article 181", obligationType:"filing", title:"Annual Financial Statements Filing", description:"All joint stock companies must file audited financial statements with Ministry of Commerce", applicableTo:["joint_stock_company"], jurisdiction:"Saudi Arabia", penalty:"Board liability", dueDate:"Within 6 months of fiscal year end", recurring:true, recurringCycle:"annual", status:"active", evidenceRequired:["audited_accounts","board_resolution"] },
  { framework:"AML_Law", articleRef:"Article 16", obligationType:"reporting", title:"Suspicious Transaction Reporting", description:"Financial institutions must report suspicious transactions to SFIU within 72 hours", applicableTo:["financial_institution","bank","fintech"], jurisdiction:"Saudi Arabia", penalty:"SAR 5,000,000 + license revocation", recurring:false, status:"active", evidenceRequired:["str_report","transaction_records"] },
  { framework:"Capital_Market_Law", articleRef:"Article 53", obligationType:"disclosure", title:"Material Information Disclosure", description:"Listed companies must disclose material information to CMA and Tadawul immediately", applicableTo:["listed_company"], jurisdiction:"Saudi Arabia", penalty:"Delisting + SAR 100,000 per day", recurring:false, status:"active", evidenceRequired:["disclosure_announcement","board_minute"] },
  { framework:"Labor_Law", articleRef:"Article 75", obligationType:"reporting", title:"Saudization (Nitaqat) Reporting", description:"Employers must maintain and report Saudization ratios quarterly", applicableTo:["employer","private_sector"], jurisdiction:"Saudi Arabia", penalty:"Work permit suspension", recurring:true, recurringCycle:"quarterly", status:"active", evidenceRequired:["saudization_report","employee_records"] },
  { framework:"SAMA_Regulations", articleRef:"SAMA Circular 2024/001", obligationType:"reporting", title:"SAMA Cyber Resilience Reporting", description:"Financial institutions report cyber incidents to SAMA within 4 hours", applicableTo:["bank","insurance","fintech"], jurisdiction:"Saudi Arabia", penalty:"SAR 10,000,000", recurring:false, status:"active", evidenceRequired:["incident_report","containment_evidence"] },
  { framework:"Data_AI_Governance", articleRef:"SDAIA AI Governance Framework", obligationType:"registration", title:"High-Risk AI System Registration", description:"Organizations deploying high-risk AI systems in Saudi Arabia must register with SDAIA", applicableTo:["all"], jurisdiction:"Saudi Arabia", penalty:"Operations suspension", recurring:false, status:"active", evidenceRequired:["ai_system_description","risk_assessment","explainability_report"] },
];

const obligationStore = new Map<string, LegalObligation[]>();
const contractStore   = new Map<string, Contract[]>();
const contraStore     = new Map<string, LegalContradiction[]>();
let   contractSeq     = 0;

export class LegalGovernanceRuntime {
  constructor(private readonly tenantId: string) {}

  /**
   * Load Saudi legal baseline — idempotent by framework+articleRef.
   */
  loadLegalBaseline(ownerId: string): number {
    let loaded = 0;
    for (const o of SAUDI_LEGAL_BASELINE) {
      const existing = (obligationStore.get(this.tenantId) ?? []).find(x => x.framework===o.framework && x.articleRef===o.articleRef);
      if (!existing) {
        const obl: LegalObligation = { ...o, id:uuidv4(), tenantId:this.tenantId, ownerId, lastVerifiedAt:new Date().toISOString(), createdAt:new Date().toISOString() };
        if (!obligationStore.has(this.tenantId)) obligationStore.set(this.tenantId, []);
        obligationStore.get(this.tenantId)!.push(obl);
        loaded++;
      }
    }
    return loaded;
  }

  registerObligation(params: Omit<LegalObligation,"id"|"tenantId"|"createdAt"|"lastVerifiedAt">): LegalObligation {
    const obl: LegalObligation = { ...params, id:uuidv4(), tenantId:this.tenantId, createdAt:new Date().toISOString(), lastVerifiedAt:new Date().toISOString() };
    if (!obligationStore.has(this.tenantId)) obligationStore.set(this.tenantId, []);
    obligationStore.get(this.tenantId)!.push(obl);
    getEventStore(this.tenantId).append({ topic:"legal.obligation.registered", payload:{ oblId:obl.id, framework:obl.framework, type:obl.obligationType }, actorId:params.ownerId, actorRole:"legal_counsel" });
    return obl;
  }

  registerContract(params: Omit<Contract,"id"|"tenantId"|"code"|"createdAt">): Contract {
    contractSeq++;
    const now = new Date().toISOString();
    // Auto-detect risk clauses
    const autoRiskClauses = (params.keyObligations ?? []).filter(c =>
      ["liability_cap","indemnity","ip_ownership"].includes(c.type) && c.riskFlag
    );
    const contract: Contract = {
      ...params, id:uuidv4(), tenantId:this.tenantId,
      code: `CTR-${new Date().getFullYear()}-${String(contractSeq).padStart(4,"0")}`,
      riskClauses: autoRiskClauses,
      createdAt: now,
    };
    if (!contractStore.has(this.tenantId)) contractStore.set(this.tenantId, []);
    contractStore.get(this.tenantId)!.push(contract);
    if (contract.riskLevel === "high") {
      getEventStore(this.tenantId).append({ topic:"legal.contract.high_risk", payload:{ contractId:contract.id, code:contract.code, title:params.title }, actorId:"system", actorRole:"system" });
    }
    return contract;
  }

  detectContradictions(): LegalContradiction[] {
    const obligations  = this.getObligations();
    const contradictions: LegalContradiction[] = [];
    const now = new Date().toISOString();

    // Check: PDPL vs other data-related obligations
    const pdplObls  = obligations.filter(o => o.framework === "PDPL");
    const amlObls   = obligations.filter(o => o.framework === "AML_Law");

    if (pdplObls.length > 0 && amlObls.length > 0) {
      // Tension: PDPL data minimization vs AML record keeping
      const key = `pdpl-aml-tension-${this.tenantId}`;
      const existing = (contraStore.get(this.tenantId) ?? []).find(c => c.description.includes("PDPL") && c.description.includes("AML"));
      if (!existing) {
        contradictions.push({ id:uuidv4(), type:"framework_conflict", description:"PDPL data minimization principle may conflict with AML 5-year transaction record retention requirement. Legal counsel review required to define compliant data retention schedules.", frameworks:["PDPL","AML_Law"], severity:"high", detectedAt:now });
      }
    }

    // Check: expired or near-expiry contracts with active obligations
    const now_ts = Date.now();
    for (const c of this.getContracts()) {
      if (c.endDate && new Date(c.endDate).getTime() - now_ts < c.expiryWarningDays * 86400000) {
        const existing = (contraStore.get(this.tenantId) ?? []).find(co => co.description.includes(c.code));
        if (!existing) {
          contradictions.push({ id:uuidv4(), type:"contract_conflict", description:`Contract ${c.code} (${c.title}) expires within ${c.expiryWarningDays} days — active obligations may be affected`, frameworks:[c.contractType], severity:c.riskLevel==="high"?"critical":"medium", detectedAt:now });
        }
      }
    }

    if (contradictions.length > 0) {
      if (!contraStore.has(this.tenantId)) contraStore.set(this.tenantId, []);
      contraStore.get(this.tenantId)!.push(...contradictions);
    }
    return contradictions;
  }

  interpretRegulation(params: {question:string; framework:LegalFramework; articleRef:string}): RegulatoryInterpretation {
    // Structured interpretation based on known framework characteristics
    const interpretationMap: Partial<Record<LegalFramework, {interpretation:string; confidence:"high"|"medium"|"low"; caveats:string[]; requiresCounsel:boolean}>> = {
      PDPL: { interpretation:"Under Saudi PDPL, processing personal data requires a legal basis (consent, contract necessity, legitimate interest, or legal obligation). Data subjects have rights to access, correction, and deletion. Cross-border transfers require SDAIA approval or adequacy decision.", confidence:"high", caveats:["Implementation regulations may evolve","SDAIA guidance takes precedence"], requiresCounsel:false },
      Companies_Law: { interpretation:"Saudi Companies Law 2022 modernizes corporate governance requirements including board composition, shareholder rights, and disclosure obligations for all company types.", confidence:"high", caveats:["Secondary regulations from Ministry of Commerce apply","Listed companies have additional CMA requirements"], requiresCounsel:true },
      AML_Law: { interpretation:"Anti-Money Laundering Law requires financial institutions to implement KYC/CDD programs, transaction monitoring, and report suspicious transactions to SFIU within 72 hours.", confidence:"high", caveats:["SAMA/CMA sector-specific rules add additional requirements"], requiresCounsel:false },
    };

    const known = interpretationMap[params.framework];
    return {
      id:uuidv4(), tenantId:this.tenantId,
      question:       params.question,
      framework:      params.framework,
      articleRef:     params.articleRef,
      interpretation: known?.interpretation ?? `No specific interpretation available for ${params.framework}. This requires review of the specific article text and applicable secondary regulations.`,
      confidence:     known?.confidence ?? "low",
      caveats:        known?.caveats ?? ["Always verify with qualified Saudi legal counsel","Regulations may have been amended"],
      requiresLegalCounsel: known?.requiresCounsel ?? true,
      createdAt:      new Date().toISOString(),
    };
  }

  scoreLegalRisk(): LegalRiskScore {
    const obligations = this.getObligations();
    const contracts   = this.getContracts();
    const now         = new Date().toISOString();

    const expiring    = contracts.filter(c => c.endDate && c.endDate < new Date(Date.now() + 90*86400000).toISOString()).length;
    const highRisk    = contracts.filter(c => c.riskLevel === "high").length;
    const contras     = this.detectContradictions();

    const obligationRisk = obligations.filter(o => o.obligationType === "reporting" || o.obligationType === "notification").length * 8;
    const contractRisk   = highRisk * 15 + expiring * 10;
    const litigationRisk = 20; // baseline
    const regulatoryRisk = obligations.filter(o => ["SAMA_Regulations","NCA_Regulations","Capital_Market_Law"].includes(o.framework)).length * 12;

    const overall = Math.min(100, Math.round((obligationRisk + contractRisk + litigationRisk + regulatoryRisk) / 4));
    const recs: string[] = [];
    if (expiring > 0) recs.push(`${expiring} contracts expiring within 90 days — initiate renewal`);
    if (highRisk > 0) recs.push(`${highRisk} high-risk contracts require legal review`);
    if (contras.length > 0) recs.push(`${contras.length} legal contradictions detected — escalate to legal counsel`);
    if (obligations.length === 0) recs.push("No legal obligations registered — load baseline obligations immediately");

    return { tenantId:this.tenantId, scoredAt:now, overallScore:overall, obligationRisk:Math.min(100,obligationRisk), contractRisk:Math.min(100,contractRisk), litigationRisk, regulatoryRisk:Math.min(100,regulatoryRisk), openObligations:obligations.length, expiringContracts:expiring, highRiskContracts:highRisk, contradictions:contras, recommendations:recs };
  }

  getObligations(framework?: LegalFramework): LegalObligation[] {
    const all = obligationStore.get(this.tenantId) ?? [];
    return framework ? all.filter(o => o.framework === framework) : all;
  }

  getContracts(type?: Contract["contractType"]): Contract[] {
    const all = contractStore.get(this.tenantId) ?? [];
    return type ? all.filter(c => c.contractType === type) : all;
  }

  getContradictions(): LegalContradiction[] {
    return contraStore.get(this.tenantId) ?? [];
  }
}

const legalCache = new Map<string, LegalGovernanceRuntime>();
export function getLegalRuntime(tenantId: string): LegalGovernanceRuntime {
  if (!legalCache.has(tenantId)) legalCache.set(tenantId, new LegalGovernanceRuntime(tenantId));
  return legalCache.get(tenantId)!;
}
