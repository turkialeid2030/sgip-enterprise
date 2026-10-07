/**
 * Authority & Supervisory Relationship Model
 *
 * P0 CORRECTION: supervision is NOT a property of an entity type.
 * A supervisory relationship is an assertion about the world and therefore
 * requires: an authority, a role, an entity classification, optional activity
 * scoping, a SOURCE, a version, an effective date range, and applicability
 * conditions. Many-to-many by construction.
 *
 * FAIL-CLOSED: the registry starts EMPTY of asserted relationships.
 * `assertRelationship` REJECTS any relationship without a registered source.
 * Nothing about who supervises whom is knowable to this platform until an
 * official document has been registered.
 */

import { CanonicalEntityType } from "./canonical.entity.taxonomy";

// ── Authority roles (many can apply to one entity simultaneously) ──
export type AuthorityRole =
  | "REGULATOR"
  | "ADMINISTRATIVE_SUPERVISOR"
  | "FINANCIAL_SUPERVISOR"
  | "TECHNICAL_SUPERVISOR"
  | "LICENSING_AUTHORITY"
  | "REGISTRATION_AUTHORITY"
  | "OVERSIGHT_AUTHORITY";

export const AUTHORITY_ROLES: AuthorityRole[] = [
  "REGULATOR", "ADMINISTRATIVE_SUPERVISOR", "FINANCIAL_SUPERVISOR",
  "TECHNICAL_SUPERVISOR", "LICENSING_AUTHORITY", "REGISTRATION_AUTHORITY",
  "OVERSIGHT_AUTHORITY",
];

// ── Official source: nothing regulatory exists without one ──
export type SourceType = "law" | "regulation" | "executive_bylaw" | "governance_rules" | "circular" | "official_model" | "classification_schema";

/** Source lifecycle — only VERIFIED sources may drive regulatory decisions. */
export type SourceVerificationStatus = "DISCOVERED" | "INGESTED" | "VERIFIED" | "REJECTED";

/** Where a source sits in the regulatory timeline. */
export type SourceLifecycleState =
  | "CURRENT"
  | "PREVIOUS"
  | "SUPERSEDED"
  | "APPROVED_NOT_YET_EFFECTIVE"
  | "APPROVED_PENDING_OFFICIAL_TEXT_OR_EFFECTIVE_DATE"
  | "FUTURE";

export type AuthorityLevel = "royal_decree" | "council_of_ministers" | "ministerial" | "authority_regulation" | "authority_guidance";

export interface OfficialSource {
  sourceId:           string;
  titleAr:            string;
  titleEn:            string;
  issuingAuthorityId: string;
  officialPublisher:  string;
  jurisdiction:       string;            // e.g. "SA"
  sourceType:         SourceType;
  authorityLevel:     AuthorityLevel | null;
  documentNumber:     string | null;     // e.g. م/132
  documentHash:       string | null;     // integrity of the retrieved artefact
  officialUrl:        string;            // MANDATORY
  reference:          string;            // human-readable citation
  version:            string;
  publicationDate:    string | null;
  effectiveFrom:      string | null;
  effectiveTo:        string | null;
  supersedes:         string | null;
  supersededBy:       string | null;
  lifecycleState:     SourceLifecycleState;
  verificationStatus: SourceVerificationStatus;
  retrievedAt:        string | null;
  verifiedAt:         string | null;
  verifiedBy:         string | null;
}

/** Discovery input from a user or secondary source — NEVER authoritative. */
export interface DiscoveryInput {
  inputId:   string;
  content:   string;
  origin:    string;
  receivedAt: string;
  status:    "DISCOVERY_INPUT" | "UNVERIFIED_CLASSIFICATION";
}

/** A tracked regulatory change (e.g. a newly approved law without published text). */
export interface RegulatoryChangeEvent {
  eventId:      string;
  title:        string;
  entityTypesAffected: string[];
  approvedOn:   string | null;
  lifecycleState: SourceLifecycleState;
  supersedesSourceId: string | null;
  newSourceId:  string | null;
  note:         string;
}

export interface Authority {
  authorityId: string;
  nameAr:      string;
  nameEn:      string;
  /** Source establishing this authority's mandate. null = not yet sourced. */
  mandateSourceId: string | null;
}

export interface EntityClassification {
  classificationId: string;
  entityType:       CanonicalEntityType;
  /** Official classification code, when the entity is classified by an official schema. */
  officialCode:     string | null;
  sourceId:         string | null;
}

/**
 * Activity hierarchy: MAIN_GROUP -> SPECIALIZED -> ACTIVITY.
 * The official schema is reported to carry ~10 main groups and 117+ specialized
 * classifications. This model must hold the FULL published set — it must never
 * be collapsed into a small hand-made list. Entries are UNVERIFIED until sourced.
 */
export type ActivityLevel = "MAIN_GROUP" | "SPECIALIZED" | "ACTIVITY";

export interface ActivityClassification {
  activityId:   string;
  level:        ActivityLevel;
  nameAr:       string;
  nameEn:       string;
  /** Official classification code from the authority's published schema. */
  officialCode: string | null;
  parentId:     string | null;
  /** null => UNVERIFIED; may not drive technical-supervision decisions. */
  sourceId:     string | null;
  verificationStatus: "UNVERIFIED" | "VERIFIED";
}

/** Conditions that narrow when a supervisory relationship applies. */
export interface ApplicabilityConditions {
  activityIds?:      string[];      // applies only to these activities
  geographicScope?:  string[];      // e.g. specific regions
  minMembers?:       number;
  maxMembers?:       number;
  minAnnualRevenue?: number;
  maxAnnualRevenue?: number;
  notes?:            string;
}

export interface SupervisoryRelationship {
  relationshipId: string;
  authorityId:    string;
  role:           AuthorityRole;
  entityType:     CanonicalEntityType;
  activityScoped: boolean;
  /** Legal domain this relationship governs — conflict is scoped to this. */
  legalScope:     string | null;
  /** Distinct permit/licence type. Multiple licences are LEGITIMATE, not a conflict. */
  permitScope:    string | null;
  conditions:     ApplicabilityConditions;
  /** MANDATORY. A relationship without a source cannot be asserted. */
  sourceId:       string;
  articleReference: string | null;
  effectiveFrom:  string | null;
  effectiveTo:    string | null;
}

export type AssertionResult =
  | { ok: true; relationship: SupervisoryRelationship }
  | { ok: false; error: string; code: "MISSING_SOURCE" | "UNKNOWN_SOURCE" | "UNKNOWN_AUTHORITY" | "INVALID_ROLE" };

/** Resolution outcome — fail-closed by design. */
export type SupervisionResolution =
  | { status: "RESOLVED"; relationships: SupervisoryRelationship[] }
  /** No verified official source exists for this question. */
  | { status: "INSUFFICIENT_AUTHORITATIVE_EVIDENCE"; reason: string }
  /** Sources exist, but the ENTITY's own facts are missing. Ask for them. */
  | { status: "INSUFFICIENT_ENTITY_DATA"; reason: string; missingFacts: string[] }
  | { status: "REGULATORY_CONFLICT"; conflicting: SupervisoryRelationship[]; reason: string }
  | { status: "HUMAN_REVIEW_REQUIRED"; reason: string };

export class RegulatorySourceRegistry {
  private sources = new Map<string, OfficialSource>();
  private authorities = new Map<string, Authority>();
  private activities = new Map<string, ActivityClassification>();
  private relationships: SupervisoryRelationship[] = [];
  private discovery: DiscoveryInput[] = [];
  private changeEvents: RegulatoryChangeEvent[] = [];

  // ── sources ──
  registerSource(s: OfficialSource): { ok: boolean; error?: string } {
    if (!s.officialUrl || !s.officialUrl.trim()) {
      return { ok: false, error: "OfficialSource.officialUrl is mandatory — no unsourced regulation." };
    }
    if (!s.jurisdiction || !s.officialPublisher) {
      return { ok: false, error: "officialPublisher and jurisdiction are mandatory." };
    }
    this.sources.set(s.sourceId, s);
    return { ok: true };
  }

  /** A source may drive regulatory decisions only when VERIFIED and in force. */
  isSourceUsable(sourceId: string, asOf: string): boolean {
    const src = this.sources.get(sourceId);
    if (!src) return false;
    if (src.verificationStatus !== "VERIFIED") return false;
    if (src.lifecycleState === "SUPERSEDED" || src.lifecycleState === "PREVIOUS") return false;
    if (src.lifecycleState === "APPROVED_NOT_YET_EFFECTIVE") return false;
    if (src.lifecycleState === "APPROVED_PENDING_OFFICIAL_TEXT_OR_EFFECTIVE_DATE") return false;
    if (src.effectiveFrom && asOf < src.effectiveFrom) return false;
    if (src.effectiveTo && asOf > src.effectiveTo) return false;
    return true;
  }

  registerDiscoveryInput(d: DiscoveryInput): void { this.discovery.push(d); }
  listDiscoveryInputs(): DiscoveryInput[] { return [...this.discovery]; }
  registerChangeEvent(e: RegulatoryChangeEvent): void { this.changeEvents.push(e); }
  listChangeEvents(): RegulatoryChangeEvent[] { return [...this.changeEvents]; }
  getSource(id: string): OfficialSource | null { return this.sources.get(id) ?? null; }
  listSources(): OfficialSource[] { return [...this.sources.values()]; }

  // ── authorities ──
  registerAuthority(a: Authority): void { this.authorities.set(a.authorityId, a); }
  getAuthority(id: string): Authority | null { return this.authorities.get(id) ?? null; }
  listAuthorities(): Authority[] { return [...this.authorities.values()]; }

  // ── activities ──
  registerActivity(a: ActivityClassification): void { this.activities.set(a.activityId, a); }
  listActivities(): ActivityClassification[] { return [...this.activities.values()]; }

  /**
   * Assert a supervisory relationship. Rejected unless the source is registered
   * and the authority is known. This is the guard that prevents the platform
   * from ever "knowing" a regulator it cannot evidence.
   */
  assertRelationship(r: SupervisoryRelationship): AssertionResult {
    if (!r.sourceId || !r.sourceId.trim()) {
      return { ok: false, code: "MISSING_SOURCE", error: "A supervisory relationship requires sourceId." };
    }
    if (!this.sources.has(r.sourceId)) {
      return { ok: false, code: "UNKNOWN_SOURCE", error: `Source '${r.sourceId}' is not registered.` };
    }
    if (!this.authorities.has(r.authorityId)) {
      return { ok: false, code: "UNKNOWN_AUTHORITY", error: `Authority '${r.authorityId}' is not registered.` };
    }
    if (!AUTHORITY_ROLES.includes(r.role)) {
      return { ok: false, code: "INVALID_ROLE", error: `Unknown authority role '${r.role}'.` };
    }
    this.relationships.push(r);
    return { ok: true, relationship: r };
  }

  private inForce(r: SupervisoryRelationship, asOf: string): boolean {
    if (r.effectiveFrom && asOf < r.effectiveFrom) return false;
    if (r.effectiveTo   && asOf > r.effectiveTo)   return false;
    return true;
  }

  private matchesConditions(r: SupervisoryRelationship, facts: { activityIds?: string[]; geographicScope?: string[]; members?: number; annualRevenue?: number }): boolean {
    const c = r.conditions ?? {};
    if (c.activityIds?.length) {
      const acts = facts.activityIds ?? [];
      if (!acts.some(a => c.activityIds!.includes(a))) return false;
    }
    if (c.geographicScope?.length) {
      const g = facts.geographicScope ?? [];
      if (!g.some(x => c.geographicScope!.includes(x))) return false;
    }
    if (c.minMembers !== undefined && (facts.members ?? -1) < c.minMembers) return false;
    if (c.maxMembers !== undefined && (facts.members ?? Infinity) > c.maxMembers) return false;
    if (c.minAnnualRevenue !== undefined && (facts.annualRevenue ?? -1) < c.minAnnualRevenue) return false;
    if (c.maxAnnualRevenue !== undefined && (facts.annualRevenue ?? Infinity) > c.maxAnnualRevenue) return false;
    return true;
  }

  /**
   * Resolve which authorities supervise an entity, in which roles, as of a date.
   * Returns INSUFFICIENT_AUTHORITATIVE_EVIDENCE when nothing is sourced —
   * never an empty "no supervision" answer, which would be a false assertion.
   */
  resolveSupervision(
    entityType: CanonicalEntityType,
    facts: { activityIds?: string[]; geographicScope?: string[]; members?: number; annualRevenue?: number },
    asOf: string = new Date().toISOString().slice(0, 10),
  ): SupervisionResolution {
    const candidates = this.relationships.filter(r => r.entityType === entityType);
    if (candidates.length === 0) {
      return { status: "INSUFFICIENT_AUTHORITATIVE_EVIDENCE",
        reason: `No sourced supervisory relationship registered for entity type '${entityType}'.` };
    }

    // Source lifecycle gate: the relationship inherits its source's validity.
    const sourced = candidates.filter(r => this.isSourceUsable(r.sourceId, asOf));
    if (sourced.length === 0) {
      return { status: "INSUFFICIENT_AUTHORITATIVE_EVIDENCE",
        reason: `Relationships exist for '${entityType}' but no backing source is VERIFIED and in force as of ${asOf}.` };
    }

    const inForce = sourced.filter(r => this.inForce(r, asOf));
    if (inForce.length === 0) {
      return { status: "INSUFFICIENT_AUTHORITATIVE_EVIDENCE",
        reason: `No relationship for '${entityType}' is in force as of ${asOf}.` };
    }

    // Distinguish "we lack the ENTITY's facts" from "we lack a SOURCE".
    const missing = new Set<string>();
    for (const r of inForce) {
      const c = r.conditions ?? {};
      if (c.activityIds?.length && !facts.activityIds?.length)          missing.add("activityIds");
      if (c.geographicScope?.length && !facts.geographicScope?.length)  missing.add("geographicScope");
      if ((c.minMembers !== undefined || c.maxMembers !== undefined) && facts.members === undefined) missing.add("members");
      if ((c.minAnnualRevenue !== undefined || c.maxAnnualRevenue !== undefined) && facts.annualRevenue === undefined) missing.add("annualRevenue");
    }

    const active = inForce.filter(r => this.matchesConditions(r, facts));
    if (active.length === 0) {
      if (missing.size > 0) {
        return { status: "INSUFFICIENT_ENTITY_DATA",
          reason: `A verified rule exists for '${entityType}', but the entity's own facts are incomplete.`,
          missingFacts: [...missing] };
      }
      return { status: "INSUFFICIENT_AUTHORITATIVE_EVIDENCE",
        reason: `No relationship applies to '${entityType}' under the supplied facts as of ${asOf}.` };
    }

    // Conflict is scoped: same role AND same legal scope AND same permit scope
    // AND overlapping effective period. Multiple licences are legitimate.
    const key = (r: SupervisoryRelationship) => `${r.role}|${r.legalScope ?? ""}|${r.permitScope ?? ""}`;
    const groups = new Map<string, SupervisoryRelationship[]>();
    for (const r of active) {
      const k = key(r);
      groups.set(k, [...(groups.get(k) ?? []), r]);
    }
    for (const [, group] of groups) {
      if (group.length < 2) continue;
      const distinctAuthorities = new Set(group.map(r => r.authorityId));
      if (distinctAuthorities.size > 1 && this.periodsOverlap(group)) {
        return { status: "REGULATORY_CONFLICT", conflicting: group,
          reason: `Two authorities asserted for the same role, legal scope and permit scope with overlapping effective periods.` };
      }
    }

    return { status: "RESOLVED", relationships: active };
  }

  private periodsOverlap(rs: SupervisoryRelationship[]): boolean {
    for (let i = 0; i < rs.length; i++) {
      for (let j = i + 1; j < rs.length; j++) {
        const a = rs[i], b = rs[j];
        const aFrom = a.effectiveFrom ?? "0000-01-01", aTo = a.effectiveTo ?? "9999-12-31";
        const bFrom = b.effectiveFrom ?? "0000-01-01", bTo = b.effectiveTo ?? "9999-12-31";
        if (aFrom <= bTo && bFrom <= aTo) return true;
      }
    }
    return false;
  }

  stats() {
    return {
      sources: this.sources.size,
      verifiedSources: [...this.sources.values()].filter(x => x.verificationStatus === "VERIFIED").length,
      discoveryInputs: this.discovery.length,
      changeEvents: this.changeEvents.length,
      authorities: this.authorities.size,
      activities: this.activities.size,
      relationships: this.relationships.length,
    };
  }

  reset(): void {
    this.sources.clear(); this.authorities.clear();
    this.activities.clear(); this.relationships = [];
    this.discovery = []; this.changeEvents = [];
  }
}

let _r: RegulatorySourceRegistry | null = null;
export function getRegulatorySourceRegistry(): RegulatorySourceRegistry {
  if (!_r) _r = new RegulatorySourceRegistry();
  return _r;
}
