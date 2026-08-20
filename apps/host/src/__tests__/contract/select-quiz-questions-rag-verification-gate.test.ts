/**
 * select_quiz_questions_rag verification gate — PR-GATING structure test.
 *
 * Mirrors `v3-school-rpc-predeploy.test.ts`'s pattern: reads the migration's
 * SQL text via readFileSync and asserts, textually/structurally, WITHOUT
 * executing any SQL, that the four repeated predicate blocks and the
 * enforcement ladder are wired correctly.
 *
 * Per spec `docs/superpowers/specs/2026-08-02-quiz-rag-verification-gate-
 * correctness.md` §6.1: "This is the test that actually gates every PR — the
 * live-DB test (select-quiz-questions-rag-verification-gate.test.ts under
 * __tests__/migrations/) does NOT run on a normal PR, so this structure test
 * is what must catch source drift."
 *
 * Deterministic, no DB, no network. Runs on every PR.
 *
 * SOURCE RESOLUTION (fixed 2026-08-20, PR #1582 follow-up): this test used to
 * hardcode its source path to the ORIGINAL migration that introduced the
 * verification gate (`20260802100000_select_quiz_questions_rag_verification_
 * gate.sql`). The function has since been re-issued twice more —
 * `20260814000014_tiered_verification_serving_and_truthful_picker.sql`
 * (widened the Tier-0 disproved-state exclusion from one state to three) and
 * `20260820120000_reassert_select_quiz_questions_rag_staging_drift.sql` (a
 * byte-identical-body defensive re-assertion that additionally re-issues the
 * function's anon REVOKE) — and the hardcoded path silently stopped tracking
 * the live definition, so this "PR-gating" test was checking a stale,
 * superseded predicate (`!= 'failed'`) while the real function had long since
 * moved to `NOT IN ('failed', 'failed_fix_in_flight', 'failed_unfixable')`.
 * A hardcoded filename will go stale again the next time this function is
 * re-issued, so instead of repointing to another fixed name, this test now
 * resolves the source dynamically: it scans every `supabase/migrations/
 * *.sql` file for one containing a `CREATE OR REPLACE FUNCTION public.
 * select_quiz_questions_rag` marker and takes the LEXICOGRAPHICALLY LAST
 * match. Migration filenames are `YYYYMMDDHHMMSS`-prefixed, so lexicographic
 * order is chronological order, and the most recent `CREATE OR REPLACE` of a
 * function is always its current, authoritative definition — this is the
 * same "supersession" reasoning documented in each migration's own header.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = resolve(__dirname, '..', '..', '..', '..', '..');
const migrationsRoot = resolve(REPO_ROOT, 'supabase', 'migrations');
const FUNCTION_DEFINITION_MARKER =
  'CREATE OR REPLACE FUNCTION public.select_quiz_questions_rag';

function findLatestMigrationDefining(marker: string): string {
  const matches = readdirSync(migrationsRoot)
    .filter((name) => name.endsWith('.sql'))
    .sort() // YYYYMMDDHHMMSS-prefixed filenames => lexicographic === chronological
    .filter((name) => readFileSync(resolve(migrationsRoot, name), 'utf8').includes(marker));

  if (matches.length === 0) {
    throw new Error(
      `No file under ${migrationsRoot} contains a definition of: ${marker}. ` +
        'Has select_quiz_questions_rag been renamed, dropped, or moved?',
    );
  }
  return matches[matches.length - 1];
}

const migrationFilename = findLatestMigrationDefining(FUNCTION_DEFINITION_MARKER);
const migrationPath = resolve(migrationsRoot, migrationFilename);
const migrationSql = readFileSync(migrationPath, 'utf8');

// Strip SQL line comments so marker-searches can't accidentally match text
// that only appears in a `--` comment (mirrors v3-school-rpc-predeploy's
// `executableAdditiveSql` stripping approach).
const executableSql = migrationSql
  .split('\n')
  .map((line) => line.replace(/--.*$/, ''))
  .join('\n');

function sqlBetween(source: string, startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  if (start < 0 || end < 0) {
    throw new Error(`Missing migration markers: ${startMarker} -> ${endMarker}`);
  }
  return source.slice(start, end);
}

// ── The four repeated predicate blocks (spec §2.1, AC-7) ────────────────────
const poolCountBlock = sqlBetween(
  executableSql,
  'SELECT COUNT(*) INTO v_total_pool',
  'IF v_total_pool = 0 THEN',
);
const seenCountBlock = sqlBetween(
  executableSql,
  'SELECT COUNT(*) INTO v_seen_count',
  'v_total_pool >= MIN_POOL_FOR_RESET',
);
const resetDeleteBlock = sqlBetween(
  executableSql,
  'DELETE FROM user_question_history h',
  'v_seen_count := 0;',
);
const candidatePoolBlock = sqlBetween(
  executableSql,
  'candidate_pool AS (',
  'numbered AS (',
);

const FOUR_BLOCKS: Array<[string, string]> = [
  ['pool-count', poolCountBlock],
  ['seen-count', seenCountBlock],
  ['reset/delete', resetDeleteBlock],
  ['candidate_pool CTE', candidatePoolBlock],
];

describe('select_quiz_questions_rag verification gate — migration structure', () => {
  it('is a CREATE OR REPLACE FUNCTION wrapped in a single transaction (idempotent)', () => {
    expect(executableSql).toMatch(
      /BEGIN;\s*CREATE OR REPLACE FUNCTION public\.select_quiz_questions_rag/i,
    );
    expect(executableSql.trimEnd()).toMatch(/COMMIT;$/i);
  });

  it('preserves the EXACT existing 8-parameter signature (no accidental overload)', () => {
    // Byte-identical to baseline / 20260625000200 / 20260801100700 — verified
    // by hand against every historical CREATE OR REPLACE of this function.
    // Keeping this identical is what makes CREATE OR REPLACE a true in-place
    // replace instead of a new sibling overload.
    expect(executableSql).toMatch(
      /CREATE OR REPLACE FUNCTION public\.select_quiz_questions_rag\(\s*p_student_id uuid,\s*p_subject text,\s*p_grade text,\s*p_chapter_number integer DEFAULT NULL,\s*p_count integer DEFAULT 10,\s*p_difficulty_mode text DEFAULT 'mixed',\s*p_question_types text\[\] DEFAULT ARRAY\['mcq'\]::text\[\],\s*p_query_embedding vector DEFAULT NULL\s*\)/,
    );
    expect(executableSql).toContain('RETURNS jsonb');
    expect(executableSql).toContain('SECURITY DEFINER');
    expect(executableSql).toContain("SET search_path TO 'public'");
  });

  it.each(FOUR_BLOCKS)(
    'the %s block contains all three Tier-0 closures (spec §2.1, widened 2026-08-14)',
    (_label, block) => {
      expect(block).toContain('qb.deleted_at IS NULL');
      expect(block).toContain("qb.content_status = 'published'");
      // Widened by 20260814000014_tiered_verification_serving_and_truthful_
      // picker.sql from the single-state `!= 'failed'` to all three
      // disproved states — the CHECK constraint allows six verification_state
      // values (20260510064952) but every serving gate had kept testing only
      // 'failed', so rows the verifier had disproved via
      // 'failed_fix_in_flight' / 'failed_unfixable' were still servable.
      expect(block).toContain(
        "qb.verification_state NOT IN ('failed', 'failed_fix_in_flight', 'failed_unfixable')",
      );
    },
  );

  it('the ownership guard (auth.uid() skip for service-role) is unchanged', () => {
    expect(executableSql).toContain(
      'IF auth.uid() IS NOT NULL AND NOT EXISTS (',
    );
    expect(executableSql).toContain(
      'SELECT 1 FROM students WHERE id = p_student_id AND auth_user_id = auth.uid()',
    );
  });

  it('looks up ff_grounded_ai_enforced_pairs by (grade, subject_code, enabled) before deciding the rung', () => {
    expect(executableSql).toMatch(
      /SELECT EXISTS \(\s*SELECT 1 FROM ff_grounded_ai_enforced_pairs\s*WHERE grade = p_grade AND subject_code = p_subject AND enabled = true\s*\) INTO v_pair_enforced;/,
    );
  });

  it('computes the verified-pool count for the EXACT requested slice only when the pair is enforced', () => {
    const ifBlock = sqlBetween(
      executableSql,
      'IF v_pair_enforced THEN',
      'v_use_strict := v_pair_enforced AND v_verified_pool >= p_count;',
    );
    expect(ifBlock).toContain('SELECT COUNT(*) INTO v_verified_pool');
    expect(ifBlock).toContain("qb.verification_state = 'verified'");
    expect(ifBlock).toContain('qb.verified_against_ncert = true');
    // Same slice-scoping as candidate_pool: chapter, question type, AND
    // difficulty (spec §2.3 — the pair-level 90% floor can mask a locally
    // thin chapter/difficulty slice).
    expect(ifBlock).toContain('(p_chapter_number IS NULL OR qb.chapter_number = p_chapter_number)');
    expect(ifBlock).toContain(
      "p_difficulty_mode = 'mixed' OR p_difficulty_mode = 'progressive'",
    );
  });

  it('Rung E0/E1 decision uses inclusive >= at the boundary (spec §3.1)', () => {
    expect(executableSql).toContain(
      'v_use_strict := v_pair_enforced AND v_verified_pool >= p_count;',
    );
  });

  it('candidate_pool CTE wires the strict verified predicate conditionally on v_use_strict (spec §3.2)', () => {
    expect(candidatePoolBlock).toContain(
      'AND (NOT v_use_strict OR (qb.verified_against_ncert = true AND qb.verification_state = \'verified\'))',
    );
  });

  it('telemetry fires only for the enforced-but-thin case, wrapped fail-open (spec §3.5)', () => {
    const telemetryGuard = sqlBetween(
      executableSql,
      'IF v_pair_enforced AND v_verified_pool < p_count THEN',
      'END IF;',
    );
    expect(telemetryGuard).toContain("INSERT INTO ops_events (");
    expect(telemetryGuard).toContain("'grounding.quiz_serving'");
    expect(telemetryGuard).toContain("'select_quiz_questions_rag'");
    expect(telemetryGuard).toContain("'quiz_verification_gap'");
    expect(telemetryGuard).toContain("'verified_pool_count', v_verified_pool");
    expect(telemetryGuard).toContain("'requested_count', p_count");
    expect(telemetryGuard).toContain('EXCEPTION WHEN OTHERS THEN');
    expect(telemetryGuard).toContain('NULL;');
  });

  it('does NOT emit telemetry context referencing any student identifier (P13)', () => {
    const telemetryGuard = sqlBetween(
      executableSql,
      'IF v_pair_enforced AND v_verified_pool < p_count THEN',
      'END IF;',
    );
    expect(telemetryGuard).not.toContain('p_student_id');
  });

  it('adds a verified_rank ordering column without adding it to the JSON response payload (spec §3.3 + ambiguity resolution)', () => {
    expect(candidatePoolBlock).toContain(
      "CASE WHEN qb.verification_state = 'verified' THEN 0 ELSE 1 END AS verified_rank,",
    );
    expect(executableSql).toContain(
      'ORDER BY seen_rank, ncert_rank, verified_rank, relevance_score DESC, last_shown_at',
    );
    expect(executableSql).toContain(
      'ROW_NUMBER() OVER (ORDER BY seen_rank, ncert_rank, verified_rank, relevance_score DESC) AS rn',
    );

    // The JSON response payload (jsonb_build_object) must NOT gain a new key
    // for verification_state/verified_against_ncert/verified_rank — no ACs
    // in the spec require it, and it would be an unreviewed caller-facing
    // contract change (see this migration's own "spec ambiguity" comment).
    const responseObject = sqlBetween(
      executableSql,
      'SELECT jsonb_agg(jsonb_build_object(',
      ') ORDER BY rn) INTO v_result FROM selected;',
    );
    expect(responseObject).not.toContain('verification_state');
    expect(responseObject).not.toContain('verified_against_ncert');
    expect(responseObject).not.toContain('verified_rank');
    expect(responseObject).not.toContain('verification_tier');
  });

  it('does not touch select_quiz_questions_v2, coverage.ts-adjacent logic, or question-validation.ts (spec §5 non-goals)', () => {
    expect(executableSql).not.toContain('select_quiz_questions_v2');
    expect(executableSql).not.toContain('validateQuestion');
    expect(executableSql).not.toContain('chk_source_type');
    expect(executableSql).not.toContain('source_type');
  });

  it('does not flip any ff_grounded_ai_enforced_pairs row (no INSERT/UPDATE against that table)', () => {
    expect(executableSql).not.toMatch(/INSERT INTO ff_grounded_ai_enforced_pairs/i);
    expect(executableSql).not.toMatch(/UPDATE ff_grounded_ai_enforced_pairs/i);
    expect(executableSql).not.toMatch(/UPSERT.*ff_grounded_ai_enforced_pairs/i);
  });

  it('issues no GRANT, and any REVOKE is only the pre-existing anon-execute revoke reissued verbatim (preserves ACL)', () => {
    // No migration re-issuing this function may GRANT new privileges — the
    // ACL is preserved via CREATE OR REPLACE alone. A REVOKE is allowed ONLY
    // if it is the anon-execute revoke against THIS function, reissued
    // verbatim from 20260515000002_security_hardening_secdef_anon_
    // searchpath_rls_view.sql (idempotent — REVOKE on an already-revoked
    // grant is a no-op). This is deliberately not a blanket "no REVOKE"
    // check: 20260820120000_reassert_select_quiz_questions_rag_staging_
    // drift.sql re-affirms that exact REVOKE defensively, so a blanket ban
    // would itself be stale against the current source.
    expect(executableSql).not.toMatch(/\bGRANT\b/);
    const revokeStatements = executableSql.match(/REVOKE\b[^;]*;/gi) ?? [];
    for (const statement of revokeStatements) {
      expect(statement).toMatch(/EXECUTE ON FUNCTION public\.select_quiz_questions_rag/);
      expect(statement).toMatch(/FROM anon/);
    }
  });

  it('the empty-Tier-0-pool early return is unchanged and precedes the ladder computation', () => {
    const earlyReturnIdx = executableSql.indexOf("IF v_total_pool = 0 THEN\n    RETURN '[]'::jsonb;");
    const ladderIdx = executableSql.indexOf('SELECT EXISTS (\n    SELECT 1 FROM ff_grounded_ai_enforced_pairs');
    expect(earlyReturnIdx).toBeGreaterThan(-1);
    expect(ladderIdx).toBeGreaterThan(-1);
    expect(ladderIdx).toBeGreaterThan(earlyReturnIdx);
  });
});
