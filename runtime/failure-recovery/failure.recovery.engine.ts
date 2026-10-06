/**
 * Failure Recovery Engine — Phase 1.5
 * Compensating transactions, rollback protection, partial failure isolation.
 * Implements saga-like pattern for multi-step governance flows.
 */
import { v4 as uuidv4 } from "uuid";
import { getDurableEventBus } from "../event-bus/durable.event.bus";

export type StepStatus = "pending" | "executed" | "compensated" | "failed";
export type SagaStatus = "running" | "completed" | "compensating" | "failed";

export interface SagaStep {
  id:          string;
  name:        string;
  execute:     () => Promise<unknown>;
  compensate:  () => Promise<void>;
  status:      StepStatus;
  result?:     unknown;
  error?:      string;
  executedAt?:  string;
  compensatedAt?:string;
}

export interface Saga {
  id:          string;
  tenantId:    string;
  name:        string;
  steps:       SagaStep[];
  status:      SagaStatus;
  startedAt:   string;
  completedAt?:string;
  failedAt?:   string;
  failedStep?: string;
}

const sagaStore = new Map<string, Saga>();

export class FailureRecoveryEngine {
  constructor(private readonly tenantId: string) {}

  createSaga(name: string, steps: Omit<SagaStep, "id" | "status">[]): Saga {
    const saga: Saga = {
      id:        uuidv4(),
      tenantId:  this.tenantId,
      name,
      steps:     steps.map(s => ({ ...s, id:uuidv4(), status:"pending" })),
      status:    "running",
      startedAt: new Date().toISOString(),
    };
    sagaStore.set(saga.id, saga);
    return saga;
  }

  async execute(sagaId: string): Promise<Saga> {
    const saga = sagaStore.get(sagaId);
    if (!saga || saga.tenantId !== this.tenantId) {
      throw Object.assign(new Error("Saga not found"), { statusCode:404 });
    }

    const bus = getDurableEventBus(this.tenantId);

    for (const step of saga.steps) {
      try {
        step.result    = await step.execute();
        step.status    = "executed";
        step.executedAt = new Date().toISOString();

        await bus.publish({ topic:"saga.step.executed", payload:{ sagaId, stepId:step.id, stepName:step.name }, actorId:"system", actorRole:"system", correlationId:saga.id });
      } catch (err) {
        step.status = "failed";
        step.error  = (err as Error).message;
        saga.status = "compensating";
        saga.failedStep = step.name;
        saga.failedAt   = new Date().toISOString();

        // Compensate in reverse order
        const executed = saga.steps.filter(s => s.status === "executed").reverse();
        for (const completedStep of executed) {
          try {
            await completedStep.compensate();
            completedStep.status        = "compensated";
            completedStep.compensatedAt  = new Date().toISOString();
          } catch (compErr) {
            console.error(`[Saga] Compensation failed for step ${completedStep.name}:`, compErr);
          }
        }

        saga.status = "failed";
        sagaStore.set(sagaId, saga);
        await bus.publish({ topic:"saga.failed", payload:{ sagaId, failedStep:step.name, error:step.error }, actorId:"system", actorRole:"system", correlationId:saga.id });
        return saga;
      }
    }

    saga.status      = "completed";
    saga.completedAt = new Date().toISOString();
    sagaStore.set(sagaId, saga);
    await bus.publish({ topic:"saga.completed", payload:{ sagaId, stepsCompleted:saga.steps.length }, actorId:"system", actorRole:"system", correlationId:saga.id });
    return saga;
  }

  getSaga(sagaId: string): Saga | undefined {
    const s = sagaStore.get(sagaId);
    return s?.tenantId === this.tenantId ? s : undefined;
  }

  getActiveSagas(): Saga[] {
    return [...sagaStore.values()].filter(s => s.tenantId === this.tenantId && s.status === "running");
  }

  getFailedSagas(): Saga[] {
    return [...sagaStore.values()].filter(s => s.tenantId === this.tenantId && s.status === "failed");
  }
}

const recoveryCache = new Map<string, FailureRecoveryEngine>();
export function getRecoveryEngine(tenantId: string): FailureRecoveryEngine {
  if (!recoveryCache.has(tenantId)) recoveryCache.set(tenantId, new FailureRecoveryEngine(tenantId));
  return recoveryCache.get(tenantId)!;
}
