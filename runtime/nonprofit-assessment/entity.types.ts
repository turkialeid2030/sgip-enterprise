/**
 * DEPRECATED — superseded by runtime/regulatory-core/canonical.entity.taxonomy.ts
 *
 * This module previously declared a COMPETING entity taxonomy
 * (charitable_assoc | cooperative_assoc | civil_assoc). Two taxonomies means two
 * sources of truth, which would corrupt any Applicability Engine built on top.
 * It now re-exports the canonical taxonomy. Do not add types here.
 */
export {
  CanonicalEntityType as EntityType,
  CANONICAL_ENTITY_TYPES,
  LEGACY_ENTITY_TYPE_MAP,
  resolveEntityType,
  isCanonicalEntityType,
} from "../regulatory-core/canonical.entity.taxonomy";
