/**
 * Legal Update Pipeline — Change Detector + Reviewer Queue
 *
 * Phase 1: detects changes via SHA-256 hash transitions, classifies them,
 * and drives a human-review state machine gated to a licensed Saudi lawyer
 * (Code of Law Practice M/38 compliance). Every transition can be written to
 * the existing SHA-256 hash-chained audit-override engine.
 *
 * Additive module: does not modify any frozen runtime.
 */

import { createHash } from "crypto";
import { CapturedLegalDocument, ChangeType, classifyChange, LegalSourceId } from "../normalizer/legal.normalizer";

export type ReviewState =
  | "DETECTED" | "AUTO_SUMMARIZED" | "PENDING_REVIEW"
  | "IN_REVIEW" | "APPROVED" | "REJECTED"
  | "NEEDS_SOURCE_VERIFICATION" | "PUBLISHED" | "SUPERSEDED";

export interface DetectedChange {
  id:                  string;
  naturalKey:          string;
  sourceId:            LegalSourceId;
  changeType:          ChangeType;
  fromHash:            string | null;
  toHash:              string;
  diffSummary:         string;
  affectedObligationIds: string[];
  confidence:          number;        // 0-1 from XAI engine
  detectedAt:          string;
}

export interface ReviewTask {
  id:           string;
  changeId:     string;
  state:        ReviewState;
  assigneeId:   string | null;
  reviewerIsLicensedLawyer: boolean;
  llmSummary:   { en: string; ar: string };
  reviewerNotes: string | null;
  slaDueAt:     string;
  createdAt:    string;
  updatedAt:    string;
  history:      Array<{ from: ReviewState; to: ReviewState; by: string; at: string }>;
}

// Valid state transitions
const TRANSITIONS: Record<ReviewState, ReviewState[]> = {
  DETECTED:                  ["AUTO_SUMMARIZED"],
  AUTO_SUMMARIZED:           ["PENDING_REVIEW"],
  PENDING_REVIEW:            ["IN_REVIEW", "SUPERSEDED"],
  IN_REVIEW:                 ["APPROVED", "REJECTED", "NEEDS_SOURCE_VERIFICATION", "SUPERSEDED"],
  NEEDS_SOURCE_VERIFICATION: ["IN_REVIEW", "REJECTED"],
  APPROVED:                  ["PUBLISHED"],
  REJECTED:                  [],
  PUBLISHED:                 ["SUPERSEDED"],
  SUPERSEDED:                [],
};

export class LegalChangeDetector {
  private lastHash: Map<string, string> = new Map();   // naturalKey -> last accepted hash
  private prevDocs: Map<string, CapturedLegalDocument> = new Map();

  /** Detect whether a captured doc represents a change. Idempotent per hash. */
  detect(doc: CapturedLegalDocument, affectedObligationIds: string[] = []): DetectedChange | null {
    const known = this.lastHash.get(doc.naturalKey);
    if (known === doc.contentHash) return null; // no change — idempotent no-op

    const prev = this.prevDocs.get(doc.naturalKey) ?? null;
    const changeType = classifyChange(prev, doc);

    if (changeType === "NON_SUBSTANTIVE") {
      this.lastHash.set(doc.naturalKey, doc.contentHash);
      this.prevDocs.set(doc.naturalKey, doc);
      return null;
    }

    const change: DetectedChange = {
      id: `chg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      naturalKey: doc.naturalKey,
      sourceId: doc.sourceId,
      changeType,
      fromHash: known ?? null,
      toHash: doc.contentHash,
      diffSummary: this.buildDiff(prev, doc),
      affectedObligationIds,
      confidence: prev ? 0.75 : 0.85,
      detectedAt: new Date().toISOString(),
    };

    this.lastHash.set(doc.naturalKey, doc.contentHash);
    this.prevDocs.set(doc.naturalKey, doc);
    return change;
  }

  private buildDiff(prev: CapturedLegalDocument | null, next: CapturedLegalDocument): string {
    if (!prev) return `New document: ${next.title} (${next.decreeNumber ?? "no decree"})`;
    const parts: string[] = [];
    if (prev.effectiveDate !== next.effectiveDate) parts.push(`effective date ${prev.effectiveDate} -> ${next.effectiveDate}`);
    if (prev.title !== next.title) parts.push(`title changed`);
    parts.push(`content hash ${prev.contentHash.slice(0, 8)} -> ${next.contentHash.slice(0, 8)}`);
    return parts.join("; ");
  }

  reset(): void { this.lastHash.clear(); this.prevDocs.clear(); }
}

export class ReviewQueue {
  private tasks: Map<string, ReviewTask> = new Map();
  private auditSink: ((event: Record<string, unknown>) => void) | null = null;

  /** Optionally wire the SHA-256 hash-chained audit engine. */
  setAuditSink(sink: (event: Record<string, unknown>) => void): void {
    this.auditSink = sink;
  }

  private slaFor(changeType: ChangeType): string {
    const hours = changeType === "AMENDMENT" || changeType === "NEW" ? 24
                : changeType === "REPEAL" || changeType === "EFFECTIVE_DATE" ? 24
                : 72;
    return new Date(Date.now() + hours * 3_600_000).toISOString();
  }

  /** Create a review task from a detected change. */
  enqueue(change: DetectedChange, llmSummary: { en: string; ar: string }): ReviewTask {
    const now = new Date().toISOString();
    const task: ReviewTask = {
      id: `rev-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      changeId: change.id,
      state: "DETECTED",
      assigneeId: null,
      reviewerIsLicensedLawyer: false,
      llmSummary,
      reviewerNotes: null,
      slaDueAt: this.slaFor(change.changeType),
      createdAt: now,
      updatedAt: now,
      history: [],
    };
    this.tasks.set(task.id, task);
    this.audit("review.enqueued", task, "system");
    // auto-advance through summarization
    this.transition(task.id, "AUTO_SUMMARIZED", "system");
    this.transition(task.id, "PENDING_REVIEW", "system");
    return this.tasks.get(task.id)!;
  }

  /** Move a task to a new state, enforcing the transition graph. */
  transition(taskId: string, to: ReviewState, by: string, opts?: { isLicensedLawyer?: boolean; notes?: string }): { ok: boolean; error?: string } {
    const task = this.tasks.get(taskId);
    if (!task) return { ok: false, error: "Task not found" };
    if (!TRANSITIONS[task.state].includes(to)) {
      return { ok: false, error: `Invalid transition ${task.state} -> ${to}` };
    }
    // M/38 compliance: APPROVED/PUBLISHED require a licensed Saudi lawyer
    if ((to === "APPROVED" || to === "PUBLISHED") && !opts?.isLicensedLawyer) {
      return { ok: false, error: "Approval/publishing requires a licensed Saudi lawyer (Code of Law Practice M/38)." };
    }
    const from = task.state;
    task.state = to;
    task.updatedAt = new Date().toISOString();
    if (opts?.isLicensedLawyer) { task.reviewerIsLicensedLawyer = true; task.assigneeId = by; }
    if (opts?.notes) task.reviewerNotes = opts.notes;
    task.history.push({ from, to, by, at: task.updatedAt });
    this.audit("review.transition", task, by, { from, to });
    return { ok: true };
  }

  private audit(eventType: string, task: ReviewTask, by: string, extra?: Record<string, unknown>): void {
    if (!this.auditSink) return;
    this.auditSink({ eventType, taskId: task.id, changeId: task.changeId, state: task.state, by, at: task.updatedAt, ...extra });
  }

  get(taskId: string): ReviewTask | null { return this.tasks.get(taskId) ?? null; }
  list(state?: ReviewState): ReviewTask[] {
    const all = [...this.tasks.values()];
    return state ? all.filter(t => t.state === state) : all;
  }
  reset(): void { this.tasks.clear(); }
}

let _detector: LegalChangeDetector | null = null;
let _queue: ReviewQueue | null = null;
export function getLegalChangeDetector(): LegalChangeDetector {
  if (!_detector) _detector = new LegalChangeDetector();
  return _detector;
}
export function getReviewQueue(): ReviewQueue {
  if (!_queue) _queue = new ReviewQueue();
  return _queue;
}
