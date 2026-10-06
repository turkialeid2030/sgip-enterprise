/**
 * Adaptive Agent Constitution — SCEOS Layer 5
 * Governs agent behavior based on enterprise maturity, sector, and risk.
 */
import { v4 as uuidv4 } from "uuid";

export type AgentRole = "risk_analyst"|"compliance_agent"|"audit_agent"|"governance_analyst"|"executive_briefer"|"evidence_collector"|"remediation_tracker";

export interface AgentConstitution {
  id:string; tenantId:string; agentId:string; role:AgentRole; sector:string;
  maturityLevel:1|2|3|4|5; autonomyLevel:"supervised"|"semi_autonomous"|"autonomous";
  confidenceThreshold:number; humanApprovalRequired:string[]; forbiddenActions:string[];
  auditTrailRequired:boolean; maxDecisionsPerHour:number; allowedDataAccess:string[];
  constitutionVersion:string; createdAt:string;
}

export interface AgentAuditEntry {
  id:string; tenantId:string; agentId:string; action:string;
  input:Record<string,unknown>; output:Record<string,unknown>;
  confidence:number; approved:boolean; approvedBy?:string;
  reasoning:string; evidenceRefs:string[]; timestamp:string; correlationId:string;
}

const DEFAULT_CONSTITUTIONS:Record<AgentRole,Partial<AgentConstitution>> = {
  risk_analyst:       {autonomyLevel:"supervised",       confidenceThreshold:85,humanApprovalRequired:["approve_risk","accept_risk"],forbiddenActions:["approve_decision","delete_evidence"]},
  compliance_agent:   {autonomyLevel:"supervised",       confidenceThreshold:90,humanApprovalRequired:["compliance_sign_off"],forbiddenActions:["waive_obligation"]},
  audit_agent:        {autonomyLevel:"semi_autonomous",  confidenceThreshold:80,humanApprovalRequired:["issue_finding","close_audit"],forbiddenActions:["delete_audit_trail","modify_evidence"]},
  governance_analyst: {autonomyLevel:"supervised",       confidenceThreshold:85,humanApprovalRequired:["approve_policy"],forbiddenActions:["delete_governance_record"]},
  executive_briefer:  {autonomyLevel:"semi_autonomous",  confidenceThreshold:70,humanApprovalRequired:["board_communication"],forbiddenActions:["sign_contract"]},
  evidence_collector: {autonomyLevel:"autonomous",       confidenceThreshold:95,humanApprovalRequired:["seal_evidence"],forbiddenActions:["delete_evidence","modify_sealed_record"]},
  remediation_tracker:{autonomyLevel:"semi_autonomous",  confidenceThreshold:80,humanApprovalRequired:["close_critical_finding"],forbiddenActions:["delete_capa"]},
};

const constitutionStore = new Map<string,AgentConstitution>();
const auditStore:AgentAuditEntry[] = [];

export class AgentConstitutionEngine {
  constructor(private readonly tenantId:string) {}

  registerAgent(params:Omit<AgentConstitution,"id"|"tenantId"|"createdAt"|"constitutionVersion"|"autonomyLevel"|"confidenceThreshold"|"humanApprovalRequired"|"forbiddenActions"|"auditTrailRequired"|"maxDecisionsPerHour"> & {autonomyLevel?:AgentConstitution["autonomyLevel"];confidenceThreshold?:number;humanApprovalRequired?:string[];forbiddenActions?:string[];}):AgentConstitution {
    const defaults = DEFAULT_CONSTITUTIONS[params.role] ?? {};
    const constitution:AgentConstitution = {...defaults,...params,id:uuidv4(),tenantId:this.tenantId,createdAt:new Date().toISOString(),constitutionVersion:"1.0",auditTrailRequired:true,maxDecisionsPerHour:params.maturityLevel>=4?50:20,autonomyLevel:(params.autonomyLevel??defaults.autonomyLevel??"supervised") as AgentConstitution["autonomyLevel"],confidenceThreshold:params.confidenceThreshold??defaults.confidenceThreshold??80,humanApprovalRequired:params.humanApprovalRequired??defaults.humanApprovalRequired??[],forbiddenActions:params.forbiddenActions??defaults.forbiddenActions??[]};
    constitutionStore.set(`${this.tenantId}:${params.agentId}`,constitution); return constitution;
  }

  checkAction(agentId:string,action:string,confidence:number):{allowed:boolean;requiresApproval:boolean;reason:string} {
    const constitution = constitutionStore.get(`${this.tenantId}:${agentId}`);
    if (!constitution) return {allowed:false,requiresApproval:false,reason:"Agent not registered"};
    if (constitution.forbiddenActions.includes(action)) return {allowed:false,requiresApproval:false,reason:`Action "${action}" forbidden by constitution`};
    if (confidence<constitution.confidenceThreshold) return {allowed:true,requiresApproval:true,reason:`Confidence ${confidence}% below threshold ${constitution.confidenceThreshold}%`};
    if (constitution.humanApprovalRequired.includes(action)) return {allowed:true,requiresApproval:true,reason:`Action "${action}" always requires human approval`};
    return {allowed:true,requiresApproval:false,reason:"Permitted by constitution"};
  }

  logAction(params:Omit<AgentAuditEntry,"id"|"tenantId"|"timestamp"|"correlationId">):AgentAuditEntry {
    const entry:AgentAuditEntry = {...params,id:uuidv4(),tenantId:this.tenantId,timestamp:new Date().toISOString(),correlationId:uuidv4()};
    auditStore.push(entry); return entry;
  }

  getConstitution(agentId:string):AgentConstitution|undefined { return constitutionStore.get(`${this.tenantId}:${agentId}`); }
  getAuditTrail(agentId:string):AgentAuditEntry[] { return auditStore.filter(e=>e.tenantId===this.tenantId&&e.agentId===agentId); }
}

const agentCache = new Map<string,AgentConstitutionEngine>();
export function getAgentConstitutionEngine(tenantId:string):AgentConstitutionEngine {
  if (!agentCache.has(tenantId)) agentCache.set(tenantId,new AgentConstitutionEngine(tenantId)); return agentCache.get(tenantId)!;
}
