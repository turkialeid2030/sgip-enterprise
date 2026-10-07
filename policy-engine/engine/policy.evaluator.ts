/**
 * Policy Evaluator — core governance runtime engine.
 * Evaluates ALL governance actions against active policies.
 * Hard rules block. Soft rules warn. All evaluations are audited.
 */
import { v4 as uuidv4 } from "uuid";
import {
  GovernancePolicy, PolicyEvaluationRequest, PolicyEvaluationResult,
  PolicyRule, PolicyCondition, PolicyAction,
} from "../../types/policy.types";
import { TenantContext } from "../../types/tenant.types";
import { query } from "../../api/services/db.service";
import { requireTenantContext } from "../../tenant/tenant.context";

const policyCache = new Map<string, { policies: GovernancePolicy[]; fetchedAt: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000;

export class PolicyEvaluator {
  async evaluate(req: PolicyEvaluationRequest): Promise<PolicyEvaluationResult> {
    requireTenantContext(req.context, "PolicyEvaluator.evaluate");
    const traceId = uuidv4();
    const policies = await this.loadActivePolicies(req.context);
    const applicable = this.filterApplicable(policies, req);

    const hardBlocks:      string[]       = [];
    const warnings:        string[]       = [];
    const requiredActions: PolicyAction[] = [];
    const appliedRules:    string[]       = [];
    const policyRefs:      string[]       = [];

    for (const policy of applicable) {
      policyRefs.push(policy.id);
      const sortedRules = [...(Array.isArray(policy.rules) ? policy.rules : [])].sort((a, b) => a.priority - b.priority);
      for (const rule of sortedRules) {
        if (!this.triggerMatches(rule, req)) continue;
        appliedRules.push(rule.id);
        if (rule.isHard) {
          hardBlocks.push(`[${policy.code}] ${rule.description}`);
        } else {
          warnings.push(`[WARN][${policy.code}] ${rule.description}`);
        }
        if (["require_approval","require_evidence","notify"].includes(rule.action.type)) {
          requiredActions.push(rule.action);
        }
      }
    }

    const isBlocked = hardBlocks.length > 0;
    const allWarnings = [...hardBlocks, ...warnings];
    const result: PolicyEvaluationResult = {
      allowed: !isBlocked, blocked: isBlocked,
      warnings: allWarnings, requiredActions, appliedRules, policyRefs,
      confidenceScore: applicable.length === 0 ? 100 : 85,
      evaluatedAt: new Date().toISOString(), traceId,
    };

    await this.persistEvaluation(req, result).catch((err: Error) => {
      console.error("[PolicyEvaluator] Persist failed:", err.message);
    });
    return result;
  }

  invalidateCache(tenantId: string): void {
    policyCache.delete(`policies:${tenantId}`);
  }

  private async loadActivePolicies(ctx: TenantContext): Promise<GovernancePolicy[]> {
    const cacheKey = `policies:${ctx.tenantId}`;
    const cached   = policyCache.get(cacheKey);
    if (cached && (Date.now() - cached.fetchedAt) < CACHE_TTL_MS) return cached.policies;
    try {
      const rows = await query<Record<string, unknown>>(
        `SELECT * FROM "GovernancePolicy"
         WHERE "tenantId" = $1 AND status IN ('active','approved')
           AND ("effectiveTo" IS NULL OR "effectiveTo" > NOW())
         ORDER BY "updatedAt" DESC`,
        [ctx.tenantId],
      );
      const policies = (rows as unknown as GovernancePolicy[]).map(r => ({
        ...r,
        versions: Array.isArray(r.versions) ? r.versions : [],
        rules: Array.isArray(r.rules) ? r.rules : [],
        approvalChain: Array.isArray(r.approvalChain) ? r.approvalChain : [],
        scope: r.scope ?? {},
      }));
      policyCache.set(cacheKey, { policies, fetchedAt: Date.now() });
      return policies;
    } catch (err) {
      console.warn("[PolicyEvaluator] DB unavailable:", (err as Error).message);
      return [];
    }
  }

  private filterApplicable(policies: GovernancePolicy[], req: PolicyEvaluationRequest): GovernancePolicy[] {
    return policies.filter(p => {
      const scope = p.scope;
      if (!scope) return true;
      if ((scope.entityTypes ?? []).length > 0 && !scope.entityTypes.includes(req.entityType)) return false;
      if ((scope.roles ?? []).length > 0 && !scope.roles.includes(req.actorRole)) return false;
      if ((scope.conditions ?? []).length > 0) return this.evalConditions(scope.conditions, req.entityData);
      return true;
    });
  }

  private triggerMatches(rule: PolicyRule, req: PolicyEvaluationRequest): boolean {
    const t = rule.trigger;
    switch (t.type) {
      case "entity_created":   return t.entityType === req.entityType && req.action === "create";
      case "entity_updated":   return t.entityType === req.entityType && req.action === "update";
      case "status_change":    return req.action === "status_change" && req.entityData["fromStatus"] === t.from && req.entityData["toStatus"] === t.to;
      case "risk_threshold":   return req.entityData["riskLevel"] === t.level;
      case "action_requested": return req.action === t.action;
      default: return false;
    }
  }

  private evalConditions(conditions: PolicyCondition[], data: Record<string, unknown>): boolean {
    for (const c of conditions) {
      const v = data[c.field];
      const ok = this.compare(v, c.operator, c.value);
      if (c.logicOp === "OR" && ok) return true;
      if (c.logicOp !== "OR" && !ok) return false;
    }
    return true;
  }

  private compare(actual: unknown, op: PolicyCondition["operator"], expected: unknown): boolean {
    switch (op) {
      case "eq":      return actual === expected;
      case "neq":     return actual !== expected;
      case "gt":      return (actual as number) >  (expected as number);
      case "gte":     return (actual as number) >= (expected as number);
      case "lt":      return (actual as number) <  (expected as number);
      case "lte":     return (actual as number) <= (expected as number);
      case "in":      return Array.isArray(expected) && expected.includes(actual);
      case "not_in":  return Array.isArray(expected) && !expected.includes(actual);
      case "contains":return typeof actual === "string" && actual.includes(expected as string);
      default: return false;
    }
  }

  private async persistEvaluation(req: PolicyEvaluationRequest, result: PolicyEvaluationResult): Promise<void> {
    await query(
      `INSERT INTO "PolicyEvaluation"
       (id,"tenantId","entityType","entityId",action,"actorId","actorRole",
        allowed,blocked,warnings,"appliedRules","policyRefs","confidenceScore","traceId")
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [uuidv4(), req.context.tenantId, req.entityType, req.entityId ?? null,
       req.action, req.actorId, req.actorRole,
       result.allowed, result.blocked, result.warnings,
       result.appliedRules, result.policyRefs, result.confidenceScore, result.traceId],
    );
  }
}

export const policyEvaluator = new PolicyEvaluator();
