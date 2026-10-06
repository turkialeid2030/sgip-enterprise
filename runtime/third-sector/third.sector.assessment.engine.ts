/**
 * Third-Sector Governance Assessment Engine
 *
 * Multi-entity: waqf, charitable/civil associations, cooperative associations,
 * non-profit companies. Built on OFFICIAL published frameworks only.
 *
 * DESIGN PRINCIPLE — no invented regulatory content:
 *   A framework is ACTIVE only when its official reference has been transcribed.
 *   Otherwise it is registered as PENDING_OFFICIAL_REFERENCE and cannot be scored.
 *   This mirrors the platform's licensed-reviewer gate: never assert a regulatory
 *   requirement the platform cannot evidence.
 *
 * VALUE ADDED over the official self-assessment models:
 *   1. Maturity ladder 0-5 instead of binary 0/1
 *   2. Evidence verification against the official "expected evidence" field
 *   3. Provenance weighting (integrates the Data Maturity engine)
 *   4. Gap register with regulatory citation
 *   5. Benchmark-ready output
 */

import {
  WAQF_PRINCIPLES, WAQF_OUTPUTS, WAQF_PRACTICES, WAQF_TOTAL_PRACTICES,
  OfficialPractice, OfficialPrinciple,
} from "./frameworks/waqf.official.framework";

// Canonical taxonomy is the single source of truth (see regulatory-core).
import { CanonicalEntityType } from "../regulatory-core/canonical.entity.taxonomy";
export type EntityType = CanonicalEntityType;

export type FrameworkStatus = "ACTIVE" | "PENDING_OFFICIAL_REFERENCE";

/** 0-5 maturity ladder layered on top of the official binary model. */
export type MaturityLevel = 0 | 1 | 2 | 3 | 4 | 5;

export const MATURITY_LADDER: Record<MaturityLevel, { ar: string; en: string }> = {
  0: { ar: "غير مطبَّق",        en: "Absent" },
  1: { ar: "مبدئي غير موثَّق",  en: "Initial / undocumented" },
  2: { ar: "موثَّق",            en: "Documented" },
  3: { ar: "مطبَّق",            en: "Implemented" },
  4: { ar: "مُقاس ومراجَع",     en: "Measured & reviewed" },
  5: { ar: "محسَّن باستمرار",   en: "Continuously improved" },
};

export type EvidenceProvenance = "automated" | "uploaded" | "self_attested" | "none";

export interface PracticeResponse {
  practiceId:  string;
  maturity:    MaturityLevel;
  provenance:  EvidenceProvenance;
  evidenceRef?: string;        // pointer to the supplied document
  note?:       string;
}

export interface FrameworkRegistration {
  entityType:   EntityType;
  nameAr:       string;
  nameEn:       string;
  /**
   * NOTE (P0): NO `regulator` field. Supervision is a sourced, time-bound,
   * activity-scoped relationship — see runtime/regulatory-core/authority.model.ts.
   * Declaring a regulator here would be a regulatory assertion without provenance.
   */
  status:       FrameworkStatus;
  sourceNote:   string;         // provenance of the framework content
  practiceCount: number;
}

export interface GapItem {
  practiceId: string;
  principle:  string;
  practice:   string;
  maturity:   MaturityLevel;
  expectedEvidence: string;     // official "الشاهد المتوقع"
  severity:   "high" | "medium" | "low";
}

export interface PrincipleScore {
  principleId:  string;
  nameAr:       string;
  practices:    number;
  answered:     number;
  officialBinary: number;       // backward-compatible field name: evidence-verified implemented practices in the official-practice denominator
  officialRatio:  number;       // 0-100 SGIP evidence-verified ratio; not asserted to reproduce an authority-issued score
  maturityAvg:    number;       // 0-5
  maturityPct:    number;       // 0-100
}

export interface AssessmentResult {
  entityId:        string;
  entityType:      EntityType;
  frameworkStatus: FrameworkStatus;
  assessedAt:      string;
  totalPractices:  number;
  answered:        number;
  coverage:        number;      // % of practices answered
  // Backward-compatible API field name. Semantics are SGIP evidence-verified scoring over the official-practice denominator;
  // this is NOT represented as a regulator/authority-issued verification or official self-assessment result.
  officialScore:   { verified: number; total: number; percentage: number };
  // SGIP maturity layer
  maturityIndex:   number;      // 0-100
  maturityLevel:   MaturityLevel;
  // Evidence provenance layer
  provenance:      { automated: number; uploaded: number; selfAttested: number; none: number; verifiedRatio: number };
  byPrinciple:     PrincipleScore[];
  gaps:            GapItem[];
  summary:         { ar: string; en: string };
  disclaimer:      { ar: string; en: string };
}

// ── Framework registry ────────────────────────────────────────
// Only the waqf framework is ACTIVE: its official workbook was transcribed.
// The others are registered but cannot be scored until their official
// reference is supplied — deliberately, to avoid inventing regulatory content.
const REGISTRY: Partial<Record<EntityType, FrameworkRegistration>> = {
  waqf: {
    entityType: "waqf",
    nameAr: "مبادئ حوكمة الأوقاف", nameEn: "Waqf Governance Principles",
    status: "ACTIVE",
    sourceNote: "نموذج التقييم الذاتي لمبادئ حوكمة الأوقاف 2026م — منقول حرفياً",
    practiceCount: WAQF_TOTAL_PRACTICES,
  },
  civil_association: {
    entityType: "civil_association",
    nameAr: "حوكمة الجمعيات والمؤسسات الأهلية والخيرية", nameEn: "Civil & Charitable Associations Governance",
    status: "PENDING_OFFICIAL_REFERENCE",
    sourceNote: "بانتظار المرجع الرسمي — لا تُحتسب درجات قبل تحميله",
    practiceCount: 0,
  },
  cooperative_association: {
    entityType: "cooperative_association",
    nameAr: "حوكمة الجمعيات التعاونية", nameEn: "Cooperative Associations Governance",
    status: "PENDING_OFFICIAL_REFERENCE",
    sourceNote: "بانتظار المرجع الرسمي — لا تُحتسب درجات قبل تحميله",
    practiceCount: 0,
  },
  nonprofit_company: {
    entityType: "nonprofit_company",
    nameAr: "حوكمة الشركات غير الربحية", nameEn: "Non-Profit Companies Governance",
    status: "PENDING_OFFICIAL_REFERENCE",
    sourceNote: "بانتظار المرجع الرسمي — لا تُحتسب درجات قبل تحميله",
    practiceCount: 0,
  },
};

/**
 * Shared governance core — principles that recur across third-sector entity types.
 * Derived from the official waqf framework; the mapping to other entity types is
 * an ANALYTICAL grouping by SGIP, not an official cross-reference.
 */
export const SHARED_CORE_PRINCIPLES = [
  { id: "4", themeAr: "فاعلية المجلس/النظارة",        themeEn: "Board / trustee effectiveness" },
  { id: "5", themeAr: "التعامل العادل وتعارض المصالح", themeEn: "Fair dealing & conflicts of interest" },
  { id: "6", themeAr: "المساءلة والسلامة المالية",     themeEn: "Accountability & financial integrity" },
  { id: "7", themeAr: "الشفافية والإفصاح",             themeEn: "Transparency & disclosure" },
];

const PROVENANCE_WEIGHT: Record<EvidenceProvenance, number> = {
  automated: 1.0, uploaded: 0.75, self_attested: 0.4, none: 0,
};

export class ThirdSectorAssessmentEngine {
  listFrameworks(): FrameworkRegistration[] { return Object.values(REGISTRY) as FrameworkRegistration[]; }
  getFramework(t: EntityType): FrameworkRegistration | null { return REGISTRY[t] ?? null; }

  /** Practices for an active framework; empty for pending ones. */
  getPractices(t: EntityType): OfficialPractice[] {
    return t === "waqf" ? WAQF_PRACTICES : [];
  }
  getPrinciples(t: EntityType): OfficialPrinciple[] {
    return t === "waqf" ? WAQF_PRINCIPLES : [];
  }
  getOutputs(t: EntityType) { return t === "waqf" ? WAQF_OUTPUTS : []; }

  /** Practices belonging to the shared cross-entity governance core. */
  getSharedCorePractices(): OfficialPractice[] {
    const ids = new Set(SHARED_CORE_PRINCIPLES.map(p => p.id));
    return WAQF_PRACTICES.filter(p => ids.has(p.principle));
  }

  private severity(m: MaturityLevel): "high" | "medium" | "low" {
    if (m <= 1) return "high";
    if (m === 2) return "medium";
    return "low";
  }

  assess(entityId: string, entityType: EntityType, responses: PracticeResponse[]): AssessmentResult {
    const fw = REGISTRY[entityType];
    const now = new Date().toISOString();

    if (!fw || fw.status !== "ACTIVE") {
      return {
        entityId, entityType,
        frameworkStatus: fw?.status ?? "PENDING_OFFICIAL_REFERENCE",
        assessedAt: now, totalPractices: 0, answered: 0, coverage: 0,
        officialScore: { verified: 0, total: 0, percentage: 0 },
        maturityIndex: 0, maturityLevel: 0,
        provenance: { automated:0, uploaded:0, selfAttested:0, none:0, verifiedRatio:0 },
        byPrinciple: [], gaps: [],
        summary: {
          ar: `إطار «${fw?.nameAr ?? entityType}» غير مُفعّل: لم يُحمَّل مرجعه الرسمي بعد، ولا تُحتسب أي درجة قبل ذلك.`,
          en: `Framework "${fw?.nameEn ?? entityType}" is not active: its official reference has not been loaded, and no score is computed until it is.`,
        },
        disclaimer: this.disclaimer(),
      };
    }

    const practices = this.getPractices(entityType);
    const total = practices.length;
    const validIds = new Set(practices.map(p=>p.id));
    const provenanceRank: Record<EvidenceProvenance,number> = { none:0, self_attested:1, uploaded:2, automated:3 };
    const canonicalResponses = new Map<string,PracticeResponse>();
    for (const r of responses) {
      if (!validIds.has(r.practiceId)) continue;
      const prior = canonicalResponses.get(r.practiceId);
      if (!prior) { canonicalResponses.set(r.practiceId,r); continue; }
      // Fail closed on duplicates: retain the more conservative maturity/evidence claim.
      if (r.maturity < prior.maturity || (r.maturity === prior.maturity && provenanceRank[r.provenance] < provenanceRank[prior.provenance])) canonicalResponses.set(r.practiceId,r);
    }
    const byId = canonicalResponses;
    const answered = practices.filter(p => byId.has(p.id)).length;
    const evidenceBacked = (r:PracticeResponse|undefined) => !!r && (r.provenance === "automated" || (r.provenance === "uploaded" && !!r.evidenceRef?.trim()));

    // Evidence-verified binary score: an implemented practice counts only when its claim is evidence-backed.
    const verified = practices.filter(p => { const r=byId.get(p.id); return (r?.maturity ?? 0) >= 3 && evidenceBacked(r); }).length;

    // Maturity index (0-100), provenance-weighted
    let weighted = 0;
    for (const p of practices) {
      const r = byId.get(p.id);
      if (!r) continue;
      weighted += (r.maturity / 5) * PROVENANCE_WEIGHT[r.provenance];
    }
    const maturityIndex = total > 0 ? Math.round((weighted / total) * 100) : 0;

    const prov = { automated:0, uploaded:0, selfAttested:0, none:0, verifiedRatio:0 };
    for (const r of canonicalResponses.values()) {
      if (r.provenance === "automated") prov.automated++;
      else if (r.provenance === "uploaded") prov.uploaded++;
      else if (r.provenance === "self_attested") prov.selfAttested++;
      else prov.none++;
    }
    const provTotal = canonicalResponses.size || 1;
    prov.verifiedRatio = Math.round(((prov.automated + prov.uploaded) / provTotal) * 100);

    // Per-principle scoring
    const byPrinciple: PrincipleScore[] = this.getPrinciples(entityType).map(pr => {
      const ps = practices.filter(p => p.principle === pr.id);
      const ans = ps.filter(p => byId.has(p.id));
      const bin = ps.filter(p => { const r=byId.get(p.id); return (r?.maturity ?? 0) >= 3 && evidenceBacked(r); }).length;
      const sum = ans.reduce((s, p) => s + (byId.get(p.id)!.maturity), 0);
      const avg = ans.length ? sum / ans.length : 0;
      return {
        principleId: pr.id, nameAr: pr.name,
        practices: ps.length, answered: ans.length,
        officialBinary: bin,
        officialRatio: ps.length ? Math.round((bin / ps.length) * 100) : 0,
        maturityAvg: Math.round(avg * 10) / 10,
        maturityPct: Math.round((avg / 5) * 100),
      };
    });

    // Gap register — carries the OFFICIAL expected evidence
    const gaps: GapItem[] = practices
      .filter(p => { const r=byId.get(p.id); return (r?.maturity ?? 0) < 3 || !evidenceBacked(r); })
      .map(p => {
        const m = (byId.get(p.id)?.maturity ?? 0) as MaturityLevel;
        return {
          practiceId: p.id, principle: p.principle, practice: p.practice,
          maturity: m, expectedEvidence: p.evidence, severity: this.severity(m),
        };
      })
      .sort((a, b) => a.maturity - b.maturity);

    const pct = total ? Math.round((verified / total) * 100) : 0;
    const lvl = Math.round((maturityIndex / 100) * 5) as MaturityLevel;

    return {
      entityId, entityType, frameworkStatus: "ACTIVE", assessedAt: now,
      totalPractices: total, answered,
      coverage: total ? Math.round((answered / total) * 100) : 0,
      officialScore: { verified, total, percentage: pct },
      maturityIndex, maturityLevel: lvl,
      provenance: prov, byPrinciple, gaps,
      summary: {
        ar: `النتيجة المتحققة بالأدلة: ${verified} من ${total} (${pct}%). مؤشر النضج المرجّح: ${maturityIndex}% (المستوى ${lvl} — ${MATURITY_LADDER[lvl].ar}). ${prov.verifiedRatio}% من الإجابات ذات مصدر آلي أو رفع موثق. عدد الفجوات: ${gaps.length}.`,
        en: `Evidence-verified score: ${verified} of ${total} (${pct}%). Weighted maturity index: ${maturityIndex}% (level ${lvl} — ${MATURITY_LADDER[lvl].en}). ${prov.verifiedRatio}% of responses are automated or evidence-upload backed. Gaps: ${gaps.length}.`,
      },
      disclaimer: this.disclaimer(),
    };
  }

  private disclaimer() {
    return {
      ar: "هذا تقييم داعم للقرار مبني على النموذج الرسمي المنشور، ولا يُعد شهادة امتثال ولا استشارة قانونية. الاعتماد النهائي يتطلب مراجعة مختص مرخّص والجهة الإشرافية.",
      en: "Decision-support assessment based on the published official model. It is not a compliance certification nor legal advice. Final reliance requires review by a licensed professional and the supervising authority.",
    };
  }
}

let _e: ThirdSectorAssessmentEngine | null = null;
export function getThirdSectorEngine(): ThirdSectorAssessmentEngine {
  if (!_e) _e = new ThirdSectorAssessmentEngine();
  return _e;
}
