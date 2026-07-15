import { describe, it, expect } from 'vitest';
import {
  composeFoxyLearningReport,
  type FoxyLearningReportInput,
} from './foxy-report';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const STUDENT_ID = '11111111-1111-1111-1111-111111111111';
const CONCEPT_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const CONCEPT_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const SESSION_1 = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const ATTEMPT_A = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
const ATTEMPT_B = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';

/** A minimal empty input — every array empty, ledger dark. */
function emptyInput(overrides: Partial<FoxyLearningReportInput> = {}): FoxyLearningReportInput {
  return {
    studentId: STUDENT_ID,
    grade: '8',
    generatedAt: '2026-07-15T00:00:00.000Z',
    sessions: [],
    userTurnCount: 0,
    servedItems: [],
    attempts: [],
    masteryRows: [],
    conceptMeta: [],
    studentMisconceptions: [],
    misconceptionLabels: [],
    ledgerTurns: [],
    ledgerStruggles: [],
    ...overrides,
  };
}

/** A fully-populated input, including a lit ledger. */
function populatedInput(): FoxyLearningReportInput {
  return {
    studentId: STUDENT_ID,
    grade: '8',
    generatedAt: '2026-07-15T12:00:00.000Z',
    sessions: [
      {
        id: SESSION_1,
        subject: 'Science',
        grade: '8',
        chapter: 'Force and Pressure',
        mode: 'learn',
        last_active_at: '2026-07-15T11:00:00.000Z',
        created_at: '2026-07-15T10:00:00.000Z',
        lesson_step: 'guided_examples',
        lesson_objective_concept_id: CONCEPT_A,
      },
      {
        id: 'f1f1f1f1-f1f1-f1f1-f1f1-f1f1f1f1f1f1',
        subject: 'Mathematics',
        grade: '8',
        chapter: 'Rational Numbers',
        mode: 'practice',
        last_active_at: '2026-07-14T09:00:00.000Z',
        created_at: '2026-07-14T08:00:00.000Z',
        lesson_step: null,
        lesson_objective_concept_id: null,
      },
    ],
    userTurnCount: 17,
    servedItems: [
      {
        id: 's-a',
        session_id: SESSION_1,
        concept_id: CONCEPT_A,
        question_id: `${CONCEPT_A}:evidential:v1`,
        served_at: '2026-07-15T11:05:00.000Z',
        answered_at: '2026-07-15T11:06:00.000Z',
        attempt_id: ATTEMPT_A,
      },
      {
        id: 's-b',
        session_id: SESSION_1,
        concept_id: CONCEPT_B,
        question_id: `${CONCEPT_B}:evidential:v1`,
        served_at: '2026-07-15T11:10:00.000Z',
        answered_at: '2026-07-15T11:11:00.000Z',
        attempt_id: ATTEMPT_B,
      },
      {
        // Served but NOT answered (no attempt) — counts as served, not answered.
        id: 's-c',
        session_id: SESSION_1,
        concept_id: CONCEPT_A,
        question_id: `${CONCEPT_A}:evidential:v1`,
        served_at: '2026-07-15T11:20:00.000Z',
        answered_at: null,
        attempt_id: null,
      },
    ],
    attempts: [
      {
        attempt_id: ATTEMPT_A,
        concept_id: CONCEPT_A,
        correct: true,
        answered_at: '2026-07-15T11:06:00.000Z',
        prior_mastery_mean: 0.4,
        posterior_mastery_mean: 0.55,
      },
      {
        attempt_id: ATTEMPT_B,
        concept_id: CONCEPT_B,
        correct: false,
        answered_at: '2026-07-15T11:11:00.000Z',
        prior_mastery_mean: 0.3,
        posterior_mastery_mean: 0.22,
      },
    ],
    masteryRows: [
      {
        concept_id: CONCEPT_A,
        mastery_mean: 0.55,
        mastery_probability: 0.5,
        mastery_level: 'developing',
        updated_at: '2026-07-15T11:06:30.000Z',
      },
      {
        concept_id: CONCEPT_B,
        mastery_mean: 0.22,
        mastery_probability: 0.2,
        mastery_level: 'building',
        updated_at: '2026-07-15T11:11:30.000Z',
      },
    ],
    conceptMeta: [
      { id: CONCEPT_A, title: 'Pressure exerted by liquids', chapter_number: 11, subject: 'Science' },
      { id: CONCEPT_B, title: 'Multiplying rational numbers', chapter_number: 1, subject: 'Mathematics' },
    ],
    studentMisconceptions: [
      {
        pattern_code: 'confuses_mass_with_weight',
        concept_code: 'force_pressure',
        detected_at: '2026-07-13T10:00:00.000Z',
        is_resolved: false,
        resolved_at: null,
      },
      {
        pattern_code: 'sign_error_negative_product',
        concept_code: 'rational_numbers',
        detected_at: '2026-07-12T10:00:00.000Z',
        is_resolved: true,
        resolved_at: '2026-07-14T10:00:00.000Z',
      },
    ],
    misconceptionLabels: [
      {
        misconception_code: 'confuses_mass_with_weight',
        misconception_label: 'Confuses mass with weight',
        misconception_label_hi: 'द्रव्यमान और भार में भ्रम',
      },
    ],
    ledgerTurns: [
      {
        occurred_at: '2026-07-15T11:06:10.000Z',
        misconceptionCode: 'confuses_mass_with_weight',
        struggleSignal: 'none',
      },
      {
        occurred_at: '2026-07-15T11:12:00.000Z',
        misconceptionCode: 'divides_instead_of_multiplies',
        struggleSignal: 'repeated_wrong',
      },
    ],
    ledgerStruggles: [
      { occurred_at: '2026-07-15T11:11:30.000Z', signalType: 'repeated_wrong' },
      { occurred_at: '2026-07-15T11:13:00.000Z', signalType: 'explicit_confusion' },
    ],
  };
}

// ─── Populated path ───────────────────────────────────────────────────────────

describe('composeFoxyLearningReport — populated', () => {
  const report = composeFoxyLearningReport(populatedInput());

  it('passes through studentId + grade (P5 string) + generatedAt', () => {
    expect(report.studentId).toBe(STUDENT_ID);
    expect(report.grade).toBe('8');
    expect(typeof report.grade).toBe('string');
    expect(report.generatedAt).toBe('2026-07-15T12:00:00.000Z');
  });

  it('marks the ledger available when perception/struggle rows are present', () => {
    expect(report.ledgerAvailable).toBe(true);
  });

  it('aggregates engagement (sessions, user turns, last-active, subjects/chapters/modes)', () => {
    expect(report.engagement.sessionCount).toBe(2);
    expect(report.engagement.turnCount).toBe(17);
    expect(report.engagement.lastActiveAt).toBe('2026-07-15T11:00:00.000Z');
    expect(report.engagement.subjects).toEqual(['Science', 'Mathematics']);
    expect(report.engagement.chapters).toEqual(['Force and Pressure', 'Rational Numbers']);
    expect(report.engagement.modes).toEqual(['learn', 'practice']);
  });

  it('computes evidential practice: served counts all items, answered/correct only verifiable grades', () => {
    // 3 served, 2 answered (the unanswered no-attempt item is excluded), 1 correct.
    expect(report.evidentialPractice.served).toBe(3);
    expect(report.evidentialPractice.answered).toBe(2);
    expect(report.evidentialPractice.correct).toBe(1);
    expect(report.evidentialPractice.accuracyPct).toBe(50); // round(1/2*100)
  });

  it('computes mastery movement: concepts practiced, band, and recent delta', () => {
    expect(report.masteryMovement.conceptsPracticed).toBe(2);
    // Weakest-first: CONCEPT_B (0.22) before CONCEPT_A (0.55).
    const [first, second] = report.masteryMovement.concepts;
    expect(first.conceptId).toBe(CONCEPT_B);
    expect(first.masteryMean).toBe(0.22);
    expect(first.band).toBe('low'); // < 0.4
    expect(first.recentDelta).toBe(-0.08); // 0.22 - 0.30
    expect(first.attempts).toBe(1);
    expect(second.conceptId).toBe(CONCEPT_A);
    expect(second.masteryMean).toBe(0.55);
    expect(second.band).toBe('mid'); // 0.4 – 0.8
    expect(second.recentDelta).toBe(0.15); // 0.55 - 0.40
    expect(second.conceptName).toBe('Pressure exerted by liquids');
  });

  it('merges misconceptions from detected + perception, attaches labels, and tracks resolution', () => {
    const codes = report.misconceptions.items.map((i) => i.code);
    expect(codes).toContain('confuses_mass_with_weight');
    expect(codes).toContain('sign_error_negative_product');
    expect(codes).toContain('divides_instead_of_multiplies');

    const massWeight = report.misconceptions.items.find(
      (i) => i.code === 'confuses_mass_with_weight',
    )!;
    // Appears in BOTH student_misconceptions and the perception ledger.
    expect(massWeight.source).toBe('both');
    expect(massWeight.occurrences).toBe(2);
    expect(massWeight.resolved).toBe(false);
    expect(massWeight.label).toBe('Confuses mass with weight');
    expect(massWeight.labelHi).toBe('द्रव्यमान और भार में भ्रम');
    expect(massWeight.concept).toBe('force_pressure');

    const signError = report.misconceptions.items.find(
      (i) => i.code === 'sign_error_negative_product',
    )!;
    expect(signError.source).toBe('detected');
    expect(signError.resolved).toBe(true);

    const perceptionOnly = report.misconceptions.items.find(
      (i) => i.code === 'divides_instead_of_multiplies',
    )!;
    expect(perceptionOnly.source).toBe('perception');
    expect(perceptionOnly.resolved).toBe(false); // observation-only is never "resolved"
    expect(perceptionOnly.label).toBeNull(); // no dictionary entry

    expect(report.misconceptions.total).toBe(3);
    expect(report.misconceptions.open).toBe(2); // all but the resolved detected one
  });

  it('surfaces persisted lesson progress from the most-recent session with lesson state', () => {
    expect(report.lessonProgress).not.toBeNull();
    expect(report.lessonProgress!.active).toBe(true);
    expect(report.lessonProgress!.lessonStep).toBe('guided_examples');
    expect(report.lessonProgress!.objectiveConceptId).toBe(CONCEPT_A);
    expect(report.lessonProgress!.objectiveConceptName).toBe('Pressure exerted by liquids');
    expect(report.lessonProgress!.sessionId).toBe(SESSION_1);
  });

  it('aggregates struggle signals from both ledger sources, excluding "none"', () => {
    expect(report.struggleSignals.available).toBe(true);
    const bySignal = Object.fromEntries(
      report.struggleSignals.signals.map((s) => [s.signal, s.count]),
    );
    // repeated_wrong appears once in struggles + once in a turn = 2; explicit_confusion once.
    expect(bySignal.repeated_wrong).toBe(2);
    expect(bySignal.explicit_confusion).toBe(1);
    // 'none' from the clean turn is never counted.
    expect(bySignal.none).toBeUndefined();
    // Sorted by count desc.
    expect(report.struggleSignals.signals[0].signal).toBe('repeated_wrong');
  });

  it('emits no PII-shaped keys (P13)', () => {
    const flat = JSON.stringify(report);
    expect(flat).not.toMatch(/"email"\s*:/);
    expect(flat).not.toMatch(/"phone"\s*:/);
    expect(flat).not.toMatch(/"question_text"\s*:/);
    expect(flat).not.toMatch(/"student_answer"\s*:/);
  });
});

// ─── Dark-ledger degradation ──────────────────────────────────────────────────

describe('composeFoxyLearningReport — dark ledger (not ramped)', () => {
  // Live evidential path populated, but the event ledger supplies NO rows.
  const base = populatedInput();
  const report = composeFoxyLearningReport({
    ...base,
    ledgerTurns: [],
    ledgerStruggles: [],
  });

  it('reports the ledger unavailable and struggle signals empty (no error)', () => {
    expect(report.ledgerAvailable).toBe(false);
    expect(report.struggleSignals.available).toBe(false);
    expect(report.struggleSignals.signals).toEqual([]);
  });

  it('still computes engagement + evidential + mastery from the live path', () => {
    expect(report.engagement.sessionCount).toBe(2);
    expect(report.evidentialPractice.answered).toBe(2);
    expect(report.masteryMovement.conceptsPracticed).toBe(2);
  });

  it('keeps misconceptions from the detected source only (additive perception absent)', () => {
    const codes = report.misconceptions.items.map((i) => i.code);
    expect(codes).toContain('confuses_mass_with_weight');
    expect(codes).toContain('sign_error_negative_product');
    // The perception-only code disappears when the ledger is dark.
    expect(codes).not.toContain('divides_instead_of_multiplies');
    // The mass/weight code is now detected-only (no perception contribution).
    const massWeight = report.misconceptions.items.find(
      (i) => i.code === 'confuses_mass_with_weight',
    )!;
    expect(massWeight.source).toBe('detected');
    expect(massWeight.occurrences).toBe(1);
  });

  it('still surfaces persisted lesson progress (not a ledger signal)', () => {
    expect(report.lessonProgress).not.toBeNull();
    expect(report.lessonProgress!.lessonStep).toBe('guided_examples');
  });
});

// ─── Fully empty (cold start / no data anywhere) ──────────────────────────────

describe('composeFoxyLearningReport — fully empty', () => {
  const report = composeFoxyLearningReport(emptyInput());

  it('returns zeroed/empty sections and never throws', () => {
    expect(report.ledgerAvailable).toBe(false);
    expect(report.engagement).toEqual({
      sessionCount: 0,
      turnCount: 0,
      lastActiveAt: null,
      subjects: [],
      chapters: [],
      modes: [],
    });
    expect(report.evidentialPractice).toEqual({
      served: 0,
      answered: 0,
      correct: 0,
      accuracyPct: null,
    });
    expect(report.masteryMovement).toEqual({ conceptsPracticed: 0, concepts: [] });
    expect(report.misconceptions).toEqual({ total: 0, open: 0, items: [] });
    expect(report.lessonProgress).toBeNull();
    expect(report.struggleSignals).toEqual({ available: false, signals: [] });
  });

  it('passes a null grade through untouched', () => {
    const r = composeFoxyLearningReport(emptyInput({ grade: null }));
    expect(r.grade).toBeNull();
  });

  it('is deterministic — identical inputs produce identical output', () => {
    const a = composeFoxyLearningReport(populatedInput());
    const b = composeFoxyLearningReport(populatedInput());
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

// ─── Numeric coercion (PostgREST numeric-as-string tolerance) ─────────────────

describe('composeFoxyLearningReport — numeric coercion', () => {
  it('coerces string-typed numeric columns from PostgREST', () => {
    const input = emptyInput({
      servedItems: [
        {
          id: 's-a',
          session_id: SESSION_1,
          concept_id: CONCEPT_A,
          question_id: null,
          served_at: '2026-07-15T11:05:00.000Z',
          answered_at: '2026-07-15T11:06:00.000Z',
          attempt_id: ATTEMPT_A,
        },
      ],
      attempts: [
        {
          attempt_id: ATTEMPT_A,
          concept_id: CONCEPT_A,
          correct: true,
          answered_at: '2026-07-15T11:06:00.000Z',
          prior_mastery_mean: '0.400000',
          posterior_mastery_mean: '0.550000',
        },
      ],
      masteryRows: [
        {
          concept_id: CONCEPT_A,
          mastery_mean: '0.550000',
          mastery_probability: '0.5',
          mastery_level: 'developing',
          updated_at: '2026-07-15T11:06:30.000Z',
        },
      ],
    });
    const report = composeFoxyLearningReport(input);
    const concept = report.masteryMovement.concepts[0];
    expect(concept.masteryMean).toBe(0.55);
    expect(concept.band).toBe('mid');
    expect(concept.recentDelta).toBe(0.15);
  });

  it('falls back to mastery_probability when the BKT mastery_mean is null', () => {
    const input = emptyInput({
      servedItems: [
        {
          id: 's-a',
          session_id: SESSION_1,
          concept_id: CONCEPT_A,
          question_id: null,
          served_at: '2026-07-15T11:05:00.000Z',
          answered_at: null,
          attempt_id: null,
        },
      ],
      masteryRows: [
        {
          concept_id: CONCEPT_A,
          mastery_mean: null, // BKT column not yet written
          mastery_probability: 0.82, // legacy value present
          mastery_level: 'strong',
          updated_at: '2026-07-15T11:06:30.000Z',
        },
      ],
    });
    const report = composeFoxyLearningReport(input);
    const concept = report.masteryMovement.concepts[0];
    expect(concept.masteryMean).toBe(0.82);
    expect(concept.band).toBe('high'); // >= 0.8
  });
});
