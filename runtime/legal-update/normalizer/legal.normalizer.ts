/**
 * Legal Update Pipeline — Source Adapters + Normalizer
 *
 * Phase 0 of the legislative-update architecture. Buildable WITHOUT live scraping:
 * defines the common SourceAdapter interface (BOE, Umm Al-Qura, Istitlaa), and a
 * normalizer that extracts decree number, article refs, effective date, and
 * converts Hijri -> Gregorian. Live fetching is a later phase (needs external access).
 *
 * Additive module: does not modify any frozen runtime.
 */

export type LegalSourceId = "boe" | "umm_al_qura" | "istitlaa";

export type ChangeType = "NEW" | "AMENDMENT" | "REPEAL" | "EFFECTIVE_DATE" | "NON_SUBSTANTIVE";

export interface CapturedLegalDocument {
  id:                 string;
  sourceId:           LegalSourceId;
  canonicalUrl:       string;
  naturalKey:         string;        // sha-deterministic: source+decree+issue+article
  title:              string;
  bodyText:           string;
  decreeNumber:       string | null; // e.g. "م/132"
  gazetteIssue:       string | null;
  issueDateHijri:     string | null;
  issueDateGregorian: string | null;
  effectiveDate:      string | null;
  contentHash:        string;
  capturedAt:         string;
  adapterVersion:     string;
}

/** Common interface every source adapter implements. Live fetch is injected later. */
export interface SourceAdapter {
  sourceId: LegalSourceId;
  /** Invariants this adapter expects (for parser-breakage detection). */
  validate(raw: string): { ok: boolean; reason?: string };
  /** Parse raw HTML/text into captured documents (pure — testable with fixtures). */
  parse(raw: string, fetchedUrl: string): CapturedLegalDocument[];
}

// ── Hijri -> Gregorian (tabular Islamic calendar approximation) ───
// Sufficient for date anchoring; production should cross-check with the gazette.
export function hijriToGregorian(hYear: number, hMonth: number, hDay: number): string {
  // Tabular Islamic calendar (civil epoch). Julian Day Number from Hijri:
  const jd = Math.floor((11 * hYear + 3) / 30) + 354 * hYear + 30 * hMonth
           - Math.floor((hMonth - 1) / 2) + hDay + 1948440 - 386;
  // JDN -> Gregorian
  let l = jd + 68569;
  const n = Math.floor((4 * l) / 146097);
  l = l - Math.floor((146097 * n + 3) / 4);
  const i = Math.floor((4000 * (l + 1)) / 1461001);
  l = l - Math.floor((1461 * i) / 4) + 31;
  const j = Math.floor((80 * l) / 2447);
  const day = l - Math.floor((2447 * j) / 80);
  l = Math.floor(j / 11);
  const month = j + 2 - 12 * l;
  const year = 100 * (n - 49) + i + l;
  const mm = String(month).padStart(2, "0");
  const dd = String(day).padStart(2, "0");
  return `${year}-${mm}-${dd}`;
}

/** Extract decree number like "م/132" or "م/19" from Arabic legal text. */
export function extractDecreeNumber(text: string): string | null {
  const m = text.match(/م\s*\/\s*(\d+)/);
  return m ? `م/${m[1]}` : null;
}

/** Extract article references like "المادة (12)" / "المادة الثانية عشرة". */
export function extractArticleRefs(text: string): string[] {
  const refs = new Set<string>();
  const numeric = text.matchAll(/المادة\s*\(?\s*(\d+)\s*\)?/g);
  for (const m of numeric) refs.add(`المادة ${m[1]}`);
  return [...refs];
}

/** Detect effective-date clause: "نفاذ بعد (90) يوماً من تاريخ النشر". */
export function extractEffectiveDays(text: string): number | null {
  const m = text.match(/بعد\s*\(?\s*(\d+)\s*\)?\s*يوم/);
  return m ? Number(m[1]) : null;
}

/** Classify what changed between two document versions. */
export function classifyChange(
  prev: CapturedLegalDocument | null,
  next: CapturedLegalDocument,
): ChangeType {
  if (!prev) return "NEW";
  if (prev.contentHash === next.contentHash) return "NON_SUBSTANTIVE";
  const t = next.bodyText;
  if (/يُلغى|إلغاء|ملغى/.test(t)) return "REPEAL";
  if (/يُعدّل|تعديل|يستبدل|استثناءً من/.test(t)) return "AMENDMENT";
  if (prev.effectiveDate !== next.effectiveDate) return "EFFECTIVE_DATE";
  return "AMENDMENT";
}
