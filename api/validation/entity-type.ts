import { resolveEntityType } from "../../runtime/regulatory-core/canonical.entity.taxonomy";

/** Runtime values corresponding to UGOMType in types/governance.types.ts. */
export const UGOM_ENTITY_TYPES = new Set([
  "organization", "entity", "department", "board", "committee", "policy",
  "procedure", "risk", "control", "compliance_obligation", "audit_finding",
  "external_finding", "financial_review", "legal_review", "capa", "incident",
  "evidence", "board_resolution", "committee_decision", "kpi", "kri", "kci",
  "regulatory_requirement", "contract", "litigation", "fraud_case",
  "whistleblowing_case", "ipo_gap", "agent_action", "assurance_activity",
  "decision", "vendor", "strategic_objective", "regulation",
]);

/**
 * Accept UGOM governance types unchanged; normalize known third-sector legacy
 * aliases to the provisional canonical taxonomy; reject everything else.
 */
export function normalizeEntityType(value: string): string | null {
  if (UGOM_ENTITY_TYPES.has(value)) return value;
  return resolveEntityType(value);
}
