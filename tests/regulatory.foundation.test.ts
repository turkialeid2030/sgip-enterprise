/**
 * Regulatory Foundation Correction — tests
 * Covers: Canonical Entity Taxonomy (single truth) + sourced Authority /
 * Supervisory Relationship model (fail-closed, no unsourced assertions).
 */
import {
  CANONICAL_ENTITY_TYPES, LEGACY_ENTITY_TYPE_MAP, resolveEntityType,
  isCanonicalEntityType, listCanonicalEntityTypes, CanonicalEntityType,
} from "../runtime/regulatory-core/canonical.entity.taxonomy";
import {
  RegulatorySourceRegistry, AUTHORITY_ROLES, OfficialSource, Authority,
  SupervisoryRelationship,
} from "../runtime/regulatory-core/authority.model";
import { readFileSync } from "fs";
import { join } from "path";

describe("Canonical Entity Taxonomy — single source of truth", () => {
  it("declares 8 canonical entity types with unique ids", () => {
    const ids = CANONICAL_ENTITY_TYPES.map(t => t.id);
    expect(ids.length).toBe(8);
    expect(new Set(ids).size).toBe(8);
  });

  it("maps every legacy alias to a canonical id", () => {
    expect(LEGACY_ENTITY_TYPE_MAP["civil_assoc"]).toBe("civil_association");
    expect(LEGACY_ENTITY_TYPE_MAP["charitable_assoc"]).toBe("charitable_association");
    expect(LEGACY_ENTITY_TYPE_MAP["cooperative_assoc"]).toBe("cooperative_association");
  });

  it("resolves legacy and canonical ids identically", () => {
    expect(resolveEntityType("civil_assoc")).toBe("civil_association");
    expect(resolveEntityType("civil_association")).toBe("civil_association");
    expect(resolveEntityType("not_a_type")).toBeNull();
  });

  it("guards canonical membership", () => {
    expect(isCanonicalEntityType("waqf")).toBe(true);
    expect(isCanonicalEntityType("civil_assoc")).toBe(false); // legacy is NOT canonical
  });

  it("carries NO regulator field on any entity type (P0)", () => {
    for (const t of listCanonicalEntityTypes()) {
      expect((t as unknown as Record<string, unknown>).regulator).toBeUndefined();
      expect((t as unknown as Record<string, unknown>).supervisor).toBeUndefined();
    }
  });

  it("retires the competing taxonomy file", () => {
    const legacy = readFileSync(
      join(__dirname, "..", "runtime", "nonprofit-assessment", "entity.types.ts"), "utf8");
    expect(/DEPRECATED/.test(legacy)).toBe(true);
    // must not re-declare its own union
    expect(/\|\s*"charitable_assoc"/.test(legacy)).toBe(false);
  });
});

describe("Authority model — no assertion without a source", () => {
  let reg: RegulatorySourceRegistry;
  const SRC: OfficialSource = {
    sourceId: "src-test-1", titleAr: "وثيقة اختبار", titleEn: "Test document",
    issuingAuthorityId: "auth-1", officialPublisher: "TEST_FIXTURE", jurisdiction: "SA",
    sourceType: "regulation", authorityLevel: "authority_regulation",
    documentNumber: null, documentHash: null,
    officialUrl: "https://fixture.invalid/doc", reference: "fixture",
    version: "1.0", publicationDate: "2026-01-01",
    effectiveFrom: "2026-01-01", effectiveTo: null,
    supersedes: null, supersededBy: null,
    lifecycleState: "CURRENT", verificationStatus: "VERIFIED",
    retrievedAt: null, verifiedAt: "2026-01-01", verifiedBy: "test",
  };
  const AUTH: Authority = { authorityId: "auth-1", nameAr: "جهة", nameEn: "Authority", mandateSourceId: null };
  const rel = (over: Partial<SupervisoryRelationship> = {}): SupervisoryRelationship => ({
    relationshipId: "rel-1", authorityId: "auth-1", role: "REGULATOR",
    entityType: "civil_association" as CanonicalEntityType, activityScoped: false,
    legalScope: null, permitScope: null,
    conditions: {}, sourceId: "src-test-1", articleReference: null,
    effectiveFrom: "2026-02-01", effectiveTo: null, ...over,
  });

  beforeEach(() => { reg = new RegulatorySourceRegistry(); });

  it("supports all seven authority roles", () => {
    expect(AUTHORITY_ROLES.length).toBe(7);
    expect(AUTHORITY_ROLES).toContain("TECHNICAL_SUPERVISOR");
    expect(AUTHORITY_ROLES).toContain("REGISTRATION_AUTHORITY");
  });

  it("rejects a source with no reference", () => {
    const r = reg.registerSource({ ...SRC, officialUrl: "" });
    expect(r.ok).toBe(false);
  });

  it("rejects a relationship with no sourceId", () => {
    reg.registerAuthority(AUTH);
    const r = reg.assertRelationship(rel({ sourceId: "" }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("MISSING_SOURCE");
  });

  it("rejects a relationship whose source is not registered", () => {
    reg.registerAuthority(AUTH);
    const r = reg.assertRelationship(rel({ sourceId: "src-unknown" }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("UNKNOWN_SOURCE");
  });

  it("rejects a relationship whose authority is not registered", () => {
    reg.registerSource(SRC);
    const r = reg.assertRelationship(rel({ authorityId: "auth-nope" }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("UNKNOWN_AUTHORITY");
  });

  it("accepts a fully sourced relationship", () => {
    reg.registerSource(SRC); reg.registerAuthority(AUTH);
    expect(reg.assertRelationship(rel()).ok).toBe(true);
    expect(reg.stats().relationships).toBe(1);
  });

  it("fails closed when nothing is sourced for an entity type", () => {
    const res = reg.resolveSupervision("waqf", {});
    expect(res.status).toBe("INSUFFICIENT_AUTHORITATIVE_EVIDENCE");
  });

  it("respects effective dates (no retroactive supervision)", () => {
    reg.registerSource(SRC); reg.registerAuthority(AUTH);
    reg.assertRelationship(rel({ effectiveFrom: "2026-06-01" }));
    const before = reg.resolveSupervision("civil_association", {}, "2026-03-01");
    const after  = reg.resolveSupervision("civil_association", {}, "2026-07-01");
    expect(before.status).toBe("INSUFFICIENT_AUTHORITATIVE_EVIDENCE");
    expect(after.status).toBe("RESOLVED");
  });

  it("supports many-to-many: several roles for one entity type", () => {
    reg.registerSource(SRC); reg.registerAuthority(AUTH);
    reg.registerAuthority({ ...AUTH, authorityId: "auth-2", nameAr: "جهة فنية", nameEn: "Technical" });
    reg.assertRelationship(rel({ relationshipId: "r1", role: "ADMINISTRATIVE_SUPERVISOR" }));
    reg.assertRelationship(rel({ relationshipId: "r2", role: "TECHNICAL_SUPERVISOR", authorityId: "auth-2" }));
    const res = reg.resolveSupervision("civil_association", {});
    expect(res.status).toBe("RESOLVED");
    if (res.status === "RESOLVED") {
      expect(res.relationships.length).toBe(2);
      expect(new Set(res.relationships.map(r => r.role)).size).toBe(2);
    }
  });

  it("scopes technical supervision by activity", () => {
    reg.registerSource(SRC); reg.registerAuthority(AUTH);
    reg.assertRelationship(rel({
      role: "TECHNICAL_SUPERVISOR", activityScoped: true,
      conditions: { activityIds: ["FIXTURE_ACT_A"] },
    }));
    const health = reg.resolveSupervision("civil_association", { activityIds: ["FIXTURE_ACT_A"] });
    const other  = reg.resolveSupervision("civil_association", { activityIds: ["FIXTURE_ACT_B"] });
    expect(health.status).toBe("RESOLVED");
    expect(other.status).toBe("INSUFFICIENT_AUTHORITATIVE_EVIDENCE");
  });

  it("raises REGULATORY_CONFLICT for two registration authorities", () => {
    reg.registerSource(SRC); reg.registerAuthority(AUTH);
    reg.registerAuthority({ ...AUTH, authorityId: "auth-2" });
    reg.assertRelationship(rel({ relationshipId: "r1", role: "REGISTRATION_AUTHORITY" }));
    reg.assertRelationship(rel({ relationshipId: "r2", role: "REGISTRATION_AUTHORITY", authorityId: "auth-2" }));
    const res = reg.resolveSupervision("civil_association", {});
    expect(res.status).toBe("REGULATORY_CONFLICT");
  });

  it("starts empty — the platform knows no supervision until sourced", () => {
    const s = new RegulatorySourceRegistry().stats();
    expect(s.sources).toBe(0);
    expect(s.relationships).toBe(0);
    expect(s.verifiedSources).toBe(0);
  });
});

describe("Correction Round 2 — source governance & scoped decisions", () => {
  let reg: RegulatorySourceRegistry;
  const base = (over: Partial<OfficialSource> = {}): OfficialSource => ({
    sourceId: "s1", titleAr: "و", titleEn: "d", issuingAuthorityId: "a1",
    officialPublisher: "TEST_FIXTURE", jurisdiction: "SA", sourceType: "regulation",
    authorityLevel: "authority_regulation", documentNumber: null, documentHash: null,
    officialUrl: "https://fixture.invalid/d", reference: "fx", version: "1",
    publicationDate: "2026-01-01", effectiveFrom: "2026-01-01", effectiveTo: null,
    supersedes: null, supersededBy: null, lifecycleState: "CURRENT",
    verificationStatus: "VERIFIED", retrievedAt: null, verifiedAt: "2026-01-01",
    verifiedBy: "test", ...over,
  });
  const auth: Authority = { authorityId: "a1", nameAr: "ج", nameEn: "A", mandateSourceId: null };
  const rel = (o: Partial<SupervisoryRelationship> = {}): SupervisoryRelationship => ({
    relationshipId: "r", authorityId: "a1", role: "REGULATOR",
    entityType: "civil_association" as CanonicalEntityType, activityScoped: false,
    legalScope: null, permitScope: null, conditions: {}, sourceId: "s1",
    articleReference: null, effectiveFrom: "2026-01-01", effectiveTo: null, ...o,
  });

  beforeEach(() => { reg = new RegulatorySourceRegistry(); reg.registerAuthority(auth); });

  it("rejects a source without officialUrl", () => {
    expect(reg.registerSource(base({ officialUrl: "" })).ok).toBe(false);
  });

  it("an UNVERIFIED source cannot drive a decision", () => {
    reg.registerSource(base({ verificationStatus: "INGESTED" }));
    reg.assertRelationship(rel());
    expect(reg.resolveSupervision("civil_association", {}).status)
      .toBe("INSUFFICIENT_AUTHORITATIVE_EVIDENCE");
  });

  it("a SUPERSEDED source cannot drive a decision", () => {
    reg.registerSource(base({ lifecycleState: "SUPERSEDED" }));
    reg.assertRelationship(rel());
    expect(reg.resolveSupervision("civil_association", {}).status)
      .toBe("INSUFFICIENT_AUTHORITATIVE_EVIDENCE");
  });

  it("APPROVED_PENDING_OFFICIAL_TEXT does not become an active rule", () => {
    reg.registerSource(base({ lifecycleState: "APPROVED_PENDING_OFFICIAL_TEXT_OR_EFFECTIVE_DATE" }));
    reg.assertRelationship(rel());
    expect(reg.resolveSupervision("civil_association", {}).status)
      .toBe("INSUFFICIENT_AUTHORITATIVE_EVIDENCE");
  });

  it("separates INSUFFICIENT_ENTITY_DATA from missing source", () => {
    reg.registerSource(base());
    reg.assertRelationship(rel({ activityScoped: true, conditions: { activityIds: ["FIXTURE_ACT_A"] } }));
    const res = reg.resolveSupervision("civil_association", {}); // no activity supplied
    expect(res.status).toBe("INSUFFICIENT_ENTITY_DATA");
    if (res.status === "INSUFFICIENT_ENTITY_DATA") {
      expect(res.missingFacts).toContain("activityIds");
    }
  });

  it("multiple licences with different permit scopes are NOT a conflict", () => {
    reg.registerSource(base());
    reg.registerAuthority({ ...auth, authorityId: "a2" });
    reg.assertRelationship(rel({ relationshipId: "r1", role: "LICENSING_AUTHORITY", permitScope: "PERMIT_X" }));
    reg.assertRelationship(rel({ relationshipId: "r2", role: "LICENSING_AUTHORITY", permitScope: "PERMIT_Y", authorityId: "a2" }));
    expect(reg.resolveSupervision("civil_association", {}).status).toBe("RESOLVED");
  });

  it("same role + same scope + overlapping period IS a conflict", () => {
    reg.registerSource(base());
    reg.registerAuthority({ ...auth, authorityId: "a2" });
    reg.assertRelationship(rel({ relationshipId: "r1", role: "LICENSING_AUTHORITY", permitScope: "PERMIT_X" }));
    reg.assertRelationship(rel({ relationshipId: "r2", role: "LICENSING_AUTHORITY", permitScope: "PERMIT_X", authorityId: "a2" }));
    expect(reg.resolveSupervision("civil_association", {}).status).toBe("REGULATORY_CONFLICT");
  });

  it("records discovery input separately from official sources", () => {
    reg.registerDiscoveryInput({ inputId: "d1", content: "user-sent list", origin: "user", receivedAt: "2026-01-01", status: "UNVERIFIED_CLASSIFICATION" });
    expect(reg.stats().discoveryInputs).toBe(1);
    expect(reg.stats().sources).toBe(0); // never promoted automatically
  });

  it("tracks a regulatory change event without inventing its content", () => {
    reg.registerChangeEvent({
      eventId: "NEW_COOPERATIVES_SYSTEM_2026",
      title: "نظام التعاونيات الجديد",
      entityTypesAffected: ["cooperative_association"],
      approvedOn: "2026-09-01",
      lifecycleState: "APPROVED_PENDING_OFFICIAL_TEXT_OR_EFFECTIVE_DATE",
      supersedesSourceId: null, newSourceId: null,
      note: "Council of Ministers approval recorded. Official text and effective date not yet verified — content must NOT be assumed.",
    });
    const ev = reg.listChangeEvents()[0];
    expect(ev.lifecycleState).toBe("APPROVED_PENDING_OFFICIAL_TEXT_OR_EFFECTIVE_DATE");
    expect(ev.newSourceId).toBeNull();
  });
});

describe("Provisional taxonomy — no unverified legal-form claims", () => {
  it("every type is UNVERIFIED until sourced", async () => {
    const m = await import("../runtime/regulatory-core/canonical.entity.taxonomy");
    for (const t of m.PROVISIONAL_ENTITY_TAXONOMY) {
      expect(t.verificationStatus).toBe("UNVERIFIED");
      expect(t.isConfirmedLegalForm).toBe(false);
    }
    expect(m.listVerifiedLegalForms().length).toBe(0);
  });

  it("flags the three types needing legal-form verification", async () => {
    const m = await import("../runtime/regulatory-core/canonical.entity.taxonomy");
    for (const id of ["charitable_association", "grantmaking_entity", "waqf_institution"]) {
      const t = m.PROVISIONAL_ENTITY_TAXONOMY.find(x => x.id === id)!;
      expect(t.verificationNote).toBeTruthy();
    }
  });
});
