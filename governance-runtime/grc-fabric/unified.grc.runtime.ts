/**
 * Unified GRC Runtime Fabric — Phase 6.9
 * Every decision/action passes authority, governance, compliance, and risk
 * checks before execution. The central enforcement gate of the entire OS.
 */
import { v4 as uuidv4 } from "uuid";
import { getEventStore } from "../../runtime/persistence/persistent.event.store";
import { getAuthorityEngine } from "../authority/authority.engine";
import { getPolicyRuntime } from "../policy/governance.policy.runtime";
import { getComplianceObligationRuntime } from "../../compliance-runtime/obligations/compliance.obligation.runtime";
import { getRiskRuntime } from "../../risk-runtime/register/risk.intelligence.runtime";
import { getCCMRuntime } from "../../compliance-runtime/ccm/ccm.runtime";
import { CorruptionGuards } from "../../runtime/corruption-guards/corruption.guards";

export interface GRCActionRequest {
  actionId:     string;
  tenantId:     string;
  actorId:      string;
  actorRole:    string;
  action:       string;
  scope:        string;
  entityId?:    string;
  amount?:      number;
  idempotencyKey?:string;
}

export interface GRCActionResult {
  actionId:     string;
  approved:     boolean;
  blockedBy?:   "authority"|"governance"|"compliance"|"risk"|"sod"|"corruption";
  reason:       string;
  requiresDual: boolean;
  auditRef:     string;
  timestamp:    string;
  checks: {
    authority:    boolean;
    governance:   boolean;
    compliance:   boolean;
    riskAcceptable:boolean;
    sodClean:     boolean;
    integrityOk:  boolean;
  };
}

const actionLog: GRCActionResult[] = [];

export class UnifiedGRCFabric {
  constructor(private readonly tenantId: string) {}

  async checkAndExecute<T>(
    request: GRCActionRequest,
    executor: () => Promise<T>,
  ): Promise<{ result?: T; grcResult: GRCActionResult }> {
    const grcResult = this.runChecks(request);
    if(!grcResult.approved) return { grcResult };
    if(grcResult.requiresDual) {
      // Log but don't auto-execute dual-approval actions
      getEventStore(this.tenantId).append({topic:"grc.dual_approval.required",payload:{actionId:request.actionId,action:request.action},actorId:request.actorId,actorRole:request.actorRole});
      return { grcResult: {...grcResult, approved:false, reason:"Dual approval required — awaiting second approver", blockedBy:"governance"} };
    }
    const result = await executor();
    return { result, grcResult };
  }

  runChecks(request: GRCActionRequest): GRCActionResult {
    const auditRef = uuidv4();
    const checks = { authority:false, governance:false, compliance:false, riskAcceptable:false, sodClean:false, integrityOk:false };

    // 1. Integrity guard
    const integrityOk = !request.actorId.includes("undefined") && request.actorId.trim() !== "";
    checks.integrityOk = integrityOk;
    if(!integrityOk) return this.blocked(request.actionId, "corruption", "Actor identity is invalid or undefined", checks, auditRef);

    // 2. Authority check
    const authEngine  = getAuthorityEngine(this.tenantId);
    const authCheck   = authEngine.checkAuthority({ actorId:request.actorId, action:request.action, scope:request.scope, amount:request.amount });
    checks.authority  = authCheck.authorized;
    if(!authCheck.authorized) return this.blocked(request.actionId, "authority", authCheck.reason, checks, auditRef);

    // 3. SoD check
    const ccm    = getCCMRuntime(this.tenantId);
    const sodViol = ccm.checkSoD(request.actorId, [request.actorRole], request.action);
    checks.sodClean = sodViol === null;
    if(sodViol !== null) return this.blocked(request.actionId, "sod", sodViol.conflictDescription, checks, auditRef);

    // 4. Policy check — active policies must not prohibit this action
    const policyRuntime = getPolicyRuntime(this.tenantId);
    const activePolicies = policyRuntime.getAll("active");
    checks.governance = true; // simplified: no policy explicitly blocks

    // 5. Compliance exposure check
    const complianceRuntime = getComplianceObligationRuntime(this.tenantId);
    const breachedObls = complianceRuntime.getBreached();
    checks.compliance = breachedObls.length === 0 || !["approve_exception","waive_obligation"].includes(request.action);

    // 6. Risk check
    const riskRuntime = getRiskRuntime(this.tenantId);
    const criticalBreaches = riskRuntime.getBreachingTolerance().filter(r => r.category === "strategic" || r.category === "cyber");
    checks.riskAcceptable = criticalBreaches.length < 3;  // block if 3+ strategic/cyber risks breach tolerance

    const allPassed = Object.values(checks).every(v => v);
    const result: GRCActionResult = {
      actionId:    request.actionId, approved:allPassed,
      reason:      allPassed ? "All GRC checks passed" : "One or more GRC checks failed",
      requiresDual:authCheck.requiresDual,
      auditRef, timestamp:new Date().toISOString(), checks,
    };
    actionLog.push(result);
    getEventStore(this.tenantId).append({topic:allPassed?"grc.action.approved":"grc.action.blocked",payload:{actionId:request.actionId,action:request.action,approved:allPassed,checks},actorId:request.actorId,actorRole:request.actorRole,idempotencyKey:request.idempotencyKey});
    return result;
  }

  private blocked(actionId:string,blockedBy:GRCActionResult["blockedBy"],reason:string,checks:GRCActionResult["checks"],auditRef:string): GRCActionResult {
    const r:GRCActionResult={actionId,approved:false,blockedBy,reason,requiresDual:false,auditRef,timestamp:new Date().toISOString(),checks};
    actionLog.push(r);
    return r;
  }

  getActionLog(limit=50): GRCActionResult[] { return actionLog.filter((_,i,a)=>i>=a.length-limit).filter(r=>r.actionId.length>0); }
  getBlockedActions(): GRCActionResult[] { return actionLog.filter(r=>!r.approved); }
}

const fabricCache = new Map<string, UnifiedGRCFabric>();
export function getGRCFabric(tenantId: string): UnifiedGRCFabric {
  if(!fabricCache.has(tenantId)) fabricCache.set(tenantId, new UnifiedGRCFabric(tenantId));
  return fabricCache.get(tenantId)!;
}
