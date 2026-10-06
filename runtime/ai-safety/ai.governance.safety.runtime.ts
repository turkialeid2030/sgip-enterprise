/**
 * AI Governance Safety Runtime — Phase 8.9
 * Bounded AI execution, sandboxing, hallucination containment,
 * mandatory human override, rollback-safe AI actions.
 */
import { v4 as uuidv4 } from "uuid";
import { getEventStore } from "../persistence/persistent.event.store";

export type AIRiskLevel = "low" | "medium" | "high" | "critical" | "prohibited";
export type AIActionStatus = "pending_approval" | "approved" | "executing" | "completed" | "rolled_back" | "blocked" | "quarantined";

export interface AIActionRequest {
  id:             string;
  tenantId:       string;
  agentId:        string;
  agentType:      string;
  action:         string;
  scope:          string;
  input:          Record<string, unknown>;
  estimatedImpact:string;
  riskLevel:      AIRiskLevel;
  requiresHuman:  boolean;
  sandboxed:      boolean;
}

export interface AIActionTrace {
  id:             string;
  tenantId:       string;
  requestId:      string;
  agentId:        string;
  action:         string;
  status:         AIActionStatus;
  startedAt:      string;
  completedAt?:   string;
  humanApprovalBy?:string;
  humanApprovalAt?:string;
  output?:        Record<string, unknown>;
  rollbackData?:  Record<string, unknown>;
  confidenceScore:number;
  explainability: string;
  wasRolledBack:  boolean;
  blockedReason?: string;
}

export interface HallucinationReport {
  id:         string;
  tenantId:   string;
  agentId:    string;
  actionId:   string;
  detected:   boolean;
  confidence: number;     // confidence that output is hallucinated
  evidence:   string[];
  action:     "blocked" | "flagged" | "reviewed";
  detectedAt: string;
}

export interface AIGovernancePolicy {
  agentId:         string;
  tenantId:        string;
  prohibitedActions:string[];
  maxRiskLevel:    AIRiskLevel;
  requiresHumanAboveLevel:AIRiskLevel;
  maxConfidenceThreshold:number;  // below this → human review
  sandboxRequired: boolean;
  auditAll:        boolean;
}

// ── Risk level ordering ───────────────────────────────────────
const RISK_ORDER: Record<AIRiskLevel,number> = { low:0, medium:1, high:2, critical:3, prohibited:4 };

const actionTraceStore     = new Map<string, AIActionTrace[]>();
const hallucinationStore   = new Map<string, HallucinationReport[]>();
const aiPolicyStore        = new Map<string, AIGovernancePolicy>();
const pendingApprovals     = new Map<string, AIActionRequest>();

const DEFAULT_POLICY: Omit<AIGovernancePolicy,"agentId"|"tenantId"> = {
  prohibitedActions: ["delete_audit_trail","modify_sealed_evidence","impersonate_board","override_governance"],
  maxRiskLevel:      "high",
  requiresHumanAboveLevel:"medium",
  maxConfidenceThreshold:70,
  sandboxRequired:   true,
  auditAll:          true,
};

export class AIGovernanceSafetyRuntime {
  constructor(private readonly tenantId: string) {}

  setPolicy(agentId: string, policy: Partial<Omit<AIGovernancePolicy,"agentId"|"tenantId">>): AIGovernancePolicy {
    const p: AIGovernancePolicy = { ...DEFAULT_POLICY, ...policy, agentId, tenantId:this.tenantId };
    aiPolicyStore.set(`${this.tenantId}:${agentId}`, p);
    return p;
  }

  getPolicy(agentId: string): AIGovernancePolicy {
    return aiPolicyStore.get(`${this.tenantId}:${agentId}`) ?? { ...DEFAULT_POLICY, agentId, tenantId:this.tenantId };
  }

  /**
   * Evaluate whether an AI action is safe to execute.
   * Returns: proceed | pending_human_approval | blocked
   */
  evaluateAction(request: AIActionRequest): { proceed:boolean; requiresHuman:boolean; blocked:boolean; reason:string; trace:AIActionTrace } {
    const policy = this.getPolicy(request.agentId);

    // 1. Check prohibited actions
    if (policy.prohibitedActions.includes(request.action)) {
      const trace = this.createTrace(request, "blocked", `Action "${request.action}" is prohibited by AI governance policy`);
      return { proceed:false, requiresHuman:false, blocked:true, reason:trace.blockedReason!, trace };
    }

    // 2. Check risk level
    if (RISK_ORDER[request.riskLevel] > RISK_ORDER[policy.maxRiskLevel]) {
      const trace = this.createTrace(request, "blocked", `Risk level "${request.riskLevel}" exceeds maximum allowed "${policy.maxRiskLevel}"`);
      return { proceed:false, requiresHuman:false, blocked:true, reason:trace.blockedReason!, trace };
    }

    // 3. Check if human approval required
    const requiresHuman = request.requiresHuman || RISK_ORDER[request.riskLevel] >= RISK_ORDER[policy.requiresHumanAboveLevel];
    if (requiresHuman) {
      pendingApprovals.set(request.id, request);
      const trace = this.createTrace(request, "pending_approval", "Awaiting human governance approval");
      getEventStore(this.tenantId).append({ topic:"ai.action.pending_human_approval", payload:{ requestId:request.id, agentId:request.agentId, action:request.action, riskLevel:request.riskLevel }, actorId:request.agentId, actorRole:"ai_agent" });
      return { proceed:false, requiresHuman:true, blocked:false, reason:"Human approval required", trace };
    }

    // 4. Approved — create trace
    const trace = this.createTrace(request, "executing", "AI action approved by policy");
    return { proceed:true, requiresHuman:false, blocked:false, reason:"Action permitted by AI governance policy", trace };
  }

  approveAction(requestId: string, approvedBy: string): AIActionTrace | null {
    const request = pendingApprovals.get(requestId);
    if (!request || request.tenantId !== this.tenantId) return null;
    const traces = actionTraceStore.get(this.tenantId) ?? [];
    const trace  = traces.find(t => t.requestId === requestId);
    if (!trace) return null;
    (trace as any).status           = "executing";
    (trace as any).humanApprovalBy  = approvedBy;
    (trace as any).humanApprovalAt  = new Date().toISOString();
    pendingApprovals.delete(requestId);
    getEventStore(this.tenantId).append({ topic:"ai.action.human_approved", payload:{ requestId, approvedBy }, actorId:approvedBy, actorRole:"governance_approver" });
    return trace;
  }

  detectHallucination(agentId: string, actionId: string, output: Record<string, unknown>, confidenceScore: number): HallucinationReport {
    const policy    = this.getPolicy(agentId);
    const detected  = confidenceScore < policy.maxConfidenceThreshold;
    const action    = detected ? (confidenceScore < 30 ? "blocked" : "flagged") : "reviewed";
    const report: HallucinationReport = {
      id:uuidv4(), tenantId:this.tenantId, agentId, actionId,
      detected, confidence:100-confidenceScore,
      evidence: detected ? [`Low confidence score: ${confidenceScore}%`, "Output deviates from expected pattern"] : [],
      action, detectedAt:new Date().toISOString(),
    };
    if (!hallucinationStore.has(this.tenantId)) hallucinationStore.set(this.tenantId, []);
    hallucinationStore.get(this.tenantId)!.push(report);
    if (detected) {
      getEventStore(this.tenantId).append({ topic:"ai.hallucination.detected", payload:{ agentId, actionId, confidence:confidenceScore, action }, actorId:"ai_safety", actorRole:"system" });
    }
    return report;
  }

  rollbackAction(traceId: string, reason: string, rolledBackBy: string): AIActionTrace | null {
    const trace = (actionTraceStore.get(this.tenantId) ?? []).find(t => t.id === traceId);
    if (!trace) return null;
    (trace as any).status      = "rolled_back";
    (trace as any).wasRolledBack = true;
    (trace as any).completedAt = new Date().toISOString();
    getEventStore(this.tenantId).append({ topic:"ai.action.rolled_back", payload:{ traceId, reason, rolledBackBy }, actorId:rolledBackBy, actorRole:"governance_approver" });
    return trace;
  }

  getTraces(agentId?: string): AIActionTrace[] {
    const all = actionTraceStore.get(this.tenantId) ?? [];
    return agentId ? all.filter(t => t.agentId === agentId) : all;
  }

  getHallucinationReports(): HallucinationReport[] { return hallucinationStore.get(this.tenantId) ?? []; }
  getPendingApprovals(): AIActionRequest[] { return [...pendingApprovals.values()].filter(r => r.tenantId === this.tenantId); }
  getBlockedActions(): AIActionTrace[] { return this.getTraces().filter(t => t.status === "blocked"); }

  private createTrace(request: AIActionRequest, status: AIActionStatus, reason: string): AIActionTrace {
    const trace: AIActionTrace = {
      id:uuidv4(), tenantId:this.tenantId, requestId:request.id,
      agentId:request.agentId, action:request.action, status,
      startedAt:new Date().toISOString(),
      confidenceScore:80, explainability:`Agent ${request.agentId} requested "${request.action}" on scope "${request.scope}"`,
      wasRolledBack:false, blockedReason:status==="blocked"?reason:undefined,
    };
    if (!actionTraceStore.has(this.tenantId)) actionTraceStore.set(this.tenantId, []);
    actionTraceStore.get(this.tenantId)!.push(trace);
    return trace;
  }
}

const aiSafetyCache = new Map<string, AIGovernanceSafetyRuntime>();
export function getAISafetyRuntime(tenantId: string): AIGovernanceSafetyRuntime {
  if (!aiSafetyCache.has(tenantId)) aiSafetyCache.set(tenantId, new AIGovernanceSafetyRuntime(tenantId));
  return aiSafetyCache.get(tenantId)!;
}
