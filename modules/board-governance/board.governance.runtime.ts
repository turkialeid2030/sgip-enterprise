/**
 * Board Governance Runtime
 * Board packs, committee governance, delegated authority, executive accountability.
 * All board decisions are immutable and traceable.
 */
import { v4 as uuidv4 } from "uuid";
import { TenantContext } from "../../types/tenant.types";
import { requireTenantContext } from "../../tenant/tenant.context";
import { getEvidenceEngine } from "../../evidence/lineage/evidence.lineage.engine";
import { getDecisionEngine } from "../../governance/decisions/decision.engine";
import { executiveSummaryEngine } from "../../governance/narrative/executive.summary.engine";

export type BoardMeetingStatus = "scheduled" | "in_progress" | "adjourned" | "cancelled";
export type CommitteeType = "board" | "audit" | "risk" | "remuneration" | "nomination" | "technology" | "esg";

export interface BoardCommittee {
  id:            string;
  tenantId:      string;
  name:          string;
  type:          CommitteeType;
  chair:         string;
  members:       string[];
  quorumRequired:number;             // minimum members for valid vote
  mandate:       string;
  meetingCycle:  "monthly" | "quarterly" | "annual";
  createdAt:     string;
}

export interface BoardMeeting {
  id:            string;
  tenantId:      string;
  code:          string;             // BRD-MTG-001
  committeeId:   string;
  scheduledAt:   string;
  status:        BoardMeetingStatus;
  attendees:     string[];
  agenda:        string[];
  resolutions:   BoardResolution[];
  minutesId?:    string;             // immutable record ID
  chairpersonId: string;
  correlationId: string;
  createdAt:     string;
  updatedAt:     string;
}

export interface BoardResolution {
  id:             string;
  meetingId:      string;
  tenantId:       string;
  code:           string;            // RES-001
  title:          string;
  description:    string;
  resolution:     "approved" | "rejected" | "deferred" | "noted";
  proposedBy:     string;
  secondedBy?:    string;
  votesFor:       number;
  votesAgainst:   number;
  abstentions:    number;
  linkedDecisionId?:string;
  evidenceIds:    string[];
  isImmutable:    boolean;
  resolvedAt:     string;
  immutableId?:   string;
}

const committeeStore = new Map<string, BoardCommittee>();
const meetingStore   = new Map<string, BoardMeeting>();

export class BoardGovernanceRuntime {
  constructor(private readonly tenantId: string) {}

  createCommittee(params: Omit<BoardCommittee, "id" | "tenantId" | "createdAt">): BoardCommittee {
    const cmte: BoardCommittee = { ...params, id:uuidv4(), tenantId:this.tenantId, createdAt:new Date().toISOString() };
    committeeStore.set(cmte.id, cmte);
    return cmte;
  }

  scheduleMeeting(params: { committeeId:string; scheduledAt:string; agenda:string[]; chairpersonId:string; attendees:string[] }, ctx: TenantContext): BoardMeeting {
    requireTenantContext(ctx, "BoardGovernanceRuntime.scheduleMeeting");
    const count = [...meetingStore.values()].filter(m => m.tenantId === this.tenantId).length + 1;
    const now   = new Date().toISOString();
    const mtg: BoardMeeting = {
      id:           uuidv4(),
      tenantId:     this.tenantId,
      code:         `BRD-MTG-${String(count).padStart(3,"0")}`,
      committeeId:  params.committeeId,
      scheduledAt:  params.scheduledAt,
      status:       "scheduled",
      attendees:    params.attendees,
      agenda:       params.agenda,
      resolutions:  [],
      chairpersonId:params.chairpersonId,
      correlationId:uuidv4(),
      createdAt:    now,
      updatedAt:    now,
    };
    meetingStore.set(mtg.id, mtg);
    return mtg;
  }

  recordResolution(meetingId: string, params: { title:string; description:string; proposedBy:string; secondedBy?:string; votesFor:number; votesAgainst:number; abstentions:number; linkedDecisionId?:string }, ctx: TenantContext): BoardResolution {
    requireTenantContext(ctx, "BoardGovernanceRuntime.recordResolution");
    const mtg = this.getMeeting(meetingId);
    if (!mtg) throw Object.assign(new Error("Meeting not found"), { statusCode:404 });

    const resolution: BoardResolution["resolution"] = params.votesFor > params.votesAgainst ? "approved" : "rejected";
    const now = new Date().toISOString();
    const resCount = mtg.resolutions.length + 1;

    // Seal as immutable
    const ev     = getEvidenceEngine(this.tenantId);
    const sealed = ev.sealDecisionRecord({ decisionType:"board_resolution", entityId:meetingId, entityType:"board_meeting", actorId:params.proposedBy, actorRole:"board_reporter", outcome:resolution, rationale:params.description, evidenceRefs:[], policyRefs:[], approvalRefs:[], sodChecked:false, sodViolations:0, policyAllowed:true, correlationId:mtg.correlationId });

    const res: BoardResolution = {
      id:              uuidv4(),
      meetingId,
      tenantId:        this.tenantId,
      code:            `${mtg.code}-RES-${String(resCount).padStart(2,"0")}`,
      ...params,
      resolution,
      evidenceIds:     [sealed.decisionId],
      isImmutable:     true,
      resolvedAt:      now,
      immutableId:     sealed.decisionId,
    };

    mtg.resolutions.push(res);
    mtg.updatedAt = now;
    meetingStore.set(meetingId, mtg);
    return res;
  }

  generateBoardPack(ctx: TenantContext): object {
    requireTenantContext(ctx, "BoardGovernanceRuntime.generateBoardPack");
    const summary  = executiveSummaryEngine.generate(ctx);
    const meetings = this.getAllMeetings();
    const decEng   = getDecisionEngine(this.tenantId);
    const orphans  = decEng.getOrphanDecisions();
    return { generatedAt:new Date().toISOString(), executiveSummary:summary, recentMeetings:meetings.slice(-5), pendingResolutions:0, orphanDecisions:orphans.length, governanceScore:summary.governanceScore, boardReady:summary.boardReady };
  }

  getMeeting(id: string): BoardMeeting | undefined {
    const m = meetingStore.get(id);
    if (m && m.tenantId !== this.tenantId) return undefined;
    return m;
  }

  getAllMeetings(): BoardMeeting[] {
    return [...meetingStore.values()].filter(m => m.tenantId === this.tenantId);
  }

  getCommittees(): BoardCommittee[] {
    return [...committeeStore.values()].filter(c => c.tenantId === this.tenantId);
  }
}

const boardCache = new Map<string, BoardGovernanceRuntime>();
export function getBoardRuntime(tenantId: string): BoardGovernanceRuntime {
  if (!boardCache.has(tenantId)) boardCache.set(tenantId, new BoardGovernanceRuntime(tenantId));
  return boardCache.get(tenantId)!;
}
