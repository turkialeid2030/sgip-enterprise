/**
 * BOE Source Adapter — parses Bureau of Experts "LawUpdated" listing HTML.
 * Pure parser: works on fixture HTML; live fetching is a later (external) phase.
 */
import { createHash } from "crypto";
import {
  SourceAdapter, CapturedLegalDocument,
  extractDecreeNumber, extractEffectiveDays,
} from "../normalizer/legal.normalizer";

export class BoeAdapter implements SourceAdapter {
  sourceId = "boe" as const;
  private readonly version = "1.0";

  validate(raw: string): { ok: boolean; reason?: string } {
    if (!raw || raw.length < 50) return { ok: false, reason: "Empty or too-short response" };
    if (/requested URL was rejected|Access to this page is restricted/i.test(raw)) {
      return { ok: false, reason: "WAF block page detected" };
    }
    if (!/LawDetails|تاريخ الإصدار|law-item/i.test(raw)) {
      return { ok: false, reason: "Expected BOE markers not found (possible redesign)" };
    }
    return { ok: true };
  }

  parse(raw: string, fetchedUrl: string): CapturedLegalDocument[] {
    const docs: CapturedLegalDocument[] = [];
    // Lightweight extraction: split on law-item blocks (fixture format)
    const blocks = raw.split(/<div class="law-item">/).slice(1);
    for (const block of blocks) {
      const title = (block.match(/<h3[^>]*>([^<]+)<\/h3>/)?.[1] ?? "").trim();
      const guid  = block.match(/LawDetails\/([a-f0-9-]+)/i)?.[1] ?? "";
      const body  = (block.match(/<p class="summary">([^<]+)<\/p>/)?.[1] ?? "").trim();
      const hijri = block.match(/تاريخ الإصدار[:\s]*([\d/]+)/)?.[1] ?? null;
      if (!title) continue;

      const decreeNumber = extractDecreeNumber(title + " " + body);
      const effDays = extractEffectiveDays(body);
      const canonicalUrl = `https://laws.boe.gov.sa/BoeLaws/Laws/LawDetails/${guid}/1`;
      const naturalKey = createHash("sha256")
        .update(`boe|${decreeNumber ?? guid}|${title}`).digest("hex").slice(0, 32);
      const contentHash = createHash("sha256").update(title + body + (hijri ?? "")).digest("hex");

      docs.push({
        id: `boe-${guid || naturalKey.slice(0, 8)}`,
        sourceId: "boe",
        canonicalUrl,
        naturalKey,
        title,
        bodyText: body,
        decreeNumber,
        gazetteIssue: null,
        issueDateHijri: hijri,
        issueDateGregorian: null,
        effectiveDate: effDays ? `+${effDays} days from publication` : null,
        contentHash,
        capturedAt: new Date().toISOString(),
        adapterVersion: this.version,
      });
    }
    return docs;
  }
}
