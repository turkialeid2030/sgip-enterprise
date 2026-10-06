/**
 * Governance Maturity Engine — Phase 9.3
 * Scores governance maturity across 6 dimensions:
 *   - Governance (board, authority, policy, committee)
 *   - AI Governance (model registry, human oversight, explainability)
 *   - Internal Audit (IIA standards alignment)
 *   - Compliance (obligation coverage, CCM)
 *   - Operational Resilience (BCP, DR, continuity)
 *   - Financial Governance (IFRS alignment, controls, materiality)
 *
 * Maturity Levels (CMMI-inspired):
 *   1 = Initial/Ad-hoc
 *   2 = Developing/Managed
 *   3 = Defined/Standardized
 *   4 = Quantitatively Managed
 *   5 = Optimizing/Leading
 */
import { v4 as uuidv4 } from "uuid";
import { getKernel } from "../runtime/institutional-kernel/institutional.kernel";
import { getBoardRuntime } from "../governance-runtime/board/board.runtime";
import { getAuthorityEngine } from "../governance-runtime/authority/authority.engine";
import { getPolicyRuntime } from "../governance-runtime/policy/governance.policy.runtime";
import { getCommitteeRuntime } from "../governance-runtime/committees/committee.runtime";
import { getAISafetyRuntime } from "../runtime/ai-safety/ai.governance.safety.runtime";
import { getInternalAuditRuntime } from "../audit-runtime/internal/internal.audit.runtime";
import { getFinancialAuditRuntime } from "../audit-runtime/financial/financial.audit.runtime";
import { getComplianceObligationRuntime } from "../compliance-runtime/obligations/compliance.obligation.runtime";
import { getCCMRuntime } from "../compliance-runtime/ccm/ccm.runtime";
import { getResilienceRuntime } from "../resilience-runtime/continuity/operational.resilience.runtime";
import { getDRRuntime } from "../runtime/disaster-recovery/disaster.recovery.runtime";
import { getExternalIntelligence } from "../runtime/external-intelligence/external.intelligence.runtime";
import { getPredictiveRuntime } from "../analytics-runtime/predictive/predictive.governance.runtime";

export type MaturityLevel = 1|2|3|4|5;
export type MaturityTrend = "improving"|"stable"|"deteriorating";

export interface DimensionMaturity {
  dimension:   string;
  level:       MaturityLevel;
  label:       string;
  score:       number;           // 0-100 within level
  strengths:   string[];
  gaps:        string[];
  nextActions: string[];
  trend:       MaturityTrend;
}

export interface GovernanceMaturityReport {
  id:          string;
  tenantId:    string;
  generatedAt: string;
  overallLevel:MaturityLevel;
  overallScore:number;           // 0-100
  dimensions:  DimensionMaturity[];
  topGaps:     string[];
  quickWins:   string[];
  strategicRecommendations:string[];
  benchmarkNote:string;         // vs industry
  certificationReadiness: {
    ISO_37301:  boolean;
    COSO_ERM:   boolean;
    IIA_IPPF:   boolean;
    COBIT:      boolean;
  };
}

const LEVEL_LABELS: Record<MaturityLevel,string> = {
  1:"Initial/Ad-hoc", 2:"Developing/Managed",
  3:"Defined/Standardized", 4:"Quantitatively Managed", 5:"Optimizing/Leading",
};

export class GovernanceMaturityEngine {
  constructor(private readonly tenantId: string) {}

  score(): GovernanceMaturityReport {
    const dims = [
      this.scoreGovernance(),
      this.scoreAIGovernance(),
      this.scoreInternalAudit(),
      this.scoreCompliance(),
      this.scoreResilience(),
      this.scoreFinancialGovernance(),
    ];

    const avgScore = Math.round(dims.reduce((s,d)=>s+d.score,0)/dims.length);
    const overallLevel: MaturityLevel = avgScore>=90?5:avgScore>=75?4:avgScore>=55?3:avgScore>=30?2:1;

    const topGaps = dims.flatMap(d=>d.gaps).slice(0,5);
    const quickWins = dims.flatMap(d=>d.nextActions).slice(0,3);

    return {
      id:uuidv4(), tenantId:this.tenantId, generatedAt:new Date().toISOString(),
      overallLevel, overallScore:avgScore, dimensions:dims,
      topGaps, quickWins,
      strategicRecommendations:[
        overallLevel<3?"Formalize governance policies and procedures — document what should be":"",
        overallLevel<4?"Implement metrics and KPIs for governance processes":"",
        overallLevel>=4?"Focus on continuous improvement and innovation in governance":"",
        "Align governance framework with COSO, IIA IPPF, and local regulatory requirements",
      ].filter(Boolean),
      benchmarkNote: `Organization at Level ${overallLevel} — ${overallLevel>=4?"above":"below or at"} regional financial services average (Level 3)`,
      certificationReadiness: {
        ISO_37301:  overallLevel>=3 && dims.find(d=>d.dimension==="Compliance")!.level>=3,
        COSO_ERM:   overallLevel>=3 && dims.find(d=>d.dimension==="Governance")!.level>=3,
        IIA_IPPF:   overallLevel>=3 && dims.find(d=>d.dimension==="Internal Audit")!.level>=3,
        COBIT:      overallLevel>=3,
      },
    };
  }

  private scoreGovernance(): DimensionMaturity {
    const board   = getBoardRuntime(this.tenantId);
    const auth    = getAuthorityEngine(this.tenantId);
    const policy  = getPolicyRuntime(this.tenantId);
    const comm    = getCommitteeRuntime(this.tenantId);
    const health  = getKernel(this.tenantId).computeHealthState();

    const hasSessions   = board.getSessions().length>0;
    const hasResolutions= board.getResolutions().length>0;
    const hasAuthority  = health.accountabilityCoverageScore>50;
    const hasPolicies   = policy.getAll("active").length>0;
    const hasCommittees = comm.getMeetings().length>0;
    const score = Math.round((hasSessions?20:0)+(hasResolutions?20:0)+(hasAuthority?20:0)+(hasPolicies?20:0)+(hasCommittees?20:0));
    const level: MaturityLevel = score>=90?5:score>=70?4:score>=50?3:score>=25?2:1;

    return {
      dimension:"Governance", level, label:LEVEL_LABELS[level], score,
      strengths: [hasSessions?"Board sessions tracked":"",hasPolicies?"Active policies documented":"",hasCommittees?"Committee governance active":""].filter(Boolean),
      gaps: [!hasSessions?"No board sessions recorded":"",!hasResolutions?"No board resolutions":"",!hasAuthority?"Accountability gaps detected":""].filter(Boolean),
      nextActions: [!hasPolicies?"Develop and activate core governance policies":"",!hasCommittees?"Establish governance committees":"","Map complete authority matrix"].filter(Boolean),
      trend:"stable",
    };
  }

  private scoreAIGovernance(): DimensionMaturity {
    const ai = getAISafetyRuntime(this.tenantId);
    const traces = ai.getTraces().length;
    const blocked = ai.getBlockedActions().length;
    const hallucinations = ai.getHallucinationReports().filter(h=>h.detected).length;
    const hasPolicies = traces>0;
    const hasMonitoring = true;  // AI safety runtime is active
    const score = Math.min(100, (hasPolicies?25:5)+(traces>0?20:0)+(blocked>0?15:5)+30+(hallucinations===0?10:0));
    const level: MaturityLevel = score>=85?4:score>=65?3:score>=45?2:1;
    return {
      dimension:"AI Governance", level, label:LEVEL_LABELS[level], score,
      strengths:["AI safety runtime active","Prohibited action enforcement enabled","Hallucination detection enabled"],
      gaps:[!hasPolicies?"No AI actions traced yet":"",hallucinations>0?`${hallucinations} hallucinations detected`:""].filter(Boolean),
      nextActions:["Register all AI models in AI registry","Implement confidence thresholds per use case","Schedule AI governance committee review"],
      trend:"stable",
    };
  }

  private scoreInternalAudit(): DimensionMaturity {
    const audit    = getInternalAuditRuntime(this.tenantId);
    const readiness= audit.scoreReadiness();
    const hasUniverse = audit.getUniverse().length>0;
    const hasEngagements = audit.getEngagements().length>0;
    const score = Math.round((hasUniverse?20:0)+(hasEngagements?20:0)+readiness.overall*0.6);
    const level: MaturityLevel = score>=85?4:score>=65?3:score>=40?2:1;
    return {
      dimension:"Internal Audit", level, label:LEVEL_LABELS[level], score,
      strengths:[hasUniverse?"Audit universe defined":"",readiness.criticalOpen===0?"No critical open findings":"",readiness.overdueFindings===0?"No overdue findings":""].filter(Boolean),
      gaps:[!hasUniverse?"No audit universe defined — IIA standards require coverage":"",!hasEngagements?"No audit engagements recorded":"",readiness.overdueFindings>0?`${readiness.overdueFindings} findings overdue`:""].filter(Boolean),
      nextActions:["Define audit universe for all high-risk areas","Initiate risk-based annual audit plan","Implement continuous auditing for critical controls"],
      trend:"stable",
    };
  }

  private scoreCompliance(): DimensionMaturity {
    const compl   = getComplianceObligationRuntime(this.tenantId);
    const ccm     = getCCMRuntime(this.tenantId);
    const intel   = getExternalIntelligence(this.tenantId);
    intel.loadBaseline();
    const score = Math.round((compl.getAll().length>0?20:5)+(compl.getBreached().length===0?30:10)+(ccm.getOverallScore()*0.3)+(intel.getChanges().length>0?20:0));
    const level: MaturityLevel = score>=85?4:score>=65?3:score>=40?2:1;
    return {
      dimension:"Compliance", level, label:LEVEL_LABELS[level], score,
      strengths:[compl.getBreached().length===0?"No compliance breaches":"","External regulatory intelligence active","CCM runtime monitoring controls"],
      gaps:[compl.getAll().length===0?"No compliance obligations registered":"",ccm.getOverallScore()<60?`Control effectiveness at ${ccm.getOverallScore()}%`:""].filter(Boolean),
      nextActions:["Register all regulatory obligations by framework","Automate evidence collection for key controls","Implement quarterly compliance attestation"],
      trend:"stable",
    };
  }

  private scoreResilience(): DimensionMaturity {
    const res = getResilienceRuntime(this.tenantId);
    const dr  = getDRRuntime(this.tenantId);
    const resScore = res.scoreResilience();
    const drTested = dr.getTestResults().some(t=>t.outcome==="passed");
    const score = Math.round((resScore.tier1ProcessCount>0?25:0)+(resScore.singlePointsOfFailure===0?25:10)+(drTested?25:0)+(resScore.overallScore*0.25));
    const level: MaturityLevel = score>=85?4:score>=65?3:score>=40?2:1;
    return {
      dimension:"Operational Resilience", level, label:LEVEL_LABELS[level], score,
      strengths:[drTested?"DR test completed successfully":"","Self-healing runtime active","Disaster recovery plans registered"],
      gaps:[resScore.tier1ProcessCount===0?"No Tier 1 critical processes mapped":"",resScore.singlePointsOfFailure>0?`${resScore.singlePointsOfFailure} SPOFs detected`:"",!drTested?"DR not yet tested":""      ].filter(Boolean),
      nextActions:["Map all Tier 1 critical processes","Eliminate single points of failure","Schedule quarterly DR simulation"],
      trend:"stable",
    };
  }

  private scoreFinancialGovernance(): DimensionMaturity {
    const fin = getFinancialAuditRuntime(this.tenantId);
    const hasMateriality = fin.getMateriality().length>0;
    const hasAssertions  = fin.getAssertions().length>0;
    const hasPackages    = fin.getEvidencePackages().length>0;
    const mw             = fin.getMaterialWeaknesses().length;
    const score = Math.round((hasMateriality?25:0)+(hasAssertions?25:0)+(hasPackages?25:0)+(mw===0?25:5));
    const level: MaturityLevel = score>=85?4:score>=65?3:score>=40?2:1;
    return {
      dimension:"Financial Governance", level, label:LEVEL_LABELS[level], score,
      strengths:[hasMateriality?"Materiality framework established":"",hasPackages?"Evidence packages sealed":"",mw===0?"No material weaknesses identified":""].filter(Boolean),
      gaps:[!hasMateriality?"No materiality assessment performed":"",!hasAssertions?"Management assertions not documented":"",mw>0?`${mw} material weaknesses requiring board attention`:""].filter(Boolean),
      nextActions:["Complete materiality assessment for current period","Document management assertions for all financial statement areas","Seal evidence packages for external audit readiness"],
      trend:"stable",
    };
  }
}

const matCache = new Map<string,GovernanceMaturityEngine>();
export function getMaturityEngine(tenantId:string): GovernanceMaturityEngine {
  if (!matCache.has(tenantId)) matCache.set(tenantId,new GovernanceMaturityEngine(tenantId));
  return matCache.get(tenantId)!;
}
