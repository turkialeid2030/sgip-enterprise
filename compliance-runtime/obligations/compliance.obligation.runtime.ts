/**
 * Compliance Obligation Runtime — Phase 7.3
 * Obligation registry, regulatory mapping, drift detection, attestation workflows.
 */
import { v4 as uuidv4 } from "uuid";
import { getEventStore } from "../../runtime/persistence/persistent.event.store";

export type ObligationStatus = "active"|"pending"|"breached"|"remediated"|"waived"|"expired";
export type ObligationSource = "regulation"|"contract"|"standard"|"policy"|"court_order"|"self_imposed";

export interface ComplianceObligation {
  readonly id:string; readonly tenantId:string;
  readonly code:string; readonly title:string; readonly description:string;
  readonly source:ObligationSource; readonly regulatorId?:string;
  readonly jurisdiction:string; readonly framework:string;
  readonly dueDate?:string; readonly reviewDate:string;
  readonly status:ObligationStatus; readonly ownerId:string;
  readonly controlIds:string[]; readonly evidenceIds:string[];
  readonly riskExposure:number; readonly penaltyEstimate?:number;
  readonly breachCount:number; readonly lastTestedAt?:string;
  readonly createdAt:string; readonly updatedAt:string;
}

export interface ObligationDriftSignal {
  readonly obligationId:string; readonly title:string;
  readonly driftType:"overdue"|"evidence_gap"|"control_gap"|"attestation_expired"|"regulator_change";
  readonly severity:"critical"|"high"|"medium";
  readonly detectedAt:string; readonly daysOverdue?:number;
}

export interface RegulatorImpact {
  readonly regulatorId:string; readonly regulatorName:string;
  readonly affectedObligations:string[]; readonly changeType:string;
  readonly effectiveDate:string; readonly impactSummary:string;
}

const obligationStore = new Map<string,ComplianceObligation>();
let   oblSeq          = 0;

export class ComplianceObligationRuntime {
  constructor(private readonly tenantId:string) {}

  register(params:{title:string;description:string;source:ObligationSource;framework:string;jurisdiction:string;ownerId:string;controlIds?:string[];riskExposure?:number;penaltyEstimate?:number;dueDate?:string}):ComplianceObligation {
    oblSeq++;
    const obl:ComplianceObligation = Object.freeze({
      id:uuidv4(), tenantId:this.tenantId,
      code:`OBL-${String(oblSeq).padStart(4,"0")}`,
      title:params.title, description:params.description,
      source:params.source, jurisdiction:params.jurisdiction, framework:params.framework,
      dueDate:params.dueDate, reviewDate:new Date(Date.now()+90*24*3600000).toISOString(),
      status:"active", ownerId:params.ownerId,
      controlIds:params.controlIds??[], evidenceIds:[],
      riskExposure:params.riskExposure??5, penaltyEstimate:params.penaltyEstimate,
      breachCount:0, createdAt:new Date().toISOString(), updatedAt:new Date().toISOString(),
    });
    obligationStore.set(obl.id, obl);
    getEventStore(this.tenantId).append({topic:"compliance.obligation.registered",payload:{oblId:obl.id,code:obl.code,framework:params.framework},actorId:params.ownerId,actorRole:"compliance_officer"});
    return obl;
  }

  markBreach(oblId:string, reason:string, reportedBy:string):ComplianceObligation {
    const o=obligationStore.get(oblId);
    if(!o||o.tenantId!==this.tenantId) throw Object.assign(new Error("Obligation not found"),{statusCode:404});
    const updated:ComplianceObligation=Object.freeze({...o,status:"breached",breachCount:o.breachCount+1,updatedAt:new Date().toISOString()});
    obligationStore.set(oblId,updated);
    getEventStore(this.tenantId).append({topic:"compliance.obligation.breached",payload:{oblId,code:o.code,reason,breachCount:updated.breachCount},actorId:reportedBy,actorRole:"compliance_officer",idempotencyKey:`breach-${oblId}-${updated.breachCount}`});
    return updated;
  }

  detectDrift():ObligationDriftSignal[] {
    const signals:ObligationDriftSignal[]=[];
    const now=new Date().toISOString();
    for(const o of [...obligationStore.values()].filter(o=>o.tenantId===this.tenantId)) {
      if(o.dueDate&&o.dueDate<now&&o.status==="active") {
        const days=Math.round((Date.now()-new Date(o.dueDate).getTime())/86400000);
        signals.push({obligationId:o.id,title:o.title,driftType:"overdue",severity:days>30?"critical":"high",detectedAt:now,daysOverdue:days});
      }
      if(o.controlIds.length===0) {
        signals.push({obligationId:o.id,title:o.title,driftType:"control_gap",severity:"high",detectedAt:now});
      }
      if(o.evidenceIds.length===0) {
        signals.push({obligationId:o.id,title:o.title,driftType:"evidence_gap",severity:"medium",detectedAt:now});
      }
    }
    return signals;
  }

  getAll(status?:ObligationStatus):ComplianceObligation[] { return [...obligationStore.values()].filter(o=>o.tenantId===this.tenantId&&(!status||o.status===status)); }
  getById(id:string):ComplianceObligation|undefined { const o=obligationStore.get(id); return o?.tenantId===this.tenantId?o:undefined; }
  getBreached():ComplianceObligation[] { return this.getAll("breached"); }
  getTotalExposure():number { return this.getAll().reduce((s,o)=>s+o.riskExposure,0); }
}

const oblCache=new Map<string,ComplianceObligationRuntime>();
export function getComplianceObligationRuntime(tenantId:string):ComplianceObligationRuntime {
  if(!oblCache.has(tenantId)) oblCache.set(tenantId,new ComplianceObligationRuntime(tenantId));
  return oblCache.get(tenantId)!;
}
