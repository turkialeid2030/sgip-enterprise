
/**
 * AI Gateway — ONLY server-side Anthropic calls.
 * API key NEVER leaves this file. Frontend receives only structured outputs.
 *
 * Every call is:
 *   1. Validated by agent constitution
 *   2. Logged to audit trail
 *   3. Quality-gated before return
 *   4. Stored in AgentOutput table
 */
import Anthropic from "@anthropic-ai/sdk";
import { v4 as uuidv4 } from "uuid";
import { AgentDAO } from "./agent.dao";
import { AuditDAO } from "./audit.dao";
import { AGENT_CONSTITUTIONS } from "../../agents/constitutions/registry";
import type { AgentId } from "../../types/agent.types";

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY ?? "",
});

const MODEL = process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-20250514";

export interface GatewayRequest {
  agentId:     AgentId;
  action:      string;
  systemPrompt:string;
  userPrompt:  string;
  tenantId:    string;
  requestedBy: string;
  sessionId?:  string;
  entityId?:   string;
  evidenceIds?:string[];
}

export interface GatewayResponse {
  outputId:        string;
  traceId:         string;
  content:         string;
  confidenceScore: number;
  requiresHumanReview: boolean;
  hallucinationCheckPassed: boolean;
  tokenUsage:      { input: number; output: number };
}

export async function callAIGateway(req: GatewayRequest): Promise<GatewayResponse> {
  const constitution = AGENT_CONSTITUTIONS[req.agentId];
  if (!constitution) throw new Error(`Unknown agent: ${req.agentId}`);

  // Forbidden action check
  if (constitution.forbiddenActions.includes(req.action as never)) {
    throw new Error(`Action "${req.action}" is forbidden for ${constitution.role}`);
  }

  const traceId    = uuidv4();
  const outputId   = uuidv4();
  const sessionId  = req.sessionId ?? uuidv4();

  // Constitution enforcement — inject into system prompt
  const enforcedSystem = `${req.systemPrompt}

AGENT CONSTITUTION ENFORCEMENT:
- You are: ${constitution.role} (${constitution.arabicName})
- You MUST NOT: ${constitution.forbiddenActions.join(", ")}
- You MUST cite sources for every claim
- You MUST provide a confidence score (0-100) at the end of your response in format: CONFIDENCE: [score]
- If confidence < ${constitution.confidenceThreshold}, explicitly state human review is required
- You MUST NOT certify, approve, or issue legal opinions without explicit human review
- TraceId: ${traceId}`;

  let rawContent = "";
  let inputTokens = 0;
  let outputTokens = 0;

  try {
    const message = await anthropic.messages.create({
      model:      MODEL,
      max_tokens: constitution.maxContextTokens,
      system:     enforcedSystem,
      messages:   [{ role: "user", content: req.userPrompt }],
    });

    rawContent   = message.content.map(b => b.type === "text" ? b.text : "").join("");
    inputTokens  = message.usage.input_tokens;
    outputTokens = message.usage.output_tokens;
  } catch (err: unknown) {
    const e = err instanceof Error ? err : new Error(String(err));
    const message = e.message ?? "";
    // Configuration/authentication unavailability is a governed 503. Unknown
    // provider/runtime faults stay 500 and are sanitized by the global boundary.
    if (/apiKey|ANTHROPIC_API_KEY|authentication method|authentication|unauthorized/i.test(message)) {
      throw Object.assign(new Error("AI service unavailable"), {
        statusCode: 503, code: "AI_SERVICE_UNAVAILABLE", cause: e,
      });
    }
    // Strip provider-specific HTTP status fields (for example 529) from the
    // public transport decision. The unified boundary owns HTTP mapping; the
    // raw provider message remains on the internal Error for diagnostics.
    throw Object.assign(new Error(e.message), { code: "AI_PROVIDER_ERROR", cause: e });
  }

  // Extract confidence score
  const confMatch = rawContent.match(/CONFIDENCE:\s*(\d+)/i);
  const confidenceScore = confMatch ? Math.min(100, Math.max(0, parseInt(confMatch[1]))) : 70;

  // Hallucination check: flag if no citations or too many absolutes
  const hasAbsolutes = /\b(definitely|certainly|always|never|guaranteed)\b/i.test(rawContent);
  const hasCitations = /\b(ref:|citation:|source:|regulation:|article:|section:)/i.test(rawContent);
  const hallucinationCheckPassed = !hasAbsolutes || hasCitations;

  const requiresHumanReview = confidenceScore < constitution.confidenceThreshold;

  // Persist to DB
  await AgentDAO.create({
    id: outputId, agentId: req.agentId, outputType: req.action,
    inputSummary: req.userPrompt.slice(0, 200),
    outputJson: { content: rawContent, entityId: req.entityId },
    confidenceScore, evidenceRefs: req.evidenceIds ?? [],
    hallucinationCheckPassed, requiresHumanReview,
    reviewerStatus: requiresHumanReview ? "pending" : "auto_approved",
    modelName: MODEL, promptVersion: "1.0",
    traceId, sessionId, tenantId: req.tenantId,
  });

  // Audit log
  await AuditDAO.log({
    entityId: req.entityId, entityType: "agent_action",
    action: `agent.${req.agentId}.${req.action}`,
    performedBy: req.requestedBy, role: req.agentId,
    tenantId: req.tenantId, traceId,
    next: { outputId, confidenceScore, tokenUsage: { input: inputTokens, output: outputTokens } },
  });

  return {
    outputId, traceId, content: rawContent,
    confidenceScore, requiresHumanReview, hallucinationCheckPassed,
    tokenUsage: { input: inputTokens, output: outputTokens },
  };
}
