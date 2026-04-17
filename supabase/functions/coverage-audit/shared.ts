// supabase/functions/coverage-audit/shared.ts
//
// Pure helpers for the nightly coverage audit. Imported by index.ts (Deno)
// and by src/__tests__/coverage-audit-logic.test.ts (Vitest).

// ─── Constants ───────────────────────────────────────────────────────────────

/** Auto-disable enforcement when the verified_ratio drops below this. */
export const AUTO_DISABLE_RATIO_THRESHOLD = 0.85;

/** Ordinal ranks for rag_status so we can detect "getting worse". */
export const RAG_STATUS_RANK: Record<string, number> = {
  missing: 0,
  partial: 1,
  ready: 2,
};

// ─── Types ───────────────────────────────────────────────────────────────────

export type RagStatus = 'missing' | 'partial' | 'ready';

export interface SyllabusRow {
  board: string;
  grade: string;
  subject_code: string;
  chapter_number: number;
  rag_status: RagStatus;
  chunk_count?: number;
  verified_question_count?: number;
}

export interface EnforcedPair {
  grade: string;
  subject_code: string;
  enabled: boolean;
}

export interface ChapterStats {
  grade: string;
  subject_code: string;
  chapter_number: number;
  verified_question_count: number;
  total_questions: number;
}

export interface Regression {
  board: string;
  grade: string;
  subject_code: string;
  chapter_number: number;
  previous_status: RagStatus;
  current_status: RagStatus;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Canonical key for comparing rows across snapshots. */
export function rowKey(r: Pick<SyllabusRow, 'board' | 'grade' | 'subject_code' | 'chapter_number'>): string {
  return `${r.board}::${r.grade}::${r.subject_code}::${r.chapter_number}`;
}

/**
 * Compare yesterday's snapshot rows to today's. Returns rows that **dropped**
 * (ready→partial, ready→missing, partial→missing). Improvements and unchanged
 * rows are ignored. Rows present today but missing from yesterday are ignored
 * (they can only be a new or previously-unsnapshot chapter).
 */
export function detectRegressions(
  yesterday: SyllabusRow[],
  today: SyllabusRow[],
): Regression[] {
  const yMap = new Map<string, RagStatus>();
  for (const r of yesterday) yMap.set(rowKey(r), r.rag_status);

  const regressions: Regression[] = [];
  for (const t of today) {
    const prev = yMap.get(rowKey(t));
    if (!prev) continue;
    const prevRank = RAG_STATUS_RANK[prev];
    const currRank = RAG_STATUS_RANK[t.rag_status];
    if (prevRank !== undefined && currRank !== undefined && currRank < prevRank) {
      regressions.push({
        board: t.board,
        grade: t.grade,
        subject_code: t.subject_code,
        chapter_number: t.chapter_number,
        previous_status: prev,
        current_status: t.rag_status,
      });
    }
  }
  return regressions;
}

/**
 * Summarize a snapshot for the ops_events / DB row.
 */
export function summarizeSnapshot(rows: SyllabusRow[]): {
  ready_count: number;
  partial_count: number;
  missing_count: number;
  total_verified_questions: number;
  total_chunks: number;
} {
  let ready = 0, partial = 0, missing = 0, vq = 0, chunks = 0;
  for (const r of rows) {
    if (r.rag_status === 'ready') ready++;
    else if (r.rag_status === 'partial') partial++;
    else missing++;
    vq += r.verified_question_count ?? 0;
    chunks += r.chunk_count ?? 0;
  }
  return {
    ready_count: ready,
    partial_count: partial,
    missing_count: missing,
    total_verified_questions: vq,
    total_chunks: chunks,
  };
}

/**
 * Aggregate per-chapter stats into per-(grade, subject_code) verified_ratio.
 * Returns a map keyed `grade::subject_code` → ratio in [0,1].
 * Missing data (no chapters / zero total) → ratio=1 so we don't falsely
 * auto-disable during cold-start.
 */
export function computeVerifiedRatios(
  stats: ChapterStats[],
): Record<string, number> {
  const agg = new Map<string, { verified: number; total: number }>();
  for (const s of stats) {
    const key = `${s.grade}::${s.subject_code}`;
    const prev = agg.get(key) ?? { verified: 0, total: 0 };
    prev.verified += s.verified_question_count;
    prev.total += s.total_questions;
    agg.set(key, prev);
  }
  const out: Record<string, number> = {};
  for (const [k, v] of agg.entries()) {
    out[k] = v.total === 0 ? 1 : v.verified / v.total;
  }
  return out;
}

/**
 * Decide which enforced pairs should be auto-disabled.
 *   - Pair must currently be enabled.
 *   - verified_ratio strictly below threshold.
 * Returns list of pair keys + computed ratio (for audit log).
 */
export function pairsToAutoDisable(
  enforced: EnforcedPair[],
  ratios: Record<string, number>,
  threshold: number = AUTO_DISABLE_RATIO_THRESHOLD,
): { grade: string; subject_code: string; verified_ratio: number }[] {
  const out: { grade: string; subject_code: string; verified_ratio: number }[] = [];
  for (const p of enforced) {
    if (!p.enabled) continue;
    const key = `${p.grade}::${p.subject_code}`;
    const r = ratios[key];
    // If we have no data for this pair, don't auto-disable (fail safe for ops).
    if (typeof r !== 'number') continue;
    if (r < threshold) {
      out.push({ grade: p.grade, subject_code: p.subject_code, verified_ratio: r });
    }
  }
  return out;
}