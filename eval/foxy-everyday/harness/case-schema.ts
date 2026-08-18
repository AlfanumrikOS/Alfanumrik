// eval/foxy-everyday/harness/case-schema.ts
//
// Everyday-example rubric — the CASE-SET fixture types + a PURE runtime
// validator. No I/O, no DB, no LLM, no network. Offline tooling; never imported
// by production code (see rubric.ts's header for the two guards + the one gap).
//
// Deliberately modelled on eval/rag/harness/golden-schema.ts so the two fixtures
// share one discipline:
//   - P5: every `grade` is a STRING "6".."12" (an integer 8 is REJECTED).
//   - snake_case canonical subject codes only.
//   - a RECURSIVE PII-shaped-key ban over the whole document, at any depth,
//     including inside arrays (P13). Same forbidden-key list as the golden set.
//   - duplicate case ids are a HARD REJECT (a repeated id would be double
//     counted in the aggregate).
//
// ── Scope: the 18 CEO-locked cells ───────────────────────────────────────────
// grades 6-10 x {math, science} = 10, plus grades 11-12 x {math, physics,
// chemistry, biology} = 8. Total 18. This is the same scope as
// docs/audits/2026-08-13-rag-math-science-coverage.md §2, which measured all 18.
// The validator REJECTS any (grade, subject) pair outside that set — this rubric
// makes no claim about english/hindi/social_studies/commerce/humanities cells.

// ─── Canonical enums ─────────────────────────────────────────────────────────

/** P5 grade strings. */
export const GRADES = ['6', '7', '8', '9', '10', '11', '12'] as const;
export type Grade = (typeof GRADES)[number];

/** The subject codes used by the 18 in-scope cells (a subset of the platform set). */
export const SUBJECTS = ['math', 'science', 'physics', 'chemistry', 'biology'] as const;
export type Subject = (typeof SUBJECTS)[number];

/**
 * The 18 CEO-locked cells, written out rather than computed, so the list is
 * greppable and a reviewer can count it.
 */
export const CELLS: ReadonlyArray<{ grade: Grade; subject: Subject }> = [
  { grade: '6', subject: 'math' },
  { grade: '6', subject: 'science' },
  { grade: '7', subject: 'math' },
  { grade: '7', subject: 'science' },
  { grade: '8', subject: 'math' },
  { grade: '8', subject: 'science' },
  { grade: '9', subject: 'math' },
  { grade: '9', subject: 'science' },
  { grade: '10', subject: 'math' },
  { grade: '10', subject: 'science' },
  { grade: '11', subject: 'math' },
  { grade: '11', subject: 'physics' },
  { grade: '11', subject: 'chemistry' },
  { grade: '11', subject: 'biology' },
  { grade: '12', subject: 'math' },
  { grade: '12', subject: 'physics' },
  { grade: '12', subject: 'chemistry' },
  { grade: '12', subject: 'biology' },
];

/** Stable "g<grade>/<subject>" cell key used across the report + aggregates. */
export function cellKey(grade: string, subject: string): string {
  return `g${grade}/${subject}`;
}

/** The canonical 18 cell keys, in CELLS order. */
export const CELL_KEYS: readonly string[] = CELLS.map((c) => cellKey(c.grade, c.subject));

/**
 * Turn types. These are the three EXPLANATION-STYLE Foxy modes the directive
 * names ("For an explanation-style turn (learn, explain, or doubt)"). Modes the
 * directive deliberately does NOT cover (practice, revise, homework, explorer)
 * are out of scope for v1 and must not be added without re-reading the shipped
 * directive text — a case in an uncovered mode would fail D0 by design, not by
 * defect.
 */
export const TURN_TYPES = ['learn', 'explain', 'doubt'] as const;
export type TurnType = (typeof TURN_TYPES)[number];

/**
 * Corpus state of the chapter a case targets.
 *
 *   zero_corpus — the chapter has ZERO active chunks in rag_content_chunks,
 *                 per docs/audits/2026-08-13-rag-math-science-coverage.md §3
 *                 (26 such chapters, measured 2026-08-13 against prod). These
 *                 cases are the point: the directive changes GENERATION, so it
 *                 must work where retrieval returns nothing. A case marked
 *                 zero_corpus MUST carry a `chapter_number` and
 *                 `corpus_evidence`.
 *   unverified  — chunk presence was NOT verified for this case's target. This
 *                 is the honest default: the author of this fixture had no DB
 *                 access and will not assert a corpus state it did not measure.
 *
 * There is deliberately NO "has_corpus" value. Claiming it would require a live
 * query this fixture never made.
 */
export const CORPUS_STATES = ['zero_corpus', 'unverified'] as const;
export type CorpusState = (typeof CORPUS_STATES)[number];

/** v1 is English-only. See README §"Known gaps" — a Hindi/Hinglish arm is v2. */
export const LANGUAGES = ['en'] as const;
export type Language = (typeof LANGUAGES)[number];

/**
 * PII-shaped keys that must NEVER appear anywhere in the committed case set or
 * in a capture file, at ANY nesting depth (P13). Byte-identical to
 * eval/rag/harness/golden-schema.ts's PII_FORBIDDEN_KEYS — mirroring the exact
 * list, rather than inventing a longer one, keeps one definition of "PII-shaped"
 * across both fixtures.
 */
export const PII_FORBIDDEN_KEYS = [
  'student_id',
  'user_id',
  'session_id',
  'email',
  'phone',
] as const;

// ─── Fixture types ───────────────────────────────────────────────────────────

/** One case: a single student turn to send to Foxy, in one cell. */
export interface EverydayCase {
  /** Stable id, e.g. "g8-science-friction-doubt-001". Unique across the set. */
  id: string;
  /** P5 grade string. */
  grade: Grade;
  /** Canonical subject code, in-scope for the grade band. */
  subject: Subject;
  /** learn | explain | doubt. */
  turn_type: TurnType;
  /** The curriculum topic the turn is about (human-readable, for review). */
  topic: string;
  /** NCERT chapter number when the case targets a specific chapter; else null. */
  chapter_number: number | null;
  /** The student turn text sent to Foxy. NO PII, ever. */
  prompt: string;
  /** Language of the prompt. v1: 'en' only. */
  language: Language;
  /** See CORPUS_STATES. */
  corpus_state: CorpusState;
  /** Required when corpus_state === 'zero_corpus': where the claim comes from. */
  corpus_evidence?: string;
}

/** The full versioned case-set document. */
export interface EverydayCaseSet {
  version: string;
  created_at: string;
  /** Must equal RUBRIC_VERSION at run time (verdict guards the mismatch). */
  rubric_version: string;
  /** The flag under measurement — recorded so a reader knows what this scores. */
  flag: string;
  notes: string;
  cases: EverydayCase[];
}

export type CaseValidation =
  | { ok: true; value: EverydayCaseSet }
  | { ok: false; errors: string[] };

// ─── Pure helpers ────────────────────────────────────────────────────────────

const PII_KEY_SET: ReadonlySet<string> = new Set<string>(PII_FORBIDDEN_KEYS);
const CELL_KEY_SET: ReadonlySet<string> = new Set<string>(CELL_KEYS);

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Recursively scan for forbidden PII-shaped keys (P13). Walks objects AND array
 * elements so a forbidden key cannot hide inside an array. Exported because the
 * capture-file validator reuses it verbatim — a captured RESPONSE is exactly
 * where a stray identifier would show up.
 */
export function scanForPiiKeys(node: unknown, path: string, errors: string[]): void {
  if (Array.isArray(node)) {
    node.forEach((el, i) => scanForPiiKeys(el, `${path}[${i}]`, errors));
    return;
  }
  if (isPlainObject(node)) {
    for (const key of Object.keys(node)) {
      const childPath = path ? `${path}.${key}` : key;
      if (PII_KEY_SET.has(key)) {
        errors.push(`PII-shaped key "${key}" found at ${childPath}`);
      }
      scanForPiiKeys(node[key], childPath, errors);
    }
  }
}

function validateCase(c: unknown, idx: number, errors: string[]): void {
  const path = `cases[${idx}]`;
  if (!isPlainObject(c)) {
    errors.push(`${path} must be an object`);
    return;
  }

  if (typeof c.id !== 'string' || c.id.length === 0) {
    errors.push(`${path}.id must be a non-empty string`);
  }

  // P5: an integer grade fails the typeof check before the membership check.
  if (typeof c.grade !== 'string' || !(GRADES as readonly string[]).includes(c.grade)) {
    errors.push(
      `${path}.grade must be a P5 STRING in {${GRADES.join(', ')}} (got ${JSON.stringify(c.grade)})`,
    );
  }
  if (!(SUBJECTS as readonly string[]).includes(c.subject as string)) {
    errors.push(
      `${path}.subject must be one of {${SUBJECTS.join(', ')}} (got ${JSON.stringify(c.subject)})`,
    );
  }
  // The (grade, subject) pair must be one of the 18 CEO-locked cells.
  if (typeof c.grade === 'string' && typeof c.subject === 'string') {
    const key = cellKey(c.grade, c.subject);
    if (!CELL_KEY_SET.has(key)) {
      errors.push(`${path} cell ${key} is outside the 18 in-scope cells`);
    }
  }

  if (!(TURN_TYPES as readonly string[]).includes(c.turn_type as string)) {
    errors.push(
      `${path}.turn_type must be one of {${TURN_TYPES.join(', ')}} (got ${JSON.stringify(c.turn_type)})`,
    );
  }
  if (typeof c.topic !== 'string' || c.topic.length === 0) {
    errors.push(`${path}.topic must be a non-empty string`);
  }
  if (c.chapter_number !== null && !Number.isInteger(c.chapter_number)) {
    errors.push(`${path}.chapter_number must be an integer or null`);
  }
  if (typeof c.prompt !== 'string' || c.prompt.trim().length === 0) {
    errors.push(`${path}.prompt must be a non-empty string`);
  }
  if (!(LANGUAGES as readonly string[]).includes(c.language as string)) {
    errors.push(`${path}.language must be one of {${LANGUAGES.join(', ')}}`);
  }
  if (!(CORPUS_STATES as readonly string[]).includes(c.corpus_state as string)) {
    errors.push(
      `${path}.corpus_state must be one of {${CORPUS_STATES.join(', ')}} (got ${JSON.stringify(c.corpus_state)})`,
    );
  }
  // A zero_corpus claim must be evidenced and chapter-bound, or it is folklore.
  if (c.corpus_state === 'zero_corpus') {
    if (!Number.isInteger(c.chapter_number)) {
      errors.push(`${path}.chapter_number is REQUIRED (integer) when corpus_state='zero_corpus'`);
    }
    if (typeof c.corpus_evidence !== 'string' || c.corpus_evidence.length === 0) {
      errors.push(
        `${path}.corpus_evidence is REQUIRED when corpus_state='zero_corpus' — cite the ` +
          'measurement that established the chapter has zero active chunks',
      );
    }
  }
}

// ─── Public validator ────────────────────────────────────────────────────────

/**
 * Pure runtime validator for a case-set document. Returns a discriminated union;
 * never throws.
 *
 * Coverage is checked but NOT auto-failed here beyond the structural rules: the
 * COVERAGE gate (all 18 cells present, CASES_PER_CELL each) lives in the runner,
 * because a deliberately truncated `--limit` run is a legal smoke run — it just
 * can never be a PASS (see verdict.ts `truncated`).
 */
export function validateCaseSet(doc: unknown): CaseValidation {
  const errors: string[] = [];

  if (!isPlainObject(doc)) {
    return { ok: false, errors: ['document root must be an object'] };
  }

  // Recursive PII-key scan over the WHOLE document first (P13).
  scanForPiiKeys(doc, '', errors);

  if (typeof doc.version !== 'string' || doc.version.length === 0) {
    errors.push('version must be a non-empty string');
  }
  if (typeof doc.created_at !== 'string') {
    errors.push('created_at must be a string date');
  }
  if (typeof doc.rubric_version !== 'string' || doc.rubric_version.length === 0) {
    errors.push('rubric_version must be a non-empty string');
  }
  if (typeof doc.flag !== 'string' || doc.flag.length === 0) {
    errors.push('flag must be a non-empty string');
  }

  if (!Array.isArray(doc.cases)) {
    errors.push('cases must be an array');
  } else {
    if (doc.cases.length === 0) errors.push('cases must be a non-empty array');
    doc.cases.forEach((c, i) => validateCase(c, i, errors));

    const seen = new Set<string>();
    doc.cases.forEach((c, i) => {
      if (isPlainObject(c) && typeof c.id === 'string') {
        if (seen.has(c.id)) {
          errors.push(`cases[${i}].id "${c.id}" is a duplicate — case ids must be unique`);
        } else {
          seen.add(c.id);
        }
      }
    });
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, value: doc as unknown as EverydayCaseSet };
}

/** Per-cell case counts, for the runner's coverage gate. */
export function coverageByCell(cases: readonly EverydayCase[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const key of CELL_KEYS) counts.set(key, 0);
  for (const c of cases) {
    const key = cellKey(c.grade, c.subject);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}
