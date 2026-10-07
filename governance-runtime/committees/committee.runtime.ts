/**
 * Committee Governance Runtime — Phase 6.3
 * Seven committee types with independent authorities, quorum, and workflows.
 */
import { v4 as uuidv4 } from "uuid";
import * as crypto from "crypto";
import { getEventStore } from "../../runtime/persistence/persistent.event.store";

export type CommitteeType = "audit"|"risk"|"nomination"|"compensation"|"investment"|"compliance"|"technology_ai";

export interface Committee {
  readonly id:string; readonly tenantId:string;
  readonly type:CommitteeType; readonly name:string;
  readonly charterRef:string; readonly memberIds:string[];
  readonly chairId:string; readonly secretaryId:string;
  readonly quorumRequired:number;
  readonly authorities:string[]; readonly restrictions:string[];
  readonly meetingFrequency:"monthly"|"quarterly"|"as_needed";
  readonly status:"active"|"inactive"|"dissolved";
  readonly createdAt:string; readonly createdBy:string;
}

export interface CommitteeMeeting {
  readonly id:string; readonly tenantId:string;
  readonly committeeId:string; readonly scheduledAt:string;
  readonly attendeeIds:string[]; readonly quorumMet:boolean;
  readonly agendaItems:string[]; readonly decisions:CommitteeDecision[];
  readonly status:"scheduled"|"in_progress"|"completed"|"cancelled";
  readonly minutesHash:string; readonly createdAt:string;
}

export interface CommitteeDecision {
  readonly id:string; readonly meetingId:string;
  readonly title:string; readonly outcome:"approved"|"rejected"|"deferred"|"noted";
  readonly votesFor:number; readonly votesAgainst:number;
  readonly requiredEscalation:boolean; readonly escalateTo?:string;
  readonly evidenceIds:string[]; readonly decidedAt:string; readonly signature:string;
}

const DEFAULT_AUTHORITIES:Record<CommitteeType,string[]> = {
  audit:         ["approve_audit_plan","review_findings","appoint_external_auditor"],
  risk:          ["approve_risk_appetite","review_risk_register","approve_exceptions"],
  nomination:    ["nominate_directors","evaluate_executives","approve_succession_plan"],
  compensation:  ["approve_remuneration","approve_incentives","review_performance"],
  investment:    ["approve_investments","review_portfolio","approve_budget"],
  compliance:    ["approve_compliance_program","review_violations","approve_remediation"],
  technology_ai: ["approve_ai_models","review_ai_risks","govern_ai_agents"],
};

const committeeStore = new Map<string,Committee>();
const meetingStore   = new Map<string,CommitteeMeeting>();

export class CommitteeRuntime {
  constructor(private readonly tenantId:string) {}

  establish(params:Omit<Committee,"id"|"tenantId"|"createdAt"|"authorities"|"restrictions">&{customAuthorities?:string[]}):Committee {
    const c:Committee = Object.freeze({...params, id:uuidv4(), tenantId:this.tenantId,
      authorities:[...(DEFAULT_AUTHORITIES[params.type]??[]),...(params.customAuthorities??[])],
      restrictions:[`cannot_exceed_board_authority`,`requires_quorum_of_${params.quorumRequired}`],
      createdAt:new Date().toISOString()});
    committeeStore.set(c.id,c);
    getEventStore(this.tenantId).append({topic:`committee.${params.type}.established`,payload:{committeeId:c.id,type:params.type,name:params.name},actorId:params.createdBy,actorRole:"board_secretary"});
    return c;
  }

  scheduleM(committeeId:string,scheduledAt:string,agendaItems:string[],scheduledBy:string):CommitteeMeeting {
    const c=committeeStore.get(committeeId);
    if(!c||c.tenantId!==this.tenantId) throw Object.assign(new Error("Committee not found"),{statusCode:404});
    const m:CommitteeMeeting=Object.freeze({id:uuidv4(),tenantId:this.tenantId,committeeId,scheduledAt,attendeeIds:[],quorumMet:false,agendaItems,decisions:[],status:"scheduled",minutesHash:crypto.createHash("sha256").update(`${committeeId}:${scheduledAt}`).digest("hex").slice(0,16),createdAt:new Date().toISOString()});
    meetingStore.set(m.id,m);
    getEventStore(this.tenantId).append({topic:"committee.meeting.scheduled",payload:{meetingId:m.id,committeeId,scheduledAt},actorId:scheduledBy,actorRole:"committee_secretary"});
    return m;
  }

  recordDecision(meetingId:string,params:{title:string;outcome:CommitteeDecision["outcome"];votesFor:number;votesAgainst:number;evidenceIds:string[];decidedBy:string}):CommitteeMeeting {
    const m=meetingStore.get(meetingId);
    if(!m||m.tenantId!==this.tenantId) throw Object.assign(new Error("Meeting not found"),{statusCode:404});
    const d:CommitteeDecision=Object.freeze({id:uuidv4(),meetingId,title:params.title,outcome:params.outcome,votesFor:params.votesFor,votesAgainst:params.votesAgainst,requiredEscalation:params.outcome==="deferred"||params.votesAgainst>params.votesFor,evidenceIds:params.evidenceIds,decidedAt:new Date().toISOString(),signature:crypto.createHash("sha256").update(`${meetingId}:${params.title}:${params.outcome}`).digest("hex").slice(0,16)});
    const updated=Object.freeze({...m,decisions:[...m.decisions,d]});
    meetingStore.set(meetingId,updated);
    getEventStore(this.tenantId).append({topic:`committee.decision.${params.outcome}`,payload:{meetingId,title:params.title,outcome:params.outcome},actorId:params.decidedBy,actorRole:"committee_chair"});
    return updated;
  }

  checkAuthority(committeeId:string,action:string):{allowed:boolean;reason:string} {
    const c=committeeStore.get(committeeId);
    if(!c||c.tenantId!==this.tenantId) return {allowed:false,reason:"Committee not found"};
    if(c.status!=="active") return {allowed:false,reason:`Committee is ${c.status}`};
    return c.authorities.includes(action)||c.authorities.includes("*") ? {allowed:true,reason:"Authorized by committee charter"} : {allowed:false,reason:`Action "${action}" not in charter`};
  }

  getCommittee(id:string):Committee|undefined { const c=committeeStore.get(id); return c?.tenantId===this.tenantId?c:undefined; }
  getByType(type:CommitteeType):Committee[] { return [...committeeStore.values()].filter(c=>c.tenantId===this.tenantId&&c.type===type); }
  getMeetings(committeeId?:string):CommitteeMeeting[] { return [...meetingStore.values()].filter(m=>m.tenantId===this.tenantId&&(!committeeId||m.committeeId===committeeId)); }
}

const cache=new Map<string,CommitteeRuntime>();
export function getCommitteeRuntime(tenantId:string):CommitteeRuntime {
  if(!cache.has(tenantId)) cache.set(tenantId,new CommitteeRuntime(tenantId));
  return cache.get(tenantId)!;
}
