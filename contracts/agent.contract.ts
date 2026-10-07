/**
 * Agent-to-Module Contract
 * Defines what capabilities an agent exposes to the orchestrator.
 */
import { AgentId, AgentContext, AgentOutput } from "../types/agent.types";

export interface IAgentCapability {
  agentId:    AgentId;
  canHandle:  (action: string, entityType: string) => boolean;
  execute:    (context: AgentContext, input: unknown) => Promise<AgentOutput>;
  validate:   (action: string, context: AgentContext) => { valid: boolean; reason?: string };
}

export interface IAgentRouter {
  route(action: string, entityType: string): AgentId | null;
  getCapabilities(agentId: AgentId): IAgentCapability | undefined;
  registerCapability(capability: IAgentCapability): void;
}
