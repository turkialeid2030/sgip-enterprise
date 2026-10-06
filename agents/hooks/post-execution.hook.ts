/**
 * Post-Execution Hooks — run after every agent action completes
 */
import { AgentOutput } from "../../types/agent.types";

export type PostHookFn = (output: AgentOutput) => Promise<void>;
const hooks: PostHookFn[] = [];

export function registerPostHook(hook: PostHookFn): void {
  hooks.push(hook);
}

export async function runPostHooks(output: AgentOutput): Promise<void> {
  for (const hook of hooks) await hook(output);
}

// Built-in: log low-confidence outputs
registerPostHook(async (output) => {
  if (output.confidenceScore < 80 && !output.requiresHumanReview) {
    console.warn(`[PostHook] Low confidence output from ${output.agentId}: ${output.confidenceScore}%`);
  }
});
