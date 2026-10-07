/**
 * Incident & Crisis Governance Runtime — Phase 7.7
 * Classification, severity, escalation, CAPA, decision logs.
 */
import { v4 as uuidv4 } from "uuid";
import { getEventStore } from "../../runtime/persistence/persistent.event.store";

export type IncidentSeverity  = "p0_crisis"|"p1_critical"|"p2_high"|"p3_medium"|"p4_low";
export type IncidentCategory  = "security"|"operational"|"compliance"|"governance"|"ai"|"third_party"|"financial"|"reputational";
export type IncidentStatus    = "detected"|"triaged"|"investigating"|"contained"|"resolved"|"closed"|"escalated_to_crisis";

export interface IncidentRecord {
  readonly id:string; readonly tenantId:string;
  readonly code:string; readonly title:string; readonly description:string;
  readonly category:IncidentCategory; readonly severity:IncidentSeverity;
  readonly status:IncidentStatus; readonly ownerId:string;
  readonly linkedRiskIds:string[]; readonly linkedControlIds:string[];
  readonly evidenceIds:string[]; readonly capaIds:string[];
  readonly timeline:IncidentEvent[]; readonly isCrisis:boolean;
  readonly crisisDecisionLog:string[];
  readonly detectedAt:string; readonly resolvedAt?:string; readonly closedAt?:string;
  readonly rootCause?:string; readonly lessonsLearned?:string;
  readonly createdAt:string;
}

export interface IncidentEvent {
  readonly timestamp:string; readonly actorId:string;
  readonly eventType:"detected"|"triaged"|"escalated"|"update"|"contained"|"resolved"|"capa_issued";
  readonly description:string; readonly evidenceId?:string;
}

export interface CAPA {
  readonly id:string; readonly tenantId:string;
  readonly incidentId:string; readonly title:string;
  readonly type:"corrective"|"preventive"; readonly ownerId:string;
  readonly dueDate:string; readonly status:"open"|"in_progress"|"completed"|"overdue";
  readonly priority:"critical"|"high"|"medium"|"low";
  readonly evidenceId?:string; readonly completedAt?:string; readonly createdAt:string;
}

const incidentStore = new Map<string,IncidentRecord>();
const capaStore     = new Map<string,CAPA>();
let   incidentSeq   = 0;

export class IncidentCrisisRuntime {
  constructor(private readonly tenantId:string) {}

  detect(params:{title:string;description:string;category:IncidentCategory;severity:IncidentSeverity;ownerId:string;linkedRiskIds?:string[];detectedBy:string}):IncidentRecord {
    incidentSeq++;
    const id = uuidv4();
    const isCrisis = params.severity === "p0_crisis";
    const evt:IncidentEvent = {timestamp:new Date().toISOString(),actorId:params.detectedBy,eventType:"detected",description:`Incident detected: ${params.description}`};
    const inc:IncidentRecord = Object.freeze({
      id, tenantId:this.tenantId,
      code:`INC-${String(incidentSeq).padStart(5,"0")}`,
      title:params.title, description:params.description,
      category:params.category, severity:params.severity,
      status:isCrisis?"escalated_to_crisis":"detected",
      ownerId:params.ownerId,
      linkedRiskIds:params.linkedRiskIds??[], linkedControlIds:[],
      evidenceIds:[], capaIds:[], timeline:[evt],
      isCrisis, crisisDecisionLog:[],
      detectedAt:new Date().toISOString(), createdAt:new Date().toISOString(),
    });
    incidentStore.set(id, inc);
    getEventStore(this.tenantId).append({topic:isCrisis?"incident.crisis.detected":"incident.detected",payload:{incidentId:id,code:inc.code,severity:params.severity,category:params.category},actorId:params.detectedBy,actorRole:"incident_manager"});
    return inc;
  }

  escalate(incidentId:string,toSeverity:IncidentSeverity,reason:string,escalatedBy:string):IncidentRecord {
    const inc = incidentStore.get(incidentId);
    if(!inc||inc.tenantId!==this.tenantId) throw Object.assign(new Error("Incident not found"),{statusCode:404});
    const isCrisis = toSeverity==="p0_crisis";
    const evt:IncidentEvent = {timestamp:new Date().toISOString(),actorId:escalatedBy,eventType:"escalated",description:`Escalated to ${toSeverity}: ${reason}`};
    const updated:IncidentRecord=Object.freeze({...inc,severity:toSeverity,status:isCrisis?"escalated_to_crisis":"investigating",isCrisis,timeline:[...inc.timeline,evt],crisisDecisionLog:isCrisis?[...inc.crisisDecisionLog,`[${new Date().toISOString()}] ${reason}`]:inc.crisisDecisionLog});
    incidentStore.set(incidentId,updated);
    getEventStore(this.tenantId).append({topic:"incident.escalated",payload:{incidentId,toSeverity,reason},actorId:escalatedBy,actorRole:"incident_manager"});
    return updated;
  }

  createCAPA(incidentId:string,params:{title:string;type:CAPA["type"];ownerId:string;dueDate:string;priority:CAPA["priority"]}):CAPA {
    const inc = incidentStore.get(incidentId);
    if(!inc||inc.tenantId!==this.tenantId) throw Object.assign(new Error("Incident not found"),{statusCode:404});
    const capa:CAPA = Object.freeze({id:uuidv4(),tenantId:this.tenantId,incidentId,...params,status:"open",createdAt:new Date().toISOString()});
    capaStore.set(capa.id,capa);
    const capaEvt:IncidentEvent={timestamp:new Date().toISOString(),actorId:params.ownerId,eventType:"capa_issued",description:`CAPA issued: ${params.title}`};
    const updated:IncidentRecord=Object.freeze({...inc,capaIds:[...inc.capaIds,capa.id],timeline:[...inc.timeline,capaEvt]});
    incidentStore.set(incidentId,updated);
    getEventStore(this.tenantId).append({topic:"incident.capa.created",payload:{incidentId,capaId:capa.id,title:params.title},actorId:params.ownerId,actorRole:"incident_manager"});
    return capa;
  }

  resolve(incidentId:string,rootCause:string,lessonsLearned:string,resolvedBy:string):IncidentRecord {
    const inc=incidentStore.get(incidentId);
    if(!inc||inc.tenantId!==this.tenantId) throw Object.assign(new Error("Incident not found"),{statusCode:404});
    const evt:IncidentEvent={timestamp:new Date().toISOString(),actorId:resolvedBy,eventType:"resolved",description:`Resolved. Root cause: ${rootCause}`};
    const updated:IncidentRecord=Object.freeze({...inc,status:"resolved",rootCause,lessonsLearned,resolvedAt:new Date().toISOString(),timeline:[...inc.timeline,evt]});
    incidentStore.set(incidentId,updated);
    getEventStore(this.tenantId).append({topic:"incident.resolved",payload:{incidentId,code:inc.code,rootCause},actorId:resolvedBy,actorRole:"incident_manager"});
    return updated;
  }

  getAll(category?:IncidentCategory):IncidentRecord[] { return [...incidentStore.values()].filter(i=>i.tenantId===this.tenantId&&(!category||i.category===category)); }
  getById(id:string):IncidentRecord|undefined { const i=incidentStore.get(id); return i?.tenantId===this.tenantId?i:undefined; }
  getCrises():IncidentRecord[] { return this.getAll().filter(i=>i.isCrisis); }
  getCAPAs(incidentId?:string):CAPA[] { return [...capaStore.values()].filter(c=>c.tenantId===this.tenantId&&(!incidentId||c.incidentId===incidentId)); }
  getOpenCAPAs():CAPA[] { return this.getCAPAs().filter(c=>c.status==="open"||c.status==="in_progress"); }
}

const incidentCache=new Map<string,IncidentCrisisRuntime>();
export function getIncidentRuntime(tenantId:string):IncidentCrisisRuntime {
  if(!incidentCache.has(tenantId)) incidentCache.set(tenantId,new IncidentCrisisRuntime(tenantId));
  return incidentCache.get(tenantId)!;
}
