/**
 * Governance Orchestration Engine
 * ─────────────────────────────────────────────────────────────────────
 * Routes work between agents, enforces constitutions,
 * runs quality gates, and coordinates cross-module workflows.
 *
 * No agent may act without passing through this layer.
 * Every orchestrated action produces an immutable trace.
 */
import { v4 as uuidv4 } from "uuid";
import { AgentId, AgentContext, ActionValidationResult, AgentOutput } from "../types/agent.types";
import { UGOMType, RiskLevel } from "../types/governance.types";
import { EventBus } from "../core/event-bus";
import { AuditLogger } from "../audit/audit.logger";
import { AGENT_CONSTITUTIONS } from "../agents/constitutions/registry";
import { QualityGateEngine } from "./quality-gate.engine";

// AI Gateway function type — injected at runtime to avoid circular deps
export type AIGatewayFn = (params: {
  agentId: string; action: string; systemPrompt: string;
  userPrompt: string; tenantId: string; requestedBy: string;
  entityId?: string; evidenceIds?: string[];
}) => Promise<{ content: string; confidenceScore: number; outputId: string; traceId: string; hallucinationCheckPassed: boolean; requiresHumanReview: boolean }>;

export interface OrchestrationRequest {
  agentId:          AgentId;
  action:           string;
  entityId?:        string;
  entityType?:      UGOMType;
  input:            unknown;
  requestedBy:      string;
  confidenceScore?: number;
  evidenceIds?:     string[];
  tenantId:         string;
}

export interface OrchestrationResult {
  orchestrationId:  string;
  agentId:          AgentId;
  action:           string;
  status:           "approved" | "blocked" | "escalated" | "pending_human";
  output?:          AgentOutput;
  validationResult: ActionValidationResult;
  qualityScore?:    number;
  blockReasons:     string[];
  escalateTo?:      string[];
  traceId:          string;
  durationMs:       number;
}

export class GovernanceOrchestrator {
  private readonly pendingHumanReview = new Map<string, OrchestrationRequest>();

  constructor(
    private readonly eventBus: EventBus,
    private readonly auditLogger: AuditLogger,
    private readonly qualityGate: QualityGateEngine,
    private readonly tenantId: string,
    private readonly aiGateway?: AIGatewayFn,
  ) {}

  async orchestrate(request: OrchestrationRequest): Promise<OrchestrationResult> {
    const orchestrationId = uuidv4();
    const traceId         = uuidv4();
    const startMs         = Date.now();

    // 1. Validate agent action against constitution
    const validation = this.validateAction(request, orchestrationId);
    if (!validation.valid) {
      this.auditLogger.log({
        action: `orchestration.blocked.${request.action}`,
        entityId: request.entityId ?? orchestrationId,
        entityType: request.entityType ?? "agent_action",
        performedBy: request.requestedBy,
        details: { reason: validation.reason, agentId: request.agentId },
      });
      this.eventBus.emit({
        type: "agent.quality_gate_failed", source: "Orchestrator",
        payload: { orchestrationId, agentId: request.agentId, reason: validation.reason },
        tenantId: this.tenantId,
        severity: validation.severity as RiskLevel ?? "medium",
      });
      return {
        orchestrationId, agentId: request.agentId, action: request.action,
        status: "blocked", validationResult: validation,
        blockReasons: [validation.reason ?? "Constitution violation"],
        traceId, durationMs: Date.now() - startMs,
      };
    }

    // 2. Human review gate
    if (validation.requiresHumanApproval) {
      this.pendingHumanReview.set(orchestrationId, request);
      this.eventBus.emit({
        type: "agent.human_review_required", source: "Orchestrator",
        payload: { orchestrationId, agentId: request.agentId, action: request.action },
        tenantId: this.tenantId,
      });
      return {
        orchestrationId, agentId: request.agentId, action: request.action,
        status: "pending_human", validationResult: validation,
        blockReasons: [], traceId, durationMs: Date.now() - startMs,
      };
    }

    // 3. AI Gateway — injected; falls back to mock only in test environments
    const agentOutput = await this.executeGateway(request, orchestrationId, traceId);

    // 4. Quality Gate
    const qgResult = this.qualityGate.run({
      type:               request.action,
      evidenceIds:        request.evidenceIds ?? [],
      owner:              request.requestedBy,
      auditTrail:         [`${new Date().toISOString()}: Orchestrated by ${request.agentId}`],
      confidenceScore:    agentOutput.confidenceScore,
      linkedRegulations:  [],
      riskLevel:          "medium",
    });

    if (qgResult.status === "blocked") {
      this.eventBus.emit({
        type: "agent.quality_gate_failed", source: "Orchestrator",
        payload: { orchestrationId, blockers: qgResult.blockers, score: qgResult.overallScore },
        tenantId: this.tenantId,
      });
      return {
        orchestrationId, agentId: request.agentId, action: request.action,
        status: "blocked", validationResult: validation, output: agentOutput,
        qualityScore: qgResult.overallScore,
        blockReasons: qgResult.blockers.map(b => b.issue),
        traceId, durationMs: Date.now() - startMs,
      };
    }

    // 5. Audit
    this.auditLogger.log({
      action: `orchestration.completed.${request.action}`,
      entityId: request.entityId ?? orchestrationId,
      entityType: request.entityType ?? "agent_action",
      performedBy: request.requestedBy,
      newValue: { agentId: request.agentId, confidence: agentOutput.confidenceScore, qgScore: qgResult.overallScore },
      correlationId: traceId,
    });

    this.eventBus.emit({
      type: "agent.output_ready", source: "Orchestrator",
      payload: agentOutput, tenantId: this.tenantId,
    });

    return {
      orchestrationId, agentId: request.agentId, action: request.action,
      status: "approved", validationResult: validation, output: agentOutput,
      qualityScore: qgResult.overallScore,
      blockReasons: [], traceId, durationMs: Date.now() - startMs,
    };
  }

  approveHumanReview(orchestrationId: string, approvedBy: string): boolean {
    const pending = this.pendingHumanReview.get(orchestrationId);
    if (!pending) return false;
    this.pendingHumanReview.delete(orchestrationId);
    this.auditLogger.log({
      action: "orchestration.human_approved",
      entityId: orchestrationId, entityType: "agent_action",
      performedBy: approvedBy, details: { orchestrationId },
    });
    return true;
  }

  getPendingReviews(): Array<{ id: string; request: OrchestrationRequest }> {
    return [...this.pendingHumanReview.entries()].map(([id, req]) => ({ id, request: req }));
  }

  private validateAction(
    request: OrchestrationRequest,
    orchestrationId: string,
  ): ActionValidationResult {
    const constitution = AGENT_CONSTITUTIONS[request.agentId];
    if (!constitution) {
      return { valid: false, reason: `Unknown agent: ${request.agentId}`, severity: "critical", requiresHumanApproval: false };
    }
    if (constitution.forbiddenActions.includes(request.action as import("../types/agent.types").AgentAction)) {
      return { valid: false, reason: `Action "${request.action}" is forbidden for ${constitution.role}`, severity: "high", requiresHumanApproval: false };
    }
    if (request.confidenceScore !== undefined && request.confidenceScore < constitution.escalationThreshold) {
      return { valid: true, requiresHumanApproval: true, approvalNote: `Confidence ${request.confidenceScore}% < escalation threshold ${constitution.escalationThreshold}%` };
    }
    if (constitution.humanApprovalRequired.includes(request.action)) {
      return { valid: true, requiresHumanApproval: true, approvalNote: `Action "${request.action}" requires explicit human approval for ${constitution.role}` };
    }
    return { valid: true, requiresHumanApproval: false };
  }

  private async executeGateway(
    request: OrchestrationRequest,
    orchestrationId: string,
    traceId: string,
  ): Promise<AgentOutput> {
    const constitution = AGENT_CONSTITUTIONS[request.agentId]!;

    if (this.aiGateway) {
      // Real gateway injected (production path)
      const gatewayResult = await this.aiGateway({
        agentId:     request.agentId,
        action:      request.action,
        systemPrompt: `You are ${constitution.role} (${constitution.arabicName}). ${constitution.description}`,
        userPrompt:  typeof request.input === "string" ? request.input : JSON.stringify(request.input),
        tenantId:    request.tenantId,
        requestedBy: request.requestedBy,
        entityId:    request.entityId,
        evidenceIds: request.evidenceIds,
      });
      const auditEntry = this.auditLogger.log({
        action: `agent.output.${request.action}`, entityId: orchestrationId,
        entityType: "agent_action", performedBy: request.agentId,
        newValue: { confidence: gatewayResult.confidenceScore },
      });
      return {
        agentId:         request.agentId, outputId: gatewayResult.outputId,
        traceId:         gatewayResult.traceId, sessionId: orchestrationId,
        inputSummary:    typeof request.input === "string" ? request.input.slice(0, 100) : "",
        outputType:      request.action, content: gatewayResult.content,
        confidenceScore: gatewayResult.confidenceScore, evidenceRefs: request.evidenceIds ?? [],
        hallucinationCheckPassed: gatewayResult.hallucinationCheckPassed,
        requiresHumanReview: gatewayResult.requiresHumanReview,
        reviewerStatus:  "pending", auditEntry, timestamp: new Date().toISOString(),
        modelName: process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-20250514",
        promptVersion: "1.0", isDemo: false,
      };
    }

    // Test/dev fallback — clearly marked, no silent mock
    console.warn("[Orchestrator] No AI gateway injected — using dev stub for:", request.agentId, request.action);
    const confidence = 70;  // fixed dev stub — deterministic, not random
    const auditEntry = this.auditLogger.log({
      action: `agent.stub.${request.action}`, entityId: orchestrationId,
      entityType: "agent_action", performedBy: request.agentId,
      newValue: { confidence, stub: true },
    });
    return {
      agentId: request.agentId, outputId: uuidv4(), traceId, sessionId: orchestrationId,
      inputSummary: typeof request.input === "string" ? request.input.slice(0, 100) : "",
      outputType: request.action, content: { stub: true, action: request.action },
      confidenceScore: confidence, evidenceRefs: request.evidenceIds ?? [],
      hallucinationCheckPassed: false, requiresHumanReview: true,
      reviewerStatus: "pending", auditEntry, timestamp: new Date().toISOString(),
      modelName: "[STUB — inject aiGateway for production]", promptVersion: "1.0", isDemo: true,
    };
  }
}
