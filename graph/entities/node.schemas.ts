/**
 * Graph Node Schemas — typed property interfaces per node type.
 * Every governance entity type has its own typed node schema.
 * These are the canonical shapes for graph nodes — not DB rows.
 */
import { GovernanceNodeType } from "../../types/graph.v4.types";

// ── Base ──────────────────────────────────────────────────────
export interface BaseNodeSchema {
  id:            string;
  type:          GovernanceNodeType;
  label:         string;
  tenantId:      string;
  status:        string;
  owner?:        string;
  createdAt:     string;
  updatedAt:     string;
  version:       number;
}

// ── Domain node schemas ───────────────────────────────────────
export interface RiskNodeSchema extends BaseNodeSchema {
  type:          "risk";
  code:          string;
  category:      string;
  inherentScore: number;
  residualScore: number;
  toleranceBreached: boolean;
  appetiteBreached:  boolean;
  trending:      string;
}

export interface ControlNodeSchema extends BaseNodeSchema {
  type:          "control";
  code:          string;
  controlType:   string;
  mode:          string;
  effectiveness: number;
  lastTestedAt?: string;
  testScore?:    number;
}

export interface PolicyNodeSchema extends BaseNodeSchema {
  type:          "policy";
  code:          string;
  policyVersion: string;
  freshnessScore:number;
  effectiveFrom: string;
  effectiveTo?:  string;
  hasConflicts:  boolean;
}

export interface RegulationNodeSchema extends BaseNodeSchema {
  type:          "regulation";
  code:          string;
  issuer:        string;
  articleCount:  number;
  penaltyRange:  string;
}

export interface EvidenceNodeSchema extends BaseNodeSchema {
  type:          "evidence";
  code:          string;
  contentHash:   string;
  chainHash:     string;
  integrityScore:number;
  legalHold:     boolean;
  expiresAt?:    string;
}

export interface AuditFindingNodeSchema extends BaseNodeSchema {
  type:          "audit_finding";
  code:          string;
  severity:      string;
  overdueFlag:   boolean;
  remediationDays:number;
}

export interface CAPANodeSchema extends BaseNodeSchema {
  type:          "capa";
  code:          string;
  overdueFlag:   boolean;
  escalationLevel:number;
  retestRequired:boolean;
}

export interface VendorNodeSchema extends BaseNodeSchema {
  type:          "vendor";
  riskScore:     number;
  country:       string;
  criticalService:boolean;
}

export interface KRINodeSchema extends BaseNodeSchema {
  type:          "kri";
  code:          string;
  value:         number;
  target:        number;
  breached:      boolean;
  trend:         string;
}

// ── Node schema registry ──────────────────────────────────────
export type GovernanceNodeSchema =
  | RiskNodeSchema       | ControlNodeSchema    | PolicyNodeSchema
  | RegulationNodeSchema | EvidenceNodeSchema   | AuditFindingNodeSchema
  | CAPANodeSchema       | VendorNodeSchema     | KRINodeSchema
  | BaseNodeSchema;

export function createNodeSchema(
  type: GovernanceNodeType,
  id: string, label: string, tenantId: string,
  properties: Record<string, unknown>,
): GovernanceNodeSchema {
  const base: BaseNodeSchema = {
    id, type, label, tenantId,
    status:    properties["status"] as string ?? "active",
    owner:     properties["owner"]  as string,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    version:   1,
  };
  return { ...base, ...properties } as GovernanceNodeSchema;
}
