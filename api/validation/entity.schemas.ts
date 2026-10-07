import { z } from "zod";
import { normalizeEntityType } from "./entity-type";

const EntityTypeSchema = z.string().min(1, "type required").transform((value, ctx) => {
  const normalized = normalizeEntityType(value);
  if (normalized) return normalized;
  ctx.addIssue({ code: z.ZodIssueCode.custom, message: "unsupported entity type" });
  return value;
});

export const CreateEntitySchema = z.object({
  type:             EntityTypeSchema,
  title:            z.string().min(1).max(500),
  description:      z.string().max(2000).optional(),
  owner:            z.string().min(1),
  ownerId:          z.string().optional(),
  department:       z.string().max(200).optional(),
  status:           z.enum(["draft","active","under_review","approved","rejected","closed","escalated","overdue","blocked","archived"]).default("draft"),
  priority:         z.enum(["critical","high","medium","low"]).default("medium"),
  riskLevel:        z.enum(["critical","high","medium","low","info"]).default("medium"),
  impactLevel:      z.enum(["critical","high","medium","low"]).default("medium"),
  financialImpact:  z.object({
    currency: z.enum(["SAR","USD","EUR"]),
    amount:   z.number().positive().optional(),
    description: z.string(),
    isEstimate: z.boolean(),
  }).optional(),
  legalImpact:      z.string().max(500).optional(),
  complianceImpact: z.string().max(500).optional(),
  dueDate:          z.string().datetime().optional(),
  reviewDate:       z.string().datetime().optional(),
  confidentiality:  z.enum(["highly_confidential","confidential","restricted","internal","public"]).default("internal"),
  linkedPolicies:   z.array(z.string()).default([]),
  linkedRisks:      z.array(z.string()).default([]),
  linkedControls:   z.array(z.string()).default([]),
  linkedEvidence:   z.array(z.string()).default([]),
  linkedRegulations:z.array(z.string()).default([]),
  linkedFindings:   z.array(z.string()).default([]),
  linkedCAPAs:      z.array(z.string()).default([]),
  linkedDecisions:  z.array(z.string()).default([]),
  linkedObligations:z.array(z.string()).default([]),
  tags:             z.array(z.string().max(50)).default([]),
  data:             z.record(z.unknown()).default({}),
});

export const UpdateEntitySchema  = CreateEntitySchema.partial().omit({ type: true });
export const EntityQuerySchema   = z.object({
  type: EntityTypeSchema.optional(), status: z.string().optional(),
  riskLevel: z.string().optional(), owner: z.string().optional(),
  limit:  z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
export const CreateEdgeSchema    = z.object({
  fromId: z.string().min(1), toId: z.string().min(1),
  relationship: z.string().min(1), weight: z.number().min(0).max(10).default(5),
});
export const LoginSchema         = z.object({
  email: z.string().email(), password: z.string().min(6), tenantId: z.string().min(1),
});
export const RegisterSchema      = z.object({
  email: z.string().email(), password: z.string().min(8),
  nameAr: z.string().min(1),
  role: z.enum(["governance_analyst","risk_analyst","compliance_analyst","internal_audit_agent","financial_reviewer","legal_reviewer","board_reporter","fraud_analyst","orchestrator"]),
  tenantId: z.string().min(1),
});
export const AnalyzeSchema       = z.object({
  agentId: z.string().min(1), entityId: z.string().optional(),
  action: z.string().min(1), context: z.string().min(10).max(2000),
});
export const ReviewOutputSchema  = z.object({
  decision: z.enum(["approved","rejected"]),
  notes:    z.string().max(500).optional(),
});

export const TraceQuerySchema = z.object({
  depth: z.coerce.number().int().min(1).max(8).default(4),
});

export const AuditLogQuerySchema = z.object({
  entityType: z.string().optional(),
  limit:      z.coerce.number().int().min(1).max(200).default(50),
});

export const AgentOutputQuerySchema = z.object({
  status:  z.string().optional().default("pending"),
  agentId: z.string().optional(),
});
