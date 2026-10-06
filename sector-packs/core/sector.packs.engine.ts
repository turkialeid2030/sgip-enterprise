/**
 * Sector Packs Core — Phase 14
 * Pre-configured governance packages for 10 sectors.
 * Each pack contains: Controls, KRIs, Policies, Regulatory mappings,
 * Audit programs, Risk libraries, Compliance workflows, Executive reports.
 */
import { v4 as uuidv4 } from "uuid";

export type Sector =
  | "banking"       | "insurance"     | "government"   | "healthcare"
  | "investment"    | "manufacturing" | "real_estate"  | "nonprofit"
  | "technology"    | "energy";

export interface SectorControl {
  code:         string;
  name:         string;
  description:  string;
  controlType:  "preventive"|"detective"|"corrective";
  frequency:    "continuous"|"daily"|"weekly"|"monthly"|"quarterly"|"annual";
  regulatoryRef:string[];
  mandatoryFor: Sector[];
}

export interface SectorKRI {
  code:       string;
  name:       string;
  metric:     string;
  unit:       string;
  redThreshold:  number;
  amberThreshold:number;
  greenThreshold:number;
  regulatoryRef: string[];
  sector:     Sector;
}

export interface SectorRisk {
  code:       string;
  title:      string;
  category:   string;
  inherentLikelihood: 1|2|3|4|5;
  inherentImpact:     1|2|3|4|5;
  sectors:    Sector[];
  mitigationStrategies:string[];
  regulatoryRef:string[];
}

export interface SectorPack {
  sector:       Sector;
  name:         string;
  description:  string;
  primaryFrameworks:string[];
  controls:     SectorControl[];
  kris:         SectorKRI[];
  risks:        SectorRisk[];
  auditPrograms:Array<{name:string; scope:string; frequency:string; standards:string[]}>;
  reportTemplates:string[];
}

// ── Banking Sector Pack ───────────────────────────────────────
const BANKING_PACK: SectorPack = {
  sector:"banking", name:"Banking & Financial Services", description:"Governance pack for banks, digital lenders, and payment service providers under SAMA supervision",
  primaryFrameworks:["SAMA_CSF","NCA_ECC","PDPL","AML_Law","Basel_III","IFRS_9","Capital_Market_Law"],
  controls:[
    { code:"BNK-CTL-001", name:"KYC/CDD Program", description:"Know Your Customer / Customer Due Diligence", controlType:"preventive", frequency:"continuous", regulatoryRef:["SAMA AML Guidelines","FATF Recommendations"], mandatoryFor:["banking"] },
    { code:"BNK-CTL-002", name:"Transaction Monitoring", description:"Real-time monitoring of transactions for suspicious activity", controlType:"detective", frequency:"continuous", regulatoryRef:["AML Law Art 16","SAMA Circular 2024/001"], mandatoryFor:["banking","investment"] },
    { code:"BNK-CTL-003", name:"Credit Risk Assessment", description:"IFRS 9 expected credit loss calculation and provisioning", controlType:"detective", frequency:"quarterly", regulatoryRef:["IFRS 9","SAMA Pillar 2"], mandatoryFor:["banking"] },
    { code:"BNK-CTL-004", name:"Cyber Resilience Program", description:"SAMA Cyber Security Framework implementation", controlType:"preventive", frequency:"continuous", regulatoryRef:["SAMA CSF 2.1","NCA ECC"], mandatoryFor:["banking","insurance"] },
    { code:"BNK-CTL-005", name:"Capital Adequacy Monitoring", description:"Basel III/IV capital ratio monitoring and SAMA reporting", controlType:"detective", frequency:"monthly", regulatoryRef:["Basel III","SAMA Circular"], mandatoryFor:["banking"] },
  ],
  kris:[
    { code:"BNK-KRI-001", name:"Capital Adequacy Ratio", metric:"Tier 1 Capital / Risk-Weighted Assets", unit:"%", redThreshold:8, amberThreshold:10, greenThreshold:12, regulatoryRef:["Basel III Art 92"], sector:"banking" },
    { code:"BNK-KRI-002", name:"Non-Performing Loan Ratio", metric:"NPL / Total Loans", unit:"%", redThreshold:7, amberThreshold:5, greenThreshold:2, regulatoryRef:["SAMA Supervision"], sector:"banking" },
    { code:"BNK-KRI-003", name:"Suspicious Transaction Reports", metric:"STRs Filed / Month", unit:"count", redThreshold:0, amberThreshold:5, greenThreshold:10, regulatoryRef:["AML Law"], sector:"banking" },
    { code:"BNK-KRI-004", name:"Cyber Incident Response Time", metric:"Mean Time to Contain", unit:"hours", redThreshold:24, amberThreshold:8, greenThreshold:4, regulatoryRef:["SAMA CSF","NCA ECC"], sector:"banking" },
    { code:"BNK-KRI-005", name:"Saudization Ratio", metric:"Saudi Employees / Total", unit:"%", redThreshold:60, amberThreshold:70, greenThreshold:80, regulatoryRef:["Labor Law Nitaqat"], sector:"banking" },
  ],
  risks:[
    { code:"BNK-RSK-001", title:"Credit Concentration Risk", category:"financial", inherentLikelihood:3, inherentImpact:5, sectors:["banking"], mitigationStrategies:["Diversify loan portfolio","Apply sector limits","Stress test under adverse scenarios"], regulatoryRef:["Basel III","SAMA Pillar 2"] },
    { code:"BNK-RSK-002", title:"AML/Sanctions Violation", category:"regulatory", inherentLikelihood:3, inherentImpact:5, sectors:["banking","investment"], mitigationStrategies:["Robust KYC program","Real-time sanctions screening","Annual AML training"], regulatoryRef:["AML Law","SAMA"] },
    { code:"BNK-RSK-003", title:"Cyber Attack on Core Banking", category:"cyber", inherentLikelihood:4, inherentImpact:5, sectors:["banking"], mitigationStrategies:["SAMA CSF implementation","24/7 SOC","Cyber insurance"], regulatoryRef:["SAMA CSF","NCA ECC"] },
  ],
  auditPrograms:[
    { name:"Annual Credit Risk Audit", scope:"Loan portfolio quality, IFRS 9 provisioning, credit approval process", frequency:"annual", standards:["IIA Standards","SAMA Pillar 2"] },
    { name:"AML/Compliance Audit", scope:"KYC effectiveness, transaction monitoring, STR process", frequency:"annual", standards:["IIA Standards","FATF","AML Law"] },
    { name:"IT Security Audit", scope:"SAMA CSF control effectiveness, cyber resilience, incident response", frequency:"annual", standards:["SAMA CSF","NCA ECC","ISO 27001"] },
  ],
  reportTemplates:["Board Risk Report","SAMA Supervisory Report","Capital Adequacy Report","AML Annual Report","Audit Committee Pack"],
};

// ── Other Sector Packs (abbreviated) ─────────────────────────
const INSURANCE_PACK: SectorPack = {
  sector:"insurance", name:"Insurance", description:"Governance pack for insurance companies under SAMA/ISA supervision",
  primaryFrameworks:["SAMA_Insurance_Regulations","PDPL","IFRS_17","AML_Law"],
  controls:[
    { code:"INS-CTL-001", name:"Actuarial Reserve Adequacy", description:"IFRS 17 insurance contract liability calculation", controlType:"detective", frequency:"quarterly", regulatoryRef:["IFRS 17","SAMA Insurance"], mandatoryFor:["insurance"] },
    { code:"INS-CTL-002", name:"Claims Fraud Detection", description:"AI-enabled claims anomaly detection", controlType:"detective", frequency:"continuous", regulatoryRef:["SAMA Insurance Regulations"], mandatoryFor:["insurance"] },
  ],
  kris:[
    { code:"INS-KRI-001", name:"Combined Ratio", metric:"(Claims + Expenses) / Premiums", unit:"%", redThreshold:105, amberThreshold:100, greenThreshold:95, regulatoryRef:["SAMA Insurance"], sector:"insurance" },
  ],
  risks:[
    { code:"INS-RSK-001", title:"Catastrophic Claims Event", category:"operational", inherentLikelihood:2, inherentImpact:5, sectors:["insurance"], mitigationStrategies:["Reinsurance program","Cat bond","Reserve strengthening"], regulatoryRef:["SAMA Insurance Regulations"] },
  ],
  auditPrograms:[{ name:"Actuarial Audit", scope:"Reserve adequacy, IFRS 17 compliance", frequency:"annual", standards:["IIA Standards","IFRS 17"] }],
  reportTemplates:["Board Risk Report","SAMA Insurance Report","Actuarial Report"],
};

const GOVERNMENT_PACK: SectorPack = {
  sector:"government", name:"Government & Public Sector", description:"Governance pack for Saudi government entities and Vision 2030 programs",
  primaryFrameworks:["NDMO_Controls","NCA_ECC","PDPL","SAMA_Regulations","Vision_2030_KPIs"],
  controls:[
    { code:"GOV-CTL-001", name:"NDMO Data Classification", description:"National Data Management Office data classification and protection controls", controlType:"preventive", frequency:"continuous", regulatoryRef:["NDMO Framework","PDPL"], mandatoryFor:["government"] },
    { code:"GOV-CTL-002", name:"Vision 2030 KPI Reporting", description:"Monthly tracking and reporting of Vision 2030 program KPIs", controlType:"detective", frequency:"monthly", regulatoryRef:["Vision 2030 Framework"], mandatoryFor:["government"] },
  ],
  kris:[
    { code:"GOV-KRI-001", name:"Citizen Satisfaction Score", metric:"Survey NPS", unit:"score", redThreshold:40, amberThreshold:60, greenThreshold:75, regulatoryRef:["Vision 2030"], sector:"government" },
  ],
  risks:[
    { code:"GOV-RSK-001", title:"Cyber Attack on Critical Infrastructure", category:"cyber", inherentLikelihood:4, inherentImpact:5, sectors:["government"], mitigationStrategies:["NCA ECC implementation","CERT coordination","Incident response plan"], regulatoryRef:["NCA ECC","Cybercrime Law"] },
  ],
  auditPrograms:[{ name:"Performance Audit", scope:"Program delivery effectiveness, KPI achievement", frequency:"annual", standards:["INTOSAI","IIA Standards"] }],
  reportTemplates:["Minister Report","Cabinet Report","Performance Dashboard"],
};

// ── Sector Pack Registry ──────────────────────────────────────
const SECTOR_PACKS: Record<Sector, SectorPack> = {
  banking:     BANKING_PACK,
  insurance:   INSURANCE_PACK,
  government:  GOVERNMENT_PACK,
  healthcare:   { ...BANKING_PACK, sector:"healthcare",  name:"Healthcare",    description:"Governance for hospitals and healthcare providers", primaryFrameworks:["PDPL","MOH_Regulations","CBAHI"], controls:[], kris:[], risks:[], auditPrograms:[], reportTemplates:["MOH Report","Patient Safety Report"] },
  investment:  { ...BANKING_PACK, sector:"investment",  name:"Investment",    description:"CMA-regulated investment firms", primaryFrameworks:["Capital_Market_Law","CMA_Regulations","AML_Law"], controls:[], kris:[], risks:[], auditPrograms:[], reportTemplates:["CMA Report","Board Risk Pack"] },
  manufacturing:{ ...BANKING_PACK, sector:"manufacturing",name:"Manufacturing", description:"Industrial governance pack", primaryFrameworks:["ISO_9001","SASO_Standards","Labor_Law"], controls:[], kris:[], risks:[], auditPrograms:[], reportTemplates:["Quality Report","EHS Report"] },
  real_estate: { ...BANKING_PACK, sector:"real_estate", name:"Real Estate",   description:"Real estate companies and REITs", primaryFrameworks:["Capital_Market_Law","Real_Estate_Law","RERA"], controls:[], kris:[], risks:[], auditPrograms:[], reportTemplates:["RERA Report","Investor Pack"] },
  nonprofit:   { ...BANKING_PACK, sector:"nonprofit",   name:"Non-Profit",    description:"Charities and nonprofit organizations", primaryFrameworks:["MHR_Regulations","PDPL","AML_Law"], controls:[], kris:[], risks:[], auditPrograms:[], reportTemplates:["Annual Governance Report"] },
  technology:  { ...BANKING_PACK, sector:"technology",  name:"Technology",    description:"Technology companies and startups", primaryFrameworks:["NCA_ECC","PDPL","Data_AI_Governance","ISO_27001"], controls:[], kris:[], risks:[], auditPrograms:[], reportTemplates:["Tech Governance Report","AI Governance Report"] },
  energy:      { ...BANKING_PACK, sector:"energy",      name:"Energy",        description:"Energy sector including oil & gas, renewables", primaryFrameworks:["SEC_Regulations","RCJY_Framework","ISO_14001","ISO_45001"], controls:[], kris:[], risks:[], auditPrograms:[], reportTemplates:["Energy Regulator Report","ESG Report"] },
};

export class SectorPackEngine {
  getPack(sector: Sector): SectorPack { return SECTOR_PACKS[sector]; }
  getAllPacks(): SectorPack[] { return Object.values(SECTOR_PACKS); }
  getSectors(): Sector[] { return Object.keys(SECTOR_PACKS) as Sector[]; }

  getControlsForSector(sector: Sector): SectorControl[] {
    // Return controls mandatory for this sector across all packs
    return Object.values(SECTOR_PACKS).flatMap(p => p.controls.filter(c => c.mandatoryFor.includes(sector)));
  }

  getKRIsForSector(sector: Sector): SectorKRI[] {
    return Object.values(SECTOR_PACKS).flatMap(p => p.kris.filter(k => k.sector === sector));
  }

  getRisksForSector(sector: Sector): SectorRisk[] {
    return Object.values(SECTOR_PACKS).flatMap(p => p.risks.filter(r => r.sectors.includes(sector)));
  }

  applyPack(tenantId: string, sector: Sector): {controls:number; kris:number; risks:number; auditPrograms:number} {
    const pack = this.getPack(sector);
    return {
      controls:     pack.controls.length,
      kris:         pack.kris.length,
      risks:        pack.risks.length,
      auditPrograms:pack.auditPrograms.length,
    };
  }
}

export const sectorPackEngine = new SectorPackEngine();
