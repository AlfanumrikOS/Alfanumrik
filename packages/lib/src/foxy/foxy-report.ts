// packages/lib/src/foxy/foxy-report.ts
//
// Foxy Learning Report (Phase 3.1) — the PURE aggregator that shapes the raw
// learning-loop rows an admin route has already read into a single at-a-glance
// per-student report DTO.
//
// ─── HARD INVARIANTS ─────────────────────────────────────────────────────────
//   • PURE + DETERMINISTIC: no DB, no fetch, no Date.now(), no randomness, no
//     side effects. Same inputs → byte-identical output. Trivially unit-testable.
//     The ROUTE does every read and passes the rows in; this module only shapes.
//   • READ-ONLY semantics: this shapes existing state. It NEVER moves mastery,
//     XP, or any learner-state surface (P1/P2/P3 untouched — nothing here writes).
//   • GRACEFUL DEGRADATION: the event ledger (state_events perception + struggle
//     rows) is DARK in production until it's ramped. Every ledger-derived section
//     degrades to empty arrays / `available:false` / `ledgerAvailable:false` when
//     no ledger rows are supplied — never throws, never errors.
//   • P5: `grade` is a STRING ("6".."12") passed through untouched — never an int.
//   • P13: inputs are codes / ids / enums / aggregates ONLY. This module never
//     receives (and the route never reads) the student's message text, the
//     served-item stems, or the free-text student_misconceptions columns
//     (question_text / student_answer / correct_answer). No PII is shaped here.
//
// Owner: backend. Reviewers (P14): ops (admin-metrics definition), frontend
//   (renders the DTO), assessment (learner-correctness of mastery / misconception
//   / struggle derivation), testing.

import type { MasteryBand } from '@alfanumrik/lib/dashboard/mastery-band-labels';

// ─── Raw input row shapes (exactly the columns the route selects) ────────────
// Each is a structural read-surface — the route may pass richer rows; only these
// fields are consumed.

/** foxy_sessions row (engagement + persisted Teaching-Director lesson state). */
export interface FoxyReportSessionRow {
  id: string;
  subject: string | null;
  grade: string | null;
  chapter: string | null;
  mode: string | null;
  last_active_at: string | null;
  created_at: string | null;
  /** Persisted lesson step (Teaching Director), or null. */
  lesson_step: string | null;
  /** chapter_concepts.id the lesson is progressing, or null. */
  lesson_objective_concept_id: string | null;
}

/** foxy_served_items row (server-issued evidential "Quiz me" item). */
export interface FoxyReportServedItemRow {
  id: string;
  session_id: string;
  concept_id: string;
  question_id: string | null;
  served_at: string | null;
  /** Set by the grading flow when answered; null = served, unanswered. */
  answered_at: string | null;
  /** Links to concept_attempts.attempt_id once graded; null until then. */
  attempt_id: string | null;
}

/** concept_attempts row (per-attempt BKT chain log — grade + delta source). */
export interface FoxyReportAttemptRow {
  attempt_id: string;
  concept_id: string;
  /** true / false once answered; null while reserved. */
  correct: boolean | null;
  answered_at: string | null;
  prior_mastery_mean: number | string | null;
  posterior_mastery_mean: number | string | null;
}

/** concept_mastery row (current BKT mastery for a concept). */
export interface FoxyReportMasteryRow {
  concept_id: string | null;
  mastery_mean: number | string | null;
  mastery_probability: number | string | null;
  mastery_level: string | null;
  updated_at: string | null;
}

/** chapter_concepts metadata (concept name resolution — content, not PII). */
export interface FoxyReportConceptMeta {
  id: string;
  title: string | null;
  chapter_number: number | null;
  subject: string | null;
}

/** student_misconceptions row — CODES ONLY (no free-text columns are read). */
export interface FoxyReportStudentMisconceptionRow {
  pattern_code: string | null;
  concept_code: string | null;
  detected_at: string | null;
  is_resolved: boolean | null;
  resolved_at: string | null;
}

/** question_misconceptions distinct rows — used as a bilingual LABEL dictionary. */
export interface FoxyReportMisconceptionLabelRow {
  misconception_code: string;
  misconception_label: string | null;
  misconception_label_hi: string | null;
}

/**
 * learner.turn_classified payload (perception ledger — additive, DARK by default).
 * Only the fields this report reads are declared.
 */
export interface FoxyReportLedgerTurn {
  occurred_at: string | null;
  misconceptionCode: string | null;
  struggleSignal: string | null;
}

/**
 * learner.struggle_observed payload (struggle ledger — additive, DARK by default).
 */
export interface FoxyReportLedgerStruggle {
  occurred_at: string | null;
  signalType: string | null;
}

/** The full raw-rows bundle the route hands the aggregator. */
export interface FoxyLearningReportInput {
  studentId: string;
  /** P5 — grade string "6".."12", or null when unknown. Passed through untouched. */
  grade: string | null;
  /** ISO timestamp the route stamps as the report generation time. */
  generatedAt: string;
  sessions: FoxyReportSessionRow[];
  /** Count of role='user' foxy_chat_messages (accurate head count from the route). */
  userTurnCount: number;
  servedItems: FoxyReportServedItemRow[];
  attempts: FoxyReportAttemptRow[];
  masteryRows: FoxyReportMasteryRow[];
  /** chapter_concepts by id (concept-name resolution). */
  conceptMeta: FoxyReportConceptMeta[];
  studentMisconceptions: FoxyReportStudentMisconceptionRow[];
  misconceptionLabels: FoxyReportMisconceptionLabelRow[];
  /** Perception-ledger turns. Empty ⇒ ledger dark / not ramped (degrade). */
  ledgerTurns: FoxyReportLedgerTurn[];
  /** Struggle-ledger observations. Empty ⇒ ledger dark / not ramped (degrade). */
  ledgerStruggles: FoxyReportLedgerStruggle[];
}

// ─── Output DTO (shared with the frontend that renders it) ───────────────────

export interface FoxyReportEngagement {
  /** Number of Foxy sessions in the read window. */
  sessionCount: number;
  /** Number of student turns (role='user' messages). */
  turnCount: number;
  /** Most-recent session activity, or null. */
  lastActiveAt: string | null;
  /** Distinct subjects touched. */
  subjects: string[];
  /** Distinct chapter labels touched. */
  chapters: string[];
  /** Distinct session modes used. */
  modes: string[];
}

export interface FoxyReportEvidentialPractice {
  /** Gradable MCQs Foxy served. */
  served: number;
  /** Served items that were answered + verifiably graded. */
  answered: number;
  /** Answered items graded correct. */
  correct: number;
  /** Math.round(correct/answered*100), or null when nothing was answered. */
  accuracyPct: number | null;
}

export interface FoxyReportMasteryConcept {
  conceptId: string;
  conceptName: string | null;
  /** BKT posterior mean 0..1 (rounded to 4dp), or null. */
  masteryMean: number | null;
  /** low / mid / high band derived from the BKT mastery line, or null. */
  band: MasteryBand | null;
  /** posterior − prior on the most-recent answered attempt (rounded), or null. */
  recentDelta: number | null;
  /** Answered evidential attempts on this concept. */
  attempts: number;
}

export interface FoxyReportMasteryMovement {
  conceptsPracticed: number;
  concepts: FoxyReportMasteryConcept[];
}

export type FoxyReportMisconceptionSource = 'detected' | 'perception' | 'both';

export interface FoxyReportMisconception {
  code: string;
  label: string | null;
  labelHi: string | null;
  source: FoxyReportMisconceptionSource;
  /** concept_code from student_misconceptions, when known. */
  concept: string | null;
  occurrences: number;
  /** Resolved only when it came from student_misconceptions and every row is resolved. */
  resolved: boolean;
  lastSeenAt: string | null;
}

export interface FoxyReportMisconceptions {
  total: number;
  /** Distinct codes not marked resolved. */
  open: number;
  items: FoxyReportMisconception[];
}

export interface FoxyReportLessonProgress {
  active: boolean;
  lessonStep: string | null;
  objectiveConceptId: string | null;
  objectiveConceptName: string | null;
  sessionId: string | null;
}

export interface FoxyReportStruggleSignal {
  signal: string;
  count: number;
  lastObservedAt: string | null;
}

export interface FoxyReportStruggle {
  /** True only when the ledger supplied at least one struggle observation. */
  available: boolean;
  signals: FoxyReportStruggleSignal[];
}

export interface FoxyLearningReport {
  studentId: string;
  /** P5 — grade string, passed through untouched. */
  grade: string | null;
  generatedAt: string;
  /** True when the perception/struggle event ledger contributed any rows. */
  ledgerAvailable: boolean;
  engagement: FoxyReportEngagement;
  evidentialPractice: FoxyReportEvidentialPractice;
  masteryMovement: FoxyReportMasteryMovement;
  misconceptions: FoxyReportMisconceptions;
  /** Null when no lesson state is persisted on any recent session. */
  lessonProgress: FoxyReportLessonProgress | null;
  struggleSignals: FoxyReportStruggle;
}

// ─── Small pure helpers ──────────────────────────────────────────────────────

function toNum(v: number | string | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

/**
 * Map a BKT posterior mean (0..1) onto the shared low/mid/high band. Cutoffs
 * are the platform-wide BKT lines documented in packages/lib/src/pulse/signals.ts
 * (at-risk < 0.4) and cognitive-engine (developing 0.4–0.8, strong ≥ 0.8) — NOT
 * the accuracy-% cutoffs in mastery-band-labels (whose bandForValue is anchored
 * to accuracy %, per its assessment C1 caveat). We reuse the SHARED MasteryBand
 * type so the frontend can render with MASTERY_BAND_LABELS, but derive the band
 * from BKT mastery because that is the report's mastery-movement source.
 */
function masteryMeanToBand(mean: number | null): MasteryBand | null {
  if (mean === null) return null;
  if (mean >= 0.8) return 'high';
  if (mean >= 0.4) return 'mid';
  return 'low';
}

function distinct(values: Array<string | null | undefined>): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const v of values) {
    if (typeof v === 'string' && v.trim() !== '' && !seen.has(v)) {
      seen.add(v);
      out.push(v);
    }
  }
  return out;
}

function maxIso(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return a >= b ? a : b;
}

// ─── Section builders ────────────────────────────────────────────────────────

function buildEngagement(input: FoxyLearningReportInput): FoxyReportEngagement {
  const { sessions, userTurnCount } = input;
  let lastActiveAt: string | null = null;
  for (const s of sessions) lastActiveAt = maxIso(lastActiveAt, s.last_active_at);
  return {
    sessionCount: sessions.length,
    turnCount: Number.isFinite(userTurnCount) && userTurnCount > 0 ? Math.floor(userTurnCount) : 0,
    lastActiveAt,
    subjects: distinct(sessions.map((s) => s.subject)),
    chapters: distinct(sessions.map((s) => s.chapter)),
    modes: distinct(sessions.map((s) => s.mode)),
  };
}

function buildEvidentialPractice(
  servedItems: FoxyReportServedItemRow[],
  attemptById: Map<string, FoxyReportAttemptRow>,
): FoxyReportEvidentialPractice {
  let answered = 0;
  let correct = 0;
  for (const item of servedItems) {
    if (!item.attempt_id) continue;
    const attempt = attemptById.get(item.attempt_id);
    // Verifiable grade only: the served item must map to an answered attempt.
    if (!attempt || attempt.correct === null || attempt.correct === undefined) continue;
    answered += 1;
    if (attempt.correct === true) correct += 1;
  }
  const accuracyPct = answered > 0 ? Math.round((correct / answered) * 100) : null;
  return { served: servedItems.length, answered, correct, accuracyPct };
}

function buildMasteryMovement(
  servedItems: FoxyReportServedItemRow[],
  attempts: FoxyReportAttemptRow[],
  masteryRows: FoxyReportMasteryRow[],
  conceptMetaById: Map<string, FoxyReportConceptMeta>,
): FoxyReportMasteryMovement {
  // Concepts practiced via Foxy = distinct concept_ids across served items.
  const practicedConceptIds = distinct(servedItems.map((s) => s.concept_id));

  // Current mastery per concept_id.
  const masteryByConcept = new Map<string, FoxyReportMasteryRow>();
  for (const m of masteryRows) {
    if (m.concept_id) masteryByConcept.set(m.concept_id, m);
  }

  // Latest answered attempt (+ answered count) per concept.
  interface Agg {
    latestAnsweredAt: string | null;
    latestDelta: number | null;
    answeredCount: number;
  }
  const attemptAgg = new Map<string, Agg>();
  for (const a of attempts) {
    if (a.correct === null || a.correct === undefined) continue; // only answered
    const agg = attemptAgg.get(a.concept_id) ?? {
      latestAnsweredAt: null,
      latestDelta: null,
      answeredCount: 0,
    };
    agg.answeredCount += 1;
    const isNewer = a.answered_at !== null && (agg.latestAnsweredAt === null || a.answered_at > agg.latestAnsweredAt);
    if (isNewer || agg.latestAnsweredAt === null) {
      const prior = toNum(a.prior_mastery_mean);
      const post = toNum(a.posterior_mastery_mean);
      agg.latestAnsweredAt = a.answered_at;
      agg.latestDelta = prior !== null && post !== null ? round4(post - prior) : null;
    }
    attemptAgg.set(a.concept_id, agg);
  }

  const concepts: FoxyReportMasteryConcept[] = practicedConceptIds.map((conceptId) => {
    const mastery = masteryByConcept.get(conceptId) ?? null;
    const meta = conceptMetaById.get(conceptId) ?? null;
    const agg = attemptAgg.get(conceptId) ?? null;
    // BKT posterior mean is the evidential source; fall back to the legacy
    // mastery_probability when the BKT column hasn't been written yet.
    const masteryMeanRaw = mastery
      ? toNum(mastery.mastery_mean) ?? toNum(mastery.mastery_probability)
      : null;
    const masteryMean = masteryMeanRaw !== null ? round4(masteryMeanRaw) : null;
    return {
      conceptId,
      conceptName: meta?.title ?? null,
      masteryMean,
      band: masteryMeanToBand(masteryMean),
      recentDelta: agg?.latestDelta ?? null,
      attempts: agg?.answeredCount ?? 0,
    };
  });

  // Weakest-first (nulls last), then by conceptId for a deterministic tie-break.
  concepts.sort((a, b) => {
    const am = a.masteryMean;
    const bm = b.masteryMean;
    if (am === null && bm === null) return a.conceptId.localeCompare(b.conceptId);
    if (am === null) return 1;
    if (bm === null) return -1;
    if (am !== bm) return am - bm;
    return a.conceptId.localeCompare(b.conceptId);
  });

  return { conceptsPracticed: practicedConceptIds.length, concepts };
}

function buildMisconceptions(
  studentMisconceptions: FoxyReportStudentMisconceptionRow[],
  labels: FoxyReportMisconceptionLabelRow[],
  ledgerTurns: FoxyReportLedgerTurn[],
): FoxyReportMisconceptions {
  const labelByCode = new Map<string, FoxyReportMisconceptionLabelRow>();
  for (const l of labels) if (l.misconception_code) labelByCode.set(l.misconception_code, l);

  interface Acc {
    code: string;
    fromDetected: boolean;
    fromPerception: boolean;
    concept: string | null;
    occurrences: number;
    resolvedRows: number;
    totalDetectedRows: number;
    lastSeenAt: string | null;
  }
  const byCode = new Map<string, Acc>();

  const ensure = (code: string): Acc => {
    let acc = byCode.get(code);
    if (!acc) {
      acc = {
        code,
        fromDetected: false,
        fromPerception: false,
        concept: null,
        occurrences: 0,
        resolvedRows: 0,
        totalDetectedRows: 0,
        lastSeenAt: null,
      };
      byCode.set(code, acc);
    }
    return acc;
  };

  // (1) Detected misconceptions (always available — the evidential/detected source).
  for (const row of studentMisconceptions) {
    const code = row.pattern_code?.trim();
    if (!code) continue;
    const acc = ensure(code);
    acc.fromDetected = true;
    acc.occurrences += 1;
    acc.totalDetectedRows += 1;
    if (row.is_resolved === true) acc.resolvedRows += 1;
    if (!acc.concept && row.concept_code) acc.concept = row.concept_code;
    acc.lastSeenAt = maxIso(acc.lastSeenAt, row.resolved_at ?? row.detected_at);
  }

  // (2) Perception-ledger misconceptions (additive; empty ⇒ ledger dark).
  for (const turn of ledgerTurns) {
    const code = turn.misconceptionCode?.trim();
    if (!code) continue;
    const acc = ensure(code);
    acc.fromPerception = true;
    acc.occurrences += 1;
    acc.lastSeenAt = maxIso(acc.lastSeenAt, turn.occurred_at);
  }

  const items: FoxyReportMisconception[] = Array.from(byCode.values()).map((acc) => {
    const source: FoxyReportMisconceptionSource =
      acc.fromDetected && acc.fromPerception ? 'both' : acc.fromDetected ? 'detected' : 'perception';
    // A code is "resolved" only when it's detected AND every detected row is resolved.
    // Perception-only observations are never "resolved" (observation, not a graded state).
    const resolved = acc.fromDetected && acc.totalDetectedRows > 0 && acc.resolvedRows === acc.totalDetectedRows;
    const label = labelByCode.get(acc.code) ?? null;
    return {
      code: acc.code,
      label: label?.misconception_label ?? null,
      labelHi: label?.misconception_label_hi ?? null,
      source,
      concept: acc.concept,
      occurrences: acc.occurrences,
      resolved,
      lastSeenAt: acc.lastSeenAt,
    };
  });

  // Most-frequent first, then code for a deterministic tie-break.
  items.sort((a, b) => (b.occurrences - a.occurrences) || a.code.localeCompare(b.code));

  const open = items.filter((i) => !i.resolved).length;
  return { total: items.length, open, items };
}

function buildLessonProgress(
  sessions: FoxyReportSessionRow[],
  conceptMetaById: Map<string, FoxyReportConceptMeta>,
): FoxyReportLessonProgress | null {
  // Sessions are ordered most-recent-first by the route; take the first that
  // carries persisted Teaching-Director lesson state.
  const withState = sessions.find(
    (s) => s.lesson_step !== null || s.lesson_objective_concept_id !== null,
  );
  if (!withState) return null;
  const objectiveConceptId = withState.lesson_objective_concept_id ?? null;
  const meta = objectiveConceptId ? conceptMetaById.get(objectiveConceptId) ?? null : null;
  return {
    active: true,
    lessonStep: withState.lesson_step ?? null,
    objectiveConceptId,
    objectiveConceptName: meta?.title ?? null,
    sessionId: withState.id,
  };
}

function buildStruggleSignals(
  ledgerStruggles: FoxyReportLedgerStruggle[],
  ledgerTurns: FoxyReportLedgerTurn[],
): FoxyReportStruggle {
  interface Agg {
    signal: string;
    count: number;
    lastObservedAt: string | null;
  }
  const bySignal = new Map<string, Agg>();
  const add = (signal: string | null, occurredAt: string | null) => {
    const s = signal?.trim();
    if (!s || s === 'none') return;
    const agg = bySignal.get(s) ?? { signal: s, count: 0, lastObservedAt: null };
    agg.count += 1;
    agg.lastObservedAt = maxIso(agg.lastObservedAt, occurredAt);
    bySignal.set(s, agg);
  };

  for (const obs of ledgerStruggles) add(obs.signalType, obs.occurred_at);
  for (const turn of ledgerTurns) add(turn.struggleSignal, turn.occurred_at);

  const signals = Array.from(bySignal.values()).sort(
    (a, b) => (b.count - a.count) || a.signal.localeCompare(b.signal),
  );

  // Available only when the ledger actually supplied observations of any kind.
  const available = ledgerStruggles.length > 0 || ledgerTurns.length > 0;
  return { available, signals };
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Shape the raw learning-loop rows into the Foxy Learning Report DTO. Pure —
 * no IO, no clock, no side effects. Every ledger-derived section degrades to
 * empty / `available:false` when the ledger rows are empty (dark bus).
 */
export function composeFoxyLearningReport(input: FoxyLearningReportInput): FoxyLearningReport {
  const conceptMetaById = new Map<string, FoxyReportConceptMeta>();
  for (const c of input.conceptMeta) conceptMetaById.set(c.id, c);

  const attemptById = new Map<string, FoxyReportAttemptRow>();
  for (const a of input.attempts) attemptById.set(a.attempt_id, a);

  const ledgerAvailable = input.ledgerTurns.length > 0 || input.ledgerStruggles.length > 0;

  return {
    studentId: input.studentId,
    grade: input.grade,
    generatedAt: input.generatedAt,
    ledgerAvailable,
    engagement: buildEngagement(input),
    evidentialPractice: buildEvidentialPractice(input.servedItems, attemptById),
    masteryMovement: buildMasteryMovement(
      input.servedItems,
      input.attempts,
      input.masteryRows,
      conceptMetaById,
    ),
    misconceptions: buildMisconceptions(
      input.studentMisconceptions,
      input.misconceptionLabels,
      input.ledgerTurns,
    ),
    lessonProgress: buildLessonProgress(input.sessions, conceptMetaById),
    struggleSignals: buildStruggleSignals(input.ledgerStruggles, input.ledgerTurns),
  };
}
