/**
 * Board Governance Runtime — Phase 6.2
 * Digital board sessions, resolutions, voting, quorum, immutable decision trails.
 */
import { v4 as uuidv4 } from "uuid";
import * as crypto from "crypto";
import { getEventStore } from "../../runtime/persistence/persistent.event.store";
import { getGRCOntology } from "../../grc-ontology/grc.ontology.engine";

export type BoardSessionStatus = "scheduled" | "quorum_pending" | "in_session" | "adjourned" | "cancelled";
export type ResolutionStatus   = "draft" | "proposed" | "under_vote" | "passed" | "failed" | "withdrawn" | "superseded";
export type VoteChoice         = "for" | "against" | "abstain" | "absent";

export interface BoardSession {
  readonly id:          string;
  readonly tenantId:    string;
  readonly type:        "ordinary" | "extraordinary" | "emergency";
  readonly scheduledAt: string;
  readonly status:      BoardSessionStatus;
  readonly memberIds:   string[];
  readonly attendeeIds: string[];
  readonly quorumRequired:number;       // min members
  readonly quorumMet:   boolean;
  readonly agendaItems: string[];
  readonly hash:        string;
  readonly createdAt:   string;
  readonly createdBy:   string;
}

export interface BoardResolution {
  readonly id:          string;
  readonly tenantId:    string;
  readonly sessionId:   string;
  readonly code:        string;          // RES-2025-001
  readonly title:       string;
  readonly description: string;
  readonly status:      ResolutionStatus;
  readonly votes:       Vote[];
  readonly votesFor:    number;
  readonly votesAgainst:number;
  readonly abstentions: number;
  readonly quorumMet:   boolean;
  readonly passedAt?:   string;
  readonly failedAt?:   string;
  readonly hash:        string;          // cryptographic integrity
  readonly previousHash:string;
  readonly createdAt:   string;
  readonly createdBy:   string;
}

export interface Vote {
  readonly memberId:    string;
  readonly memberRole:  string;
  readonly choice:      VoteChoice;
  readonly timestamp:   string;
  readonly signature:   string;          // memberId:choice:timestamp hash
  readonly conflicts?:  string[];        // declared conflicts of interest
}

const sessionStore    = new Map<string, BoardSession>();
const resolutionStore = new Map<string, BoardResolution>();
let   resolutionSeq   = 0;

function computeResolutionHash(r: Partial<BoardResolution>, previousHash: string): string {
  const canonical = JSON.stringify({ id:r.id, sessionId:r.sessionId, title:r.title, votes:r.votes, previousHash });
  return crypto.createHash("sha256").update(canonical).digest("hex").slice(0, 32);
}

export class BoardRuntime {
  constructor(private readonly tenantId: string) {}

  scheduleSession(params: {
    type:          BoardSession["type"];
    scheduledAt:   string;
    memberIds:     string[];
    quorumRequired:number;
    agendaItems:   string[];
    createdBy:     string;
  }): BoardSession {
    const id = uuidv4();
    const session: BoardSession = Object.freeze({
      id, tenantId:this.tenantId,
      type:          params.type,
      scheduledAt:   params.scheduledAt,
      status:        "scheduled",
      memberIds:     params.memberIds,
      attendeeIds:   [],
      quorumRequired:params.quorumRequired,
      quorumMet:     false,
      agendaItems:   params.agendaItems,
      hash:          crypto.createHash("sha256").update(`${id}:${params.scheduledAt}`).digest("hex").slice(0,16),
      createdAt:     new Date().toISOString(),
      createdBy:     params.createdBy,
    });
    sessionStore.set(id, session);

    getEventStore(this.tenantId).append({
      topic:"board.session.scheduled",
      payload:{ sessionId:id, type:params.type, scheduledAt:params.scheduledAt },
      actorId:params.createdBy, actorRole:"board_secretary",
    });
    return session;
  }

  recordAttendance(sessionId: string, attendeeIds: string[]): BoardSession {
    const s = sessionStore.get(sessionId);
    if (!s || s.tenantId !== this.tenantId) throw Object.assign(new Error("Session not found"), {statusCode:404});
    const quorumMet = attendeeIds.length >= s.quorumRequired;
    const updated: BoardSession = Object.freeze({ ...s, attendeeIds, quorumMet, status: quorumMet ? "in_session" : "quorum_pending" });
    sessionStore.set(sessionId, updated);
    getEventStore(this.tenantId).append({ topic:"board.session.attendance", payload:{ sessionId, attendeeCount:attendeeIds.length, quorumMet }, actorId:"system", actorRole:"system" });
    return updated;
  }

  proposeResolution(params: { sessionId:string; title:string; description:string; createdBy:string }): BoardResolution {
    const s = sessionStore.get(params.sessionId);
    if (!s || s.tenantId !== this.tenantId) throw Object.assign(new Error("Session not found"), {statusCode:404});
    if (!s.quorumMet) throw Object.assign(new Error("Cannot propose: quorum not met"), {statusCode:422});

    resolutionSeq++;
    const id   = uuidv4();
    const prev = [...resolutionStore.values()].filter(r => r.tenantId === this.tenantId).at(-1);
    const previousHash = prev?.hash ?? "GENESIS";
    const partial = { id, sessionId:params.sessionId, title:params.title, votes:[] };
    const hash = computeResolutionHash(partial, previousHash);

    const res: BoardResolution = Object.freeze({
      id, tenantId:this.tenantId, sessionId:params.sessionId,
      code:    `RES-${new Date().getFullYear()}-${String(resolutionSeq).padStart(3,"0")}`,
      title:   params.title, description:params.description,
      status:  "under_vote", votes:[], votesFor:0, votesAgainst:0, abstentions:0,
      quorumMet:s.quorumMet, hash, previousHash,
      createdAt:new Date().toISOString(), createdBy:params.createdBy,
    });
    resolutionStore.set(id, res);
    getEventStore(this.tenantId).append({ topic:"board.resolution.proposed", payload:{ resolutionId:id, code:res.code, title:params.title }, actorId:params.createdBy, actorRole:"board_director" });
    return res;
  }

  castVote(resolutionId: string, memberId: string, memberRole: string, choice: VoteChoice, conflicts?: string[]): BoardResolution {
    const res = resolutionStore.get(resolutionId);
    if (!res || res.tenantId !== this.tenantId) throw Object.assign(new Error("Resolution not found"), {statusCode:404});
    if (res.status !== "under_vote") throw Object.assign(new Error(`Cannot vote: status is ${res.status}`), {statusCode:409});

    const sig  = crypto.createHash("sha256").update(`${memberId}:${choice}:${new Date().toISOString()}`).digest("hex").slice(0,16);
    const vote: Vote = Object.freeze({ memberId, memberRole, choice, timestamp:new Date().toISOString(), signature:sig, conflicts });

    const updatedVotes  = [...res.votes, vote];
    const votesFor      = updatedVotes.filter(v => v.choice === "for").length;
    const votesAgainst  = updatedVotes.filter(v => v.choice === "against").length;
    const abstentions   = updatedVotes.filter(v => v.choice === "abstain").length;

    const updated: BoardResolution = Object.freeze({ ...res, votes:updatedVotes, votesFor, votesAgainst, abstentions });
    resolutionStore.set(resolutionId, updated);
    getEventStore(this.tenantId).append({ topic:"board.vote.cast", payload:{ resolutionId, memberId, choice, conflicts }, actorId:memberId, actorRole:memberRole });
    return updated;
  }

  closeVote(resolutionId: string, closedBy: string): BoardResolution {
    const res = resolutionStore.get(resolutionId);
    if (!res || res.tenantId !== this.tenantId) throw Object.assign(new Error("Resolution not found"), {statusCode:404});
    const now    = new Date().toISOString();
    const passed = res.votesFor > res.votesAgainst;
    const updated: BoardResolution = Object.freeze({ ...res, status: passed ? "passed" : "failed", passedAt: passed?now:undefined, failedAt:!passed?now:undefined });
    resolutionStore.set(resolutionId, updated);
    getEventStore(this.tenantId).append({ topic:`board.resolution.${passed?"passed":"failed"}`, payload:{ resolutionId, code:res.code, votesFor:res.votesFor, votesAgainst:res.votesAgainst }, actorId:closedBy, actorRole:"board_chair" });
    return updated;
  }

  getSession(id: string): BoardSession | undefined { const s = sessionStore.get(id); return s?.tenantId===this.tenantId?s:undefined; }
  getResolution(id: string): BoardResolution | undefined { const r = resolutionStore.get(id); return r?.tenantId===this.tenantId?r:undefined; }
  getSessions(): BoardSession[] { return [...sessionStore.values()].filter(s=>s.tenantId===this.tenantId); }
  getResolutions(sessionId?: string): BoardResolution[] { return [...resolutionStore.values()].filter(r=>r.tenantId===this.tenantId&&(!sessionId||r.sessionId===sessionId)); }
  getPassedResolutions(): BoardResolution[] { return this.getResolutions().filter(r=>r.status==="passed"); }
}

const boardCache = new Map<string, BoardRuntime>();
export function getBoardRuntime(tenantId: string): BoardRuntime {
  if (!boardCache.has(tenantId)) boardCache.set(tenantId, new BoardRuntime(tenantId));
  return boardCache.get(tenantId)!;
}
