/**
 * Policy DSL — Executable governance rules in a typed language.
 *
 * Syntax examples:
 *   IF vendor.riskScore > 80 THEN require_board_approval
 *   IF unresolvedCriticalFindings > 0 THEN block_audit_closure
 *   IF segregationViolationDetected THEN escalate_to_committee
 *
 * Supports: versioning, simulation mode, dry-run, conflict detection.
 */
import { PolicyEvaluationRequest, PolicyEvaluationResult } from "../../types/policy.types";
import { TenantContext } from "../../types/tenant.types";

// ── DSL AST Types ──────────────────────────────────────────────
export type DSLConditionOp = ">" | ">=" | "<" | "<=" | "==" | "!=" | "contains" | "not_contains";
export type DSLActionType  =
  | "require_board_approval" | "require_committee_approval" | "block"
  | "escalate_to_committee"  | "require_evidence"           | "notify"
  | "auto_tag"               | "set_risk_level"             | "create_capa";

export interface DSLCondition {
  field:    string;
  operator: DSLConditionOp;
  value:    unknown;
  negate?:  boolean;
}

export interface DSLRule {
  id:          string;
  name:        string;
  description: string;
  version:     string;
  conditions:  DSLCondition[];
  logicOp:     "AND" | "OR";
  action:      DSLActionType;
  actionParams?:Record<string, unknown>;
  priority:    number;         // 1 = highest
  isHard:      boolean;        // hard blocks; soft warns
  tags:        string[];
  effectiveFrom:string;
  effectiveTo?: string;
  tenantId:    string;
}

export interface DSLEvaluationResult {
  ruleId:     string;
  ruleName:   string;
  fired:      boolean;
  blocked:    boolean;
  dryRun:     boolean;
  action?:    DSLActionType;
  reason?:    string;
  matchedConditions: DSLCondition[];
}

export interface DSLExecutionResult {
  results:    DSLEvaluationResult[];
  anyBlocked: boolean;
  anyFired:   boolean;
  dryRun:     boolean;
  summary:    string;
}

// ── DSL Parser — text to AST ───────────────────────────────────
export class DSLParser {
  /**
   * Parse a text rule into a DSLRule AST.
   * Format: IF <field> <op> <value> [AND|OR <field> <op> <value>] THEN <action>
   *
   * Examples:
   *   IF vendor.riskScore > 80 THEN require_board_approval
   *   IF control.effectiveness < 60 AND control.type == "critical" THEN block
   *   IF finding.severity == "critical" OR finding.overdue == true THEN escalate_to_committee
   */
  parse(text: string, meta: { id: string; tenantId: string; version?: string }): DSLRule {
    const normalized = text.trim().toUpperCase();
    const ifIdx  = normalized.indexOf("IF ");
    const thenIdx= normalized.indexOf(" THEN ");
    if (ifIdx === -1 || thenIdx === -1) {
      throw new Error(`DSL parse error: expected "IF ... THEN ..." in: ${text}`);
    }

    const conditionText = text.slice(ifIdx + 3, thenIdx).trim();
    const actionText    = text.slice(thenIdx + 6).trim().toLowerCase().replace(/\s+/g, "_");

    // Parse conditions (split by AND/OR)
    const logicOp: "AND" | "OR" = conditionText.toUpperCase().includes(" OR ") ? "OR" : "AND";
    const parts = conditionText.split(/\s+(?:AND|OR)\s+/i);
    const conditions: DSLCondition[] = parts.map(part => this.parseCondition(part.trim()));

    const action = this.parseAction(actionText);

    return {
      id:           meta.id,
      name:         text.slice(0, 60),
      description:  text,
      version:      meta.version ?? "1.0",
      conditions,
      logicOp,
      action,
      priority:     5,
      isHard:       ["block", "require_board_approval"].includes(action),
      tags:         [],
      effectiveFrom:new Date().toISOString(),
      tenantId:     meta.tenantId,
    };
  }

  private parseCondition(text: string): DSLCondition {
    const ops: DSLConditionOp[] = [">=", "<=", "!=", ">", "<", "==", "contains", "not_contains"];
    for (const op of ops) {
      const idx = text.indexOf(op);
      if (idx === -1) continue;
      const field = text.slice(0, idx).trim();
      const rawValue = text.slice(idx + op.length).trim().replace(/^["']|["']$/g, "");
      const value: unknown = rawValue === "true" ? true : rawValue === "false" ? false : !isNaN(Number(rawValue)) ? Number(rawValue) : rawValue;
      return { field, operator: op, value };
    }
    // Boolean field (e.g. "overdue", "toleranceBreached")
    const negate = text.trim().toUpperCase().startsWith("NOT ");
    const field  = negate ? text.slice(4).trim() : text.trim();
    return { field, operator: "==", value: true, negate };
  }

  private parseAction(text: string): DSLActionType {
    const map: Record<string, DSLActionType> = {
      require_board_approval: "require_board_approval",
      require_committee_approval: "require_committee_approval",
      block: "block",
      escalate_to_committee: "escalate_to_committee",
      require_evidence: "require_evidence",
      notify: "notify",
      auto_tag: "auto_tag",
      set_risk_level: "set_risk_level",
      create_capa: "create_capa",
    };
    const normalized = text.toLowerCase().replace(/\s+/g, "_");
    return map[normalized] ?? "notify";
  }
}

// ── DSL Executor ──────────────────────────────────────────────
export class DSLExecutor {
  private readonly rules = new Map<string, DSLRule>();

  registerRule(rule: DSLRule): void {
    this.rules.set(rule.id, rule);
  }

  unregisterRule(ruleId: string): void {
    this.rules.delete(ruleId);
  }

  execute(
    context: Record<string, unknown>,
    tenantId: string,
    options: { dryRun?: boolean; tags?: string[] } = {},
  ): DSLExecutionResult {
    const dryRun  = options.dryRun ?? false;
    const results: DSLEvaluationResult[] = [];
    const now = new Date().toISOString();

    const applicableRules = [...this.rules.values()]
      .filter(r => r.tenantId === tenantId)
      .filter(r => !r.effectiveTo || r.effectiveTo > now)
      .filter(r => r.effectiveFrom <= now)
      .filter(r => !options.tags?.length || r.tags.some(t => options.tags!.includes(t)))
      .sort((a, b) => a.priority - b.priority);

    for (const rule of applicableRules) {
      const matched = this.evaluateConditions(rule, context);
      if (!matched.fired) {
        results.push({ ruleId: rule.id, ruleName: rule.name, fired: false, blocked: false, dryRun, matchedConditions: [] });
        continue;
      }
      const blocked = rule.isHard && !dryRun;
      results.push({
        ruleId:   rule.id,
        ruleName: rule.name,
        fired:    true,
        blocked,
        dryRun,
        action:   rule.action,
        reason:   rule.description,
        matchedConditions: matched.conditions,
      });
      if (rule.isHard && !dryRun) break; // hard block — stop evaluation
    }

    const anyBlocked = results.some(r => r.blocked);
    const anyFired   = results.some(r => r.fired);
    const summary    = anyBlocked
      ? `BLOCKED: ${results.filter(r => r.blocked).map(r => r.ruleName).join("; ")}`
      : anyFired
      ? `WARNED: ${results.filter(r => r.fired && !r.blocked).map(r => r.ruleName).join("; ")}`
      : "ALLOWED: no rules fired";

    return { results, anyBlocked, anyFired, dryRun, summary };
  }

  detectConflicts(): Array<{ rule1: string; rule2: string; reason: string }> {
    const conflicts: Array<{ rule1: string; rule2: string; reason: string }> = [];
    const ruleList = [...this.rules.values()];
    for (let i = 0; i < ruleList.length; i++) {
      for (let j = i + 1; j < ruleList.length; j++) {
        const a = ruleList[i];
        const b = ruleList[j];
        if (a.tenantId !== b.tenantId) continue;
        // Same condition field but contradictory actions
        const sharedFields = a.conditions.map(c => c.field).filter(f => b.conditions.some(c => c.field === f));
        if (sharedFields.length > 0 && a.action !== b.action && a.isHard !== b.isHard) {
          conflicts.push({ rule1: a.id, rule2: b.id, reason: `Conflicting actions on fields: ${sharedFields.join(", ")}` });
        }
      }
    }
    return conflicts;
  }

  getRules(tenantId: string): DSLRule[] {
    return [...this.rules.values()].filter(r => r.tenantId === tenantId);
  }

  private evaluateConditions(rule: DSLRule, context: Record<string, unknown>): { fired: boolean; conditions: DSLCondition[] } {
    const matched: DSLCondition[] = [];
    const results: boolean[] = rule.conditions.map(cond => {
      const fieldValue = this.getField(context, cond.field);
      const result = this.compare(fieldValue, cond.operator, cond.value);
      const final  = cond.negate ? !result : result;
      if (final) matched.push(cond);
      return final;
    });
    const fired = rule.logicOp === "OR" ? results.some(Boolean) : results.every(Boolean);
    return { fired, conditions: matched };
  }

  private getField(context: Record<string, unknown>, field: string): unknown {
    return field.split(".").reduce((obj, key) => (obj as Record<string, unknown>)?.[key], context as unknown);
  }

  private compare(actual: unknown, op: DSLConditionOp, expected: unknown): boolean {
    switch (op) {
      case "==":          return actual === expected;
      case "!=":          return actual !== expected;
      case ">":           return (actual as number)  >  (expected as number);
      case ">=":          return (actual as number)  >= (expected as number);
      case "<":           return (actual as number)  <  (expected as number);
      case "<=":          return (actual as number)  <= (expected as number);
      case "contains":    return String(actual).toLowerCase().includes(String(expected).toLowerCase());
      case "not_contains":return !String(actual).toLowerCase().includes(String(expected).toLowerCase());
      default:            return false;
    }
  }
}

export const globalDSLParser   = new DSLParser();
export const globalDSLExecutor = new DSLExecutor();
