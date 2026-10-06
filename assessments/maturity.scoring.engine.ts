/**
 * Maturity Scoring Engine
 * Computes governance maturity scores using multiple models.
 * Supports: COBIT, ISO, NCA, SAMA, custom enterprise models.
 */
import { FrameworkId, MaturityLevel, MaturityAssessment, MaturityFinding, RoadmapItem } from "../frameworks/framework.types";
import { CANONICAL_CONTROL_LIBRARY } from "../controls/control.library";
import { v4 as uuidv4 } from "uuid";

export type OrganizationMode = "startup" | "sme" | "enterprise" | "regulated_enterprise" | "government";

export interface MaturityDimension {
  name:        string;
  weight:      number;    // 0-1, sum to 1.0
  score:       number;    // 0-100
  level:       MaturityLevel;
  evidence:    string[];
  gaps:        string[];
}

export interface MaturityScoreResult {
  frameworkId:         FrameworkId;
  tenantId:            string;
  overallScore:        number;      // 0-100
  currentLevel:        MaturityLevel;
  targetLevel:         MaturityLevel;
  levelLabel:          string;
  dimensions:          MaturityDimension[];
  findings:            MaturityFinding[];
  roadmap:             RoadmapItem[];
  benchmarkComparison: number;      // vs industry average
  nextReviewDate:      string;
  organizationMode:    OrganizationMode;
}

const MATURITY_LABELS: Record<MaturityLevel, string> = {
  1: "Initial — ad hoc, unpredictable",
  2: "Developing — repeatable but reactive",
  3: "Defined — proactive and documented",
  4: "Managed — measured and controlled",
  5: "Optimized — continuously improving",
};

const BENCHMARK_BY_MODE: Record<OrganizationMode, Record<FrameworkId, number>> = {
  startup:              { CRISC:20, COBIT_2019:20, ISO_27001:25, NCA_ECC:30, HIPAA:35, PCI_DSS:30, GDPR:30, ISO_27701:20, ISO_22301:15, NIST_CSF:20, SOX:15, COSO_ERM:20, ISMS_PDPL:25, SAMA_CSF:30 },
  sme:                  { CRISC:35, COBIT_2019:35, ISO_27001:40, NCA_ECC:45, HIPAA:50, PCI_DSS:45, GDPR:45, ISO_27701:35, ISO_22301:30, NIST_CSF:35, SOX:30, COSO_ERM:35, ISMS_PDPL:40, SAMA_CSF:45 },
  enterprise:           { CRISC:55, COBIT_2019:60, ISO_27001:65, NCA_ECC:65, HIPAA:65, PCI_DSS:65, GDPR:60, ISO_27701:55, ISO_22301:55, NIST_CSF:60, SOX:65, COSO_ERM:60, ISMS_PDPL:55, SAMA_CSF:65 },
  regulated_enterprise: { CRISC:70, COBIT_2019:70, ISO_27001:75, NCA_ECC:75, HIPAA:80, PCI_DSS:80, GDPR:75, ISO_27701:70, ISO_22301:70, NIST_CSF:70, SOX:80, COSO_ERM:70, ISMS_PDPL:70, SAMA_CSF:75 },
  government:           { CRISC:65, COBIT_2019:65, ISO_27001:70, NCA_ECC:80, HIPAA:60, PCI_DSS:55, GDPR:65, ISO_27701:60, ISO_22301:75, NIST_CSF:75, SOX:55, COSO_ERM:65, ISMS_PDPL:65, SAMA_CSF:70 },
};

export class MaturityScoringEngine {
  score(params: {
    tenantId:           string;
    frameworkId:        FrameworkId;
    implementedControls:string[];   // canonical control IDs
    mode:               OrganizationMode;
    targetLevel?:       MaturityLevel;
    assessedBy:         string;
  }): MaturityScoreResult {
    const required = CANONICAL_CONTROL_LIBRARY.filter(c =>
      c.frameworkRefs.some(r => r.frameworkId === params.frameworkId)
    );
    const implemented = new Set(params.implementedControls);

    // Score by maturity level
    const byLevel: Record<MaturityLevel, { required: number; implemented: number }> = {
      1: { required: 0, implemented: 0 },
      2: { required: 0, implemented: 0 },
      3: { required: 0, implemented: 0 },
      4: { required: 0, implemented: 0 },
      5: { required: 0, implemented: 0 },
    };
    for (const ctrl of required) {
      const lvl = ctrl.maturityLevel as MaturityLevel;
      byLevel[lvl].required++;
      if (implemented.has(ctrl.id)) byLevel[lvl].implemented++;
    }

    // Overall score
    const totalRequired    = required.length;
    const totalImplemented = required.filter(c => implemented.has(c.id)).length;
    const overallScore     = totalRequired > 0
      ? Math.round((totalImplemented / totalRequired) * 100)
      : 0;

    // Current level: highest level where all controls implemented
    let currentLevel: MaturityLevel = 1;
    for (const lvl of [1,2,3,4,5] as MaturityLevel[]) {
      const { required: req, implemented: imp } = byLevel[lvl];
      if (req === 0 || imp / req >= 0.8) currentLevel = lvl;
      else break;
    }

    const targetLevel = params.targetLevel ?? Math.min(5, currentLevel + 1) as MaturityLevel;

    // Dimensions (governance, risk, compliance, technology, people)
    const dimensions: MaturityDimension[] = [
      { name:"Governance",  weight:0.25, score:this.dimScore(required, implemented, ["governance_oversight","policy_management"]),    level:currentLevel, evidence:[], gaps:[] },
      { name:"Risk",        weight:0.25, score:this.dimScore(required, implemented, ["risk_assessment"]),                              level:currentLevel, evidence:[], gaps:[] },
      { name:"Technology",  weight:0.20, score:this.dimScore(required, implemented, ["network_security","access_control","cryptography","vulnerability_management"]), level:currentLevel, evidence:[], gaps:[] },
      { name:"People",      weight:0.15, score:this.dimScore(required, implemented, ["training_awareness","segregation_of_duties"]),   level:currentLevel, evidence:[], gaps:[] },
      { name:"Compliance",  weight:0.15, score:this.dimScore(required, implemented, ["privacy_controls","audit_logging","financial_controls"]), level:currentLevel, evidence:[], gaps:[] },
    ];

    // Findings: top 5 unimplemented controls
    const findings: MaturityFinding[] = required
      .filter(c => !implemented.has(c.id))
      .sort((a, b) => a.maturityLevel - b.maturityLevel)
      .slice(0, 5)
      .map(c => ({
        controlId:    c.id,
        currentState: "Not implemented",
        desiredState: c.objective,
        gap:          `Missing: ${c.title}`,
        effort:       c.implementationEffort as MaturityFinding["effort"],
        priority:     c.maturityLevel,
      }));

    // Roadmap: phased implementation
    const roadmap: RoadmapItem[] = this.buildRoadmap(required.filter(c => !implemented.has(c.id)), currentLevel, targetLevel);

    const benchmarkScore = BENCHMARK_BY_MODE[params.mode]?.[params.frameworkId] ?? 50;

    return {
      frameworkId:    params.frameworkId,
      tenantId:       params.tenantId,
      overallScore,
      currentLevel,
      targetLevel,
      levelLabel:     MATURITY_LABELS[currentLevel],
      dimensions,
      findings,
      roadmap,
      benchmarkComparison: overallScore - benchmarkScore,
      nextReviewDate: new Date(Date.now() + 90 * 86400 * 1000).toISOString(),
      organizationMode: params.mode,
    };
  }

  private dimScore(
    required: typeof CANONICAL_CONTROL_LIBRARY,
    implemented: Set<string>,
    categories: string[],
  ): number {
    const subset = required.filter(c => categories.includes(c.category));
    if (subset.length === 0) return 0;
    return Math.round(subset.filter(c => implemented.has(c.id)).length / subset.length * 100);
  }

  private buildRoadmap(
    missing: typeof CANONICAL_CONTROL_LIBRARY,
    current: MaturityLevel,
    target:  MaturityLevel,
  ): RoadmapItem[] {
    const phases: RoadmapItem[] = [];
    let phaseNo = 0;
    for (let lvl = current; lvl <= target; lvl++) {
      const forLevel = missing.filter(c => c.maturityLevel === lvl);
      if (forLevel.length === 0) continue;
      phaseNo++;
      phases.push({
        phase:          phaseNo,
        title:          lvl === current ? `Phase ${phaseNo}: Complete Maturity Level ${lvl}` : `Phase ${phaseNo}: Achieve Maturity Level ${lvl}`,
        description:    `Implement ${forLevel.length} controls to ${lvl === current ? "complete" : "reach"} ${MATURITY_LABELS[lvl as MaturityLevel]}`,
        controls:       forLevel.map(c => c.id),
        estimatedDays:  forLevel.reduce((s, c) => s + (c.implementationEffort === "low" ? 14 : c.implementationEffort === "medium" ? 30 : 60), 0),
        dependencies:   phaseNo > 1 ? [`Phase ${phaseNo - 1}`] : [],
        maturityGain:   lvl === current ? 0 : 20,
      });
    }
    return phases;
  }
}

export const maturityScoringEngine = new MaturityScoringEngine();
