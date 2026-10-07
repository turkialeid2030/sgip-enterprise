/**
 * Event Bus — typed, in-process pub/sub
 * Production: swap for Kafka / RabbitMQ / AWS EventBridge
 * Interface is stable — only transport changes.
 */
import EventEmitter from "eventemitter3";
import { v4 as uuidv4 } from "uuid";
import { SGIPEvent, SGIPEventType } from "../types/events.types";
import { RiskLevel } from "../types/governance.types";

type EventHandler<T = unknown> = (event: SGIPEvent<T>) => void | Promise<void>;

export class EventBus {
  private readonly emitter = new EventEmitter();
  private readonly history: SGIPEvent[] = [];
  private readonly maxHistory = 1000;

  emit<T = unknown>(event: Partial<SGIPEvent<T>> & {
    type: SGIPEventType; source: string; payload: T; tenantId: string;
  }): void {
    const full: SGIPEvent<T> = {
      id:        event.id ?? uuidv4(),
      type:      event.type,
      source:    event.source,
      entityId:  event.entityId,
      entityType:event.entityType,
      payload:   event.payload,
      tenantId:  event.tenantId,
      timestamp: event.timestamp ?? new Date().toISOString(),
      traceId:   event.traceId ?? uuidv4(),
      correlationId: event.correlationId,
      severity:  event.severity as RiskLevel | undefined,
      handled:   false,
    };
    // Append to ring buffer
    if (this.history.length >= this.maxHistory) this.history.shift();
    this.history.push(full as SGIPEvent);

    this.emitter.emit(full.type, full);
    this.emitter.emit("*", full);  // wildcard subscription
  }

  on<T = unknown>(type: SGIPEventType | "*", handler: EventHandler<T>): void {
    this.emitter.on(type, handler as EventHandler);
  }

  off<T = unknown>(type: SGIPEventType | "*", handler: EventHandler<T>): void {
    this.emitter.off(type, handler as EventHandler);
  }

  once<T = unknown>(type: SGIPEventType, handler: EventHandler<T>): void {
    this.emitter.once(type, handler as EventHandler);
  }

  getRecentEvents(
    count = 50,
    filterType?: SGIPEventType,
    tenantId?: string,
  ): SGIPEvent[] {
    let events = [...this.history].reverse();
    if (filterType) events = events.filter(e => e.type === filterType);
    if (tenantId)   events = events.filter(e => e.tenantId === tenantId);
    return events.slice(0, count);
  }

  getStats() {
    const byType: Record<string, number> = {};
    for (const e of this.history) byType[e.type] = (byType[e.type] ?? 0) + 1;
    return { totalEvents: this.history.length, byType };
  }
}

// Singleton for in-process use
export const globalEventBus = new EventBus();
