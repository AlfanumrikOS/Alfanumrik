/**
 * ALFANUMRIK — Cold-start diagnostic form selector (PURE).
 *
 * Implements `docs/superpowers/specs/2026-07-29-diagnostic-cold-start-correctness.md`
 * §1 (blueprint + sequencing + ranking), §2 (Tier-0 verification gate),
 * §3.2 (chapter spread), §5 (insufficient-pool ladder) and §6 (Bloom's spread).
 *
 * This module is deliberately DB-free: it takes an already-fetched candidate
 * pool plus the student's in-scope chapter set and returns the form. Every
 * acceptance criterion in §8.1-§8.6 can therefore be asserted without a
 * database (spec §8.1 explicitly asks for this shape).
 *
 * It does NOT reimplement `validateQuestion()` — spec §2.2 requires the real
 * `quiz-assembler` screen, imported unchanged.
 *
 * Invariants honoured here:
 *  - P5: `grade` is a string "6".."12" and is only ever compared as a string.
 *  - P6: `validateQuestion()` + V1-V18 gate every served item at EVERY rung.
 *  - P1/P2 are untouched — this module neither scores nor awards XP.
 */

import { validateQuestion } from '@alfanumrik/lib/quiz-assembler';

// ── Canonical vocabularies ─────────────────────────────────────

/** Canonical Bloom order (§6). Order is asserted against cognitive-engine by AC-27. */
export const DIAGNOSTIC_BLOOM_LEVELS = [
  'remember',
  'understand',
  'apply',
  'analyze',
  'evaluate',
  'create',
] as const;

export type BloomLevel = (typeof DIAGNOSTIC_BLOOM_LEVELS)[number];

/** HOTS = analyze + evaluate + create, collapsed into one bucket (§6.1). */
export const DIAGNOSTIC_HOTS_LEVELS: readonly BloomLevel[] = ['analyze', 'evaluate', 'create'];

/**
 * V16 — CBSE-board source tiers only. The competition tiers added by migration
 * `20260520000004` (jee_archive, neet_archive, olympiad, board_paper, pyq,
 * curated) share the same subject+grade pool and are excluded. Verified against
 * the widened `chk_source_type` CHECK, not copied from memory.
 */
export const DIAGNOSTIC_SOURCE_TYPES = [
  'ncert_intext',
  'ncert_exercise',
  'ncert_example',
  'cbse_style',
  'practice',
] as const;

/** V15 — the verifier "disproved" family. Excluded at EVERY rung, permanently. */
export const DIAGNOSTIC_FAILED_VERIFICATION_STATES = [
  'failed',
  'failed_fix_in_flight',
  'failed_unfixable',
] as const;

/** Rung 0 admits only proven items; Rung 1+ admits never-checked items too (§2.3). */
export const RUNG0_VERIFICATION_STATES = ['verified'] as const;
export const RUNG1_VERIFICATION_STATES = ['verified', 'legacy_unverified', 'pending'] as const;

/** P5 — diagnostic grades are strings. Grades 11-12 supported (spec §4, G1). */
export const VALID_DIAGNOSTIC_GRADES = ['6', '7', '8', '9', '10', '11', '12'] as const;
export type DiagnosticGrade = (typeof VALID_DIAGNOSTIC_GRADES)[number];

// ── Blueprint constants (§1.1 / §1.3) ──────────────────────────

export const DIAGNOSTIC_QUESTION_COUNT = 15;
export const DIAGNOSTIC_SHORT_FORM_FLOOR = 10;

/** §1.1 — the exact target. 5 easy / 6 medium / 4 hard. Not a suggestion. */
export const DIAGNOSTIC_BLUEPRINT = { easy: 5, medium: 6, hard: 4 } as const;

/**
 * §1.3 — fixed positional band template (1 = easy, 2 = medium, 3 = hard).
 * E E M M H M E H M M H E M H E
 */
export const DIAGNOSTIC_BAND_TEMPLATE: readonly DifficultyBand[] = [
  1, 1, 2, 2, 3, 2, 1, 3, 2, 2, 3, 1, 2, 3, 1,
];

export type DifficultyBand = 1 | 2 | 3;

export type QualityTier =
  | 'verified'
  | 'standard'
  | 'relaxed_blueprint'
  | 'short_form'
  | 'insufficient';

export type InsufficientReason =
  | 'too_few_items'
  | 'no_hard_items'
  | 'no_hots_items'
  | 'too_few_chapters';

// ── Candidate shape ────────────────────────────────────────────

/** The columns the selector reads. Extra columns are carried through untouched. */
export interface DiagnosticCandidate {
  id: string;
  question_text: string;
  options: unknown;
  correct_answer_index: number | null;
  explanation: string | null;
  difficulty: number | null;
  bloom_level: string | null;
  chapter_number: number | null;
  verification_state: string | null;
  is_verified?: boolean | null;
  content_status?: string | null;
  question_type?: string | null;
  question_type_v2?: string | null;
  source_type?: string | null;
  is_active?: boolean | null;
  deleted_at?: string | null;
  grade?: string | null;
  subject?: string | null;
  irt_a?: number | null;
  irt_b?: number | null;
  irt_calibration_n?: number | null;
  [key: string]: unknown;
}

export interface SelectDiagnosticFormParams {
  candidates: DiagnosticCandidate[];
  /** In-scope `cbse_syllabus.chapter_number` set for this board+grade+subject (S1/V17). */
  inScopeChapters: Iterable<number>;
  /** P5 — string grade. */
  grade: string;
  /** Lower-cased subject code. */
  subject: string;
  /** Per-session seed so two students do not get the identical form (§1.3). */
  seed: string;
}

export interface DiagnosticFormResult {
  rung: 0 | 1 | 2 | 3 | 4;
  qualityTier: QualityTier;
  /** Ordered form. Empty at Rung 4. */
  questions: DiagnosticCandidate[];
  /** Served band counts. All zero at Rung 4. */
  blueprint: { easy: number; medium: number; hard: number };
  chapterCount: number;
  bloomCounts: Record<string, number>;
  /** Count of items that survived Tier-0 + `validateQuestion()` (P13-safe telemetry). */
  eligibleCount: number;
  /** Band counts of the whole eligible pool — the shape ops needs to fill a gap. */
  eligibleBandCounts: { easy: number; medium: number; hard: number };
  /** Distinct in-scope chapters represented in the eligible pool. */
  eligibleChapterCount: number;
  /** Only set at Rung 4. */
  reason?: InsufficientReason;
}

// ── Seeded RNG (deterministic per session) ─────────────────────

function hashSeed(seed: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

/** mulberry32 — small, fast, deterministic. */
function makeRng(seed: string): () => number {
  let a = hashSeed(seed);
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffleInPlace<T>(arr: T[], rng: () => number): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// ── Tier-0 gate (§2.1, V1-V18) ─────────────────────────────────

const FAILED_STATES = new Set<string>(DIAGNOSTIC_FAILED_VERIFICATION_STATES);
const ALLOWED_SOURCE_TYPES = new Set<string>(DIAGNOSTIC_SOURCE_TYPES);
const BLOOM_SET = new Set<string>(DIAGNOSTIC_BLOOM_LEVELS);
const HOTS_SET = new Set<string>(DIAGNOSTIC_HOTS_LEVELS);
const GRADE_SET = new Set<string>(VALID_DIAGNOSTIC_GRADES);

/**
 * Returns the failing predicate id (`'V3'`, …) or `null` when the row is clean.
 * Every predicate is also expressed in the SQL fetch; this is the authoritative
 * in-process copy so the ladder can be asserted without a database, and so a
 * broadened upstream query cannot leak a bad row (defence in depth).
 */
export function tier0Violation(
  q: DiagnosticCandidate,
  ctx: { grade: string; subject: string; inScopeChapters: Set<number> },
): string | null {
  if (!q || typeof q.id !== 'string' || q.id.length === 0) return 'V18';

  // V1 — is_active. Absent column is treated as "not proven active".
  if (q.is_active === false || q.is_active == null) return 'V1';
  // V2 — soft-delete respect.
  if (q.deleted_at != null) return 'V2';
  // V3 — draft/review/archived content is not student-facing.
  if (q.content_status !== 'published') return 'V3';
  // V4 — P5: grade is a STRING in '6'..'12' and must match the request.
  if (q.grade != null) {
    if (typeof q.grade !== 'string' || !GRADE_SET.has(q.grade)) return 'V4';
    if (q.grade !== ctx.grade) return 'V4';
  }
  // V5 — subject match (lower-cased).
  if (q.subject != null && String(q.subject).toLowerCase() !== ctx.subject) return 'V5';
  // V6 — MCQ only: a diagnostic must be auto-scorable with zero grader ambiguity.
  if ((q.question_type_v2 ?? 'mcq') !== 'mcq') return 'V6';
  // V7 — exactly 4 options (P6).
  const opts = Array.isArray(q.options) ? (q.options as unknown[]) : null;
  if (!opts || opts.length !== 4) return 'V7';
  // V8 — non-empty options, >= 3 distinct (P6).
  const optTexts = opts.map((o) => String(o ?? '').trim());
  if (optTexts.some((o) => o === '')) return 'V8';
  if (new Set(optTexts.map((o) => o.toLowerCase())).size < 3) return 'V8';
  // V9 — answer index 0..3 (P6).
  if (
    typeof q.correct_answer_index !== 'number' ||
    !Number.isInteger(q.correct_answer_index) ||
    q.correct_answer_index < 0 ||
    q.correct_answer_index > 3
  ) {
    return 'V9';
  }
  // V10 — question text length (P6, matches quiz-assembler).
  if (typeof q.question_text !== 'string' || q.question_text.trim().length < 15) return 'V10';
  // V11 — no template markers (P6).
  if (q.question_text.includes('{{') || q.question_text.includes('[BLANK]')) return 'V11';
  // V12 — explanation quality (P6, matches quiz-assembler).
  if (typeof q.explanation !== 'string' || q.explanation.trim().length < 20) return 'V12';
  // V13 — the item must sit in a real difficulty band.
  if (q.difficulty !== 1 && q.difficulty !== 2 && q.difficulty !== 3) return 'V13';
  // V14 — canonical Bloom level.
  if (typeof q.bloom_level !== 'string' || !BLOOM_SET.has(q.bloom_level)) return 'V14';
  // V15 — the verifier disproved this item. NEVER served, at any rung.
  if (typeof q.verification_state !== 'string' || FAILED_STATES.has(q.verification_state)) {
    return 'V15';
  }
  // V16 — CBSE-board source tiers only.
  if (typeof q.source_type !== 'string' || !ALLOWED_SOURCE_TYPES.has(q.source_type)) return 'V16';
  // V17 — chapter must be in the student's own in-scope syllabus (S1).
  if (typeof q.chapter_number !== 'number' || !ctx.inScopeChapters.has(q.chapter_number)) {
    return 'V17';
  }

  return null;
}

/**
 * Tier-0 + `validateQuestion()` + de-duplication (V18). Applied ONCE; every rung
 * then draws from this pool, so no rung can ever serve a Tier-0 violator.
 */
export function screenCandidates(
  candidates: DiagnosticCandidate[],
  ctx: { grade: string; subject: string; inScopeChapters: Set<number> },
): { eligible: DiagnosticCandidate[]; rejections: Record<string, number> } {
  const rejections: Record<string, number> = {};
  const seen = new Set<string>();
  const eligible: DiagnosticCandidate[] = [];

  for (const q of candidates ?? []) {
    const violation = tier0Violation(q, ctx);
    if (violation) {
      rejections[violation] = (rejections[violation] ?? 0) + 1;
      continue;
    }
    if (seen.has(q.id)) {
      rejections.V18 = (rejections.V18 ?? 0) + 1;
      continue;
    }
    // §2.2 — reuse the platform's real text-quality screen, never a copy.
    const { valid, reason } = validateQuestion(q);
    if (!valid) {
      const key = `validateQuestion:${reason ?? 'unknown'}`;
      rejections[key] = (rejections[key] ?? 0) + 1;
      continue;
    }
    seen.add(q.id);
    eligible.push(q);
  }

  return { eligible, rejections };
}

// ── Ranking (§1.4) ─────────────────────────────────────────────

/**
 * Rank tables are `Map`s, not object literals, because their keys come from DB
 * column VALUES (`String(q.verification_state)`, `String(q.source_type)`). A
 * plain object inherits `Object.prototype`, so a row carrying e.g.
 * `source_type='constructor'` would resolve to a FUNCTION — and `?? 3` / `?? 5`
 * do NOT catch a function, since it is not nullish. That non-number would then
 * flow straight into the numeric `rankKey` comparison and silently corrupt
 * question ordering. `Map.get` consults no prototype chain, so the `??` default
 * is the only fallback path and is genuinely exhaustive.
 */
const VERIFICATION_RANK = new Map<string, number>([
  ['verified', 0],
  ['legacy_unverified', 1],
  ['pending', 2],
]);

const SOURCE_RANK = new Map<string, number>([
  ['ncert_exercise', 0],
  ['ncert_intext', 1],
  ['ncert_example', 2],
  ['cbse_style', 3],
  ['practice', 4],
]);

/** Band anchors on the theta scale, mirroring the `irt_difficulty` proxy seed. */
const BAND_ANCHOR: Record<DifficultyBand, number> = { 1: -1.0, 2: 0.0, 3: 1.0 };

const IRT_TRUST_THRESHOLD = 30;

function bandOf(q: DiagnosticCandidate): DifficultyBand {
  return q.difficulty as DifficultyBand;
}

function isHots(q: DiagnosticCandidate): boolean {
  return HOTS_SET.has(String(q.bloom_level));
}

/**
 * §1.4 ranking key, ascending = better. The final element is a seeded random
 * tie-break so two sessions over the same pool differ (AC-3).
 */
function rankKey(q: DiagnosticCandidate, rng: () => number): number[] {
  const band = bandOf(q);
  const vRank = VERIFICATION_RANK.get(String(q.verification_state)) ?? 3;
  const smeRank = q.is_verified === true ? 0 : 1;

  const n = typeof q.irt_calibration_n === 'number' ? q.irt_calibration_n : 0;
  const calibrated = n >= IRT_TRUST_THRESHOLD && typeof q.irt_b === 'number';
  const calRank = calibrated ? 0 : 1;
  const bDistance = calibrated ? Math.abs((q.irt_b as number) - BAND_ANCHOR[band]) : 0;
  const discrimination = calibrated && typeof q.irt_a === 'number' ? -(q.irt_a as number) : 0;

  const sRank = SOURCE_RANK.get(String(q.source_type)) ?? 5;

  // §6.3 — Bloom x difficulty coherence as a tie-break only, never a filter.
  const coherent =
    (isHots(q) && band >= 2) || (q.bloom_level === 'remember' && band <= 2) ? 0 : 1;

  return [vRank, smeRank, calRank, bDistance, discrimination, sRank, coherent, rng()];
}

function compareKeys(a: number[], b: number[]): number {
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return 0;
}

function rankPool(pool: DiagnosticCandidate[], rng: () => number): DiagnosticCandidate[] {
  const keyed = pool.map((q) => ({ q, key: rankKey(q, rng) }));
  keyed.sort((x, y) => compareKeys(x.key, y.key));
  return keyed.map((k) => k.q);
}

// ── Constraint model ───────────────────────────────────────────

interface RungConstraints {
  /** Exact per-band counts, or `null` when only the ranges apply. */
  exactBands: { 1: number; 2: number; 3: number } | null;
  bandMin: { 1: number; 2: number; 3: number };
  bandMax: { 1: number; 2: number; 3: number };
  totalMin: number;
  totalMax: number;
  minChapters: number;
  maxPerChapter: number;
  bloom: BloomConstraints;
  verificationStates: readonly string[];
  applyTemplate: boolean;
  tier: QualityTier;
}

interface BloomConstraints {
  /** Per-level [min, max]; HOTS is the collapsed analyze+evaluate+create bucket. */
  remember: [number, number];
  understand: [number, number];
  apply: [number, number];
  hots: [number, number];
  minDistinctLevels: number;
  /** Max share of any single level, as an absolute count (Rung 0-1) … */
  maxSingleLevel: number | null;
  /** … or as a fraction of served items for `remember` (Rung 2-3). */
  maxRememberFraction: number | null;
}

/** §6.1 — Rung 0-1 Bloom shape over 15 items. */
const BLOOM_STRICT: BloomConstraints = {
  remember: [2, 5],
  understand: [3, 6],
  apply: [3, 6],
  hots: [2, 5],
  minDistinctLevels: 4,
  maxSingleLevel: 6,
  maxRememberFraction: null,
};

/** §6.2 — Rung 2-3 relaxation. HOTS >= 1 is a §5.2 never-degraded guarantee. */
const BLOOM_RELAXED: BloomConstraints = {
  remember: [0, Number.POSITIVE_INFINITY],
  understand: [0, Number.POSITIVE_INFINITY],
  apply: [0, Number.POSITIVE_INFINITY],
  hots: [1, Number.POSITIVE_INFINITY],
  minDistinctLevels: 3,
  maxSingleLevel: null,
  maxRememberFraction: 0.5,
};

function rungConstraints(rung: 0 | 1 | 2 | 3, targetTotal: number): RungConstraints {
  if (rung === 0 || rung === 1) {
    return {
      exactBands: { 1: DIAGNOSTIC_BLUEPRINT.easy, 2: DIAGNOSTIC_BLUEPRINT.medium, 3: DIAGNOSTIC_BLUEPRINT.hard },
      bandMin: { 1: DIAGNOSTIC_BLUEPRINT.easy, 2: DIAGNOSTIC_BLUEPRINT.medium, 3: DIAGNOSTIC_BLUEPRINT.hard },
      bandMax: { 1: DIAGNOSTIC_BLUEPRINT.easy, 2: DIAGNOSTIC_BLUEPRINT.medium, 3: DIAGNOSTIC_BLUEPRINT.hard },
      totalMin: DIAGNOSTIC_QUESTION_COUNT,
      totalMax: DIAGNOSTIC_QUESTION_COUNT,
      minChapters: 5,
      maxPerChapter: 3,
      bloom: BLOOM_STRICT,
      verificationStates: rung === 0 ? RUNG0_VERIFICATION_STATES : RUNG1_VERIFICATION_STATES,
      applyTemplate: true,
      tier: rung === 0 ? 'verified' : 'standard',
    };
  }

  if (rung === 2) {
    // §5.1 Rung 2 — blueprint tolerance, N still exactly 15.
    return {
      exactBands: null,
      bandMin: { 1: 3, 2: 4, 3: 2 },
      bandMax: { 1: 7, 2: 8, 3: 6 },
      totalMin: DIAGNOSTIC_QUESTION_COUNT,
      totalMax: DIAGNOSTIC_QUESTION_COUNT,
      minChapters: 3,
      maxPerChapter: 4,
      bloom: BLOOM_RELAXED,
      verificationStates: RUNG1_VERIFICATION_STATES,
      applyTemplate: false,
      tier: 'relaxed_blueprint',
    };
  }

  // §5.1 Rung 3 — short form, proportions held as close as the pool allows.
  return {
    exactBands: null,
    bandMin: { 1: 2, 2: 3, 3: 2 },
    bandMax: { 1: targetTotal, 2: targetTotal, 3: targetTotal },
    totalMin: DIAGNOSTIC_SHORT_FORM_FLOOR,
    totalMax: DIAGNOSTIC_QUESTION_COUNT - 1,
    minChapters: 3,
    maxPerChapter: 4,
    bloom: BLOOM_RELAXED,
    verificationStates: RUNG1_VERIFICATION_STATES,
    applyTemplate: false,
    tier: 'short_form',
  };
}

// ── Penalty (soft constraints used by the repair hill-climb) ───

function bloomBucket(q: DiagnosticCandidate): 'remember' | 'understand' | 'apply' | 'hots' {
  const lvl = String(q.bloom_level);
  if (lvl === 'remember') return 'remember';
  if (lvl === 'understand') return 'understand';
  if (lvl === 'apply') return 'apply';
  return 'hots';
}

function violationPenalty(sel: DiagnosticCandidate[], c: RungConstraints): number {
  let penalty = 0;

  // Chapter spread (§3.2).
  const perChapter = new Map<number, number>();
  for (const q of sel) {
    const ch = q.chapter_number as number;
    perChapter.set(ch, (perChapter.get(ch) ?? 0) + 1);
  }
  const distinctChapters = perChapter.size;
  if (distinctChapters < c.minChapters) penalty += (c.minChapters - distinctChapters) * 100;
  for (const count of perChapter.values()) {
    if (count > c.maxPerChapter) penalty += (count - c.maxPerChapter) * 100;
  }

  // Bloom's (§6).
  const buckets = { remember: 0, understand: 0, apply: 0, hots: 0 };
  const levelCounts = new Map<string, number>();
  for (const q of sel) {
    buckets[bloomBucket(q)]++;
    const lvl = String(q.bloom_level);
    levelCounts.set(lvl, (levelCounts.get(lvl) ?? 0) + 1);
  }
  const b = c.bloom;
  const bounded: Array<[number, [number, number]]> = [
    [buckets.remember, b.remember],
    [buckets.understand, b.understand],
    [buckets.apply, b.apply],
    [buckets.hots, b.hots],
  ];
  for (const [count, [min, max]] of bounded) {
    if (count < min) penalty += (min - count) * 100;
    if (Number.isFinite(max) && count > max) penalty += (count - max) * 100;
  }
  if (levelCounts.size < b.minDistinctLevels) penalty += (b.minDistinctLevels - levelCounts.size) * 100;
  if (b.maxSingleLevel != null) {
    for (const count of levelCounts.values()) {
      if (count > b.maxSingleLevel) penalty += (count - b.maxSingleLevel) * 100;
    }
  }
  if (b.maxRememberFraction != null && sel.length > 0) {
    const allowed = Math.floor(sel.length * b.maxRememberFraction);
    if (buckets.remember > allowed) penalty += (buckets.remember - allowed) * 100;
  }

  // §5.2 never-degraded guarantees, restated as penalties so the hill-climb
  // actively steers toward them.
  if (!sel.some((q) => bandOf(q) === 3)) penalty += 1000;
  if (!sel.some(isHots)) penalty += 1000;

  return penalty;
}

function satisfiesHardConstraints(sel: DiagnosticCandidate[], c: RungConstraints): boolean {
  if (sel.length < c.totalMin || sel.length > c.totalMax) return false;
  const bandCounts: Record<DifficultyBand, number> = { 1: 0, 2: 0, 3: 0 };
  for (const q of sel) bandCounts[bandOf(q)]++;
  for (const band of [1, 2, 3] as DifficultyBand[]) {
    if (c.exactBands && bandCounts[band] !== c.exactBands[band]) return false;
    if (bandCounts[band] < c.bandMin[band]) return false;
    if (bandCounts[band] > c.bandMax[band]) return false;
  }
  return violationPenalty(sel, c) === 0;
}

// ── Greedy build + repair ──────────────────────────────────────

/**
 * Multi-pass greedy: pass k admits at most k items per chapter, so distinct
 * chapters are maximised before any chapter is doubled up. Within a pass the
 * §1.4 ranking decides.
 */
function greedyPickBand(
  ranked: DiagnosticCandidate[],
  want: number,
  maxPerChapter: number,
  chapterUsage: Map<number, number>,
): DiagnosticCandidate[] {
  const picked: DiagnosticCandidate[] = [];
  const taken = new Set<string>();

  for (let cap = 1; cap <= maxPerChapter && picked.length < want; cap++) {
    for (const q of ranked) {
      if (picked.length >= want) break;
      if (taken.has(q.id)) continue;
      const ch = q.chapter_number as number;
      const used = chapterUsage.get(ch) ?? 0;
      if (used >= cap) continue;
      picked.push(q);
      taken.add(q.id);
      chapterUsage.set(ch, used + 1);
    }
  }

  return picked;
}

/**
 * Same-band swap hill-climb. Every swap preserves per-band counts, so the
 * blueprint stays satisfied while chapter-spread and Bloom's are repaired.
 */
function repair(
  selected: DiagnosticCandidate[],
  poolByBand: Record<DifficultyBand, DiagnosticCandidate[]>,
  c: RungConstraints,
  maxIterations = 60,
): DiagnosticCandidate[] {
  let current = selected.slice();
  let currentPenalty = violationPenalty(current, c);

  for (let iter = 0; iter < maxIterations && currentPenalty > 0; iter++) {
    let bestPenalty = currentPenalty;
    let bestSwap: { outIdx: number; incoming: DiagnosticCandidate } | null = null;
    const selectedIds = new Set(current.map((q) => q.id));

    for (let i = 0; i < current.length; i++) {
      const band = bandOf(current[i]);
      for (const candidate of poolByBand[band]) {
        if (selectedIds.has(candidate.id)) continue;
        const next = current.slice();
        next[i] = candidate;
        const p = violationPenalty(next, c);
        if (p < bestPenalty) {
          bestPenalty = p;
          bestSwap = { outIdx: i, incoming: candidate };
        }
        if (p === 0) break;
      }
      if (bestPenalty === 0) break;
    }

    if (!bestSwap) break; // local optimum — no improving same-band swap exists
    current = current.slice();
    current[bestSwap.outIdx] = bestSwap.incoming;
    currentPenalty = bestPenalty;
  }

  return current;
}

// ── Sequencing (§1.3) ──────────────────────────────────────────

/**
 * Arrange the selected items into the fixed positional template when the
 * blueprint is exactly 5/6/4 (Rung 0-1). Within a band, order is the seeded
 * shuffle so two sessions differ (AC-3) while AC-2 still holds positionally.
 */
export function arrangeByTemplate(
  selected: DiagnosticCandidate[],
  rng: () => number,
): DiagnosticCandidate[] | null {
  const byBand: Record<DifficultyBand, DiagnosticCandidate[]> = { 1: [], 2: [], 3: [] };
  for (const q of selected) byBand[bandOf(q)].push(q);
  if (
    byBand[1].length !== DIAGNOSTIC_BLUEPRINT.easy ||
    byBand[2].length !== DIAGNOSTIC_BLUEPRINT.medium ||
    byBand[3].length !== DIAGNOSTIC_BLUEPRINT.hard
  ) {
    return null;
  }
  for (const band of [1, 2, 3] as DifficultyBand[]) shuffleInPlace(byBand[band], rng);

  const cursor: Record<DifficultyBand, number> = { 1: 0, 2: 0, 3: 0 };
  return DIAGNOSTIC_BAND_TEMPLATE.map((band) => byBand[band][cursor[band]++]);
}

/**
 * Degraded-rung sequencing. The exact template cannot apply when the band
 * counts differ, so preserve the properties it exists for: start easy, end
 * easy, never two hard items adjacent.
 */
export function arrangeFallback(
  selected: DiagnosticCandidate[],
  rng: () => number,
): DiagnosticCandidate[] {
  const byBand: Record<DifficultyBand, DiagnosticCandidate[]> = { 1: [], 2: [], 3: [] };
  for (const q of selected) byBand[bandOf(q)].push(q);
  for (const band of [1, 2, 3] as DifficultyBand[]) shuffleInPlace(byBand[band], rng);

  const out: DiagnosticCandidate[] = [];
  // Open on the two easiest available items so every student answers something early.
  for (let i = 0; i < 2 && byBand[1].length > 0; i++) out.push(byBand[1].shift()!);
  // Reserve one easy item for the final position when we still can.
  const closer = byBand[1].length > 0 ? byBand[1].pop()! : null;

  const rest = [...byBand[2], ...byBand[3], ...byBand[1]];
  shuffleInPlace(rest, rng);

  // Place remaining items, deferring a hard item whenever the previous slot
  // already holds one (no discouragement cliff).
  const deferred: DiagnosticCandidate[] = [];
  for (const q of rest) {
    const prev = out[out.length - 1];
    if (bandOf(q) === 3 && prev && bandOf(prev) === 3) {
      deferred.push(q);
      continue;
    }
    out.push(q);
    while (deferred.length > 0) {
      const next = deferred[0];
      const last = out[out.length - 1];
      if (bandOf(next) === 3 && last && bandOf(last) === 3) break;
      out.push(deferred.shift()!);
    }
  }
  out.push(...deferred);
  if (closer) out.push(closer);

  return out;
}

// ── Target-count derivation for Rung 3 ─────────────────────────

/** Hold the 5/6/4 proportions as closely as the pool allows (§5.1 Rung 3). */
function shortFormTarget(
  available: Record<DifficultyBand, number>,
  total: number,
): {
  total: number;
  want: Record<DifficultyBand, number>;
} | null {
  if (total < DIAGNOSTIC_SHORT_FORM_FLOOR) return null;
  if (available[1] + available[2] + available[3] < total) return null;

  const want: Record<DifficultyBand, number> = {
    1: Math.min(available[1], Math.max(2, Math.round((DIAGNOSTIC_BLUEPRINT.easy / 15) * total))),
    2: Math.min(available[2], Math.max(3, Math.round((DIAGNOSTIC_BLUEPRINT.medium / 15) * total))),
    3: Math.min(available[3], Math.max(2, Math.round((DIAGNOSTIC_BLUEPRINT.hard / 15) * total))),
  };
  if (want[1] < 2 || want[2] < 3 || want[3] < 2) return null;

  // Reconcile the rounded per-band targets back to a single total, growing or
  // shrinking the bands that have the most / least slack.
  let sum = want[1] + want[2] + want[3];
  const order: DifficultyBand[] = [2, 1, 3];
  let guard = 0;
  while (sum !== total && guard++ < 64) {
    if (sum < total) {
      const band = order.find((b) => want[b] < available[b]);
      if (band == null) break;
      want[band]++;
      sum++;
    } else {
      const floors: Record<DifficultyBand, number> = { 1: 2, 2: 3, 3: 2 };
      const band = [...order].reverse().find((b) => want[b] > floors[b]);
      if (band == null) break;
      want[band]--;
      sum--;
    }
  }
  const finalTotal = want[1] + want[2] + want[3];
  if (finalTotal < DIAGNOSTIC_SHORT_FORM_FLOOR) return null;

  return { total: finalTotal, want };
}

// ── Public entry point ─────────────────────────────────────────

function poolShape(eligible: DiagnosticCandidate[]): {
  eligibleCount: number;
  eligibleBandCounts: { easy: number; medium: number; hard: number };
  eligibleChapterCount: number;
} {
  const bands = { easy: 0, medium: 0, hard: 0 };
  const chapters = new Set<number>();
  for (const q of eligible) {
    const band = bandOf(q);
    if (band === 1) bands.easy++;
    else if (band === 2) bands.medium++;
    else bands.hard++;
    chapters.add(q.chapter_number as number);
  }
  return {
    eligibleCount: eligible.length,
    eligibleBandCounts: bands,
    eligibleChapterCount: chapters.size,
  };
}

function emptyResult(
  rung: 4,
  reason: InsufficientReason,
  eligible: DiagnosticCandidate[],
): DiagnosticFormResult {
  return {
    rung,
    qualityTier: 'insufficient',
    questions: [],
    blueprint: { easy: 0, medium: 0, hard: 0 },
    chapterCount: 0,
    bloomCounts: {},
    ...poolShape(eligible),
    reason,
  };
}

function describe(
  rung: 0 | 1 | 2 | 3,
  tier: QualityTier,
  ordered: DiagnosticCandidate[],
  eligible: DiagnosticCandidate[],
): DiagnosticFormResult {
  const blueprint = { easy: 0, medium: 0, hard: 0 };
  const chapters = new Set<number>();
  const bloomCounts: Record<string, number> = {};
  for (const q of ordered) {
    const band = bandOf(q);
    if (band === 1) blueprint.easy++;
    else if (band === 2) blueprint.medium++;
    else blueprint.hard++;
    chapters.add(q.chapter_number as number);
    const lvl = String(q.bloom_level);
    bloomCounts[lvl] = (bloomCounts[lvl] ?? 0) + 1;
  }
  return {
    rung,
    qualityTier: tier,
    questions: ordered,
    blueprint,
    chapterCount: chapters.size,
    bloomCounts,
    ...poolShape(eligible),
  };
}

/** Why the pool could not produce any servable form (§5.3 reason enum). */
export function insufficientReason(
  eligible: DiagnosticCandidate[],
): InsufficientReason {
  if (eligible.length < DIAGNOSTIC_SHORT_FORM_FLOOR) return 'too_few_items';
  if (!eligible.some((q) => bandOf(q) === 3)) return 'no_hard_items';
  if (!eligible.some(isHots)) return 'no_hots_items';
  const chapters = new Set(eligible.map((q) => q.chapter_number as number));
  if (chapters.size < 3) return 'too_few_chapters';
  return 'too_few_items';
}

/**
 * Select the diagnostic form. Walks the §5.1 ladder Rung 0 -> 4 and returns the
 * first rung that can be satisfied. Rung 4 returns zero questions and a reason;
 * the caller MUST NOT create a `diagnostic_assessments` row in that case (F2).
 */
export function selectDiagnosticForm(
  params: SelectDiagnosticFormParams,
): DiagnosticFormResult {
  const { candidates, grade, subject, seed } = params;
  const inScopeChapters = new Set<number>(params.inScopeChapters);

  if (inScopeChapters.size === 0) {
    return emptyResult(4, 'too_few_chapters', []);
  }

  const { eligible } = screenCandidates(candidates, {
    grade,
    subject: subject.toLowerCase(),
    inScopeChapters,
  });

  for (const rung of [0, 1, 2, 3] as const) {
    const c = rungConstraints(rung, DIAGNOSTIC_QUESTION_COUNT);
    const allowedStates = new Set<string>(c.verificationStates);
    const pool = eligible.filter((q) => allowedStates.has(String(q.verification_state)));
    if (pool.length < c.totalMin) continue;

    // A fresh RNG per rung keeps each attempt deterministic for a given seed.
    const rng = makeRng(`${seed}:${rung}`);
    const poolByBand: Record<DifficultyBand, DiagnosticCandidate[]> = {
      1: rankPool(pool.filter((q) => bandOf(q) === 1), rng),
      2: rankPool(pool.filter((q) => bandOf(q) === 2), rng),
      3: rankPool(pool.filter((q) => bandOf(q) === 3), rng),
    };
    const available: Record<DifficultyBand, number> = {
      1: poolByBand[1].length,
      2: poolByBand[2].length,
      3: poolByBand[3].length,
    };

    // Candidate band targets to try, best-first. Rung 3 walks the form length
    // down from 14 to the floor of 10 so one unlucky chapter cap does not push
    // an otherwise-servable pool all the way to Rung 4.
    const targets: Array<Record<DifficultyBand, number>> = [];
    if (rung === 0 || rung === 1) {
      targets.push({
        1: DIAGNOSTIC_BLUEPRINT.easy,
        2: DIAGNOSTIC_BLUEPRINT.medium,
        3: DIAGNOSTIC_BLUEPRINT.hard,
      });
    } else if (rung === 2) {
      const want = pickRelaxedTargets(available, c);
      if (want[1] + want[2] + want[3] === DIAGNOSTIC_QUESTION_COUNT) targets.push(want);
    } else {
      const ceiling = Math.min(
        DIAGNOSTIC_QUESTION_COUNT - 1,
        available[1] + available[2] + available[3],
      );
      for (let total = ceiling; total >= DIAGNOSTIC_SHORT_FORM_FLOOR; total--) {
        const short = shortFormTarget(available, total);
        if (short) targets.push(short.want);
      }
    }

    for (const want of targets) {
      if (available[1] < want[1] || available[2] < want[2] || available[3] < want[3]) continue;

      const chapterUsage = new Map<number, number>();
      // Scarcest band first so the hard band is never crowded out of its chapters.
      const buildOrder: DifficultyBand[] = [3, 2, 1];
      let selected: DiagnosticCandidate[] = [];
      let complete = true;
      for (const band of buildOrder) {
        const picked = greedyPickBand(poolByBand[band], want[band], c.maxPerChapter, chapterUsage);
        if (picked.length < want[band]) {
          complete = false;
          break;
        }
        selected.push(...picked);
      }
      if (!complete) continue;

      selected = repair(selected, poolByBand, c);
      if (!satisfiesHardConstraints(selected, c)) continue;

      const ordered =
        (c.applyTemplate ? arrangeByTemplate(selected, rng) : null) ??
        arrangeFallback(selected, rng);

      return describe(rung, c.tier, ordered, eligible);
    }
  }

  return emptyResult(4, insufficientReason(eligible), eligible);
}

/**
 * Rung 2 band targets: start from the blueprint and shift within the §5.1
 * tolerance windows toward whichever bands actually have supply, keeping the
 * total at exactly 15.
 */
function pickRelaxedTargets(
  available: Record<DifficultyBand, number>,
  c: RungConstraints,
): Record<DifficultyBand, number> {
  const want: Record<DifficultyBand, number> = {
    1: Math.min(available[1], DIAGNOSTIC_BLUEPRINT.easy),
    2: Math.min(available[2], DIAGNOSTIC_BLUEPRINT.medium),
    3: Math.min(available[3], DIAGNOSTIC_BLUEPRINT.hard),
  };

  let sum = want[1] + want[2] + want[3];
  // Fill the shortfall from bands that still have supply and tolerance headroom.
  const growOrder: DifficultyBand[] = [2, 1, 3];
  let guard = 0;
  while (sum < DIAGNOSTIC_QUESTION_COUNT && guard++ < 64) {
    const band = growOrder.find((b) => want[b] < Math.min(available[b], c.bandMax[b]));
    if (band == null) break;
    want[band]++;
    sum++;
  }
  return want;
}
