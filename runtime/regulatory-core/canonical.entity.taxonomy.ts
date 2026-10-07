/**
 * PROVISIONAL Entity Taxonomy — single source of truth for entity IDS,
 * but NOT yet an authoritative statement of Saudi legal forms.
 *
 * WHY "PROVISIONAL": no entry may be called a canonical LEGAL FORM until it is
 * linked to a verified official source. Some entries below may turn out to be
 * activity/functional classifications rather than distinct legal forms —
 * charitable_association, grantmaking_entity and waqf_institution are the
 * specific ones flagged for verification.
 *
 * WHY THIS EXISTS (P0 correction):
 * Two competing taxonomies existed in the codebase:
 *   A) runtime/nonprofit-assessment/entity.types.ts → charitable_assoc | cooperative_assoc | civil_assoc
 *   B) runtime/third-sector/...engine.ts           → civil_association | cooperative_association
 * Building an Applicability Engine on two competing truths would force a full
 * platform inversion later. This module replaces both.
 *
 * DESIGN RULE — NO REGULATOR HERE:
 * An entity type carries NO supervising authority. Supervision is a sourced,
 * time-bound, activity-dependent RELATIONSHIP (see authority.model.ts), never a
 * static property of a type. The previous `regulator: string // as named by the
 * user` field was a regulatory assertion without provenance and is removed.
 */

export type TaxonomyVerificationStatus = "UNVERIFIED" | "VERIFIED" | "SUPERSEDED";

/** Entity type identifiers. Stable ids — legal-form status is a separate claim. */
export type CanonicalEntityType =
  | "waqf"                      // وقف
  | "waqf_institution"          // مؤسسة/جهة وقفية
  | "civil_association"         // جمعية أهلية
  | "charitable_association"    // جمعية خيرية
  | "civil_institution"         // مؤسسة أهلية
  | "cooperative_association"   // جمعية تعاونية
  | "nonprofit_company"         // شركة غير ربحية
  | "grantmaking_entity";       // جهة مانحة

export interface EntityTypeDefinition {
  id:        CanonicalEntityType;
  nameAr:    string;
  nameEn:    string;
  /** Legal form as expressed in Saudi law — populated only from a verified source. */
  legalFormSourceId: string | null;
  /** UNVERIFIED until legalFormSourceId points at a VERIFIED source. */
  verificationStatus: TaxonomyVerificationStatus;
  /** True only when officially confirmed to be a distinct legal form. */
  isConfirmedLegalForm: boolean;
  /** Open question a human/official source must settle. */
  verificationNote: string | null;
  /** Alternate ids previously used in this codebase, kept for migration only. */
  legacyAliases: string[];
}

export const PROVISIONAL_ENTITY_TAXONOMY: EntityTypeDefinition[] = [
  { id: "waqf",                    nameAr: "وقف",                 nameEn: "Waqf",                         legalFormSourceId: null, verificationStatus: "UNVERIFIED", isConfirmedLegalForm: false, verificationNote: null, legacyAliases: [] },
  { id: "waqf_institution",        nameAr: "مؤسسة وقفية",         nameEn: "Waqf institution",             legalFormSourceId: null, verificationStatus: "UNVERIFIED", isConfirmedLegalForm: false, verificationNote: "يحتاج تحققاً: شكل قانوني مستقل أم صفة تشغيلية للوقف", legacyAliases: [] },
  { id: "civil_association",       nameAr: "جمعية أهلية",         nameEn: "Civil association",            legalFormSourceId: null, verificationStatus: "UNVERIFIED", isConfirmedLegalForm: false, verificationNote: null, legacyAliases: ["civil_assoc"] },
  { id: "charitable_association",  nameAr: "جمعية خيرية",         nameEn: "Charitable association",       legalFormSourceId: null, verificationStatus: "UNVERIFIED", isConfirmedLegalForm: false, verificationNote: "قد تكون تصنيف نشاط لا شكلاً قانونياً مستقلاً عن الجمعية الأهلية — يحتاج تحققاً رسمياً", legacyAliases: ["charitable_assoc"] },
  { id: "civil_institution",       nameAr: "مؤسسة أهلية",         nameEn: "Civil institution",            legalFormSourceId: null, verificationStatus: "UNVERIFIED", isConfirmedLegalForm: false, verificationNote: null, legacyAliases: [] },
  { id: "cooperative_association", nameAr: "جمعية تعاونية",       nameEn: "Cooperative association",      legalFormSourceId: null, verificationStatus: "UNVERIFIED", isConfirmedLegalForm: false, verificationNote: null, legacyAliases: ["cooperative_assoc"] },
  { id: "nonprofit_company",       nameAr: "شركة غير ربحية",      nameEn: "Non-profit company",           legalFormSourceId: null, verificationStatus: "UNVERIFIED", isConfirmedLegalForm: false, verificationNote: null, legacyAliases: [] },
  { id: "grantmaking_entity",      nameAr: "جهة مانحة",           nameEn: "Grantmaking entity",           legalFormSourceId: null, verificationStatus: "UNVERIFIED", isConfirmedLegalForm: false, verificationNote: "قد تكون وظيفة للكيان لا شكلاً قانونياً — يحتاج تحققاً رسمياً", legacyAliases: [] },
];

const BY_ID = new Map(PROVISIONAL_ENTITY_TAXONOMY.map(t => [t.id, t]));

/** Legacy id → canonical id. Used only at migration boundaries. */
export const LEGACY_ENTITY_TYPE_MAP: Record<string, CanonicalEntityType> = (() => {
  const m: Record<string, CanonicalEntityType> = {};
  for (const t of PROVISIONAL_ENTITY_TAXONOMY) for (const a of t.legacyAliases) m[a] = t.id;
  return m;
})();

export function isCanonicalEntityType(v: string): v is CanonicalEntityType {
  return BY_ID.has(v as CanonicalEntityType);
}

/** Resolve any known id (canonical or legacy) to its canonical form; null if unknown. */
export function resolveEntityType(v: string): CanonicalEntityType | null {
  if (isCanonicalEntityType(v)) return v;
  return LEGACY_ENTITY_TYPE_MAP[v] ?? null;
}

export function getEntityTypeDefinition(id: CanonicalEntityType): EntityTypeDefinition | null {
  return BY_ID.get(id) ?? null;
}

export function listEntityTypes(): EntityTypeDefinition[] {
  return [...PROVISIONAL_ENTITY_TAXONOMY];
}

/** Back-compat alias. Prefer PROVISIONAL_ENTITY_TAXONOMY. */
export const CANONICAL_ENTITY_TYPES = PROVISIONAL_ENTITY_TAXONOMY;
export const listCanonicalEntityTypes = listEntityTypes;

/** Only VERIFIED types backed by a source may be treated as legal forms. */
export function listVerifiedLegalForms(): EntityTypeDefinition[] {
  return PROVISIONAL_ENTITY_TAXONOMY.filter(
    t => t.verificationStatus === "VERIFIED" && t.isConfirmedLegalForm && !!t.legalFormSourceId);
}
