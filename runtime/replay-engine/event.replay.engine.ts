/**
 * Event Replay Engine — Phase 5.8
 * Replay events by tenant, correlationId, or timestamp range.
 * Rebuilds graph/memory state from event history.
 */
import { v4 as uuidv4 } from "uuid";
import { getEventStore, PersistedEvent } from "../persistence/persistent.event.store";
import { getPersistentMemory } from "../persistent-memory/persistent.memory.layer";

export interface ReplayJob {
  id:          string;
  tenantId:    string;
  filter: {
    topic?:          string;
    correlationId?:  string;
    fromTimestamp?:  string;
    toTimestamp?:    string;
    fromSeq?:        number;
    toSeq?:          number;
    limit?:          number;
  };
  status:      "pending" | "running" | "completed" | "failed";
  eventsReplayed:number;
  startedAt?:  string;
  completedAt?:string;
  error?:      string;
}

export interface ReplayResult {
  jobId:         string;
  tenantId:      string;
  eventsReplayed:number;
  stateRebuilt:  boolean;
  summary:       string;
}

export type ReplayHandler = (event: PersistedEvent) => Promise<void>;

const replayJobs  = new Map<string, ReplayJob>();
const handlers    = new Map<string, ReplayHandler[]>();  // tenantId:topic → handlers

export class EventReplayEngine {
  constructor(private readonly tenantId: string) {}

  registerHandler(topic: string, handler: ReplayHandler): void {
    const key = `${this.tenantId}:${topic}`;
    if (!handlers.has(key)) handlers.set(key, []);
    handlers.get(key)!.push(handler);
  }

  async replay(filter: {
    topic?:         string;
    correlationId?: string;
    fromTimestamp?: string;
    toTimestamp?:   string;
    fromSeq?:       number;
    toSeq?:         number;
    limit?:         number;
  }): Promise<ReplayResult> {
    const store  = getEventStore(this.tenantId);
    const events = store.replay(filter);
    const jobId  = uuidv4();

    const job: ReplayJob = {
      id:jobId, tenantId:this.tenantId, filter,
      status:"running", eventsReplayed:0,
      startedAt:new Date().toISOString(),
    };
    replayJobs.set(jobId, job);

    try {
      for (const event of events) {
        // Order check — sequence numbers must increase
        if (events.indexOf(event) > 0) {
          const prev = events[events.indexOf(event) - 1];
          if (event.sequenceNumber <= prev.sequenceNumber) {
            job.status = "failed";
            job.error  = `Replay order corruption at seq ${event.sequenceNumber}`;
            replayJobs.set(jobId, job);
            return { jobId, tenantId:this.tenantId, eventsReplayed:job.eventsReplayed, stateRebuilt:false, summary:job.error };
          }
        }

        // Dispatch to handlers
        const topicHandlers = handlers.get(`${this.tenantId}:${event.topic}`) ?? [];
        const wildHandlers  = handlers.get(`${this.tenantId}:*`) ?? [];
        for (const h of [...topicHandlers, ...wildHandlers]) {
          await h(event);
        }
        job.eventsReplayed++;
      }

      job.status      = "completed";
      job.completedAt = new Date().toISOString();
      replayJobs.set(jobId, job);
      return { jobId, tenantId:this.tenantId, eventsReplayed:job.eventsReplayed, stateRebuilt:true, summary:`Replayed ${job.eventsReplayed} events` };
    } catch (err) {
      job.status = "failed";
      job.error  = (err as Error).message;
      replayJobs.set(jobId, job);
      return { jobId, tenantId:this.tenantId, eventsReplayed:job.eventsReplayed, stateRebuilt:false, summary:job.error! };
    }
  }

  getJob(jobId: string): ReplayJob | undefined {
    return replayJobs.get(jobId);
  }

  getJobs(): ReplayJob[] {
    return [...replayJobs.values()].filter(j => j.tenantId === this.tenantId);
  }
}

const replayCache = new Map<string, EventReplayEngine>();
export function getReplayEngine(tenantId: string): EventReplayEngine {
  if (!replayCache.has(tenantId)) replayCache.set(tenantId, new EventReplayEngine(tenantId));
  return replayCache.get(tenantId)!;
}
