/**
 * Policy Service — CRUD + lifecycle management for GovernancePolicy.
 * Uses TenantAwareRepository pattern for isolation.
 */
import { v4 as uuidv4 } from "uuid";
import { GovernancePolicy } from "../../types/policy.types";
import { TenantContext } from "../../types/tenant.types";
import { TenantAwareRepository } from "../../tenant/tenant.repository";
import { query } from "../../api/services/db.service";
import { policyEvaluator } from "../engine/policy.evaluator";
import { requireTenantContext } from "../../tenant/tenant.context";

class PolicyRepository extends TenantAwareRepository<GovernancePolicy & { tenantId: string }> {
  constructor() { super("GovernancePolicy"); }
}

const repo = new PolicyRepository();

export const PolicyService = {
  /**
   * V5.2A: tx-aware variant. When `tx` is supplied the INSERT runs on the
   * caller's transaction so the policy and its audit event commit together.
   * Passing no tx keeps the previous standalone behaviour.
   */
  async createIn(tx: { query: (sql: string, p?: unknown[]) => Promise<unknown> },
                 data: Partial<GovernancePolicy>, ctx: TenantContext): Promise<GovernancePolicy> {
    return this.create(data, ctx, tx);
  },

  async create(data: Partial<GovernancePolicy>, ctx: TenantContext,
               tx?: { query: (sql: string, p?: unknown[]) => Promise<unknown> }): Promise<GovernancePolicy> {
    requireTenantContext(ctx, "PolicyService.create");
    const now = new Date().toISOString();
    const id  = uuidv4();

    const policy: GovernancePolicy = {
      id, tenantId: ctx.tenantId,
      code:             data.code            ?? `POL-${id.slice(0,8).toUpperCase()}`,
      title:            data.title           ?? "Untitled Policy",
      description:      data.description     ?? "",
      category:         data.category        ?? "governance",
      status:           "draft",
      currentVersion:   "1.0.0",
      versions:         [{ version: "1.0.0", effectiveFrom: now, changedBy: ctx.userId, changeReason: "Initial draft" }],
      parentPolicyId:   data.parentPolicyId,
      childPolicyIds:   [],
      linkedRegulations:data.linkedRegulations ?? [],
      linkedControls:   data.linkedControls   ?? [],
      linkedRisks:      data.linkedRisks      ?? [],
      scope:            data.scope            ?? { entityTypes:[], departments:[], roles:[], riskLevels:[], conditions:[] },
      rules:            data.rules            ?? [],
      approvalChain:    data.approvalChain    ?? [],
      effectiveFrom:    data.effectiveFrom    ?? now,
      effectiveTo:      data.effectiveTo,
      reviewCycle:      data.reviewCycle      ?? "annual",
      nextReviewAt:     data.nextReviewAt     ?? new Date(Date.now() + 365*86400*1000).toISOString(),
      freshnessScore:   100,
      hasConflicts:     false,
      conflictsWith:    [],
      createdBy:        ctx.userId,
      updatedBy:        ctx.userId,
      createdAt:        now,
      updatedAt:        now,
    };

    const exec = tx ? (sql: string, p?: unknown[]) => tx.query(sql, p) : query;
    await exec(
      `INSERT INTO "GovernancePolicy"
       (id,"tenantId",code,title,description,category,status,"currentVersion",
        versions,"parentPolicyId","childPolicyIds","linkedRegulations",
        "linkedControls","linkedRisks",scope,rules,"approvalChain",
        "effectiveFrom","effectiveTo","reviewCycle","nextReviewAt",
        "freshnessScore","hasConflicts","conflictsWith",
        "createdBy","updatedBy")
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26)`,
      [policy.id, policy.tenantId, policy.code, policy.title, policy.description,
       policy.category, policy.status, policy.currentVersion,
       JSON.stringify(policy.versions), policy.parentPolicyId ?? null,
       policy.childPolicyIds, policy.linkedRegulations,
       policy.linkedControls, policy.linkedRisks,
       JSON.stringify(policy.scope), JSON.stringify(policy.rules),
       JSON.stringify(policy.approvalChain),
       policy.effectiveFrom, policy.effectiveTo ?? null,
       policy.reviewCycle, policy.nextReviewAt,
       policy.freshnessScore, policy.hasConflicts, policy.conflictsWith,
       policy.createdBy, policy.updatedBy],
    );
    return policy;
  },

  async findById(id: string, ctx: TenantContext): Promise<GovernancePolicy | null> {
    return repo.findById(id, ctx) as Promise<GovernancePolicy | null>;
  },

  async findAll(ctx: TenantContext, filter?: { status?: string; category?: string }): Promise<GovernancePolicy[]> {
    return repo.findMany(ctx, filter ?? {}) as Promise<GovernancePolicy[]>;
  },

  async activateIn(tx: { query: (sql: string, p?: unknown[]) => Promise<unknown> },
                 id: string, ctx: TenantContext): Promise<void> {
    requireTenantContext(ctx, "PolicyService.activateIn");
    // INVARIANT: at most one ACTIVE policy per (tenant, code).
    // Retiring the previous version and activating this one happen in the SAME
    // transaction as the audit event, so a partial failure can never leave two
    // active versions.
    const rows = await tx.query(
      `SELECT code FROM "GovernancePolicy" WHERE id = $1 AND "tenantId" = $2`,
      [id, ctx.tenantId]) as Array<{ code: string }>;
    const code = rows?.[0]?.code;
    if (code) {
      await tx.query(
        `UPDATE "GovernancePolicy" SET status = 'superseded', "updatedAt" = NOW()
          WHERE "tenantId" = $1 AND code = $2 AND id <> $3 AND status = 'active'`,
        [ctx.tenantId, code, id]);
    }
    await tx.query(
      `UPDATE "GovernancePolicy" SET status = $1, "updatedAt" = NOW()
        WHERE id = $2 AND "tenantId" = $3`, ["active", id, ctx.tenantId]);
  },

  async activate(id: string, ctx: TenantContext): Promise<void> {
    requireTenantContext(ctx, "PolicyService.activate");
    await repo.assertOwnership(id, ctx);
    await query(
      `UPDATE "GovernancePolicy" SET status = 'active', "updatedBy" = $1, "updatedAt" = NOW() WHERE id = $2`,
      [ctx.userId, id],
    );
    policyEvaluator.invalidateCache(ctx.tenantId);
  },

  async retireIn(tx: { query: (sql: string, p?: unknown[]) => Promise<unknown> },
                 id: string, ctx: TenantContext): Promise<void> {
    requireTenantContext(ctx, "PolicyService.retireIn");
    await tx.query(
      `UPDATE "GovernancePolicy" SET status = $1, "updatedAt" = NOW()
        WHERE id = $2 AND "tenantId" = $3`, ["retired", id, ctx.tenantId]);
  },

  async retire(id: string, ctx: TenantContext): Promise<void> {
    requireTenantContext(ctx, "PolicyService.retire");
    await repo.assertOwnership(id, ctx);
    await query(
      `UPDATE "GovernancePolicy" SET status = 'retired', "effectiveTo" = NOW(), "updatedBy" = $1, "updatedAt" = NOW() WHERE id = $2`,
      [ctx.userId, id],
    );
    policyEvaluator.invalidateCache(ctx.tenantId);
  },

  async detectConflicts(id: string, ctx: TenantContext): Promise<string[]> {
    requireTenantContext(ctx, "PolicyService.detectConflicts");
    const policy = await this.findById(id, ctx);
    if (!policy) return [];
    // Find policies with overlapping scope and conflicting rules
    const others = await this.findAll(ctx, { status: "active" });
    const conflicts: string[] = [];
    for (const other of others) {
      if (other.id === id) continue;
      const sharedRegs = policy.linkedRegulations.filter(r => other.linkedRegulations.includes(r));
      if (sharedRegs.length > 0 && other.category === policy.category) {
        conflicts.push(other.id);
      }
    }
    if (conflicts.length > 0) {
      await query(
        `UPDATE "GovernancePolicy" SET "hasConflicts" = true, "conflictsWith" = $1 WHERE id = $2`,
        [conflicts, id],
      );
    }
    return conflicts;
  },
};
