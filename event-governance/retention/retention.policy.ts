/**
 * Event Retention Policy — enforces retention rules per event type.
 * Events beyond their retention period are eligible for archival/deletion.
 */
import { GovernanceEventType } from "../../types/events.v3.types";
import { getEventRetentionDays } from "../schemas/event.schema.registry";

export interface RetentionCheck {
  eventType:    GovernanceEventType;
  eventDate:    string;
  retentionDays:number;
  expiresAt:    string;
  isExpired:    boolean;
  daysRemaining:number;
}

export function checkRetention(eventType: GovernanceEventType, eventTimestamp: string): RetentionCheck {
  const retentionDays = getEventRetentionDays(eventType);
  const eventDate     = new Date(eventTimestamp);
  const expiresAt     = new Date(eventDate.getTime() + retentionDays * 86400 * 1000);
  const now           = new Date();
  const isExpired     = now > expiresAt;
  const daysRemaining = Math.max(0, Math.ceil((expiresAt.getTime() - now.getTime()) / 86400000));
  return { eventType, eventDate: eventTimestamp, retentionDays, expiresAt: expiresAt.toISOString(), isExpired, daysRemaining };
}

export function getRetentionSummary(): Record<string, number> {
  return {
    "risk_events":    3650,
    "control_events": 2555,
    "policy_events":  3650,
    "audit_events":   3650,
    "agent_events":   730,
    "board_events":   3650,
    "tenant_events":  3650,
  };
}
