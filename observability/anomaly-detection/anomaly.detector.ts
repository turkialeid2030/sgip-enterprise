/**
 * Governance Anomaly Detector
 * Detects suspicious patterns: SoD spikes, replay attacks, privilege escalation.
 */
import { v4 as uuidv4 } from "uuid";
import { GovernanceSignal, SignalType } from "../../types/observability.types";

const signals: GovernanceSignal[] = [];
// Rate counters: key → { count, windowStart }
const counters = new Map<string, { count: number; windowStart: number }>();
const WINDOW_MS = 5 * 60 * 1000; // 5-minute windows

function incrementCounter(key: string): number {
  const now = Date.now();
  const entry = counters.get(key) ?? { count: 0, windowStart: now };
  if (now - entry.windowStart > WINDOW_MS) {
    counters.set(key, { count: 1, windowStart: now });
    return 1;
  }
  const newCount = entry.count + 1;
  counters.set(key, { count: newCount, windowStart: entry.windowStart });
  return newCount;
}

export class AnomalyDetector {
  checkTenantViolation(tenantId: string, actorId: string): GovernanceSignal | null {
    const count = incrementCounter(`tenant_violation:${tenantId}:${actorId}`);
    if (count >= 3) {
      return this.emit({
        type: "tenant_violation_attempt", tenantId,
        severity: count >= 5 ? "critical" : "high",
        description: `${count} cross-tenant access attempts by ${actorId} in 5 minutes`,
        data: { actorId, count },
      });
    }
    return null;
  }

  checkSoDSpike(tenantId: string): GovernanceSignal | null {
    const count = incrementCounter(`sod_violation:${tenantId}`);
    if (count >= 5) {
      return this.emit({
        type: "sod_violation_pattern", tenantId, severity: "high",
        description: `${count} SoD violations detected in 5 minutes`,
        data: { count },
      });
    }
    return null;
  }

  checkApprovalBottleneck(tenantId: string, pendingCount: number): GovernanceSignal | null {
    if (pendingCount >= 20) {
      return this.emit({
        type: "approval_bottleneck", tenantId,
        severity: pendingCount >= 50 ? "high" : "medium",
        description: `${pendingCount} approvals pending — possible workflow bottleneck`,
        data: { pendingCount },
      });
    }
    return null;
  }

  checkEventReplay(tenantId: string, eventId: string): boolean {
    // Simple idempotency check — track seen event IDs in a window
    const key = `event_replay:${tenantId}:${eventId}`;
    const existing = counters.get(key);
    if (existing) {
      this.emit({
        type: "event_replay_attack", tenantId, severity: "high",
        description: `Duplicate event detected: ${eventId}`,
        data: { eventId },
      });
      return true;  // replay detected
    }
    counters.set(key, { count: 1, windowStart: Date.now() });
    return false;
  }

  checkPrivilegeEscalation(tenantId: string, userId: string, fromRole: string, toRole: string): GovernanceSignal | null {
    const privileged = ["orchestrator", "board_reporter", "financial_reviewer"];
    if (privileged.includes(toRole) && !privileged.includes(fromRole)) {
      return this.emit({
        type: "privilege_escalation", tenantId, severity: "critical",
        description: `User ${userId} escalated from ${fromRole} to ${toRole}`,
        data: { userId, fromRole, toRole },
      });
    }
    return null;
  }

  getSignals(tenantId: string, resolved = false): GovernanceSignal[] {
    return signals.filter(s => s.tenantId === tenantId && s.resolved === resolved);
  }

  resolveSignal(signalId: string, tenantId: string): void {
    const s = signals.find(x => x.id === signalId && x.tenantId === tenantId);
    if (s) { s.resolvedAt = new Date().toISOString(); s.resolved = true; }
  }

  private emit(params: { type: SignalType; tenantId: string; severity: GovernanceSignal["severity"]; description: string; data: Record<string, unknown> }): GovernanceSignal {
    const signal: GovernanceSignal = {
      id: uuidv4(), ...params,
      detectedAt:    new Date().toISOString(),
      resolved:      false,
      falsePositive: false,
      correlationId: uuidv4(),
    };
    signals.push(signal);
    return signal;
  }
}

export const globalAnomalyDetector = new AnomalyDetector();
