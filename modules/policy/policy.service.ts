/**
 * Policy Module — lifecycle management, conflict detection, freshness scoring
 */
import { UGOMRegistry } from "../../core/ugom.registry";
import { EventBus } from "../../core/event-bus";
import { PolicyEntity } from "../../schemas/entities.schema";

export class PolicyService {
  constructor(
    private readonly registry: UGOMRegistry,
    private readonly eventBus: EventBus,
    private readonly tenantId: string,
  ) {}

  async createPolicy(
    data: Omit<PolicyEntity, "id"|"version"|"createdAt"|"updatedAt"|"auditTrail"|"tenantId"|"organizationId">,
    createdBy: string,
  ): Promise<PolicyEntity> {
    return this.registry.create<PolicyEntity>("policy", data, createdBy);
  }

  computeFreshnessScore(policy: PolicyEntity): number {
    if (!policy.reviewDate) return 0;
    const daysSinceReview = (Date.now() - new Date(policy.reviewDate).getTime()) / (1000 * 60 * 60 * 24);
    if (daysSinceReview <= 90)  return 100;
    if (daysSinceReview <= 180) return 85;
    if (daysSinceReview <= 365) return 60;
    if (daysSinceReview <= 730) return 30;
    return 5;
  }

  detectConflicts(): Array<{ policyA: PolicyEntity; policyB: PolicyEntity; reason: string }> {
    const policies = this.registry.findByType<PolicyEntity>("policy");
    const conflicts: Array<{ policyA: PolicyEntity; policyB: PolicyEntity; reason: string }> = [];
    for (let i = 0; i < policies.length; i++) {
      for (let j = i + 1; j < policies.length; j++) {
        const a = policies[i], b = policies[j];
        const sharedRegs = a.linkedRegIds.filter(r => b.linkedRegIds.includes(r));
        if (sharedRegs.length > 0 && a.category === b.category) {
          const aDate = a.publishedAt ? new Date(a.publishedAt).getTime() : 0;
          const bDate = b.publishedAt ? new Date(b.publishedAt).getTime() : 0;
          if (Math.abs(aDate - bDate) > 0) {
            conflicts.push({
              policyA: a, policyB: b,
              reason: `كلاهما يغطي ${sharedRegs.join(",")} في نفس الفئة مع إصدارات مختلفة`,
            });
          }
        }
      }
    }
    return conflicts;
  }

  getStalePolicies(thresholdDays = 365): PolicyEntity[] {
    const cutoff = new Date(Date.now() - thresholdDays * 86400000).toISOString();
    return this.registry.findByType<PolicyEntity>("policy")
      .filter(p => !p.reviewDate || p.reviewDate < cutoff);
  }

  getPoliciesForRegulation(regulationId: string): PolicyEntity[] {
    return this.registry.findByType<PolicyEntity>("policy")
      .filter(p => p.linkedRegIds.includes(regulationId));
  }

  async markForReview(policyId: string, reviewer: string): Promise<PolicyEntity | undefined> {
    return this.registry.update<PolicyEntity>(
      policyId, { status: "under_review" } as Partial<PolicyEntity>,
      reviewer, "Scheduled for periodic review",
    );
  }
}
