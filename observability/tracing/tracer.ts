/**
 * Distributed Tracer — OpenTelemetry-compatible interface.
 * Production: swap to @opentelemetry/api + @opentelemetry/sdk-node
 * Interface stable — only transport changes.
 */
import { v4 as uuidv4 } from "uuid";
import { GovernanceSpan, SpanEvent } from "../../types/observability.types";

const activeSpans = new Map<string, GovernanceSpan>();
const completedSpans: GovernanceSpan[] = [];
const MAX_COMPLETED = 5000;

export class GovernanceTracer {
  private readonly service: string;

  constructor(service: string) {
    this.service = service;
  }

  startSpan(params: {
    operation:   string;
    tenantId?:   string;
    parentSpanId?:string;
    traceId?:    string;
    attributes?: Record<string, string | number | boolean>;
  }): GovernanceSpan {
    const span: GovernanceSpan = {
      traceId:     params.traceId      ?? uuidv4(),
      spanId:      uuidv4(),
      parentSpanId:params.parentSpanId,
      operationName:params.operation,
      tenantId:    params.tenantId ?? "system",
      service:     this.service,
      startTime:   Date.now(),
      status:      "ok",
      attributes:  params.attributes ?? {},
      events:      [],
    };
    activeSpans.set(span.spanId, span);
    return span;
  }

  endSpan(spanId: string, status: "ok" | "error" | "timeout" = "ok"): GovernanceSpan | undefined {
    const span = activeSpans.get(spanId);
    if (!span) return undefined;
    const completed: GovernanceSpan = {
      ...span,
      endTime:    Date.now(),
      durationMs: Date.now() - span.startTime,
      status,
    };
    activeSpans.delete(spanId);
    // Ring buffer
    if (completedSpans.length >= MAX_COMPLETED) completedSpans.shift();
    completedSpans.push(completed);
    return completed;
  }

  addEvent(spanId: string, name: string, attributes?: Record<string, unknown>): void {
    const span = activeSpans.get(spanId);
    if (span) {
      const event: SpanEvent = { name, timestamp: Date.now(), attributes: attributes ?? {} };
      span.events.push(event);
    }
  }

  setAttributes(spanId: string, attrs: Record<string, string | number | boolean>): void {
    const span = activeSpans.get(spanId);
    if (span) Object.assign(span.attributes, attrs);
  }

  getRecentSpans(limit = 100, tenantId?: string): GovernanceSpan[] {
    let spans = [...completedSpans].reverse();
    if (tenantId) spans = spans.filter(s => s.tenantId === tenantId);
    return spans.slice(0, limit);
  }

  getStats() {
    return {
      active:    activeSpans.size,
      completed: completedSpans.length,
      byService: completedSpans.reduce((acc, s) => {
        acc[s.service] = (acc[s.service] ?? 0) + 1; return acc;
      }, {} as Record<string, number>),
    };
  }
}

export const globalTracer = new GovernanceTracer("sgip-runtime");

// ── Decorator-style span wrapper ──────────────────────────────
export async function withSpan<T>(
  operation:  string,
  tenantId:   string,
  fn:         (span: GovernanceSpan) => Promise<T>,
  attributes?: Record<string, string | number | boolean>,
): Promise<T> {
  const span = globalTracer.startSpan({ operation, tenantId, attributes });
  try {
    const result = await fn(span);
    globalTracer.endSpan(span.spanId, "ok");
    return result;
  } catch (err) {
    globalTracer.addEvent(span.spanId, "error", { message: (err as Error).message });
    globalTracer.endSpan(span.spanId, "error");
    throw err;
  }
}
