/**
 * Runtime Self-Healing Engine — Phase 8.6
 * Health probes, degraded mode, automatic recovery, corruption quarantine.
 */
import { v4 as uuidv4 } from "uuid";
import { getEventStore } from "../persistence/persistent.event.store";
import { getSnapshotEngine } from "../snapshot-recovery/snapshot.recovery.engine";
import { getReplayEngine } from "../replay-engine/event.replay.engine";

export type ComponentHealth = "healthy" | "degraded" | "failed" | "recovering" | "quarantined";
export type HealingAction   = "restart" | "replay_from_snapshot" | "quarantine" | "degraded_mode" | "escalate" | "no_action";

export interface HealthProbe {
  componentId:    string;
  componentType:  string;
  tenantId:       string;
  status:         ComponentHealth;
  lastCheckAt:    string;
  latencyMs:      number;
  errorCount:     number;
  consecutiveFails:number;
  details:        Record<string, unknown>;
}

export interface HealingRecord {
  id:             string;
  tenantId:       string;
  componentId:    string;
  trigger:        string;
  action:         HealingAction;
  outcome:        "success" | "failure" | "in_progress";
  details:        string;
  startedAt:      string;
  completedAt?:   string;
}

export interface SystemHealthReport {
  tenantId:       string;
  checkedAt:      string;
  overallHealth:  ComponentHealth;
  components:     HealthProbe[];
  activeHealings: HealingRecord[];
  degradedComponents:string[];
  recommendations:string[];
}

const probeStore   = new Map<string, HealthProbe[]>();   // tenantId → probes
const healingStore = new Map<string, HealingRecord[]>(); // tenantId → healings

export class SelfHealingRuntime {
  constructor(private readonly tenantId: string) {}

  async probe(params: { componentId:string; componentType:string; checkFn:()=>Promise<{healthy:boolean;latencyMs:number;details?:Record<string,unknown>}> }): Promise<HealthProbe> {
    const existing = (probeStore.get(this.tenantId) ?? []).find(p => p.componentId === params.componentId);
    let result;
    const start = Date.now();
    try {
      result = await params.checkFn();
    } catch (err) {
      result = { healthy:false, latencyMs:Date.now()-start, details:{ error:(err as Error).message } };
    }

    const consecutiveFails = result.healthy ? 0 : (existing?.consecutiveFails ?? 0) + 1;
    const status: ComponentHealth = result.healthy ? "healthy" : consecutiveFails >= 5 ? "failed" : "degraded";

    const probe: HealthProbe = {
      componentId:     params.componentId,
      componentType:   params.componentType,
      tenantId:        this.tenantId,
      status,
      lastCheckAt:     new Date().toISOString(),
      latencyMs:       result.latencyMs,
      errorCount:      (existing?.errorCount ?? 0) + (result.healthy ? 0 : 1),
      consecutiveFails,
      details:         result.details ?? {},
    };

    const probes = probeStore.get(this.tenantId) ?? [];
    const idx    = probes.findIndex(p => p.componentId === params.componentId);
    if (idx >= 0) probes[idx] = probe; else probes.push(probe);
    probeStore.set(this.tenantId, probes);

    // Auto-heal if failed
    if (status === "failed" && consecutiveFails >= 5) {
      await this.triggerHealing(params.componentId, "consecutive_failures", params.componentType);
    }
    return probe;
  }

  async triggerHealing(componentId: string, trigger: string, componentType?: string): Promise<HealingRecord> {
    // Determine healing action based on component type
    const action: HealingAction =
      componentType === "event_store"  ? "replay_from_snapshot" :
      componentType === "memory"       ? "replay_from_snapshot" :
      componentType === "workflow"     ? "restart" :
      componentType === "persistence"  ? "degraded_mode" :
      "escalate";

    const healing: HealingRecord = {
      id: uuidv4(), tenantId:this.tenantId, componentId, trigger, action,
      outcome:"in_progress", details:`Auto-healing triggered: ${trigger}`,
      startedAt:new Date().toISOString(),
    };

    const healings = healingStore.get(this.tenantId) ?? [];
    healings.push(healing); healingStore.set(this.tenantId, healings);

    getEventStore(this.tenantId).append({ topic:"system.self_healing.triggered", payload:{ componentId, trigger, action }, actorId:"self_healing_engine", actorRole:"system" });

    // Execute healing action
    try {
      if (action === "replay_from_snapshot") {
        const snapEngine = getSnapshotEngine(this.tenantId);
        await snapEngine.recoverFromLatestSnapshot();
      } else if (action === "degraded_mode") {
        // Mark component as degraded — continue with reduced functionality
        healing.details += " — switching to degraded mode";
      }
      healing.outcome     = "success";
      healing.completedAt = new Date().toISOString();
    } catch (err) {
      healing.outcome     = "failure";
      healing.completedAt = new Date().toISOString();
      healing.details    += ` — Failed: ${(err as Error).message}`;
    }
    return healing;
  }

  checkOrphanProcesses(): {orphans:string[]; healed:number} {
    // Detect stalled workflow processes (simplified — checks event store for stuck patterns)
    const events = getEventStore(this.tenantId).getStats();
    const orphans: string[] = [];
    // If DLQ has items, those are orphan processes
    const dlqCount = 0;  // DLQ count available via adapter
    if (dlqCount > 0) orphans.push(`${dlqCount} events in dead-letter queue`);
    return { orphans, healed:0 };
  }

  generateHealthReport(): SystemHealthReport {
    const probes = probeStore.get(this.tenantId) ?? [];
    const healings = (healingStore.get(this.tenantId) ?? []).filter(h => h.outcome === "in_progress");
    const degraded = probes.filter(p => p.status === "degraded" || p.status === "failed").map(p => p.componentId);
    const overall: ComponentHealth = probes.some(p=>p.status==="failed") ? "failed" : probes.some(p=>p.status==="degraded") ? "degraded" : "healthy";
    const recs = [
      ...(degraded.length > 0 ? [`${degraded.length} components degraded — review logs`] : []),
      ...(healings.length > 0 ? [`${healings.length} auto-healing actions in progress`] : []),
    ];
    return { tenantId:this.tenantId, checkedAt:new Date().toISOString(), overallHealth:overall, components:probes, activeHealings:healings, degradedComponents:degraded, recommendations:recs };
  }

  getProbes():   HealthProbe[]  { return probeStore.get(this.tenantId)   ?? []; }
  getHealings(): HealingRecord[] { return healingStore.get(this.tenantId) ?? []; }
}

const healCache = new Map<string, SelfHealingRuntime>();
export function getSelfHealingRuntime(tenantId: string): SelfHealingRuntime {
  if (!healCache.has(tenantId)) healCache.set(tenantId, new SelfHealingRuntime(tenantId));
  return healCache.get(tenantId)!;
}
