/**
 * Framework Types — typed contracts for compliance frameworks.
 * CRISC, COBIT 2019, ISO 27001, NCA ECC, HIPAA, PCI DSS, GDPR, ISO 27701, ISO 22301.
 * These are operational engines, not static document stores.
 */

export type FrameworkId =
  | "CRISC"       | "COBIT_2019"   | "ISO_27001"
  | "NCA_ECC"     | "HIPAA"        | "PCI_DSS"
  | "GDPR"        | "ISO_27701"    | "ISO_22301"
  | "NIST_CSF"    | "SOX"          | "COSO_ERM"
  | "ISMS_PDPL"   | "SAMA_CSF";

export type FrameworkDomain =
  | "governance"    | "risk"          | "compliance"
  | "strategy"     
  | "security"      | "privacy"       | "continuity"
  | "audit"         | "financial"     | "operational"
  | "technology"    | "data"          | "third_party";

export type MaturityLevel = 1 | 2 | 3 | 4 | 5;
export type MaturityLabel = "Initial" | "Developing" | "Defined" | "Managed" | "Optimized";

export interface Framework {
  id:             FrameworkId;
  name:           string;
  version:        string;
  issuer:         string;
  domains:        FrameworkDomain[];
  controlCount:   number;
  applicability:  string[];    // industries, jurisdictions
  mandatoryFor:   string[];    // regulatory jurisdictions
  lastUpdated:    string;
  description:    string;
  maturityModel:  boolean;
  certifiable:    boolean;
}

export interface FrameworkControl {
  id:             string;      // e.g. "ISO27001-A.5.1"
  frameworkId:    FrameworkId;
  code:           string;
  title:          string;
  description:    string;
  domain:         FrameworkDomain;
  category:       string;
  objective:      string;
  guidance:       string;
  evidenceRequired:string[];
  relatedControls: string[];   // cross-framework refs
  maturityLevel:  MaturityLevel;
  priority:       "critical" | "high" | "medium" | "low";
  automatable:    boolean;
  testFrequency:  string;
}

export interface ControlMapping {
  sourceControlId:   string;
  sourceFramework:   FrameworkId;
  targetControlId:   string;
  targetFramework:   FrameworkId;
  mappingType:       "equivalent" | "subset" | "superset" | "related" | "partial";
  coverageScore:     number;   // 0-100
  notes:             string;
  validatedAt:       string;
}

export interface FrameworkGap {
  frameworkId:    FrameworkId;
  controlId:      string;
  gapType:        "missing_control" | "missing_evidence" | "missing_policy" | "untested" | "expired" | "partial_coverage";
  severity:       "critical" | "high" | "medium" | "low";
  description:    string;
  recommendation: string;
  entityIds:      string[];    // UGOM entities that should address this gap
}

export interface MaturityAssessment {
  id:             string;
  tenantId:       string;
  frameworkId:    FrameworkId;
  domain:         FrameworkDomain;
  currentLevel:   MaturityLevel;
  targetLevel:    MaturityLevel;
  score:          number;      // 0-100 within level
  findings:       MaturityFinding[];
  assessedAt:     string;
  assessedBy:     string;
  nextReviewAt:   string;
  roadmapItems:   RoadmapItem[];
}

export interface MaturityFinding {
  controlId:      string;
  currentState:   string;
  desiredState:   string;
  gap:            string;
  effort:         "low" | "medium" | "high";
  priority:       number;
}

export interface RoadmapItem {
  phase:          number;
  title:          string;
  description:    string;
  controls:       string[];
  estimatedDays:  number;
  dependencies:   string[];
  maturityGain:   number;
}
