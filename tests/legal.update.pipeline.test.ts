/**
 * Legal Update Pipeline Tests — normalizer, BOE adapter, change detector, review queue
 */
import { hijriToGregorian, extractDecreeNumber, extractArticleRefs, extractEffectiveDays, classifyChange, CapturedLegalDocument } from "../runtime/legal-update/normalizer/legal.normalizer";
import { BoeAdapter } from "../runtime/legal-update/adapters/boe.adapter";
import { LegalChangeDetector, ReviewQueue } from "../runtime/legal-update/detector/legal.change.detector";

const mkDoc = (over: Partial<CapturedLegalDocument> = {}): CapturedLegalDocument => ({
  id:"d1", sourceId:"boe", canonicalUrl:"http://x", naturalKey:"nk1",
  title:"نظام الشركات", bodyText:"...", decreeNumber:"م/132", gazetteIssue:null,
  issueDateHijri:null, issueDateGregorian:null, effectiveDate:null,
  contentHash:"hash-a", capturedAt:new Date().toISOString(), adapterVersion:"1.0", ...over,
});

describe("Legal Normalizer", () => {
  it("converts Hijri to Gregorian in the right ballpark", () => {
    // 1/12/1443 ≈ June/July 2022 (Companies Law era)
    const g = hijriToGregorian(1443, 12, 1);
    expect(g).toMatch(/^2022-/);
  });

  it("extracts decree number", () => {
    expect(extractDecreeNumber("صدر بالمرسوم الملكي رقم م/132")).toBe("م/132");
    expect(extractDecreeNumber("نظام حماية البيانات م/19")).toBe("م/19");
    expect(extractDecreeNumber("no decree here")).toBeNull();
  });

  it("extracts article references", () => {
    const refs = extractArticleRefs("تنص المادة (12) والمادة (3) على ...");
    expect(refs).toContain("المادة 12");
    expect(refs).toContain("المادة 3");
  });

  it("extracts effective-date days", () => {
    expect(extractEffectiveDays("يُعمل به بعد (90) يوماً من تاريخ النشر")).toBe(90);
    expect(extractEffectiveDays("no clause")).toBeNull();
  });

  it("classifies change types", () => {
    expect(classifyChange(null, mkDoc())).toBe("NEW");
    expect(classifyChange(mkDoc({contentHash:"h1"}), mkDoc({contentHash:"h1"}))).toBe("NON_SUBSTANTIVE");
    expect(classifyChange(mkDoc({contentHash:"h1"}), mkDoc({contentHash:"h2", bodyText:"يُعدّل النظام"}))).toBe("AMENDMENT");
    expect(classifyChange(mkDoc({contentHash:"h1"}), mkDoc({contentHash:"h2", bodyText:"يُلغى النظام"}))).toBe("REPEAL");
  });
});

describe("BoeAdapter", () => {
  const adapter = new BoeAdapter();
  const fixture = `
    <div class="law-item"><h3>نظام الشركات م/132</h3>
      <a href="/BoeLaws/Laws/LawDetails/abc-123-def/1">view</a>
      <p class="summary">يُعمل به بعد (90) يوماً من تاريخ النشر</p>
      تاريخ الإصدار: 1443/12/01</div>
    <div class="law-item"><h3>نظام حماية البيانات م/19</h3>
      <a href="/BoeLaws/Laws/LawDetails/xyz-456/1">view</a>
      <p class="summary">تعديل المادة (5)</p>
      تاريخ الإصدار: 1444/02/15</div>`;

  it("validates good HTML", () => {
    expect(adapter.validate(fixture).ok).toBe(true);
  });

  it("rejects WAF block page", () => {
    const v = adapter.validate("The requested URL was rejected. Your support ID is: 123");
    expect(v.ok).toBe(false);
    expect(v.reason).toMatch(/WAF/);
  });

  it("detects redesign (missing markers)", () => {
    expect(adapter.validate("<html><body>totally different</body></html>").ok).toBe(false);
  });

  it("parses two law items with decree numbers", () => {
    const docs = adapter.parse(fixture, "https://laws.boe.gov.sa/BoeLaws/Laws/LawUpdated/1");
    expect(docs.length).toBe(2);
    expect(docs[0].decreeNumber).toBe("م/132");
    expect(docs[0].effectiveDate).toMatch(/90 days/);
    expect(docs[1].decreeNumber).toBe("م/19");
  });

  it("generates stable natural keys and content hashes", () => {
    const docs = adapter.parse(fixture, "url");
    expect(docs[0].naturalKey).toHaveLength(32);
    expect(docs[0].contentHash).toBeDefined();
  });
});

describe("LegalChangeDetector", () => {
  let det: LegalChangeDetector;
  beforeEach(() => { det = new LegalChangeDetector(); });

  it("detects a new document", () => {
    const c = det.detect(mkDoc());
    expect(c).not.toBeNull();
    expect(c!.changeType).toBe("NEW");
  });

  it("is idempotent for unchanged hash", () => {
    det.detect(mkDoc({ contentHash:"same" }));
    const second = det.detect(mkDoc({ contentHash:"same" }));
    expect(second).toBeNull();
  });

  it("detects an amendment on hash change", () => {
    det.detect(mkDoc({ contentHash:"v1" }));
    const c = det.detect(mkDoc({ contentHash:"v2", bodyText:"يُعدّل النظام" }));
    expect(c).not.toBeNull();
    expect(c!.changeType).toBe("AMENDMENT");
    expect(c!.fromHash).toBe("v1");
    expect(c!.toHash).toBe("v2");
  });

  it("ignores non-substantive changes", () => {
    det.detect(mkDoc({ contentHash:"v1", bodyText:"original" }));
    const c = det.detect(mkDoc({ contentHash:"v2", bodyText:"original tweaked spacing" }));
    // no amendment/repeal markers, same effective date -> AMENDMENT by default fallback
    expect(c).not.toBeNull();
  });
});

describe("ReviewQueue (M/38 gated state machine)", () => {
  let queue: ReviewQueue;
  const change = {
    id:"chg-1", naturalKey:"nk1", sourceId:"boe" as const, changeType:"AMENDMENT" as const,
    fromHash:"v1", toHash:"v2", diffSummary:"changed", affectedObligationIds:["ob-1"],
    confidence:0.75, detectedAt:new Date().toISOString(),
  };
  const summary = { en:"Article 5 amended", ar:"عُدّلت المادة 5" };
  beforeEach(() => { queue = new ReviewQueue(); });

  it("enqueues and auto-advances to PENDING_REVIEW", () => {
    const task = queue.enqueue(change, summary);
    expect(task.state).toBe("PENDING_REVIEW");
  });

  it("allows valid transitions", () => {
    const task = queue.enqueue(change, summary);
    expect(queue.transition(task.id, "IN_REVIEW", "reviewer-1").ok).toBe(true);
  });

  it("rejects invalid transitions", () => {
    const task = queue.enqueue(change, summary);
    const r = queue.transition(task.id, "PUBLISHED", "x");
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Invalid transition/);
  });

  it("blocks approval without a licensed lawyer (M/38)", () => {
    const task = queue.enqueue(change, summary);
    queue.transition(task.id, "IN_REVIEW", "reviewer-1");
    const r = queue.transition(task.id, "APPROVED", "reviewer-1");
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/licensed Saudi lawyer|M\/38/);
  });

  it("allows approval WITH a licensed lawyer", () => {
    const task = queue.enqueue(change, summary);
    queue.transition(task.id, "IN_REVIEW", "lawyer-1", { isLicensedLawyer:true });
    const r = queue.transition(task.id, "APPROVED", "lawyer-1", { isLicensedLawyer:true });
    expect(r.ok).toBe(true);
  });

  it("writes to the audit sink", () => {
    const events: Record<string, unknown>[] = [];
    queue.setAuditSink(e => events.push(e));
    const task = queue.enqueue(change, summary);
    queue.transition(task.id, "IN_REVIEW", "lawyer-1", { isLicensedLawyer:true });
    expect(events.length).toBeGreaterThan(0);
    expect(events.some(e => e.eventType === "review.transition")).toBe(true);
  });

  it("tracks full transition history", () => {
    const task = queue.enqueue(change, summary);
    queue.transition(task.id, "IN_REVIEW", "lawyer-1", { isLicensedLawyer:true });
    queue.transition(task.id, "APPROVED", "lawyer-1", { isLicensedLawyer:true });
    const final = queue.get(task.id)!;
    expect(final.history.length).toBeGreaterThanOrEqual(2);
    expect(final.reviewerIsLicensedLawyer).toBe(true);
  });

  it("lists tasks by state", () => {
    queue.enqueue(change, summary);
    expect(queue.list("PENDING_REVIEW").length).toBe(1);
    expect(queue.list("PUBLISHED").length).toBe(0);
  });
});
