/**
 * Structured Logger — JSON logs only, never plaintext.
 * Every log entry is machine-parseable with correlation IDs.
 * Production: stream to CloudWatch / Datadog / ELK
 */
import { StructuredLogEntry } from "../../types/observability.types";

type LogLevel = "debug" | "info" | "warn" | "error" | "fatal";

const logBuffer: StructuredLogEntry[] = [];
const MAX_BUFFER = 2000;

// Whether to write to stdout (disabled in tests)
let outputEnabled = process.env.NODE_ENV !== "test";

export function setLogOutput(enabled: boolean): void { outputEnabled = enabled; }

export class StructuredLogger {
  constructor(
    private readonly service:  string,
    private readonly tenantId?: string,
  ) {}

  private emit(level: LogLevel, operation: string, message: string, data?: Record<string, unknown>, correlationId?: string, error?: Error): void {
    const entry: StructuredLogEntry = {
      timestamp:     new Date().toISOString(),
      level,
      service:       this.service,
      operation,
      tenantId:      this.tenantId,
      correlationId,
      message,
      data,
      error: error ? { message: error.message, code: (error as NodeJS.ErrnoException).code, stack: process.env.NODE_ENV !== "production" ? error.stack : undefined } : undefined,
    };
    if (logBuffer.length >= MAX_BUFFER) logBuffer.shift();
    logBuffer.push(entry);
    if (outputEnabled) {
      const output = JSON.stringify(entry);
      if (level === "error" || level === "fatal") {
        process.stderr.write(output + "\n");
      } else {
        process.stdout.write(output + "\n");
      }
    }
  }

  debug(op: string, msg: string, data?: Record<string, unknown>, corrId?: string): void {
    this.emit("debug", op, msg, data, corrId);
  }
  info(op: string, msg: string, data?: Record<string, unknown>, corrId?: string): void {
    this.emit("info", op, msg, data, corrId);
  }
  warn(op: string, msg: string, data?: Record<string, unknown>, corrId?: string): void {
    this.emit("warn", op, msg, data, corrId);
  }
  error(op: string, msg: string, err?: Error, data?: Record<string, unknown>, corrId?: string): void {
    this.emit("error", op, msg, data, corrId, err);
  }
  fatal(op: string, msg: string, err?: Error, data?: Record<string, unknown>, corrId?: string): void {
    this.emit("fatal", op, msg, data, corrId, err);
  }

  getRecentLogs(limit = 100, level?: LogLevel): StructuredLogEntry[] {
    let logs = [...logBuffer].reverse();
    if (level) logs = logs.filter(l => l.level === level);
    return logs.slice(0, limit);
  }
}

export const globalLogger = new StructuredLogger("sgip-runtime");
