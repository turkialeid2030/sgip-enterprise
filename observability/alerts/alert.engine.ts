/**
 * Alert Engine — threshold-based governance alerts.
 * Monitors key metrics and fires alerts when thresholds are breached.
 */
import { v4 as uuidv4 } from "uuid";
import { MetricName } from "../../types/observability.types";
import { globalMetrics } from "../metrics/governance.metrics";

export interface AlertRule {
  id:          string;
  name:        string;
  metricName:  MetricName;
  operator:    ">" | ">=" | "<" | "<=" | "==" | "!=";
  threshold:   number;
  severity:    "critical" | "high" | "medium" | "low";
  cooldownMs:  number;   // suppress repeated alerts
  tenantId:    string;
}

export interface Alert {
  id:          string;
  ruleId:      string;
  ruleName:    string;
  tenantId:    string;
  metricName:  MetricName;
  actualValue: number;
  threshold:   number;
  severity:    AlertRule["severity"];
  firedAt:     string;
  resolvedAt?: string;
  resolved:    boolean;
}

const alertRules  = new Map<string, AlertRule>();
const activeAlerts: Alert[] = [];
const lastFiredAt = new Map<string, number>();  // ruleId → timestamp
const MAX_ALERTS  = 500;

export const BUILTIN_ALERT_RULES: Omit<AlertRule, "tenantId">[] = [
  { id:"al-001", name:"Critical Risk Tolerance Breach",         metricName:"policy_block_rate",                operator:">",  threshold:10, severity:"critical", cooldownMs:300000 },
  { id:"al-002", name:"SoD Violation Spike",                    metricName:"sod_violation_count",              operator:">",  threshold:5,  severity:"high",     cooldownMs:300000 },
  { id:"al-003", name:"Approval SLA Breach",                    metricName:"approval_sla_breach_count",        operator:">",  threshold:3,  severity:"high",     cooldownMs:600000 },
  { id:"al-004", name:"Evidence Integrity Degraded",            metricName:"evidence_integrity_score",         operator:"<",  threshold:80, severity:"high",     cooldownMs:600000 },
  { id:"al-005", name:"Tenant Isolation Violation",             metricName:"tenant_isolation_violation_count", operator:">",  threshold:1,  severity:"critical", cooldownMs:60000  },
  { id:"al-006", name:"Slow Policy Evaluation",                 metricName:"policy_evaluation_duration_ms",    operator:">",  threshold:5000, severity:"medium", cooldownMs:300000 },
  { id:"al-007", name:"Control Effectiveness Below Threshold",  metricName:"control_effectiveness_avg",        operator:"<",  threshold:60, severity:"high",     cooldownMs:600000 },
];

export class AlertEngine {
  registerBuiltinRules(tenantId: string): void {
    for (const rule of BUILTIN_ALERT_RULES) {
      alertRules.set(`${tenantId}:${rule.id}`, { ...rule, tenantId });
    }
  }

  registerRule(rule: AlertRule): void {
    alertRules.set(`${rule.tenantId}:${rule.id}`, rule);
  }

  evaluate(tenantId: string): Alert[] {
    const newAlerts: Alert[] = [];
    for (const [key, rule] of alertRules) {
      if (!key.startsWith(tenantId)) continue;
      const agg   = globalMetrics.getAggregate(tenantId, rule.metricName, 300000); // 5-min window
      if (agg.count === 0) continue;

      const value = agg.avg;
      const fires = this.compare(value, rule.operator, rule.threshold);
      if (!fires) continue;

      // Cooldown check
      const last = lastFiredAt.get(key) ?? 0;
      if (Date.now() - last < rule.cooldownMs) continue;

      const alert: Alert = {
        id:          uuidv4(),
        ruleId:      rule.id,
        ruleName:    rule.name,
        tenantId,
        metricName:  rule.metricName,
        actualValue: value,
        threshold:   rule.threshold,
        severity:    rule.severity,
        firedAt:     new Date().toISOString(),
        resolved:    false,
      };
      if (activeAlerts.length >= MAX_ALERTS) activeAlerts.shift();
      activeAlerts.push(alert);
      lastFiredAt.set(key, Date.now());
      newAlerts.push(alert);
    }
    return newAlerts;
  }

  getActiveAlerts(tenantId: string): Alert[] {
    return activeAlerts.filter(a => a.tenantId === tenantId && !a.resolved);
  }

  resolveAlert(alertId: string, tenantId: string): void {
    const a = activeAlerts.find(x => x.id === alertId && x.tenantId === tenantId);
    if (a) { a.resolved = true; a.resolvedAt = new Date().toISOString(); }
  }

  private compare(actual: number, op: AlertRule["operator"], threshold: number): boolean {
    switch (op) {
      case ">":  return actual >  threshold;
      case ">=": return actual >= threshold;
      case "<":  return actual <  threshold;
      case "<=": return actual <= threshold;
      case "==": return actual === threshold;
      case "!=": return actual !== threshold;
    }
  }
}

export const globalAlertEngine = new AlertEngine();
