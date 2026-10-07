/**
 * Pre-Execution Hooks — run before every agent action
 * Hooks are middleware: if any hook rejects, action is blocked.
 */
import { AgentContext } from "../../types/agent.types";
import { AGENT_CONSTITUTIONS } from "../constitutions/registry";

export interface HookResult {
  allowed: boolean;
  reason?:string;
  metadata?: Record<string, unknown>;
}

export type PreHookFn = (action: string, context: AgentContext, input: unknown) => HookResult;

const hooks: PreHookFn[] = [];

export function registerPreHook(hook: PreHookFn): void {
  hooks.push(hook);
}

export function runPreHooks(action: string, context: AgentContext, input: unknown): HookResult {
  for (const hook of hooks) {
    const result = hook(action, context, input);
    if (!result.allowed) return result;
  }
  return { allowed: true };
}

// Built-in hooks
registerPreHook((action, context) => {
  if (!context.orchestrationId) return { allowed: false, reason: "Missing orchestrationId — isolated operation blocked" };
  return { allowed: true };
});

registerPreHook((action, context) => {
  const constitution = AGENT_CONSTITUTIONS[context.agentId];
  if (!constitution) return { allowed: false, reason: `Unknown agent: ${context.agentId}` };
  if (constitution.forbiddenActions.includes(action as import("../../types/agent.types").AgentAction)) {
    return { allowed: false, reason: `Action "${action}" forbidden for ${constitution.role}` };
  }
  return { allowed: true };
});
