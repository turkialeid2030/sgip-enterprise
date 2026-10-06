/**
 * Domain Entity Schemas — extends BaseGovernanceSchema
 * One schema per UGOM entity type.
 * All use extend() — no duplication of base fields.
 */
import { z } from "zod";
import { BaseGovernanceSchema, RiskLevelSchema, EntityStatusSchema } from "./base.schema";

// ── Risk ───────────────────────────────────────────────────────────────
export const RiskSchema = BaseGovernanceSchema.extend({
  type:              z.literal("risk"),
  code:              z.string().regex(/^R-\d{3,}$/),
  category:          z.enum(["strategic","operational","financial","regulatory","cyber","legal","reputational","third_party","emerging","fraud","esg","ai"]),
  probability:       z.number().min(1).max(5),
  impact:            z.number().min(1).max(5),
  inherentScore:     z.number().min(1).max(25),
  residualScore:     z.number().min(0).max(25),
  treatmentPlan:     z.string().optional(),
  treatmentStatus:   z.enum(["not_started","in_progress","completed"]).default("not_started"),
  controlIds:        z.array(z.string()).default([]),
  regulationId:      z.string().optional(),
  toleranceBreached: z.boolean().default(false),
  appetiteBreached:  z.boolean().default(false),
  trending:          z.enum(["up","down","stable"]).default("stable"),
  lastAssessedAt:    z.string().datetime().optional(),
  nextAssessmentAt:  z.string().datetime().optional(),
});

// ── Control ────────────────────────────────────────────────────────────
export const ControlSchema = BaseGovernanceSchema.extend({
  type:              z.literal("control"),
  code:              z.string().regex(/^C-\d{3,}$/),
  controlType:       z.enum(["preventive","detective","corrective","directive","compensating"]),
  mode:              z.enum(["automated","manual","semi_automated"]),
  frequency:         z.enum(["continuous","daily","weekly","monthly","quarterly","annual","per_transaction","per_event","per_decision"]),
  effectiveness:     z.number().min(0).max(100),
  designEffective:   z.boolean().optional(),
  operatingEffective:z.boolean().optional(),
  linkedRiskIds:     z.array(z.string()).default([]),
  linkedRegIds:      z.array(z.string()).default([]),
  evidenceCount:     z.number().int().default(0),
  lastTestedAt:      z.string().datetime().optional(),
  nextTestAt:        z.string().datetime().optional(),
  testResults:       z.array(z.object({
    testId:   z.string(),
    score:    z.number().min(0).max(100),
    testedAt: z.string().datetime(),
    testedBy: z.string(),
    passed:   z.boolean(),
  })).default([]),
});

// ── Policy ─────────────────────────────────────────────────────────────
export const PolicySchema = BaseGovernanceSchema.extend({
  type:             z.literal("policy"),
  policyNumber:     z.string(),
  policyVersion:    z.string(),
  category:         z.enum(["governance","risk","compliance","security","financial","legal","hr","operational","ai","privacy","esg"]),
  linkedRegIds:     z.array(z.string()).default([]),
  linkedControlIds: z.array(z.string()).default([]),
  freshnessScore:   z.number().min(0).max(100).default(100),
  hasConflict:      z.boolean().default(false),
  conflictWith:     z.array(z.string()).default([]),
  publishedAt:      z.string().datetime().optional(),
  retiredAt:        z.string().datetime().optional(),
  exceptionCount:   z.number().int().default(0),
  attestationRequired: z.boolean().default(false),
});

// ── Compliance Obligation ──────────────────────────────────────────────
export const ComplianceObligationSchema = BaseGovernanceSchema.extend({
  type:             z.literal("compliance_obligation"),
  obligationCode:   z.string(),
  regulatorId:      z.string(),
  regulatorName:    z.string(),
  obligationText:   z.string(),
  articleReference: z.string().optional(),
  frequency:        z.string(),
  isRecurring:      z.boolean(),
  penalty:          z.string().optional(),
  controlIds:       z.array(z.string()).default([]),
  complianceScore:  z.number().min(0).max(100).optional(),
  lastVerifiedAt:   z.string().datetime().optional(),
});

// ── Audit Finding ──────────────────────────────────────────────────────
export const AuditFindingSchema = BaseGovernanceSchema.extend({
  type:             z.literal("audit_finding"),
  code:             z.string().regex(/^F-\d{3,}$/),
  findingType:      z.enum(["gap","weakness","positive","deficiency","exception"]),
  regulationRef:    z.string().optional(),
  pageRef:          z.number().int().optional(),
  excerpt:          z.string().optional(),
  controlId:        z.string().optional(),
  riskId:           z.string().optional(),
  evidenceId:       z.string().optional(),
  capaId:           z.string().optional(),
  reviewStatus:     EntityStatusSchema,
  requiresHumanReview: z.boolean().default(false),
  remediationDays:  z.number().int().optional(),
  rootCause:        z.string().optional(),
  auditEngagementId:z.string().optional(),
  iiaStandardRef:   z.string().optional(),
});

// ── Evidence ───────────────────────────────────────────────────────────
export const EvidenceSchema = BaseGovernanceSchema.extend({
  type:             z.literal("evidence"),
  code:             z.string().regex(/^EV-\d{3,}$/),
  sourceType:       z.enum(["document","system_log","process_log","policy","interview","board_resolution","external_report","financial_statement","contract","email"]),
  hash:             z.string(),
  uploadedBy:       z.string(),
  reviewedBy:       z.string().nullable().optional(),
  pageNumber:       z.number().int().optional(),
  excerpt:          z.string().optional(),
  integrityStatus:  z.enum(["verified","pending","failed","tampered"]),
  legalHold:        z.boolean().default(false),
  legalHoldReason:  z.string().optional(),
  expiryDate:       z.string().datetime().optional(),
  linkedFindingId:  z.string().optional(),
  linkedControlId:  z.string().optional(),
  linkedRiskId:     z.string().optional(),
});

// ── CAPA ───────────────────────────────────────────────────────────────
export const CAPASchema = BaseGovernanceSchema.extend({
  type:             z.literal("capa"),
  code:             z.string().regex(/^CAPA-\d{3,}$/),
  findingId:        z.string(),
  actionPlan:       z.string(),
  rootCause:        z.string(),
  expectedImpact:   z.string(),
  reviewer:         z.string(),
  closureEvidenceId:z.string().optional(),
  overdueFlag:      z.boolean().default(false),
  escalationLevel:  z.number().int().min(1).default(1),
  retestRequired:   z.boolean().default(true),
  retestDate:       z.string().datetime().optional(),
  retestResult:     z.enum(["passed","failed","pending"]).optional(),
});

// ── Decision ───────────────────────────────────────────────────────────
export const DecisionSchema = BaseGovernanceSchema.extend({
  type:             z.literal("decision"),
  decisionType:     z.enum(["strategic","operational","compliance","risk","legal","financial","governance"]),
  decidedBy:        z.string(),
  decisionBody:     z.string(),
  rationale:        z.string(),
  evidenceRefs:     z.array(z.string()).default([]),
  precedentRef:     z.string().optional(),
  riskImpact:       z.string().optional(),
  isReversible:     z.boolean().default(true),
  effectiveDate:    z.string().datetime().optional(),
  expiryDate:       z.string().datetime().optional(),
});

// ── KPI / KRI / KCI ────────────────────────────────────────────────────
export const IndicatorSchema = BaseGovernanceSchema.extend({
  type:             z.enum(["kpi","kri","kci"]),
  indicatorCode:    z.string(),
  category:         z.string(),
  value:            z.number(),
  target:           z.number(),
  threshold:        z.number().optional(),
  unit:             z.string(),
  trend:            z.enum(["up","down","stable"]).default("stable"),
  breached:         z.boolean().default(false),
  escalated:        z.boolean().default(false),
  measurementFreq:  z.enum(["realtime","daily","weekly","monthly","quarterly","annual"]),
  dataSource:       z.string(),
  lastMeasuredAt:   z.string().datetime().optional(),
});

export const schemas = {
  risk:                   RiskSchema,
  control:                ControlSchema,
  policy:                 PolicySchema,
  compliance_obligation:  ComplianceObligationSchema,
  audit_finding:          AuditFindingSchema,
  evidence:               EvidenceSchema,
  capa:                   CAPASchema,
  decision:               DecisionSchema,
  kpi:                    IndicatorSchema,
  kri:                    IndicatorSchema,
  kci:                    IndicatorSchema,
};

export type RiskEntity              = z.infer<typeof RiskSchema>;
export type ControlEntity           = z.infer<typeof ControlSchema>;
export type PolicyEntity            = z.infer<typeof PolicySchema>;
export type ComplianceObligEntity   = z.infer<typeof ComplianceObligationSchema>;
export type AuditFindingEntity      = z.infer<typeof AuditFindingSchema>;
export type EvidenceEntity          = z.infer<typeof EvidenceSchema>;
export type CAPAEntity              = z.infer<typeof CAPASchema>;
export type DecisionEntity          = z.infer<typeof DecisionSchema>;
export type IndicatorEntity         = z.infer<typeof IndicatorSchema>;
