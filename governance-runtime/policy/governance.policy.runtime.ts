/**
 * Governance Policy Runtime — Phase 6.8
 * Executable policy rules, drift detection, attestation lifecycle.
 */
import { v4 as uuidv4 } from "uuid";
import { getEventStore } from "../../runtime/persistence/persistent.event.store";

export type PolicyStatus = "draft"|"under_review"|"approved"|"active"|"expired"|"superseded"|"withdrawn";
export type PolicyCategory = "governance"|"risk"|"compliance"|"operational"|"information_security"|"ai_ethics"|"hr"|"financial";

export interface PolicyRecord {
  readonly id:string; readonly tenantId:string;
  readonly code:string; readonly title:string; readonly version:string;
  readonly category:PolicyCategory; readonly status:PolicyStatus;
  readonly ownerId:string; readonly approvedById?:string;
  readonly effectiveFrom?:string; readonly expiresAt?:string;
  readonly obligationIds:string[]; readonly controlIds:string[];
  readonly content:string; readonly changeLog:PolicyChange[];
  readonly attestationRequired:boolean; readonly reviewCycleMonths:number;
  readonly hash:string; readonly previousVersionId?:string;
  readonly createdAt:string; readonly updatedAt:string; readonly createdBy:string;
}

export interface PolicyChange {
  readonly changedAt:string; readonly changedBy:string;
  readonly changeType:"created"|"updated"|"approved"|"activated"|"expired"|"superseded";
  readonly description:string;
}

export interface PolicyAttestation {
  readonly id:string; readonly tenantId:string;
  readonly policyId:string; readonly attestedById:string;
  readonly attestedAt:string; readonly valid:boolean;
  readonly signature:string; readonly expiresAt:string;
}

export interface PolicyDriftSignal {
  readonly policyId:string; readonly policyTitle:string;
  readonly driftType:"content_deviation"|"expired_attestation"|"unreviewed"|"control_gap"|"owner_absent";
  readonly severity:"critical"|"high"|"medium"|"low";
  readonly detectedAt:string; readonly recommendation:string;
}

const policyStore      = new Map<string, any>();
const attestationStore = new Map<string,PolicyAttestation[]>();
let   policySeq        = 0;

export class GovernancePolicyRuntime {
  constructor(private readonly tenantId:string) {}

  issue(params:{title:string;category:PolicyCategory;ownerId:string;content:string;obligationIds?:string[];controlIds?:string[];reviewCycleMonths?:number;createdBy:string}):any {
    const crypto = require("crypto");
    policySeq++;
    const id = uuidv4();
    const hash = crypto.createHash("sha256").update(`${id}:${params.title}:${params.content}`).digest("hex").slice(0,32);
    const policy = Object.freeze({
      id, tenantId:this.tenantId,
      code:`POL-${String(policySeq).padStart(4,"0")}`,
      title:params.title, version:"1.0", category:params.category,
      status:"draft", ownerId:params.ownerId,
      obligationIds:params.obligationIds??[], controlIds:params.controlIds??[],
      content:params.content, changeLog:[{changedAt:new Date().toISOString(),changedBy:params.createdBy,changeType:"created",description:"Policy issued"}],
      attestationRequired:true, reviewCycleMonths:params.reviewCycleMonths??12,
      hash, createdAt:new Date().toISOString(), updatedAt:new Date().toISOString(), createdBy:params.createdBy,
    });
    policyStore.set(id, policy as unknown as PolicyRecord);
    getEventStore(this.tenantId).append({topic:"policy.issued",payload:{policyId:id,code:policy.code,title:params.title,category:params.category},actorId:params.createdBy,actorRole:"policy_owner"});
    return policy;
  }

  activate(policyId:string, approvedById:string):any {
    const p = policyStore.get(policyId);
    if(!p||p.tenantId!==this.tenantId) throw Object.assign(new Error("Policy not found"),{statusCode:404});
    const now = new Date().toISOString();
    const updated = Object.freeze({...p, status:"active", approvedById, effectiveFrom:now,
      changeLog:[...p.changeLog,{changedAt:now,changedBy:approvedById,changeType:"activated",description:"Policy activated"}],
      updatedAt:now});
    policyStore.set(policyId, updated as unknown as PolicyRecord);
    getEventStore(this.tenantId).append({topic:"policy.activated",payload:{policyId,code:p.code},actorId:approvedById,actorRole:"policy_approver"});
    return updated;
  }

  attest(policyId:string, attestedById:string):PolicyAttestation {
    const crypto = require("crypto");
    const p = policyStore.get(policyId);
    if(!p||p.tenantId!==this.tenantId) throw Object.assign(new Error("Policy not found"),{statusCode:404});
    const now = new Date().toISOString();
    const att:PolicyAttestation = Object.freeze({
      id:uuidv4(), tenantId:this.tenantId, policyId, attestedById,
      attestedAt:now, valid:true,
      signature:crypto.createHash("sha256").update(`${policyId}:${attestedById}:${now}`).digest("hex").slice(0,16),
      expiresAt:new Date(Date.now()+p.reviewCycleMonths*30*24*3600000).toISOString(),
    });
    if(!attestationStore.has(policyId)) attestationStore.set(policyId,[]);
    attestationStore.get(policyId)!.push(att);
    getEventStore(this.tenantId).append({topic:"policy.attested",payload:{policyId,attestedById},actorId:attestedById,actorRole:"policy_attester"});
    return att;
  }

  detectDrift():PolicyDriftSignal[] {
    const signals:PolicyDriftSignal[] = [];
    const now = new Date().toISOString();
    for(const p of [...policyStore.values()].filter(p=>p.tenantId===this.tenantId)) {
      if(p.status==="active" && p.expiresAt && p.expiresAt<now) {
        signals.push({policyId:p.id,policyTitle:p.title,driftType:"expired_attestation",severity:"high",detectedAt:now,recommendation:`Renew policy "${p.title}" immediately — expired ${p.expiresAt}`});
      }
      if(!p.ownerId) {
        signals.push({policyId:p.id,policyTitle:p.title,driftType:"owner_absent",severity:"critical",detectedAt:now,recommendation:`Assign owner to policy "${p.title}"`});
      }
      const atts = attestationStore.get(p.id)??[];
      if(p.attestationRequired && atts.length===0) {
        signals.push({policyId:p.id,policyTitle:p.title,driftType:"expired_attestation",severity:"medium",detectedAt:now,recommendation:`Collect attestations for policy "${p.title}"`});
      }
    }
    return signals;
  }

  getAll(status?:PolicyStatus):PolicyRecord[] { return [...policyStore.values()].filter(p=>p.tenantId===this.tenantId&&(!status||p.status===status)); }
  getById(id:string):PolicyRecord|undefined { const p=policyStore.get(id); return p?.tenantId===this.tenantId?p:undefined; }
  getAttestations(policyId:string):PolicyAttestation[] { return attestationStore.get(policyId)?.filter(a=>a.tenantId===this.tenantId)??[]; }
}

const policyCache=new Map<string,GovernancePolicyRuntime>();
export function getPolicyRuntime(tenantId:string):GovernancePolicyRuntime {
  if(!policyCache.has(tenantId)) policyCache.set(tenantId,new GovernancePolicyRuntime(tenantId));
  return policyCache.get(tenantId)!;
}
