import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Foxy weak-area loop — INTEGRITY PINS (always-on, no DB required).
 *
 * These are the load-bearing invariants for the mastery-injection boundary.
 * They grep SOURCE (route handlers + SQL migrations) so a future edit cannot
 * silently make a self-report evidential, route a chat answer around the
 * served-item gate, or re-break the quiz_responses column fix.
 *
 *   B1.3  — /api/foxy/learning-action writes NO mastery surface (self-report
 *           is non-evidential).
 *   B2    — learner.struggle_observed + learner.learning_action have NO
 *           mastery-writing subscriber registered.
 *   PART C — migrations 20260623000200 / 000300: error_type column + CHECK,
 *           submit_quiz_results_v2 SERVER-classifies + stores + passes the
 *           COMPUTED value (never raw r->>'error_type').
 *   COLUMN — submit_quiz_results_v2 INSERTs into the REAL quiz_responses
 *           columns (student_answer_index / time_taken_seconds), not the
 *           phantom selected_option / time_spent_seconds.
 *
 * Style mirrors the repo's grep-the-source conformance suites
 * (canonical-mastery-write-structure.test.ts).
 */

// ── file helpers ──────────────────────────────────────────────────────────────
function resolve(rel: string): string | null {
  for (const c of [path.resolve(process.cwd(), rel), path.resolve(process.cwd(), '..', rel)]) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}
function read(rel: string): string {
  const p = resolve(rel);
  return p ? fs.readFileSync(p, 'utf-8') : '';
}
/** Strip line comments + collapse whitespace so matching is layout-tolerant and
 *  never trips on the prose in header/comment blocks. For SQL we also strip the
 *  block comment narrative is handled per-assertion. */
function stripSqlComments(src: string): string {
  return src
    .replace(/^\s*--.*$/gm, '')   // line comments
    .replace(/\s+/g, ' ');
}
/**
 * Like stripSqlComments, but ALSO drops the non-executable string-literal prose
 * — the COMMENT ON ...; body and the admin_audit_log INSERT narrative — so
 * NEGATIVE assertions (.not.toMatch) don't trip on doc strings that legitimately
 * quote the very thing we're asserting is NOT used as executable SQL.
 */
function executableSql(src: string): string {
  return src
    .replace(/--.*$/gm, '')       // ALL line comments, incl. trailing inline ones
    .replace(/COMMENT ON[\s\S]*?;/gi, ' ')
    .replace(/INSERT INTO public\.admin_audit_log[\s\S]*?\);/gi, ' ')
    .replace(/\s+/g, ' ');
}

const LEARNING_ACTION = 'src/app/api/foxy/learning-action/route.ts';
const QUIZ_ANSWER = 'src/app/api/foxy/quiz-answer/route.ts';
const COLUMN_MIG = 'supabase/migrations/20260623000200_quiz_responses_error_type_column.sql';
const RPC_MIG = 'supabase/migrations/20260623000300_submit_quiz_v2_server_classify_error_type.sql';

const FORBIDDEN_MASTERY_TABLES = [
  'concept_mastery',
  'cme_concept_state',
  'student_skill_state',
  'knowledge_gaps',
  'learner_mastery',
  'cme_error_log',
  'student_learning_profiles',
  'bloom_progression',
] as const;

// ── B1.3 — self-report is non-evidential (no mastery write in the source) ─────
describe('B1.3 — /api/foxy/learning-action writes NO mastery surface (zero-self-report-write pin)', () => {
  const src = read(LEARNING_ACTION);

  it('source file exists and is non-trivial', () => {
    expect(src.length).toBeGreaterThan(500);
  });

  // The route must never call .from('<mastery table>').insert/update/upsert.
  // We match a write op anchored to each forbidden table name. The header
  // comment lists these tables as a CONTRACT (prose), so we strip line comments
  // first and then require that no actual `.from('<table>')...write` exists.
  for (const table of FORBIDDEN_MASTERY_TABLES) {
    it(`never writes to ${table}`, () => {
      // Match `.from('table')` followed (anywhere on the collapsed line) by a
      // mutating op. Because the file uses supabaseAdmin.from(...) chains, a
      // write would read like `.from('concept_mastery').insert(`.
      const code = src
        .replace(/\/\*[\s\S]*?\*\//g, '') // block comments
        .replace(/\/\/.*$/gm, '');        // line comments
      const writeRe = new RegExp(
        `from\\(\\s*['"\`]${table}['"\`]\\s*\\)[\\s\\S]{0,120}?\\.(insert|update|upsert|delete)\\b`,
      );
      expect(code).not.toMatch(writeRe);
    });
  }

  it('never calls the quiz-XP authority RPCs (atomic_quiz_profile_update / submit_quiz_results)', () => {
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(code).not.toMatch(/atomic_quiz_profile_update/);
    expect(code).not.toMatch(/submit_quiz_results/);
  });

  it('never calls tutor_commit_attempt (the sanctioned mastery move lives ONLY in quiz-answer)', () => {
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(code).not.toMatch(/tutor_commit_attempt/);
  });

  it('contains no XP literal in the handler body (no XP awarded)', () => {
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    // No bare numeric XP arithmetic patterns (* 10 / + 20 / + 50) in the body.
    expect(code).not.toMatch(/\*\s*10\b/);
    expect(code).not.toMatch(/\+\s*20\b/);
    expect(code).not.toMatch(/\+\s*50\b/);
  });
});

// ── B1 — the sanctioned mastery move is gated by served-item + tutor_commit ───
describe('B1 — quiz-answer is the ONLY chat path that moves mastery, via served-item + tutor_commit_attempt', () => {
  const src = read(QUIZ_ANSWER);
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

  it('verifies a SERVER-ISSUED foxy_served_items row before grading', () => {
    expect(code).toMatch(/from\(\s*['"`]foxy_served_items['"`]\s*\)/);
    // scoped to the caller's student_id (anti cross-student grading).
    expect(code).toMatch(/\.eq\(\s*['"`]student_id['"`]/);
  });

  it('commits the mastery move ONLY through tutor_commit_attempt (the BKT pipeline)', () => {
    expect(code).toMatch(/rpc\(\s*['"`]tutor_commit_attempt['"`]/);
  });

  it('never calls atomic_quiz_profile_update (ZERO XP from a chat answer)', () => {
    expect(code).not.toMatch(/atomic_quiz_profile_update/);
  });

  it('returns xp_earned: 0 on the success envelope', () => {
    expect(code).toMatch(/xp_earned:\s*0/);
  });
});

// ── B2 — no mastery subscriber for the observation/self-report events ─────────
describe('B2 — learner.struggle_observed + learner.learning_action have NO mastery subscriber', () => {
  it('the production dispatcher registers ZERO subscribers for these two kinds', async () => {
    const { standardDispatcher } = await import('@alfanumrik/lib/state/subscribers/dispatcher');
    expect(standardDispatcher.subscribersFor('learner.struggle_observed')).toHaveLength(0);
    expect(standardDispatcher.subscribersFor('learner.learning_action')).toHaveLength(0);
  });

  it('the only registered mastery (concept) projector subscribes to concept_check_answered, not the observation events', async () => {
    const { STANDARD_SUBSCRIBERS } = await import('@alfanumrik/lib/state/subscribers/dispatcher');
    const masteryProjector = STANDARD_SUBSCRIBERS.find(
      (s) => s.name === 'concept-mastery-projector',
    );
    expect(masteryProjector).toBeTruthy();
    expect(masteryProjector!.kind).toBe('learner.concept_check_answered');
    // Sanity: NO standard subscriber listens to the two observation kinds.
    const observationKinds = new Set(['learner.struggle_observed', 'learner.learning_action']);
    expect(STANDARD_SUBSCRIBERS.filter((s) => observationKinds.has(s.kind))).toHaveLength(0);
  });
});

// ── PART C — error_type column + CHECK (migration 20260623000200) ─────────────
describe('PART C — quiz_responses.error_type column + CHECK (migration 20260623000200)', () => {
  const raw = read(COLUMN_MIG);
  const sql = stripSqlComments(raw);

  it('migration file exists', () => {
    expect(raw.length).toBeGreaterThan(200);
  });

  it('adds the error_type column idempotently (ADD COLUMN IF NOT EXISTS)', () => {
    expect(sql).toMatch(/ALTER TABLE public\.quiz_responses\s+ADD COLUMN IF NOT EXISTS error_type TEXT/i);
  });

  it('constrains error_type to the three canonical buckets OR NULL', () => {
    expect(sql).toMatch(/CHECK\s*\(\s*error_type IS NULL OR error_type IN\s*\(\s*'conceptual',\s*'procedural',\s*'careless'\s*\)\s*\)/i);
  });

  it('guards the constraint add against pg_constraint (idempotent re-run)', () => {
    expect(sql).toMatch(/FROM pg_constraint/i);
    expect(sql).toMatch(/quiz_responses_error_type_check/i);
  });
});

// ── PART C — submit_quiz_results_v2 server-classifies + stores + passes ───────
describe('PART C — submit_quiz_results_v2 server-classifies error_type (migration 20260623000300)', () => {
  const raw = read(RPC_MIG);
  const sql = stripSqlComments(raw);
  const exec = executableSql(raw); // prose-free for negative assertions

  it('migration file exists', () => {
    expect(raw.length).toBeGreaterThan(1000);
  });

  it('declares the server-side classification variables', () => {
    expect(sql).toMatch(/v_error_type\s+TEXT/i);
    expect(sql).toMatch(/v_prior_mastery\s+FLOAT/i);
  });

  it('reads PRIOR concept mastery (pre-BKT) to drive the classification', () => {
    expect(sql).toMatch(/SELECT cm\.mastery_probability\s+INTO v_prior_mastery/i);
  });

  it('classifies careless / conceptual / procedural server-side', () => {
    expect(sql).toMatch(/v_error_type\s*:=\s*'careless'/i);
    expect(sql).toMatch(/v_error_type\s*:=\s*'conceptual'/i);
    expect(sql).toMatch(/v_error_type\s*:=\s*'procedural'/i);
  });

  it('stores the COMPUTED value on the quiz_responses row (error_type column in the INSERT)', () => {
    // The INSERT column list must include error_type and the VALUES must bind v_error_type.
    expect(sql).toMatch(/INSERT INTO quiz_responses[\s\S]{0,400}?error_type/i);
    expect(sql).toMatch(/v_q_text,\s*v_q_type,\s*v_shuffle,\s*v_error_type/i);
  });

  it('feeds the COMPUTED value (v_error_type) into update_learner_state_post_quiz — NOT raw r->>error_type', () => {
    // The PERFORM passes v_error_type in the p_error_type slot.
    expect(sql).toMatch(/PERFORM update_learner_state_post_quiz\([\s\S]{0,200}?v_error_type/i);
    // And the always-NULL raw client value is NOT used as the consumer arg.
    expect(exec).not.toMatch(/PERFORM update_learner_state_post_quiz\([\s\S]{0,200}?\(r->>'error_type'\)/i);
  });

  it('IGNORES the client-supplied r->>error_type for the mastery-moving value (no trust)', () => {
    // r->>'error_type' must not appear anywhere as an EXECUTABLE read (the
    // COMMENT ON prose legitimately quotes it; executableSql() drops that).
    expect(exec).not.toMatch(/r->>'error_type'/i);
  });

  it('P1 score + P2 XP math are byte-identical (ROUND + the three XP literals intact)', () => {
    expect(sql).toMatch(/ROUND\(\(v_correct::NUMERIC \/ v_total\) \* 100\)/i);
    expect(sql).toMatch(/v_xp\s*:=\s*v_correct \* 10/i);
    expect(sql).toMatch(/v_xp\s*:=\s*v_xp \+ 20/i);
    expect(sql).toMatch(/v_xp\s*:=\s*v_xp \+ 50/i);
  });
});

// ── COLUMN-NAME CORRECTION — the architect-found pre-existing bug fix ─────────
describe('submit_quiz_results_v2 uses the REAL quiz_responses columns (architect bug fix pin)', () => {
  const raw = read(RPC_MIG);
  const sql = stripSqlComments(raw);

  it('the per-response INSERT writes student_answer_index + time_taken_seconds (real columns)', () => {
    // INSERT column list includes the canonical columns.
    expect(sql).toMatch(/INSERT INTO quiz_responses\s*\([\s\S]{0,300}?student_answer_index/i);
    expect(sql).toMatch(/INSERT INTO quiz_responses\s*\([\s\S]{0,300}?time_taken_seconds/i);
  });

  it('the INSERT does NOT write the phantom selected_option / time_spent_seconds columns', () => {
    // Strip the COMMENT ON / audit-log narrative so we only test executable SQL.
    // The phantom names legitimately appear in the header prose; here we assert
    // they are not used as quiz_responses INSERT columns.
    const insertBlock = sql.match(/INSERT INTO quiz_responses\s*\(([\s\S]{0,300}?)\)\s*VALUES/i);
    expect(insertBlock, 'expected a quiz_responses INSERT column list').toBeTruthy();
    const cols = insertBlock![1];
    expect(cols).not.toMatch(/\bselected_option\b/i);
    expect(cols).not.toMatch(/\btime_spent_seconds\b/i);
  });

  it('the idempotency-replay block reads qr.student_answer_index (not qr.selected_option)', () => {
    expect(sql).toMatch(/qr\.student_answer_index/i);
    expect(sql).not.toMatch(/qr\.selected_option/i);
  });

  it('the JSONB INPUT key r->>selected_option is UNCHANGED (client payload contract, not a column)', () => {
    // The payload key is still read (it is the client contract).
    expect(sql).toMatch(/\(r->>'selected_option'\)/i);
  });
});
