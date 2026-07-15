// eval/teacher-skills/harness/deterministic-checks.ts
//
// Teacher-skills eval harness — DETERMINISTIC pre-checks (REG-54 oracle
// pattern). Where a rubric criterion is mechanically checkable, it is decided
// HERE — synchronously, before and instead of the LLM judge. A criterion with
// a registered deterministic check is NEVER sent to the judge: the mechanical
// verdict is authoritative in both directions (the same posture as
// `runDeterministicChecks` in packages/lib/src/ai/validation/quiz-oracle.ts,
// whose P6/P5 semantics the QZ-* checks below deliberately MIRROR — including
// the canonical STRING difficulty enum easy|medium|hard, A3).
//
// Pure module: no I/O, no DB, no LLM, no network. Offline dev/CI tooling only.
// All checks are defensive against malformed artifacts — a shape the check
// cannot read is a FAIL with an explanation, never a throw (fail-closed).

import { GRADES } from './rubric-schema';

// ─── Result / registry types ─────────────────────────────────────────────────

export interface DeterministicResult {
  pass: boolean;
  explanation: string;
}

/** A deterministic check over one artifact (the parsed fixture JSON). */
export type DeterministicCheck = (artifact: unknown) => DeterministicResult;

/** rubricName → criterionId → check. */
export type DeterministicRegistry = Readonly<
  Record<string, Readonly<Record<string, DeterministicCheck>>>
>;

// ─── Shared helpers ──────────────────────────────────────────────────────────

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function fail(explanation: string): DeterministicResult {
  return { pass: false, explanation };
}
function pass(explanation: string): DeterministicResult {
  return { pass: true, explanation };
}

/** P5: grade must be a STRING "6".."12". */
function isValidGradeString(g: unknown): boolean {
  return typeof g === 'string' && (GRADES as readonly string[]).includes(g);
}

// Mirrors quiz-oracle.ts PLACEHOLDER_RE.
const PLACEHOLDER_RE = /\{\{|\[BLANK\]/i;

// Canonical enums — mirror quiz-oracle.ts (A3 string difficulty; Bloom's six).
const VALID_DIFFICULTIES = new Set(['easy', 'medium', 'hard']);
const VALID_BLOOM_LEVELS = new Set([
  'remember',
  'understand',
  'apply',
  'analyze',
  'evaluate',
  'create',
]);

// PII text patterns (P13, FX-O2): email + Indian mobile (10 digits starting
// 6-9, optionally +91/0-prefixed). Key-shaped PII is caught separately by the
// structural scanForPiiKeys gate in run-eval.
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
const IN_PHONE_RE = /(?:\+91[\s-]?|0)?[6-9]\d{9}(?!\d)/;

// ─── Quiz-generation batch checks (P6/P5 — mirror quiz-oracle semantics) ─────

interface QuizQuestionShape {
  question_text?: unknown;
  options?: unknown;
  correct_answer_index?: unknown;
  explanation?: unknown;
  difficulty?: unknown;
  bloom_level?: unknown;
  grade?: unknown;
}

function getQuestions(artifact: unknown): QuizQuestionShape[] | null {
  if (!isPlainObject(artifact) || !Array.isArray(artifact.questions)) return null;
  return artifact.questions as QuizQuestionShape[];
}

/** Run `checkOne` over every question; fail on the first offender. */
function perQuestion(
  artifact: unknown,
  checkOne: (q: QuizQuestionShape, i: number) => string | null,
  passMsg: string,
): DeterministicResult {
  const questions = getQuestions(artifact);
  if (questions === null) return fail('artifact has no questions[] array (malformed batch)');
  if (questions.length === 0) return fail('questions[] is empty');
  for (let i = 0; i < questions.length; i++) {
    const q = questions[i];
    if (!isPlainObject(q)) return fail(`questions[${i}] is not an object`);
    const err = checkOne(q, i);
    if (err !== null) return fail(`questions[${i}]: ${err}`);
  }
  return pass(passMsg);
}

export const quizChecks: Readonly<Record<string, DeterministicCheck>> = {
  // P6: non-empty text, no template residue.
  'QZ-P6a': (artifact) =>
    perQuestion(
      artifact,
      (q) => {
        const text = typeof q.question_text === 'string' ? q.question_text.trim() : '';
        if (!text) return 'question_text is empty or not a string';
        if (PLACEHOLDER_RE.test(text)) return 'question_text contains {{ or [BLANK] placeholder';
        return null;
      },
      'every question_text non-empty and template-free',
    ),

  // P6: exactly 4 options.
  'QZ-P6b': (artifact) =>
    perQuestion(
      artifact,
      (q) => {
        if (!Array.isArray(q.options)) return 'options is not an array';
        if (q.options.length !== 4) return `expected exactly 4 options, got ${q.options.length}`;
        return null;
      },
      'every question has exactly 4 options',
    ),

  // P6: options non-empty strings, distinct case-insensitively (oracle parity).
  'QZ-P6c': (artifact) =>
    perQuestion(
      artifact,
      (q) => {
        if (!Array.isArray(q.options)) return 'options is not an array';
        const clean: string[] = [];
        for (let i = 0; i < q.options.length; i++) {
          const raw = q.options[i];
          if (typeof raw !== 'string' || !raw.trim()) {
            return `option at index ${i} is empty or not a string`;
          }
          clean.push(raw.trim().toLowerCase());
        }
        if (new Set(clean).size !== clean.length) {
          return 'options are not all distinct (case-insensitive)';
        }
        return null;
      },
      'every question has distinct non-empty options',
    ),

  // P6: correct_answer_index integer 0..3.
  'QZ-P6d': (artifact) =>
    perQuestion(
      artifact,
      (q) => {
        const idx = q.correct_answer_index;
        if (typeof idx !== 'number' || !Number.isInteger(idx) || idx < 0 || idx > 3) {
          return `correct_answer_index must be integer 0..3, got ${String(idx)}`;
        }
        return null;
      },
      'every correct_answer_index is an integer 0..3',
    ),

  // P6: non-empty explanation.
  'QZ-P6e': (artifact) =>
    perQuestion(
      artifact,
      (q) => {
        const exp = typeof q.explanation === 'string' ? q.explanation.trim() : '';
        if (!exp) return 'explanation is empty or not a string';
        return null;
      },
      'every explanation is non-empty',
    ),

  // P6: difficulty (when present) in easy|medium|hard; bloom_level (when
  // present) in the canonical six. Presence-optional — oracle parity.
  'QZ-P6f': (artifact) =>
    perQuestion(
      artifact,
      (q) => {
        if (q.difficulty !== undefined && q.difficulty !== null) {
          const d = q.difficulty;
          if (typeof d !== 'string' || !VALID_DIFFICULTIES.has(d.toLowerCase())) {
            return `difficulty must be one of easy|medium|hard, got ${String(d)}`;
          }
        }
        if (q.bloom_level !== undefined && q.bloom_level !== null) {
          const b = q.bloom_level;
          if (typeof b !== 'string' || !VALID_BLOOM_LEVELS.has(b.toLowerCase())) {
            return `bloom_level must be one of remember|understand|apply|analyze|evaluate|create, got ${String(b)}`;
          }
        }
        return null;
      },
      'every difficulty/bloom_level (when present) is canonical',
    ),

  // P5: batch grade is a string "6".."12"; any per-question grade echo too.
  'QZ-P5': (artifact) => {
    if (!isPlainObject(artifact)) return fail('artifact is not an object');
    if (!isValidGradeString(artifact.grade)) {
      return fail(
        `batch grade must be a P5 string "6".."12", got ${JSON.stringify(artifact.grade)}`,
      );
    }
    const questions = getQuestions(artifact);
    if (questions === null) return fail('artifact has no questions[] array (malformed batch)');
    for (let i = 0; i < questions.length; i++) {
      const g = questions[i]?.grade;
      if (g !== undefined && g !== null && !isValidGradeString(g)) {
        return fail(`questions[${i}].grade must be a P5 string "6".."12", got ${JSON.stringify(g)}`);
      }
    }
    return pass('grade fields are P5 strings');
  },
};

// ─── Foxy-explanation checks ─────────────────────────────────────────────────

export const foxyChecks: Readonly<Record<string, DeterministicCheck>> = {
  // P13: no email/phone text patterns anywhere in the artifact. (PII-shaped
  // KEYS are already a hard artifact-level gate in run-eval — an artifact with
  // a forbidden key never even reaches criterion evaluation.) Regexes cannot
  // catch bare names; this residual limitation is documented in the rubric
  // Notes and README.
  'FX-O2': (artifact) => {
    let serialized: string;
    try {
      serialized = JSON.stringify(artifact) ?? '';
    } catch {
      return fail('artifact is not JSON-serializable');
    }
    if (EMAIL_RE.test(serialized)) return fail('email-address pattern found in artifact text');
    if (IN_PHONE_RE.test(serialized)) return fail('phone-number pattern found in artifact text');
    return pass('no email/phone pattern in artifact text (structural key scan passed upstream)');
  },
};

// ─── Lesson-planning checks (Alfanumrik additions A1 / A2a) ──────────────────

/** True if any (nested) key ends in `_hi` with a non-empty string value. */
function hasNonEmptyHiField(node: unknown): boolean {
  if (Array.isArray(node)) return node.some(hasNonEmptyHiField);
  if (!isPlainObject(node)) return false;
  for (const [k, v] of Object.entries(node)) {
    if (k.endsWith('_hi') && typeof v === 'string' && v.trim().length > 0) return true;
    if (hasNonEmptyHiField(v)) return true;
  }
  return false;
}

/** Find a grade value: top-level `grade`, `meta.grade`, or `shared.grade`. */
function findGrade(artifact: unknown): unknown {
  if (!isPlainObject(artifact)) return undefined;
  if (artifact.grade !== undefined) return artifact.grade;
  if (isPlainObject(artifact.meta) && artifact.meta.grade !== undefined) return artifact.meta.grade;
  if (isPlainObject(artifact.shared) && artifact.shared.grade !== undefined) {
    return artifact.shared.grade;
  }
  return undefined;
}

export const lessonPlanningChecks: Readonly<Record<string, DeterministicCheck>> = {
  // A1 (P7): at least one non-empty `*_hi` field anywhere in the artifact.
  A1: (artifact) =>
    hasNonEmptyHiField(artifact)
      ? pass('artifact carries a non-empty *_hi Hindi-parallel field')
      : fail('no non-empty *_hi field anywhere in the artifact (bilingual structure absent, P7)'),

  // A2a (P5): grade is a string "6".."12".
  A2a: (artifact) => {
    const g = findGrade(artifact);
    return isValidGradeString(g)
      ? pass(`grade is the P5 string ${JSON.stringify(g)}`)
      : fail(`grade must be a P5 string "6".."12", got ${JSON.stringify(g)}`);
  },
};

// ─── Registry ────────────────────────────────────────────────────────────────

/**
 * rubricName → criterionId → check. Subject-layer lesson rubrics reuse the
 * shared lesson checks (A1/A2a live only in the shared rubric, but keying them
 * here is harmless — run-eval only consults ids present in the loaded rubric).
 */
export const DETERMINISTIC_REGISTRY: DeterministicRegistry = {
  'quiz-generation': quizChecks,
  'foxy-explanation': foxyChecks,
  'ncert-lesson-planning': lessonPlanningChecks,
};
