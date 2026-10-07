/**
 * Agent Skills — reusable capability building blocks
 * Each skill is a pure function: input → output, no side effects.
 * Skills are composed by agents via the orchestrator.
 */

export interface SkillInput {
  entityId:    string;
  entityType:  string;
  context:     Record<string, unknown>;
  tenantId:    string;
}

export interface SkillOutput {
  skillId:        string;
  result:         unknown;
  confidenceScore:number;
  evidenceRefs:   string[];
  recommendations:string[];
}

// Skill signatures — implementations provided by each module
export type SkillFn = (input: SkillInput) => Promise<SkillOutput>;

export const SKILL_REGISTRY = new Map<string, SkillFn>();

export function registerSkill(skillId: string, fn: SkillFn): void {
  SKILL_REGISTRY.set(skillId, fn);
}

export function getSkill(skillId: string): SkillFn | undefined {
  return SKILL_REGISTRY.get(skillId);
}
