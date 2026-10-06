/**
 * Base Governance Object Schema — Zod runtime validation
 * Used by ALL modules for entity creation and mutation.
 * No module may bypass this schema.
 */
import { z } from "zod";

export const FinancialImpactSchema = z.object({
  currency:    z.enum(["SAR", "USD", "EUR"]),
  amount:      z.number().positive().optional(),
  description: z.string().min(1),
  isEstimate:  z.boolean(),
});

export const EscalationStepSchema = z.object({
  order:         z.number().int().positive(),
  escalateTo:    z.string().min(1),
  triggerAfterH: z.number().positive(),
  condition:     z.string().optional(),
});

export const ApprovalStepSchema = z.object({
  order:      z.number().int().positive(),
  approver:   z.string().min(1),
  role:       z.string().min(1),
  required:   z.boolean(),
  approvedAt: z.string().datetime().optional(),
  approvedBy: z.string().optional(),
  notes:      z.string().optional(),
});

export const AuditEntrySchema = z.object({
  id:             z.string().uuid(),
  entityId:       z.string().min(1),
  entityType:     z.string().min(1),
  action:         z.string().min(1),
  performedBy:    z.string().min(1),
  role:           z.string().min(1),
  timestamp:      z.string().datetime(),
  previousValue:  z.unknown().optional(),
  newValue:       z.unknown().optional(),
  traceId:        z.string().min(1),
  tenantId:       z.string().min(1),
  isImmutable:    z.boolean(),
});

export const RiskLevelSchema     = z.enum(["critical","high","medium","low","info"]);
export const ImpactLevelSchema   = z.enum(["critical","high","medium","low"]);
export const PrioritySchema      = z.enum(["critical","high","medium","low"]);
export const ConfLevelSchema     = z.enum(["highly_confidential","confidential","restricted","internal","public"]);
export const EntityStatusSchema  = z.enum(["draft","active","under_review","approved","rejected","closed","escalated","overdue","blocked","archived"]);

export const BaseGovernanceSchema = z.object({
  id:                  z.string().min(1),
  type:                z.string().min(1),
  title:               z.string().min(1).max(500),
  description:         z.string().optional(),
  owner:               z.string().min(1),
  ownerId:             z.string().optional(),
  department:          z.string().optional(),
  departmentId:        z.string().optional(),
  status:              EntityStatusSchema,
  priority:            PrioritySchema,
  riskLevel:           RiskLevelSchema,
  impactLevel:         ImpactLevelSchema,

  linkedPolicies:      z.array(z.string()).default([]),
  linkedRisks:         z.array(z.string()).default([]),
  linkedControls:      z.array(z.string()).default([]),
  linkedEvidence:      z.array(z.string()).default([]),
  linkedRegulations:   z.array(z.string()).default([]),
  linkedFindings:      z.array(z.string()).default([]),
  linkedCAPAs:         z.array(z.string()).default([]),
  linkedDecisions:     z.array(z.string()).default([]),
  linkedObligations:   z.array(z.string()).default([]),

  financialImpact:     FinancialImpactSchema.optional(),
  legalImpact:         z.string().optional(),
  complianceImpact:    z.string().optional(),
  reputationalImpact:  z.string().optional(),

  reviewDate:          z.string().datetime().optional(),
  dueDate:             z.string().datetime().optional(),
  closedDate:          z.string().datetime().optional(),

  escalationPath:      z.array(EscalationStepSchema).default([]),
  approvalChain:       z.array(ApprovalStepSchema).default([]),
  auditTrail:          z.array(AuditEntrySchema).default([]),

  confidentiality:     ConfLevelSchema.default("internal"),
  evidenceSufficiency: z.number().min(0).max(100).optional(),
  confidenceScore:     z.number().min(0).max(100).optional(),

  tenantId:            z.string().min(1),
  organizationId:      z.string().min(1),

  version:             z.number().int().positive().default(1),
  createdAt:           z.string().datetime(),
  updatedAt:           z.string().datetime(),
  createdBy:           z.string().min(1),
  updatedBy:           z.string().min(1),
  tags:                z.array(z.string()).default([]),
});

export type BaseGovernanceInput  = z.input<typeof BaseGovernanceSchema>;
export type BaseGovernanceOutput = z.output<typeof BaseGovernanceSchema>;
