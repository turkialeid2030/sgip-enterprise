/**
 * Control Module — manages control library, testing, SoD, CCM
 */
import { UGOMRegistry } from "../../core/ugom.registry";
import { SovereignKnowledgeGraph } from "../../graph/graph.engine";
import { EventBus } from "../../core/event-bus";
import { ControlEntity } from "../../schemas/entities.schema";
import { BaseGovernanceObject } from "../../types/governance.types";

export interface ControlTestResult {
  controlId:      string;
  testId:         string;
  score:          number;
  passed:         boolean;
  testedBy:       string;
  findings:       string[];
  recommendation: string;
}

export class ControlService {
  constructor(
    private readonly registry: UGOMRegistry,
    private readonly graph:    SovereignKnowledgeGraph,
    private readonly eventBus: EventBus,
    private readonly tenantId: string,
  ) {}

  async createControl(
    data: Omit<ControlEntity, "id"|"version"|"createdAt"|"updatedAt"|"auditTrail"|"tenantId"|"organizationId">,
    createdBy: string,
  ): Promise<ControlEntity> {
    return this.registry.create<ControlEntity>("control", data, createdBy);
  }

  async recordTestResult(result: ControlTestResult, testedBy: string): Promise<ControlEntity | undefined> {
    const ctrl = this.registry.findById<ControlEntity>(result.controlId);
    if (!ctrl) return undefined;

    const testEntry = {
      testId:   result.testId,
      score:    result.score,
      testedAt: new Date().toISOString(),
      testedBy: result.testedBy,
      passed:   result.passed,
    };

    const newTestResults = [...(ctrl.testResults ?? []), testEntry];
    const newEffectiveness = Math.round(
      newTestResults.reduce((s, t) => s + t.score, 0) / newTestResults.length,
    );

    const updated = await this.registry.update<ControlEntity>(
      result.controlId,
      {
        testResults:       newTestResults,
        effectiveness:     newEffectiveness,
        lastTestedAt:      testEntry.testedAt,
        designEffective:   result.passed,
        operatingEffective:result.score >= 70,
        status:            result.score >= 80 ? "active" : result.score >= 60 ? "under_review" : "blocked",
      } as Partial<ControlEntity>,
      testedBy,
      `Control test: score ${result.score}%`,
    );

    if (!result.passed) {
      this.eventBus.emit({
        type: "control.failure", source: "ControlService",
        entityId: result.controlId, entityType: "control",
        payload: { controlId: result.controlId, score: result.score, findings: result.findings },
        tenantId: this.tenantId, severity: "high",
      });
    }
    return updated;
  }

  detectSoDViolations(): Array<{ employeeId: string; roles: string[]; severity: "critical"|"high" }> {
    // In production: query IAM system
    // Here: check controls that share the same owner with conflicting types
    const controls = this.registry.findByType<ControlEntity>("control");
    const byOwner = new Map<string, ControlEntity[]>();
    for (const c of controls) {
      if (!byOwner.has(c.owner)) byOwner.set(c.owner, []);
      byOwner.get(c.owner)!.push(c);
    }
    const violations: Array<{ employeeId: string; roles: string[]; severity: "critical"|"high" }> = [];
    for (const [owner, ctrls] of byOwner) {
      const types = new Set(ctrls.map(c => c.controlType));
      if (types.has("preventive") && types.has("corrective")) {
        violations.push({ employeeId: owner, roles: [...types], severity: "critical" });
      }
    }
    return violations;
  }

  getControlCoverage(): Array<{ riskId: string; controlCount: number; avgEffectiveness: number; covered: boolean }> {
    const risks = this.registry.findByType("risk");
    return risks.map(risk => {
      const linkedControls = (risk.linkedControls ?? [])
        .map(cid => this.registry.findById<ControlEntity>(cid))
        .filter(Boolean) as ControlEntity[];
      const avgEff = linkedControls.length
        ? Math.round(linkedControls.reduce((s, c) => s + c.effectiveness, 0) / linkedControls.length)
        : 0;
      return {
        riskId: risk.id,
        controlCount: linkedControls.length,
        avgEffectiveness: avgEff,
        covered: linkedControls.length > 0 && avgEff >= 70,
      };
    });
  }

  getWeakControls(): ControlEntity[] {
    return this.registry.findByType<ControlEntity>("control")
      .filter(c => c.effectiveness < 70)
      .sort((a, b) => a.effectiveness - b.effectiveness);
  }
}
