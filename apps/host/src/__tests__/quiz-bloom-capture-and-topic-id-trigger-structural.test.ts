import { describe, it, expect } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
// P2: never hardcode an XP number in a test either — read the canonical source.
import { XP_RULES } from '@alfanumrik/lib/xp-config';

/**
 * Phase 1A — STRUCTURAL pins (always-on, no database required).
 *
 * Grep-the-migration-source style, matching the sibling pins
 * (canonical-mastery-write-structure.test.ts,
 * resilient-mastery-perform-structure.test.ts,
 * sm2-interval-clamp-structure.test.ts, rls-inventory.test.ts).
 *
 * NOTE ON PLACEMENT: those three siblings each pin ONE named historical
 * migration file and assert nothing about later ones, so extending them would
 * have changed what they mean. These pins are deliberately different in kind —
 * two of the three resolve the NEWEST root migration that redefines
 * submit_quiz_results_v2 and assert against THAT, so a future re-emission of
 * the RPC that drops bloom_level or reverts the telemetry fails here rather
 * than silently regressing the way the 2026-06-21 topic_id backfill did.
 *
 * ─── WHAT IS BEING PINNED, AND THE BUG EACH ONE CATCHES ──────────────────
 *
 * 1. bloom_level in the quiz_responses INSERT column list.
 *    Bug: v_q_bloom was in scope (SELECTed from question_bank, passed to
 *    update_learner_state_post_quiz) but omitted from the INSERT, so the
 *    current writer stamped NULL on every response. Production split by
 *    cohort: Apr-2026 390/390 populated by an older writer, Aug-2026 0/45.
 *
 * 2. The learner-state write failure is observable.
 *    Bug: the handler was `RAISE NOTICE`, which Postgres does not log at the
 *    default log_min_messages='warning' AND supabase-js does not surface to
 *    the client — invisible twice over. Worse, the `v_q_topic_id IS NULL`
 *    case had no ELSE at all and vanished without trace. Both branches must
 *    now RAISE WARNING and write learner_state_write_failures.
 *
 * 3. question_bank.topic_id is self-maintaining.
 *    Bug: the 2026-06-21 repair was a one-shot DO $$ block with no trigger, so
 *    it decayed back to 32.1% NULL. A BEFORE INSERT OR UPDATE trigger is the
 *    only placement a new writer cannot bypass.
 *
 * Plus the invariant guards: P1 score formula, P2 XP literals, the 11-param
 * signature, P5 (grades stay TEXT), P8 (RLS + policies in the same migration),
 * and non-destructiveness.
 */

const MIGRATIONS_DIR = 'supabase/migrations';
const PHASE_1A = `${MIGRATIONS_DIR}/20260824090000_quiz_bloom_capture_learner_state_failure_log_and_topic_id_trigger.sql`;
/** The definition this migration copied its body from. */
const PRIOR_V2 = `${MIGRATIONS_DIR}/20260814000022_submit_quiz_v2_written_answer_scoring.sql`;

function resolveRepo(rel: string): string | null {
  for (const c of [resolve(process.cwd(), rel), resolve(process.cwd(), '..', rel), resolve(process.cwd(), '..', '..', rel)]) {
    if (existsSync(c)) return c;
  }
  return null;
}

function read(rel: string): string {
  const p = resolveRepo(rel);
  return p ? readFileSync(p, 'utf-8').replace(/\r/g, '') : '';
}

/** Strip `-- …` line comments so only EXECUTABLE SQL is inspected. */
function executable(sql: string): string {
  return sql
    .split('\n')
    .map((l) => l.replace(/--.*$/, ''))
    .join('\n');
}

/** Collapse whitespace on top of comment-stripping — layout-tolerant matching. */
function flat(sql: string): string {
  return executable(sql).replace(/\s+/g, ' ');
}

const V2_DEF_RE = /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+(?:"?public"?\.)?"?submit_quiz_results_v2"?\s*\(/i;

/**
 * Root-only `.sql`, lexicographically sorted == apply order (readdirSync is
 * non-recursive, so `_legacy/` is excluded exactly as `supabase db push` does).
 */
function rootMigrations(): string[] {
  const dir = resolveRepo(MIGRATIONS_DIR);
  if (!dir) return [];
  return readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
}

/** The LAST root migration that redefines submit_quiz_results_v2 == what runs. */
function newestV2Migration(): string | null {
  const hits = rootMigrations().filter((f) =>
    V2_DEF_RE.test(read(`${MIGRATIONS_DIR}/${f}`)),
  );
  return hits.length ? `${MIGRATIONS_DIR}/${hits[hits.length - 1]}` : null;
}

/** The body of the LAST `CREATE OR REPLACE FUNCTION … submit_quiz_results_v2` in a file. */
function v2Body(rel: string): string {
  const sql = read(rel);
  const start = sql.search(V2_DEF_RE);
  if (start < 0) return '';
  const end = sql.indexOf('\n$$;', start);
  return end > start ? sql.slice(start, end) : sql.slice(start);
}

// ════════════════════════════════════════════════════════════════════════════
// 0. The migration exists and is the newest definition of the RPC.
// ════════════════════════════════════════════════════════════════════════════
describe('Phase 1A — migration presence and ordering', () => {
  it('the Phase 1A migration exists at the root of supabase/migrations', () => {
    expect(resolveRepo(PHASE_1A)).not.toBeNull();
  });

  it('the migration it copied its body from still exists (ordering dependency)', () => {
    expect(resolveRepo(PRIOR_V2)).not.toBeNull();
  });

  it('its timestamp sorts strictly AFTER 20260814000022 (cannot re-order or collide)', () => {
    const names = rootMigrations();
    const prior = names.indexOf('20260814000022_submit_quiz_v2_written_answer_scoring.sql');
    const mine = names.indexOf(
      '20260824090000_quiz_bloom_capture_learner_state_failure_log_and_topic_id_trigger.sql',
    );
    expect(prior).toBeGreaterThanOrEqual(0);
    expect(mine).toBeGreaterThan(prior);
    // exactly one file carries this timestamp
    expect(names.filter((n) => n.startsWith('20260824090000')).length).toBe(1);
  });

  it('IS the newest root migration that redefines submit_quiz_results_v2', () => {
    expect(newestV2Migration()).toBe(PHASE_1A);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 1. bloom_level lands. Asserted against the NEWEST definition, not this file,
//    so a later re-emission that drops the column fails here.
// ════════════════════════════════════════════════════════════════════════════
describe('Phase 1A — quiz_responses.bloom_level is written (defect A)', () => {
  const newest = newestV2Migration();
  const body = newest ? v2Body(newest) : '';
  const insert = flat(body).match(
    /INSERT INTO quiz_responses \(([^)]*)\) VALUES \(([^;]*?)\) ON CONFLICT/i,
  );

  it('the newest definition contains a quiz_responses INSERT with a column list', () => {
    expect(insert).not.toBeNull();
  });

  it('bloom_level IS in the quiz_responses INSERT column list', () => {
    const columns = (insert![1] || '').split(',').map((c) => c.trim());
    expect(columns).toContain('bloom_level');
  });

  it('v_q_bloom IS in the matching VALUES list', () => {
    const values = (insert![2] || '').split(',').map((c) => c.trim());
    expect(values).toContain('v_q_bloom');
  });

  it('column list and VALUES list have the same arity (no silent misalignment)', () => {
    // The VALUES list contains one COALESCE(...)::INT with an internal comma,
    // so count top-level commas rather than naive split length.
    const topLevelCount = (s: string) => {
      let depth = 0;
      let n = 1;
      for (const ch of s) {
        if (ch === '(') depth++;
        else if (ch === ')') depth--;
        else if (ch === ',' && depth === 0) n++;
      }
      return n;
    };
    expect(topLevelCount(insert![2])).toBe(topLevelCount(insert![1]));
  });

  it('v_q_bloom is still SELECTed from question_bank (the value being stamped)', () => {
    expect(flat(body)).toMatch(/SELECT question_text, question_type, topic_id, bloom_level, difficulty/i);
  });

  it('the migration backfills historical rows from question_bank, idempotently', () => {
    const sql = flat(read(PHASE_1A));
    expect(sql).toMatch(
      /UPDATE public\.quiz_responses qr SET bloom_level = qb\.bloom_level FROM public\.question_bank qb/i,
    );
    // the re-run guard: only NULL targets, only non-NULL sources
    expect(sql).toMatch(/qr\.bloom_level IS NULL/i);
    expect(sql).toMatch(/qb\.bloom_level IS NOT NULL/i);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 2. The swallowed learner-state write failure is observable (defects C + the
//    missing ELSE).
// ════════════════════════════════════════════════════════════════════════════
describe('Phase 1A — learner-state write failures are observable (defect C)', () => {
  const newest = newestV2Migration();
  const body = newest ? v2Body(newest) : '';
  const sql = flat(body);

  /**
   * The whole `IF v_q_topic_id IS NOT NULL THEN … ELSE … END IF;` construct that
   * guards the mastery call. Anchored on the PERFORM so it cannot accidentally
   * match one of the other v_q_topic_id guards in the function.
   */
  const guard = sql.match(
    /IF v_q_topic_id IS NOT NULL THEN BEGIN PERFORM update_learner_state_post_quiz\s*\([^;]*\);\s*EXCEPTION WHEN OTHERS THEN(.*?)ELSE(.*?)END IF;/i,
  );

  it('the mastery call is still guarded and still error-isolated (P4 preserved)', () => {
    expect(guard).not.toBeNull();
  });

  it('the EXCEPTION handler no longer uses a bare RAISE NOTICE', () => {
    expect(guard![1]).not.toMatch(/RAISE NOTICE/i);
  });

  it('the EXCEPTION handler RAISEs a WARNING (which Postgres actually logs)', () => {
    expect(guard![1]).toMatch(/RAISE WARNING/i);
  });

  it('the EXCEPTION handler writes a learner_state_write_failures row', () => {
    expect(guard![1]).toMatch(/INSERT INTO public\.learner_state_write_failures/i);
    expect(guard![1]).toMatch(/'exception'/);
  });

  it('the ELSE branch exists and records failure_kind = topic_unresolvable', () => {
    expect(guard![2]).toMatch(/INSERT INTO public\.learner_state_write_failures/i);
    expect(guard![2]).toMatch(/'topic_unresolvable'/);
    expect(guard![2]).toMatch(/RAISE WARNING/i);
  });

  it('both telemetry writes are themselves error-isolated (P4: never abort the submit)', () => {
    for (const branch of [guard![1], guard![2]]) {
      expect(branch).toMatch(
        /BEGIN INSERT INTO public\.learner_state_write_failures[^;]*;\s*EXCEPTION WHEN OTHERS THEN NULL;/i,
      );
      // never re-raises out of the telemetry path
      expect(branch).not.toMatch(/RAISE EXCEPTION/i);
    }
  });

  it('P13: neither telemetry write persists question text or answer text', () => {
    for (const branch of [guard![1], guard![2]]) {
      expect(branch).not.toMatch(/\bv_q_text\b/);
      expect(branch).not.toMatch(/\bv_student_answer_text\b/);
      expect(branch).not.toMatch(/\bv_rubric_feedback\b/);
    }
  });

  it('the mastery call still receives exactly the 8 documented positional args', () => {
    const call = sql.match(/PERFORM update_learner_state_post_quiz\s*\(([^;]*?)\);/i);
    expect(call).not.toBeNull();
    const args = call![1].split(',').map((a) => a.trim());
    // COALESCE((r->>'time_spent')::INT, 0) * 1000 carries an internal comma
    expect(args.length).toBeGreaterThanOrEqual(8);
    expect(args[0]).toBe('p_student_id');
    expect(args[1]).toBe('v_q_topic_id');
    expect(args[2]).toBe('v_is_correct');
    expect(args[3]).toBe('v_q_bloom');
    expect(args[4]).toBe('v_error_type');
    // (D) the difficulty arg must stay the INT local, never a TEXT difficulty —
    // a TEXT value here fails with 42883 BEFORE the function body runs, and that
    // failure would be swallowed by the handler above.
    expect(call![1]).toMatch(/\bv_q_difficulty\b/);
    expect(call![1]).toMatch(/\bv_hint_level\b/);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 3. learner_state_write_failures — P8: RLS + policies in the SAME migration.
// ════════════════════════════════════════════════════════════════════════════
describe('Phase 1A — learner_state_write_failures table posture (P8/P13)', () => {
  const sql = flat(read(PHASE_1A));

  it('creates the table idempotently', () => {
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS public\.learner_state_write_failures/i);
  });

  it('enables RLS in the SAME migration', () => {
    expect(sql).toMatch(
      /ALTER TABLE public\.learner_state_write_failures ENABLE ROW LEVEL SECURITY;/i,
    );
  });

  it('ships a service_role FOR ALL policy and an admin/super_admin SELECT policy', () => {
    expect(sql).toMatch(
      /CREATE POLICY learner_state_write_failures_service_all ON public\.learner_state_write_failures FOR ALL/i,
    );
    expect(sql).toMatch(
      /CREATE POLICY learner_state_write_failures_admin_select ON public\.learner_state_write_failures FOR SELECT/i,
    );
    expect(sql).toMatch(/'super_admin'::text, 'admin'::text/);
  });

  it('the admin policy DELEGATES to a SECURITY DEFINER helper, never inlines the join', () => {
    // XC-3 recursion guard: an inline `EXISTS (SELECT 1 FROM user_roles JOIN
    // roles …)` in USING is a SECURITY INVOKER re-entry into two RLS-enabled
    // tables and would have added a 224th entry to the frozen inline ledger.
    expect(sql).toMatch(
      /CREATE POLICY learner_state_write_failures_admin_select ON public\.learner_state_write_failures FOR SELECT TO authenticated USING \(public\.is_rbac_platform_admin\(\)\);/i,
    );
    expect(sql).toMatch(
      /CREATE OR REPLACE FUNCTION public\.is_rbac_platform_admin\(\) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public/i,
    );
    expect(sql).toMatch(/REVOKE EXECUTE ON FUNCTION public\.is_rbac_platform_admin\(\) FROM anon;/i);
  });

  it('every CREATE POLICY is preceded by a DROP POLICY IF EXISTS (idempotent)', () => {
    const creates = (sql.match(/CREATE POLICY learner_state_write_failures_/gi) || []).length;
    const drops = (sql.match(/DROP POLICY IF EXISTS learner_state_write_failures_/gi) || []).length;
    expect(creates).toBeGreaterThanOrEqual(2);
    expect(drops).toBe(creates);
  });

  it('grants NO student / parent / teacher read path (deny by design)', () => {
    expect(sql).not.toMatch(/learner_state_write_failures_student/i);
    expect(sql).not.toMatch(/learner_state_write_failures_parent/i);
    expect(sql).not.toMatch(/learner_state_write_failures_teacher/i);
    expect(sql).not.toMatch(/guardian_student_links/i);
  });

  it('revokes the blanket grants and never grants write to authenticated/anon', () => {
    expect(sql).toMatch(/REVOKE ALL ON public\.learner_state_write_failures FROM PUBLIC;/i);
    expect(sql).toMatch(/REVOKE ALL ON public\.learner_state_write_failures FROM anon;/i);
    expect(sql).toMatch(/GRANT SELECT ON public\.learner_state_write_failures TO authenticated;/i);
    expect(sql).not.toMatch(/GRANT (ALL|INSERT|UPDATE|DELETE) ON public\.learner_state_write_failures TO (anon|authenticated)/i);
  });

  it('bounds failure_kind to the three documented values', () => {
    expect(sql).toMatch(
      /CHECK \(failure_kind IN \('exception', 'null_topic_id', 'topic_unresolvable'\)\)/i,
    );
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 4. question_bank.topic_id is self-maintaining (defect B).
// ════════════════════════════════════════════════════════════════════════════
describe('Phase 1A — topic_id resolution trigger on question_bank (defect B)', () => {
  const sql = flat(read(PHASE_1A));
  const rawSql = read(PHASE_1A);

  /**
   * ONLY the trigger function body. Scoping matters: the RPC in the same file
   * still carries its own runtime fallback which legitimately keys on the
   * SESSION grade (`ct.grade = p_grade`). The trigger must not — a question
   * has its own grade, and a whole-file assertion would be satisfied by the
   * wrong one.
   */
  const triggerFn = (() => {
    const m = rawSql.match(
      /CREATE OR REPLACE FUNCTION public\.resolve_question_topic_id\(\)[\s\S]*?\n\$fn\$;/,
    );
    return m ? flat(m[0]) : '';
  })();

  it('defines resolve_question_topic_id() as a trigger function', () => {
    expect(sql).toMatch(
      /CREATE OR REPLACE FUNCTION public\.resolve_question_topic_id\(\) RETURNS trigger/i,
    );
  });

  it('installs a BEFORE INSERT OR UPDATE trigger on question_bank', () => {
    expect(sql).toMatch(
      /CREATE TRIGGER trg_question_bank_resolve_topic_id BEFORE INSERT OR UPDATE OF [^ ]*[^;]*ON public\.question_bank FOR EACH ROW EXECUTE FUNCTION public\.resolve_question_topic_id\(\)/i,
    );
  });

  it('the trigger creation is idempotent (DROP TRIGGER IF EXISTS first)', () => {
    expect(sql).toMatch(
      /DROP TRIGGER IF EXISTS trg_question_bank_resolve_topic_id ON public\.question_bank;/i,
    );
  });

  it('the trigger function body was located (scoping guard for the tests below)', () => {
    expect(triggerFn).not.toBe('');
  });

  it('is SECURITY INVOKER with an empty pinned search_path and qualified names', () => {
    expect(triggerFn).toMatch(/SECURITY INVOKER SET search_path = ''/i);
    expect(triggerFn).toMatch(/FROM public\.curriculum_topics ct JOIN public\.subjects s/i);
    expect(triggerFn).not.toMatch(/SECURITY DEFINER/i);
  });

  it('resolves on the QUESTION own grade (NEW.grade), never a session grade', () => {
    expect(triggerFn).toMatch(/ct\.grade = NEW\.grade/i);
    expect(triggerFn).not.toMatch(/p_grade/i);
  });

  it('only ever FILLS a NULL topic_id — never overwrites a supplied one', () => {
    expect(triggerFn).toMatch(/IF NEW\.topic_id IS NULL/i);
  });

  it('P5: introduces no integer cast/comparison on a grade', () => {
    expect(rawSql).not.toMatch(/grade\s*::\s*(int|integer|smallint|bigint)/i);
    expect(rawSql).not.toMatch(/(int|integer|smallint|bigint)\s*\)\s*=\s*NEW\.grade/i);
  });

  it('re-runs the topic_id backfill with a guard that makes a replay a no-op', () => {
    expect(sql).toMatch(/UPDATE public\.question_bank qb SET topic_id =/i);
    expect(sql).toMatch(/WHERE qb\.topic_id IS NULL AND qb\.is_active = true/i);
    // the EXISTS guard is what prevents NULL -> NULL churn on unresolvable rows
    expect(sql).toMatch(/AND EXISTS \( SELECT 1 FROM public\.curriculum_topics ct/i);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 5. Product invariants preserved + non-destructive.
// ════════════════════════════════════════════════════════════════════════════
describe('Phase 1A — invariants preserved', () => {
  const newest = newestV2Migration();
  const body = flat(newest ? v2Body(newest) : '');
  const exec = executable(read(PHASE_1A));

  it('P1: the score formula is byte-identical', () => {
    expect(body).toContain('v_score_percent := ROUND((v_correct::NUMERIC / v_total) * 100);');
  });

  it('P2: the three XP literals still equal the canonical XP_RULES constants', () => {
    expect(body).toContain(`v_xp := v_correct * ${XP_RULES.quiz_per_correct};`);
    expect(body).toContain(
      `IF v_score_percent >= 80 THEN v_xp := v_xp + ${XP_RULES.quiz_high_score_bonus}; END IF;`,
    );
    expect(body).toContain(
      `IF v_score_percent = 100 THEN v_xp := v_xp + ${XP_RULES.quiz_perfect_bonus}; END IF;`,
    );
  });

  it('P3: all three anti-cheat checks survive', () => {
    expect(body).toMatch(/IF v_avg_time < 3\.0 AND v_total > 0 THEN v_flagged := true;/);
    expect(body).toMatch(/IF v_total > 3 THEN/);
    expect(body).toMatch(
      /IF v_served_count = 0 OR jsonb_array_length\(p_responses\) <> v_served_count THEN v_flagged := true;/,
    );
  });

  it('P4: the authoritative atomic_quiz_profile_update still runs', () => {
    expect(body).toMatch(/PERFORM atomic_quiz_profile_update\s*\(/i);
  });

  it('the 11-param signature is unchanged (no new overload)', () => {
    for (const p of [
      'p_session_id UUID',
      'p_student_id UUID',
      'p_subject TEXT',
      'p_grade TEXT',
      'p_topic TEXT DEFAULT NULL',
      'p_chapter INTEGER DEFAULT NULL',
      "p_responses JSONB DEFAULT '[]'",
      'p_time INTEGER DEFAULT 0',
      'p_idempotency_key UUID DEFAULT NULL',
      'p_unhinted_xp INTEGER DEFAULT 2',
      'p_unhinted_cap INTEGER DEFAULT 30',
    ]) {
      expect(body).toContain(p);
    }
    // plain CREATE OR REPLACE: the RPC itself is never dropped
    expect(exec).not.toMatch(/DROP FUNCTION[^\n]*submit_quiz_results_v2/i);
  });

  it('the RETURN shape is unchanged (REG-48-style contract pin)', () => {
    for (const key of [
      "'total'",
      "'correct'",
      "'score_percent'",
      "'xp_earned'",
      "'xp_capped'",
      "'session_id'",
      "'flagged'",
      "'idempotent_replay'",
      "'cme_next_action'",
      "'cme_next_concept_id'",
      "'cme_reason'",
      "'questions'",
      "'unhinted_correct'",
      "'unhinted_bonus_xp'",
    ]) {
      expect(body).toContain(key);
    }
  });

  it('the grant posture stays authenticated + service_role only', () => {
    expect(flat(read(PHASE_1A))).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.submit_quiz_results_v2\([^)]*\) TO authenticated, service_role;/i,
    );
  });

  it('is non-destructive: no table drop, no column drop, no DELETE', () => {
    expect(exec).not.toMatch(/\bDROP\s+TABLE\b/i);
    expect(exec).not.toMatch(/\bDROP\s+COLUMN\b/i);
    expect(exec).not.toMatch(/\bDELETE\s+FROM\b/i);
    expect(exec).not.toMatch(/\bTRUNCATE\b/i);
  });

  it('does NOT drop the concept_mastery.next_review_date ghost column (tombstone only)', () => {
    expect(exec).toMatch(/COMMENT ON COLUMN public\.concept_mastery\.next_review_date/i);
    expect(exec).not.toMatch(/next_review_date[^\n]*DROP/i);
  });

  it('is transactional (BEGIN … COMMIT)', () => {
    expect(exec).toMatch(/^BEGIN;$/m);
    expect(exec).toMatch(/^COMMIT;$/m);
  });
});
