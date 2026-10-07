/**
 * Health Monitor — checks all system components and returns structured health report.
 */
import { ServiceHealth, HealthCheck } from "../../types/observability.types";
import { query } from "../../api/services/db.service";

export class HealthMonitor {
  async getSystemHealth(): Promise<ServiceHealth> {
    const checks: HealthCheck[] = await Promise.all([
      this.checkDatabase(),
      this.checkGraphEngine(),
      this.checkPolicyEngine(),
      this.checkEvidenceEngine(),
    ]);

    const failCount = checks.filter(c => c.status === "fail").length;
    const warnCount = checks.filter(c => c.status === "warn").length;
    const status = failCount > 0 ? "unhealthy" : warnCount > 0 ? "degraded" : "healthy";

    return {
      service:   "sgip-runtime",
      status,
      checks,
      version:   "4.0.0",
      uptime:    process.uptime(),
      timestamp: new Date().toISOString(),
    };
  }

  private async checkDatabase(): Promise<HealthCheck> {
    const start = Date.now();
    try {
      await query("SELECT 1");
      return { name: "postgresql", status: "pass", latencyMs: Date.now() - start };
    } catch (err) {
      return { name: "postgresql", status: "fail", message: (err as Error).message };
    }
  }

  private checkGraphEngine(): HealthCheck {
    try {
      const { getGraphRuntime } = require("../../graph/runtime/governance.graph.runtime");
      const runtime = getGraphRuntime("health-check");
      const stats   = runtime.getStats();
      return { name: "graph-engine", status: "pass", message: `${stats.nodeCount} nodes cached` };
    } catch (err) {
      return { name: "graph-engine", status: "fail", message: (err as Error).message };
    }
  }

  private checkPolicyEngine(): HealthCheck {
    try {
      const { policyEvaluator } = require("../../policy-engine/engine/policy.evaluator");
      return { name: "policy-engine", status: "pass", message: "Policy evaluator available" };
    } catch (err) {
      return { name: "policy-engine", status: "fail", message: (err as Error).message };
    }
  }

  private checkEvidenceEngine(): HealthCheck {
    try {
      const { getEvidenceEngine } = require("../../evidence/lineage/evidence.lineage.engine");
      return { name: "evidence-engine", status: "pass", message: "Evidence lineage engine available" };
    } catch (err) {
      return { name: "evidence-engine", status: "fail", message: (err as Error).message };
    }
  }
}

export const healthMonitor = new HealthMonitor();
