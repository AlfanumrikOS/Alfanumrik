/**
 * scripts/knowledge-audit/pilot-check.ts
 *
 * Pure comparison logic for `--pilot-check` mode: engine output vs a
 * hand-audited ground-truth fixture
 * (scripts/knowledge-audit/fixtures/pilot-ground-truth-v1.json — may not exist
 * yet; a background task writes it). run-audit.ts loads the fixture and calls
 * these functions; when the fixture is absent the pilot run is reported as
 * pending.
 *
 * PASS RULE: a dimension count "agrees" when the engine count is within ±1 of
 * ground truth OR within ±15% of ground truth, WHICHEVER IS LOOSER —
 * i.e. |engine − truth| ≤ max(1, 0.15 × truth). The chapter passes when ≥ 85%
 * of compared dimensions agree.
 *
 * No I/O, no network. Unit-tested in
 * src/__tests__/scripts/knowledge-audit/pilot-check.test.ts.
 */

import type { Dimension } from './dimensions';

export const AGREEMENT_PASS_THRESHOLD = 0.85;

export interface GroundTruthChapter {
  grade: string; // P5: string grade
  subject: string;
  chapter_number: number;
  /** hand-audited found counts per dimension (subset of the 31 is fine) */
  counts: Partial<Record<Dimension, number>>;
}

export interface GroundTruthFixture {
  version: string;
  chapters: GroundTruthChapter[];
}

/**
 * Normalize a raw fixture JSON into the canonical GroundTruthFixture.
 * Accepts BOTH shapes:
 *  - canonical: { version, chapters: [{ grade, subject, chapter_number, counts: { dim: n } }] }
 *  - pilot-ground-truth-v1.json (background-task shape): { version: 1, chapters:
 *    [{ grade, subject_code, chapter_number, dimensions: { dim: { count, evidence, notes } } }] }
 * Returns null when the input is structurally unusable.
 */
export function normalizeGroundTruthFixture(raw: unknown): GroundTruthFixture | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;
  if (!Array.isArray(obj.chapters)) return null;
  const chapters: GroundTruthChapter[] = [];
  for (const chRaw of obj.chapters as unknown[]) {
    if (!chRaw || typeof chRaw !== 'object') continue;
    const ch = chRaw as Record<string, unknown>;
    const grade = ch.grade != null ? String(ch.grade) : null; // P5: string grade
    const subject =
      typeof ch.subject === 'string' ? ch.subject
      : typeof ch.subject_code === 'string' ? ch.subject_code
      : null;
    const chapterNumber = typeof ch.chapter_number === 'number' ? ch.chapter_number : null;
    if (!grade || !subject || chapterNumber === null) continue;

    const counts: Partial<Record<Dimension, number>> = {};
    if (ch.counts && typeof ch.counts === 'object' && !Array.isArray(ch.counts)) {
      for (const [dim, v] of Object.entries(ch.counts as Record<string, unknown>)) {
        if (typeof v === 'number' && Number.isFinite(v)) counts[dim as Dimension] = v;
      }
    } else if (ch.dimensions && typeof ch.dimensions === 'object' && !Array.isArray(ch.dimensions)) {
      for (const [dim, entry] of Object.entries(ch.dimensions as Record<string, unknown>)) {
        if (entry && typeof entry === 'object') {
          const count = (entry as Record<string, unknown>).count;
          if (typeof count === 'number' && Number.isFinite(count)) counts[dim as Dimension] = count;
        }
      }
    }
    chapters.push({ grade, subject, chapter_number: chapterNumber, counts });
  }
  if (chapters.length === 0) return null;
  return { version: String(obj.version ?? 'unknown'), chapters };
}

export interface DimensionComparison {
  dimension: Dimension;
  engine: number;
  truth: number;
  tolerance: number;
  agrees: boolean;
}

export interface AgreementResult {
  comparisons: DimensionComparison[];
  compared: number;
  agreed: number;
  agreementPct: number; // 0..100, 2dp
  pass: boolean;
}

/** ±1 or ±15% of truth, whichever is LOOSER. */
export function toleranceFor(truth: number): number {
  return Math.max(1, 0.15 * Math.abs(truth));
}

export function countsAgree(engine: number, truth: number): boolean {
  return Math.abs(engine - truth) <= toleranceFor(truth);
}

/**
 * Compare engine counts against a ground-truth chapter. Only dimensions
 * present in the ground truth are compared (the fixture may audit a subset).
 */
export function compareAgainstGroundTruth(
  engineCounts: Partial<Record<Dimension, number>>,
  truth: GroundTruthChapter,
): AgreementResult {
  const comparisons: DimensionComparison[] = [];
  for (const [dim, truthCount] of Object.entries(truth.counts) as Array<[Dimension, number]>) {
    if (typeof truthCount !== 'number' || !Number.isFinite(truthCount)) continue;
    const engine = engineCounts[dim] ?? 0;
    comparisons.push({
      dimension: dim,
      engine,
      truth: truthCount,
      tolerance: toleranceFor(truthCount),
      agrees: countsAgree(engine, truthCount),
    });
  }
  const compared = comparisons.length;
  const agreed = comparisons.filter((c) => c.agrees).length;
  const agreementPct = compared === 0 ? 0 : Math.round((agreed / compared) * 10000) / 100;
  return {
    comparisons,
    compared,
    agreed,
    agreementPct,
    pass: compared > 0 && agreed / compared >= AGREEMENT_PASS_THRESHOLD,
  };
}

/** Find the fixture chapter matching a chapter ref, if any. */
export function findGroundTruthChapter(
  fixture: GroundTruthFixture,
  ref: { grade: string; subject: string; chapterNumber: number },
): GroundTruthChapter | null {
  return (
    fixture.chapters.find(
      (c) =>
        c.grade === ref.grade &&
        c.subject === ref.subject &&
        c.chapter_number === ref.chapterNumber,
    ) ?? null
  );
}

/** Render the agreement matrix as an operator-readable text table. */
export function formatAgreementMatrix(result: AgreementResult): string {
  const header = 'dimension                      engine  truth  tol    verdict';
  const lines = result.comparisons.map((c) => {
    const dim = c.dimension.padEnd(30);
    const eng = String(c.engine).padStart(6);
    const tru = String(c.truth).padStart(6);
    const tol = `±${c.tolerance % 1 === 0 ? c.tolerance : c.tolerance.toFixed(1)}`.padStart(6);
    return `${dim} ${eng} ${tru} ${tol}  ${c.agrees ? 'OK' : 'MISS'}`;
  });
  const summary = `agreement: ${result.agreed}/${result.compared} (${result.agreementPct}%) — ${result.pass ? 'PASS' : 'FAIL'} (threshold ${AGREEMENT_PASS_THRESHOLD * 100}%)`;
  return [header, ...lines, summary].join('\n');
}
