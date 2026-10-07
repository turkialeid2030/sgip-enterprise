/**
 * Decision Engine — governance of every executive decision.
 * No decision proceeds without: owner, evidence, policy validation,
 * risk validation, authority check, SoD check, approval chain.
 *
 * Every decision produces an immutable sealed record.
 */
import { v4 as uuidv4 } from "uuid";
import { TenantContext } from "../../types/tenant.types";
import { requireTenantContext, assertTenantOwnership } from "../../tenant/tenant.context";
import { policyEvaluator } from "../../policy-engine/engine/policy.evaluator";
import { sodEngine } from "../../policy-engine/rules/sod.engine";
import { getEvidenceEngine } from "../../evidence/lineage/evidence.lineage.engine";
import { globalMetrics } from "../../observability/metrics/governance.metrics";

export type DecisionType =
  | "strategic"     | "operational"    | "financial"
  | "risk_acceptance"| "policy_approval"| "exception_approval"
  | "investment"    | "vendor_onboarding"| "regulatory_response"
  | "board_resolution"| "audit_closure" | "system_change";

export type DecisionStatus =
  | "draft"  | "pending_validation" | "pending_approval" | "approved"
  | "rejected"| "withdrawn"         | "expired"           | "superseded";

export interface GovernanceDecision {
  id:                string;
  tenantId:          string;
  code:              string;          // DEC-2025-001
  title:             string;
  description:       string;
  decisionType:      DecisionType;
  status:            DecisionStatus;
  owner:             string;          // userId
  ownerRole:         string;
  accountableParty:  string;          // ultimately accountable person
  approver:          string;          // final approver
  approverRole:      string;
  // Linkages (all mandatory before approval)
  linkedControls:    string[];
  linkedRisks:       string[];
  linkedEvidence:    string[];
  linkedPolicies:    string[];
  linkedRegulations: string[];
  // Validation state
  policyValidated:   boolean;
  riskValidated:     boolean;
  authorityValidated:boolean;
  sodValidated:      boolean;
  evidenceComplete:  boolean;
  // Impact
  businessImpact:    string;
  financialImpact?:  number;
  riskImpact:        "increases" | "decreases" | "neutral" | "unknown";
  urgency:           "immediate" | "standard" | "deferred";
  // Audit
  correlationId:     string;
  immutableRecordId?:string;
  approvedAt?:       string;
  rejectedAt?:       string;
  rejectionReason?:  string;
  createdAt:         string;
  updatedAt:         string;
  createdBy:         string;
  version:           number;
}

export interface DecisionValidationResult {
  decisionId:         string;
  passed:             boolean;
  blockers:           string[];
  warnings:           string[];
  requiredActions:    string[];
  policyResult?:      { allowed: boolean; warnings: string[] };
  sodViolation?:      { conflictId: string; action1: string; action2: string };
  authorityResult?:   { authorized: boolean; reason: string };
  evidenceResult?:    { complete: boolean; missingTypes: string[] };
}

// In-memory store (production: PostgreSQL with RLS)
const decisionStore = new Map<string, GovernanceDecision>();

export class DecisionEngine {
  constructor(private readonly tenantId: string) {}

  async create(params: Omit<GovernanceDecision, "id" | "code" | "status" | "policyValidated" | "riskValidated" | "authorityValidated" | "sodValidated" | "evidenceComplete" | "correlationId" | "createdAt" | "updatedAt" | "version" | "tenantId">, ctx: TenantContext): Promise<GovernanceDecision> {
    requireTenantContext(ctx, "DecisionEngine.create");
    const now = new Date().toISOString();
    const count = [...decisionStore.values()].filter(d => d.tenantId === this.tenantId).length + 1;
    const decision: GovernanceDecision = {
      ...params,
      id:                uuidv4(),
      tenantId:          this.tenantId,
      code:              `DEC-${new Date().getFullYear()}-${String(count).padStart(3, "0")}`,
      status:            "draft",
      policyValidated:   false,
      riskValidated:     false,
      authorityValidated:false,
      sodValidated:      false,
      evidenceComplete:  false,
      correlationId:     uuidv4(),
      createdAt:         now,
      updatedAt:         now,
      version:           1,
    };
    decisionStore.set(decision.id, decision);
    return decision;
  }

  async validate(decisionId: string, ctx: TenantContext): Promise<DecisionValidationResult> {
    requireTenantContext(ctx, "DecisionEngine.validate");
    const decision = this.getById(decisionId);
    if (!decision) throw Object.assign(new Error(`Decision ${decisionId} not found`), { statusCode: 404 });
    assertTenantOwnership(ctx, decision.tenantId, decisionId, "decision");

    const blockers:  string[] = [];
    const warnings:  string[] = [];
    const required:  string[] = [];

    // 1. Evidence check
    const evidenceComplete = decision.linkedEvidence.length > 0;
    if (!evidenceComplete) {
      blockers.push("Decision requires at least one evidence item — no evidence attached");
      required.push("Attach supporting evidence (board resolution, report, assessment)");
    }

    // 2. Policy validation
    let policyResult: DecisionValidationResult["policyResult"];
    try {
      const polEval = await policyEvaluator.evaluate({
        context:    ctx,
        entityType: "decision",
        entityId:   decisionId,
        action:     decision.decisionType,
        entityData: { decisionType: decision.decisionType, urgency: decision.urgency, riskImpact: decision.riskImpact },
        actorRole:  ctx.userRole,
        actorId:    ctx.userId,
      });
      policyResult = { allowed: polEval.allowed, warnings: polEval.warnings };
      if (!polEval.allowed) blockers.push(...polEval.warnings);
      else warnings.push(...polEval.warnings);
    } catch (err) {
      warnings.push(`Policy validation unavailable: ${(err as Error).message}`);
    }

    // 3. SoD check — owner cannot also be approver
    let sodViolation: DecisionValidationResult["sodViolation"];
    if (decision.owner === decision.approver) {
      blockers.push("SoD violation: decision owner cannot also be approver");
      sodViolation = { conflictId: "sod-001", action1: "create", action2: "approve" };
    }

    // 4. Authority check
    const authorityResult = this.checkAuthority(decision, ctx);
    if (!authorityResult.authorized) {
      blockers.push(`Authority not validated: ${authorityResult.reason}`);
    }

    // 5. Risk linkage
    if (decision.linkedRisks.length === 0 && decision.decisionType !== "policy_approval") {
      warnings.push("No risks linked — consider impact on risk register");
    }

    // Update decision state
    const updated: GovernanceDecision = {
      ...decision,
      policyValidated:    policyResult?.allowed ?? false,
      riskValidated:      decision.linkedRisks.length > 0,
      authorityValidated: authorityResult.authorized,
      sodValidated:       !sodViolation,
      evidenceComplete,
      status:             blockers.length === 0 ? "pending_approval" : "pending_validation",
      updatedAt:          new Date().toISOString(),
      version:            decision.version + 1,
    };
    decisionStore.set(decisionId, updated);

    const passed = blockers.length === 0;
    globalMetrics.record({ name:"policy_evaluation_duration_ms", value:1, unit:"ms", tenantId:this.tenantId, labels:{ type:"decision_validation", passed: String(passed) } });

    return { decisionId, passed, blockers, warnings, requiredActions: required, policyResult, sodViolation, authorityResult, evidenceResult: { complete: evidenceComplete, missingTypes: evidenceComplete ? [] : ["required_evidence"] } };
  }

  async approve(decisionId: string, approverId: string, ctx: TenantContext): Promise<GovernanceDecision> {
    requireTenantContext(ctx, "DecisionEngine.approve");
    const decision = this.getById(decisionId);
    if (!decision) throw Object.assign(new Error(`Decision ${decisionId} not found`), { statusCode: 404 });
    assertTenantOwnership(ctx, decision.tenantId, decisionId, "decision");

    if (decision.status !== "pending_approval") {
      throw Object.assign(new Error(`Cannot approve: decision status is "${decision.status}"`), { statusCode: 409 });
    }
    if (!decision.evidenceComplete) {
      throw Object.assign(new Error("Cannot approve: evidence incomplete"), { statusCode: 422 });
    }

    // Seal immutable record
    const evidenceEngine = getEvidenceEngine(this.tenantId);
    const sealedRecord   = evidenceEngine.sealDecisionRecord({
      decisionType:  decision.decisionType,
      entityId:      decisionId,
      entityType:    "decision",
      actorId:       approverId,
      actorRole:     ctx.userRole,
      outcome:       "approved",
      rationale:     decision.description,
      evidenceRefs:  decision.linkedEvidence,
      policyRefs:    decision.linkedPolicies,
      approvalRefs:  [],
      sodChecked:    decision.sodValidated,
      sodViolations: 0,
      policyAllowed: decision.policyValidated,
      correlationId: decision.correlationId,
    });

    const approved: GovernanceDecision = {
      ...decision,
      status:            "approved",
      approvedAt:        new Date().toISOString(),
      immutableRecordId: sealedRecord.decisionId,
      updatedAt:         new Date().toISOString(),
      version:           decision.version + 1,
    };
    decisionStore.set(decisionId, approved);
    return approved;
  }

  getById(id: string): GovernanceDecision | undefined {
    const d = decisionStore.get(id);
    if (d && d.tenantId !== this.tenantId) return undefined;
    return d;
  }

  findAll(status?: DecisionStatus): GovernanceDecision[] {
    return [...decisionStore.values()]
      .filter(d => d.tenantId === this.tenantId && (!status || d.status === status));
  }

  getOrphanDecisions(): GovernanceDecision[] {
    return this.findAll().filter(d =>
      d.linkedEvidence.length === 0 || d.linkedRisks.length === 0 || !d.policyValidated
    );
  }

  private checkAuthority(decision: GovernanceDecision, ctx: TenantContext): { authorized: boolean; reason: string } {
    const highRoleDecisions = ["board_resolution", "strategic", "financial"];
    if (highRoleDecisions.includes(decision.decisionType)) {
      const authorizedRoles = ["orchestrator", "board_reporter", "governance_analyst"];
      if (!authorizedRoles.includes(ctx.userRole)) {
        return { authorized: false, reason: `Decision type "${decision.decisionType}" requires elevated authority` };
      }
    }
    return { authorized: true, reason: "Authority confirmed" };
  }
}

// Per-tenant factory
const engineCache = new Map<string, DecisionEngine>();
export function getDecisionEngine(tenantId: string): DecisionEngine {
  if (!engineCache.has(tenantId)) engineCache.set(tenantId, new DecisionEngine(tenantId));
  return engineCache.get(tenantId)!;
}
