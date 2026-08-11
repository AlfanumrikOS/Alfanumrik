#!/usr/bin/env node
// scripts/verify-20260814-migrations.mjs
//
// Deploy gate for the unapplied `20260814*` migrations
// (20260814000007-11 and 20260814000018-23 — NON-CONTIGUOUS; see the
// MIGRATION_VERSIONS comment for why 0012-0017 are deliberately absent).
//
// Companion to docs/runbooks/2026-08-11-unapplied-migrations-20260814-apply.md.
// That runbook carries the reasoning; this file carries the assertions, so the
// post-apply check is a GATE that exits non-zero rather than a checklist
// somebody skims at 2am.
//
// ─── STATUS OF THE MIGRATIONS THIS VERIFIES ─────────────────────────────────
// UNEXECUTED. As of authoring, none of them has been applied to any
// database. Every expectation below was DERIVED from the migration source, not
// observed. This script itself has only ever been run in its no-database
// degradation path.
//
// ─── HONEST DEGRADATION (the whole point of the exit codes) ─────────────────
// A verification tool that exits 0 when it verified NOTHING is worse than no
// tool: it converts "unknown" into "green". So:
//
//   exit 0  every BLOCKING check ran and passed
//   exit 1  at least one blocking check ran and FAILED
//   exit 2  usage / internal error
//   exit 3  no SQL channel was reachable — NOTHING was verified. The script
//           prints the full list of checks it could not run, by id, and never
//           reports success.
//
// `--offline` is the only way to get exit 0 without a database, it runs ONLY
// the static chain checks (every file present, in order, each transactional),
// and it prints a loud banner saying the database lane did not run. It is a
// developer convenience, NOT a deploy gate.
//
// ─── SQL CHANNEL ────────────────────────────────────────────────────────────
// `psql` on PATH, plus a connection string in DB_URL / SUPABASE_DB_URL /
// DATABASE_URL. Deliberately single-channel: PostgREST cannot run
// has_column_privilege() or read pg_proc, and `supabase db query` emits
// human-formatted output that is not safely parseable. If you only have the
// Supabase CLI, run the SQL from the runbook by hand — do not make this script
// guess.
//
// ─── MODES ──────────────────────────────────────────────────────────────────
//   node scripts/verify-20260814-migrations.mjs              # post-apply verify
//   node scripts/verify-20260814-migrations.mjs --preflight  # BEFORE db push
//   node scripts/verify-20260814-migrations.mjs --offline    # static only
//   node scripts/verify-20260814-migrations.mjs --json       # machine output
//
// Severity: `blocking` fails the run; `advisory` is printed and never fails —
// used where the migration source does NOT determine a single correct
// post-state (see M6-2 and M4-5).

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const MIGRATIONS_DIR = path.join(REPO_ROOT, 'supabase', 'migrations');
const RUNBOOK = 'docs/runbooks/2026-08-11-unapplied-migrations-20260814-apply.md';

/** The exact set this gate covers, lowest first. Apply order == this order. */
const MIGRATION_SET = [
  '20260814000007_subject_catalogue_restrict_math_science.sql',
  '20260814000008_grade_subject_map_restrict_and_destream.sql',
  '20260814000009_repair_student_subjects_after_restriction.sql',
  '20260814000010_enforce_subject_enrollment_active_check.sql',
  '20260814000011_get_subject_violations_active_aware.sql',
  '20260814000018_plan_subject_access_restrict.sql',
  '20260814000019_trim_teacher_subjects_taught.sql',
  '20260814000020_quiz_session_shuffles_answer_key_column_acl.sql',
  '20260814000021_quiz_session_shuffles_session_mode.sql',
  '20260814000022_submit_quiz_v2_written_answer_scoring.sql',
  // Added by a concurrent agent DURING authoring; caught by ST-4 below, read in
  // full, and folded in. If ST-4 warns again, do the same for the new file —
  // this array is the gate's coverage boundary and a file outside it is
  // unverified, not verified-clean.
  '20260814000023_keyless_question_serving_and_server_side_p6.sql',
];

/**
 * The 14-digit version prefixes, DERIVED from MIGRATION_SET so the two cannot
 * drift apart. Used by PF-1.
 *
 * NOTE THE GAP — it is deliberate. This set is 0007-0011 then 0018-0023, with
 * NOTHING at 0012-0017. Those six versions were ours until 2026-08-11, when the
 * block was renumbered: `main` and `fix/ci-structural-defects` had landed
 * DIFFERENT files at the same four versions (0012-0015), and since
 * `supabase db push` keys `supabase_migrations.schema_migrations` on the numeric
 * version alone, whichever branch applied first would have marked those versions
 * applied and the other's files would have been skipped forever — silently, with
 * no error. The block moved contiguously (12->18 … 17->23) to preserve relative
 * order: 0021 extends the column allowlist 0020 establishes, and 0023 replaces
 * start_quiz_session, which 0021 and 0022 both depend on. Versions 0012-0017 now
 * belong to the OTHER branch; do not reclaim them and do not "tidy" this into a
 * contiguous range.
 */
const MIGRATION_VERSIONS = MIGRATION_SET.map((f) => f.slice(0, 14));
const MIGRATION_VERSIONS_SQL = MIGRATION_VERSIONS.map((v) => `'${v}'`).join(',');

/**
 * The question-serving surface 20260814000023 rebuilds: FOUR distinct names but
 * FIVE overloads, because get_quiz_questions has TWO live ones (4-arg from the
 * baseline, 5-arg from 20260505155525) and both are reachable by name from
 * PostgREST.
 */
const SERVING_FUNCTIONS = [
  'select_quiz_questions_rag', 'select_quiz_questions_v2',
  'get_quiz_questions', 'start_quiz_session',
];
const SERVING_FUNCTIONS_SQL = SERVING_FUNCTIONS.map((f) => `'${f}'`).join(',');
const SERVING_OVERLOAD_COUNT = 5; // rag 8 + v2 7 + gqq 4 + gqq 5 + sqs 2

/** CEO-locked. Declared once here, exactly as each migration declares it once. */
const KEEP_SET = ['math', 'science', 'physics', 'chemistry', 'biology'];
const KEEP_SQL = KEEP_SET.map((c) => `'${c}'`).join(',');

/** The 10 columns 20260814000020 grants to `authenticated`. */
const ACL_ALLOWLIST = [
  'session_id', 'question_id', 'student_id', 'shuffle_map', 'options_snapshot',
  'options_version_at_serve', 'created_at', 'student_selected_displayed_index',
  'student_time_spent_seconds', 'student_answered_at',
];

/** The two columns no client role may ever read. */
const ANSWER_KEY_COLUMNS = ['correct_answer_index_snapshot', 'integrity_hash'];

const SHUFFLES = 'public.quiz_session_shuffles';

// ─────────────────────────────────────────────────────────────────────────────
// SQL channel
// ─────────────────────────────────────────────────────────────────────────────

const NULL_TOKEN = '<NULL>';
const FIELD_SEP = '\u001F'; // ASCII unit separator: cannot occur in our data

function resolveConnString() {
  return process.env.DB_URL || process.env.SUPABASE_DB_URL || process.env.DATABASE_URL || null;
}

function psqlAvailable() {
  const r = spawnSync('psql', ['--version'], { encoding: 'utf8' });
  return r.status === 0;
}

/**
 * Run one statement. Returns { rows: string[][] } or { error: string }.
 * Never throws — a failed probe is a CHECK failure, not a crash, so one broken
 * check cannot hide every other check in the lane.
 */
function runSql(conn, sql) {
  const r = spawnSync(
    'psql',
    [conn, '-X', '-q', '-A', '-t', '-F', FIELD_SEP, '-P', `null=${NULL_TOKEN}`,
      '-v', 'ON_ERROR_STOP=1', '-c', sql],
    { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 },
  );
  if (r.error) return { error: `psql spawn failed: ${r.error.message}` };
  if (r.status !== 0) return { error: (r.stderr || '').trim() || `psql exited ${r.status}` };
  const rows = (r.stdout || '')
    .split('\n')
    .map((l) => l.replace(/\r$/, ''))
    .filter((l) => l.length > 0)
    .map((l) => l.split(FIELD_SEP));
  return { rows };
}

// ─────────────────────────────────────────────────────────────────────────────
// Expectation helpers. Each returns null on pass, or a human failure string.
// ─────────────────────────────────────────────────────────────────────────────

/** Pass when the query returns zero rows. The query returns OFFENDING rows. */
const empty = (rows) =>
  rows.length === 0 ? null : `${rows.length} offending row(s): ${preview(rows)}`;

/** Pass when the single scalar equals `want` (string compare). */
const scalarIs = (want) => (rows) => {
  if (rows.length !== 1 || rows[0].length !== 1) {
    return `expected exactly one scalar, got ${rows.length} row(s): ${preview(rows)}`;
  }
  const got = rows[0][0].trim();
  return got === String(want) ? null : `expected ${want}, got ${got}`;
};

/** Pass when the single row's booleans match `want` (array of 't'/'f'). */
const boolsAre = (want) => (rows) => {
  if (rows.length !== 1) return `expected exactly one row, got ${rows.length}: ${preview(rows)}`;
  const got = rows[0].map((v) => v.trim());
  if (got.length !== want.length) return `expected ${want.length} columns, got ${got.length}`;
  const bad = [];
  for (let i = 0; i < want.length; i++) {
    if (got[i] !== want[i]) bad.push(`col${i + 1}: expected ${want[i]}, got ${got[i]}`);
  }
  return bad.length === 0 ? null : bad.join('; ');
};

function preview(rows, n = 5) {
  const head = rows.slice(0, n).map((r) => r.join(' | '));
  return head.join(' // ') + (rows.length > n ? ` // …+${rows.length - n} more` : '');
}

// ─────────────────────────────────────────────────────────────────────────────
// PRE-FLIGHT checks (run BEFORE `supabase db push`)
//
// PF-8 is deliberately ABSENT from this array and the numbering deliberately
// skips it. PF-8 is the pricing-copy reconciliation gate — a deploy-composition
// question with no SQL answer. It lives in the runbook (§2 PF-8) and is signed
// off by a human. Do not "fix" the gap with a check that cannot actually test it.
// ─────────────────────────────────────────────────────────────────────────────

const PREFLIGHT_CHECKS = [
  {
    id: 'PF-1', migration: 'all', severity: 'blocking',
    title: 'none of the covered migrations is already recorded applied',
    // Deliberately an EXPLICIT IN-list, not a BETWEEN range. After the 2026-08-11
    // renumber this gate's set is NON-CONTIGUOUS (0007-0011 + 0018-0023): versions
    // 0012-0017 now belong to a DIFFERENT branch's migrations, so a range would
    // report those as "already applied" and abort a release for a false reason.
    // The old range also silently ended one version short of the set's own tail.
    sql: `SELECT version FROM supabase_migrations.schema_migrations
           WHERE version IN (${MIGRATION_VERSIONS_SQL}) ORDER BY version`,
    expect: empty,
    hint: 'A recorded version makes `db push` a NO-OP for it. Confirm its objects exist (post-apply lane); if not you are in the repair-skip case — stream the body via STDIN. Runbook §3.2.',
  },
  {
    id: 'PF-2a', migration: '20260814000018', severity: 'advisory',
    title: 'does the DEPLOYED subject picker gate on is_content_ready?',
    sql: `SELECT p.proname,
                 position('is_content_ready' IN pg_get_functiondef(p.oid)) > 0
            FROM pg_proc p
           WHERE p.pronamespace = 'public'::regnamespace
             AND p.proname IN ('get_available_subjects','get_available_subjects_v2')
           ORDER BY p.proname`,
    expect: (rows) => {
      if (rows.length === 0) return 'neither picker RPC exists on this database';
      const gated = rows.filter((r) => r[1].trim() === 't').map((r) => r[0]);
      return gated.length === 0
        ? null
        : `GATED: ${gated.join(', ')} — 20260814000018's grants will stay INVISIBLE for any keep-set subject whose is_content_ready is false. See PF-2b and the runbook decision table.`;
    },
    hint: 'On-disk newest bodies (20260621000400 / 20260605000000) gate on is_active ONLY; the prod-dump baseline gates on is_content_ready too. This measures which one is actually deployed. Runbook §2 PF-2.',
  },
  {
    id: 'PF-2b', migration: '20260814000018', severity: 'advisory',
    title: 'keep-set content readiness (is_content_ready is COMPUTED, never seeded)',
    sql: `SELECT code, is_active, is_content_ready FROM public.subjects
           WHERE code IN (${KEEP_SQL}) ORDER BY code`,
    expect: (rows) => {
      if (rows.length !== KEEP_SET.length) {
        return `expected ${KEEP_SET.length} keep-set rows, got ${rows.length}: ${preview(rows)}`;
      }
      const notReady = rows.filter((r) => r[2].trim() !== 't').map((r) => r[0]);
      return notReady.length === 0
        ? null
        : `not content-ready: ${notReady.join(', ')}. If PF-2a says GATED, STOP and run SELECT * FROM public.compute_subject_content_readiness_v2(); then re-check. If PF-2a says not gated, this is informational only.`;
    },
    hint: 'Written only by public.compute_subject_content_readiness_v2() (20260622000000). Nothing in the 20260814 set recomputes it.',
  },
  {
    id: 'PF-3', migration: '20260814000008', severity: 'blocking',
    title: 'no (grade, board) pair will be stranded by the assertion',
    sql: `WITH keep(code) AS (VALUES ${KEEP_SET.map((c) => `('${c}')`).join(',')}),
               pairs AS (SELECT DISTINCT grade, board FROM public.grade_subject_map)
          SELECT p.grade, COALESCE(p.board,'${NULL_TOKEN}')
            FROM pairs p
           WHERE p.grade NOT IN ('11','12')
             AND NOT EXISTS (SELECT 1 FROM public.grade_subject_map g
                              WHERE g.grade = p.grade
                                AND g.board IS NOT DISTINCT FROM p.board
                                AND g.subject_code IN (SELECT code FROM keep))
           ORDER BY 1,2`,
    expect: empty,
    hint: 'These pairs make 20260814000008 ABORT (a deliberate abort, whole txn rolls back). Fix by SEEDING math (6-12) + science (6-10) for each listed pair, then re-run. Do NOT weaken the keep-set. Runbook §2 PF-3.',
  },
  {
    id: 'PF-4', migration: '20260814000019', severity: 'advisory',
    title: 'teacher blast radius — record would_be_left_with_zero before applying',
    sql: `WITH keep(code) AS (VALUES ${KEEP_SET.map((c) => `('${c}')`).join(',')}),
               t AS (
                 SELECT COALESCE(tt.subjects_taught, ARRAY[]::TEXT[]) AS before_codes,
                        ARRAY(SELECT c FROM UNNEST(COALESCE(tt.subjects_taught, ARRAY[]::TEXT[])) AS c
                               WHERE c IN (SELECT k.code FROM keep k)) AS after_codes
                   FROM public.teachers tt)
          SELECT count(*),
                 count(*) FILTER (WHERE array_length(before_codes,1) IS NOT NULL
                                    AND array_length(after_codes,1) IS NULL),
                 count(*) FILTER (WHERE array_length(after_codes,1) IS NOT NULL
                                    AND array_length(after_codes,1) < array_length(before_codes,1))
            FROM t`,
    expect: (rows) => {
      if (rows.length !== 1) return `expected one row, got ${rows.length}`;
      const [total, zero, partial] = rows[0].map((v) => v.trim());
      return `RECORD THIS → teachers_total=${total} would_be_left_with_zero=${zero} would_be_partially_trimmed=${partial}`;
    },
    hint: 'Mirrors Q1 of docs/subject-restriction-teacher-impact.sql. Post-apply check M8-4 must reproduce would_be_left_with_zero exactly; a disagreement means the catalogue changed between runs.',
  },
  {
    id: 'PF-5', migration: '20260814000018/19', severity: 'blocking',
    title: 'every keep-set code exists in public.subjects',
    sql: `SELECT k.code FROM (VALUES ${KEEP_SET.map((c) => `('${c}')`).join(',')}) AS k(code)
           WHERE NOT EXISTS (SELECT 1 FROM public.subjects s WHERE s.code = k.code)
           ORDER BY 1`,
    expect: empty,
    hint: 'A missing code aborts 20260814000018 step 3 on plan_subject_access_subject_code_fkey AND 20260814000019 step 1. INSERT the subjects row; do not shrink the keep-set.',
  },
  {
    id: 'PF-6', migration: '20260814000020', severity: 'blocking',
    title: 'every column the ACL grants already exists',
    sql: `SELECT c FROM UNNEST(ARRAY[${ACL_ALLOWLIST.map((c) => `'${c}'`).join(',')}]) AS c
           WHERE NOT EXISTS (SELECT 1 FROM information_schema.columns
                              WHERE table_schema='public' AND table_name='quiz_session_shuffles'
                                AND column_name = c)`,
    expect: empty,
    hint: 'The GRANT is a LITERAL allowlist; a missing column errors and rolls the whole ACL transaction back. Apply the earlier migration that adds it first (20260504100500 / 20260801100900 / 20260802130000).',
  },
  {
    id: 'PF-7a', migration: '20260814000022', severity: 'blocking',
    title: 'exactly one submit_quiz_results_v2 overload, with the 11-arg signature',
    sql: `SELECT p.oid::regprocedure::text FROM pg_proc p
           WHERE p.pronamespace='public'::regnamespace AND p.proname='submit_quiz_results_v2'
           ORDER BY 1`,
    expect: (rows) => {
      const want = 'submit_quiz_results_v2(uuid,uuid,text,text,text,integer,jsonb,integer,uuid,integer,integer)';
      if (rows.length !== 1) {
        return `expected exactly 1 overload, got ${rows.length}: ${preview(rows)} — CREATE OR REPLACE would add a NEW overload and every caller then hits an ambiguity error`;
      }
      const got = rows[0][0].replace(/\s+/g, '');
      return got === want ? null : `signature mismatch — expected ${want}, got ${got}`;
    },
    hint: 'Runbook §2 PF-7.',
  },
  {
    id: 'PF-7b', migration: '20260814000022', severity: 'blocking',
    title: 'chain dependencies of the P0 fix are recorded applied',
    sql: `SELECT v FROM UNNEST(ARRAY['20260801100800','20260801100900','20260809000500']) AS v
           WHERE NOT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations m
                              WHERE m.version = v)`,
    expect: empty,
    hint: '20260801100800 is what makes start_quiz_session write an identity-shuffle/empty-snapshot row for a non-MCQ — the exact server-side marker 20260814000022 keys the written lane off.',
  },
  {
    id: 'PF-9', migration: '20260814000023', severity: 'blocking',
    title: 'the five serving-function signatures 20260814000023 rebuilds all match',
    sql: `SELECT p.oid::regprocedure::text FROM pg_proc p
           WHERE p.pronamespace='public'::regnamespace
             AND p.proname IN (${SERVING_FUNCTIONS_SQL}) ORDER BY 1`,
    expect: (rows) =>
      rows.length === SERVING_OVERLOAD_COUNT
        ? null
        : `expected ${SERVING_OVERLOAD_COUNT} overloads (rag 8-arg, v2 7-arg, get_quiz_questions 4-arg AND 5-arg, start_quiz_session 2-arg), got ${rows.length}: ${preview(rows, 8)}`,
    hint: '20260814000023 is a full-body CREATE OR REPLACE of each. A signature that does not match means the deployed body is not the one it was written against, and CREATE OR REPLACE would ADD an overload instead of replacing. This repo has been burned by exactly that twice (20260702170000, 20260729130000).',
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// POST-APPLY checks
// ─────────────────────────────────────────────────────────────────────────────

const VERIFY_CHECKS = [
  // ── M1 20260814000007 ──────────────────────────────────────────────────────
  {
    id: 'M1-1', migration: '20260814000007', severity: 'blocking',
    title: 'no active subject outside the keep-set',
    sql: `SELECT code FROM public.subjects
           WHERE is_active AND code NOT IN (${KEEP_SQL}) ORDER BY code`,
    expect: empty,
    hint: 'M1 did not land, or a subject was activated out of band after it.',
  },
  {
    id: 'M1-2', migration: '20260814000007', severity: 'blocking',
    title: 'every keep-set code that exists is active (self-heal worked)',
    sql: `SELECT code FROM public.subjects
           WHERE code IN (${KEEP_SQL}) AND is_active IS DISTINCT FROM TRUE ORDER BY code`,
    expect: empty,
    hint: 'M1 re-activates any keep-set code found inactive or NULL. A hit here means it never ran.',
  },
  {
    id: 'M1-3', migration: '20260814000007', severity: 'blocking',
    title: 'at most ONE catalogue audit row (0 is legal — see below)',
    sql: `SELECT count(*) FROM public.admin_audit_log
           WHERE action = 'subject.catalogue.restricted_to_math_science'`,
    expect: (rows) => {
      const n = Number(rows[0]?.[0]?.trim() ?? 'NaN');
      if (Number.isNaN(n)) return 'could not read the count';
      if (n > 1) return `${n} rows — the rollback source is now ambiguous`;
      return null;
    },
    hint: 'NOT assertable as "exactly 1": the INSERT is conditional on the run having changed something (…0007:106-107), so a no-op run writes NO row. That is why the runbook tells you to snapshot subjects.is_active before applying.',
  },

  // ── M2 20260814000008 ──────────────────────────────────────────────────────
  {
    id: 'M2-1', migration: '20260814000008', severity: 'blocking',
    title: 'no out-of-keep-set grade_subject_map row survives',
    sql: `SELECT grade, subject_code, COALESCE(stream,'${NULL_TOKEN}'), COALESCE(board,'${NULL_TOKEN}')
            FROM public.grade_subject_map
           WHERE subject_code NOT IN (${KEEP_SQL}) ORDER BY 1,2,3,4`,
    expect: empty,
    hint: 'M2 step 5 did not run.',
  },
  {
    id: 'M2-2', migration: '20260814000008', severity: 'blocking',
    title: 'grades 11-12 are fully de-streamed',
    sql: `SELECT grade, subject_code, stream FROM public.grade_subject_map
           WHERE grade IN ('11','12') AND stream IS NOT NULL ORDER BY 1,2`,
    expect: empty,
    hint: 'A stream-scoped 11/12 row survived; the UI presents physics+chemistry+biology as ONE grouped "Science" choice and expects stream-NULL rows.',
  },
  {
    id: 'M2-3', migration: '20260814000008', severity: 'blocking',
    title: 'no pre-existing (grade, board) pair is left with zero subjects',
    sql: `WITH pairs AS (
            SELECT DISTINCT grade, board FROM public.grade_subject_map
            UNION
            SELECT DISTINCT grade, board FROM public.grade_subject_map_archive_20260814)
          SELECT p.grade, COALESCE(p.board,'${NULL_TOKEN}') FROM pairs p
           WHERE NOT EXISTS (SELECT 1 FROM public.grade_subject_map g
                              WHERE g.grade = p.grade AND g.board IS NOT DISTINCT FROM p.board)
           ORDER BY 1,2`,
    expect: empty,
    hint: 'Students on a listed pair see an EMPTY subject list with no error anywhere. M2 asserts this in-transaction; a hit post-apply means someone deleted rows afterwards.',
  },
  {
    id: 'M2-4', migration: '20260814000008', severity: 'blocking',
    title: 'every pre-existing 11/12 pair has math+physics+chemistry+biology, stream NULL',
    sql: `WITH pairs AS (
            SELECT DISTINCT grade, board FROM public.grade_subject_map
            UNION
            SELECT DISTINCT grade, board FROM public.grade_subject_map_archive_20260814),
               want(code) AS (VALUES ('math'),('physics'),('chemistry'),('biology'))
          SELECT p.grade, COALESCE(p.board,'${NULL_TOKEN}'), w.code
            FROM pairs p CROSS JOIN want w
           WHERE p.grade IN ('11','12')
             AND NOT EXISTS (SELECT 1 FROM public.grade_subject_map g
                              WHERE g.grade = p.grade AND g.board IS NOT DISTINCT FROM p.board
                                AND g.subject_code = w.code AND g.stream IS NULL)
           ORDER BY 1,2,3`,
    expect: empty,
    hint: 'M2 step 4 re-seeds these. NOTE: is_core is deliberately NOT asserted — step 4 is ON CONFLICT DO NOTHING, so a pre-existing row keeps its own is_core and the post-state is not derivable from source.',
  },
  {
    id: 'M2-5', migration: '20260814000008', severity: 'blocking',
    title: 'archive table exists with RLS on and service-role-only reach',
    sql: `SELECT c.relrowsecurity,
                 has_table_privilege('authenticated','public.grade_subject_map_archive_20260814','SELECT'),
                 has_table_privilege('anon','public.grade_subject_map_archive_20260814','SELECT'),
                 has_table_privilege('service_role','public.grade_subject_map_archive_20260814','SELECT')
            FROM pg_class c WHERE c.oid = 'public.grade_subject_map_archive_20260814'::regclass`,
    expect: boolsAre(['t', 'f', 'f', 't']),
    hint: 'P8: RLS in the same migration. This table is the M2 rollback source of truth.',
  },
  {
    id: 'M2-6', migration: '20260814000008', severity: 'blocking',
    title: 'exactly one grade-map audit row',
    sql: `SELECT count(*) FROM public.admin_audit_log
           WHERE action = 'subject.grade_map.restricted_and_destreamed'`,
    expect: scalarIs(1),
    hint: 'Guarded by NOT EXISTS on the action code, so exactly 1 IS the derivable post-state (unlike M1-3).',
  },

  // ── M4 20260814000009 ──────────────────────────────────────────────────────
  {
    id: 'M4-1', migration: '20260814000009', severity: 'blocking',
    title: 'pass-1 residual: no enrollment on a dead or inactive subject',
    sql: `SELECT sse.student_id, sse.subject_code
            FROM public.student_subject_enrollment sse
            LEFT JOIN public.subjects sub ON sub.code = sse.subject_code
           WHERE sub.code IS NULL OR sub.is_active IS DISTINCT FROM TRUE
           ORDER BY 1,2`,
    expect: empty,
    hint: 'The repair function is self-extinguishing: after a clean run this must be empty. Use THIS, not get_subject_violations, if 20260814000011 is not applied yet.',
  },
  {
    id: 'M4-2', migration: '20260814000009', severity: 'blocking',
    title: 'pass-2 residual: enrollment-less students carrying a dead code',
    sql: `SELECT s.id FROM public.students s
           WHERE COALESCE(array_length(s.selected_subjects,1),0) > 0
             AND NOT EXISTS (SELECT 1 FROM public.student_subject_enrollment sse
                              WHERE sse.student_id = s.id)
             AND EXISTS (SELECT 1 FROM UNNEST(s.selected_subjects) AS c
                          WHERE NOT EXISTS (SELECT 1 FROM public.subjects sub
                                             WHERE sub.code = c AND sub.is_active))
           ORDER BY 1`,
    expect: empty,
    hint: 'The class the LEGACY archive_dead_subject_enrollments() structurally cannot see (its driving query starts with JOIN student_subject_enrollment).',
  },
  {
    id: 'M4-3', migration: '20260814000009', severity: 'blocking',
    title: 'pass-3 residual: preferred_subject normalised',
    sql: `SELECT s.id, s.preferred_subject FROM public.students s
           WHERE s.preferred_subject IS NOT NULL
             AND (s.preferred_subject = 'Mathematics'
                  OR NOT EXISTS (SELECT 1 FROM public.subjects sub
                                  WHERE sub.code = s.preferred_subject AND sub.is_active))
           ORDER BY 1`,
    expect: empty,
    hint: "'Mathematics' is the baseline column DEFAULT — a display name that matches no subjects.code row. NULL is a legitimate not-yet-chosen state and is correctly left alone.",
  },
  {
    id: 'M4-4', migration: '20260814000009', severity: 'blocking',
    title: 'repair function is SECURITY DEFINER, service-role EXECUTE only',
    sql: `SELECT p.prosecdef,
                 has_function_privilege('anon', p.oid, 'EXECUTE'),
                 has_function_privilege('authenticated', p.oid, 'EXECUTE'),
                 has_function_privilege('service_role', p.oid, 'EXECUTE')
            FROM pg_proc p
           WHERE p.pronamespace='public'::regnamespace
             AND p.proname='archive_inactive_subject_enrollments'`,
    expect: boolsAre(['t', 'f', 'f', 't']),
    hint: 'SECURITY DEFINER is required (it repairs every tenant row, not just the caller RLS-visible ones) — which is exactly why anon/authenticated must hold no EXECUTE.',
  },
  {
    id: 'M4-5', migration: '20260814000009', severity: 'advisory',
    title: 'students NEITHER repair pass covers (stale selected_subjects)',
    sql: `SELECT count(*) FROM public.students s
           WHERE EXISTS (SELECT 1 FROM public.student_subject_enrollment sse
                          WHERE sse.student_id = s.id)
             AND EXISTS (SELECT 1 FROM UNNEST(COALESCE(s.selected_subjects, ARRAY[]::TEXT[])) AS c
                          WHERE NOT EXISTS (SELECT 1 FROM public.subjects sub
                                             WHERE sub.code = c AND sub.is_active))`,
    expect: (rows) => {
      const n = Number(rows[0]?.[0]?.trim() ?? 'NaN');
      if (Number.isNaN(n)) return 'could not read the count';
      return n === 0
        ? null
        : `${n} student(s) keep a stale denormalised selected_subjects array — a source-derived GAP in 20260814000009, not a failed apply. Report to backend; do not hand-patch during a release.`;
    },
    hint: 'Pass 1 needs an inactive/dangling enrollment row; pass 2 needs ZERO enrollment rows. A student with all-active enrollments plus one stale array entry is invisible to both.',
  },

  // ── M5 20260814000010 ──────────────────────────────────────────────────────
  {
    id: 'M5-1', migration: '20260814000010', severity: 'blocking',
    title: 'write gate: subject_not_active present, SECURITY INVOKER, pinned search_path',
    sql: `SELECT p.prosecdef,
                 position('subject_not_active' IN pg_get_functiondef(p.oid)) > 0,
                 (array_to_string(p.proconfig, ',') LIKE '%search_path=%')
            FROM pg_proc p
           WHERE p.pronamespace='public'::regnamespace
             AND p.proname='enforce_subject_enrollment'`,
    expect: boolsAre(['f', 't', 't']),
    hint: 'It is a validation trigger and must NOT be SECURITY DEFINER. CREATE OR REPLACE discards SET clauses, so a missing search_path silently reverts 20260516010000 hardening.',
  },
  {
    id: 'M5-2', migration: '20260814000010', severity: 'blocking',
    title: 'the trigger still points at the replaced function',
    sql: `SELECT count(*) FROM pg_trigger t
           WHERE t.tgrelid = 'public.student_subject_enrollment'::regclass
             AND t.tgfoid  = 'public.enforce_subject_enrollment'::regproc
             AND NOT t.tgisinternal`,
    expect: scalarIs(1),
    hint: 'trg_enforce_subject_enrollment (BEFORE INSERT OR UPDATE) pre-exists from the baseline and is NOT recreated by the migration.',
  },

  // ── M6 20260814000011 ──────────────────────────────────────────────────────
  {
    id: 'M6-1', migration: '20260814000011', severity: 'blocking',
    title: 'violations RPC is is_active-aware, DEFINER, service-role only',
    sql: `SELECT p.prosecdef,
                 position('sub.is_active' IN pg_get_functiondef(p.oid)) > 0,
                 has_function_privilege('anon', p.oid, 'EXECUTE'),
                 has_function_privilege('authenticated', p.oid, 'EXECUTE'),
                 has_function_privilege('service_role', p.oid, 'EXECUTE')
            FROM pg_proc p
           WHERE p.pronamespace='public'::regnamespace
             AND p.proname='get_subject_violations'`,
    expect: boolsAre(['t', 't', 'f', 'f', 't']),
    hint: 'Without the is_active join this RPC reports ZERO violations while violations are real — a clean dashboard over a dirty database.',
  },
  {
    id: 'M6-2', migration: '20260814000011', severity: 'advisory',
    title: 'what the now-meaningful violations RPC reports',
    sql: 'SELECT count(*) FROM public.get_subject_violations(NULL, NULL, NULL, 1000, 0)',
    expect: (rows) => {
      const n = Number(rows[0]?.[0]?.trim() ?? 'NaN');
      if (Number.isNaN(n)) return 'could not read the count';
      return n === 0
        ? null
        : `${n} flagged student(s). NOT necessarily a failure: with M4-1 green the CATALOGUE lane is clean, so these are grade/stream or plan violations (e.g. a grade-9 student enrolled in physics, which is active but mapped only at 11-12). Triage, do not block.`;
    },
    hint: '"0" is NOT a derivable post-state — the RPC also flags active-but-unmapped and active-but-ungranted subjects.',
  },

  // ── M3 20260814000018 (PRICING) ────────────────────────────────────────────
  {
    id: 'M3-0', migration: '20260814000018', severity: 'blocking',
    title: 'anti-vacuous guard: at least one plan_code exists',
    sql: `SELECT count(*) FROM (
            SELECT plan_code FROM public.subscription_plans
            UNION SELECT plan_code FROM public.plan_subject_access) x`,
    expect: (rows) => {
      const n = Number(rows[0]?.[0]?.trim() ?? 'NaN');
      if (Number.isNaN(n)) return 'could not read the count';
      return n > 0
        ? null
        : 'ZERO plan codes — M3-1 would pass vacuously (the migration documents this at …0018:237-240). On a seeded DB expect free/starter/pro/unlimited.';
    },
    hint: 'A "no plans to strand" pass is not a pass on a production database.',
  },
  {
    id: 'M3-1', migration: '20260814000018', severity: 'blocking',
    title: 'every plan holds exactly 5 grant rows',
    sql: `WITH plan_codes AS (
            SELECT plan_code FROM public.subscription_plans
            UNION SELECT plan_code FROM public.plan_subject_access)
          SELECT p.plan_code,
                 (SELECT count(*) FROM public.plan_subject_access psa
                   WHERE psa.plan_code = p.plan_code)
            FROM plan_codes p
           WHERE (SELECT count(*) FROM public.plan_subject_access psa
                   WHERE psa.plan_code = p.plan_code) <> 5
           ORDER BY 1`,
    expect: empty,
    hint: 'With M3-2 green, "exactly 5" is equivalent to "exactly the keep-set" (the PK makes (plan_code, subject_code) unique).',
  },
  {
    id: 'M3-2', migration: '20260814000018', severity: 'blocking',
    title: 'and those grants ARE the keep-set',
    sql: `SELECT plan_code, subject_code FROM public.plan_subject_access
           WHERE subject_code NOT IN (${KEEP_SQL}) ORDER BY 1,2`,
    expect: empty,
    hint: 'Step 2 drops every out-of-keep-set grant. A hit means step 2 did not run.',
  },
  {
    id: 'M3-3', migration: '20260814000018', severity: 'blocking',
    title: 'the subject-count cap is removed on every plan',
    sql: 'SELECT plan_code, max_subjects FROM public.subscription_plans WHERE max_subjects IS NOT NULL ORDER BY 1',
    expect: empty,
    hint: 'NULL is the "unlimited" sentinel set_student_subjects already understands (IF v_max IS NOT NULL AND v_count > v_max).',
  },
  {
    id: 'M3-4', migration: '20260814000018', severity: 'blocking',
    title: 'exactly one pricing audit row, carrying BOTH rollback payloads',
    sql: `SELECT count(*) FROM public.admin_audit_log
           WHERE action = 'subject.plan_access.restricted_to_math_science'
             AND details ? 'plan_subject_access_before'
             AND details ? 'max_subjects_before'`,
    expect: scalarIs(1),
    hint: 'Written BEFORE any mutation and NOT EXISTS-guarded, so it is the only record of the pre-change pricing state. Without it M3 cannot be rolled back.',
  },

  // ── M8 20260814000019 ──────────────────────────────────────────────────────
  {
    id: 'M8-1', migration: '20260814000019', severity: 'blocking',
    title: 'no teacher differs from their active-subject intersection',
    sql: `SELECT t.id FROM public.teachers t
            LEFT JOIN LATERAL (
              SELECT ARRAY_AGG(u.c ORDER BY u.ord) AS after_codes
                FROM UNNEST(COALESCE(t.subjects_taught, ARRAY[]::TEXT[]))
                     WITH ORDINALITY AS u(c, ord)
               WHERE EXISTS (SELECT 1 FROM public.subjects sub
                              WHERE sub.code = u.c AND sub.is_active)) agg ON TRUE
           WHERE COALESCE(t.subjects_taught, ARRAY[]::TEXT[])
                 IS DISTINCT FROM COALESCE(agg.after_codes, ARRAY[]::TEXT[])
           ORDER BY 1`,
    expect: empty,
    hint: 'Exactly the migration step-2 predicate, which is self-extinguishing — non-empty means the trim did not run.',
  },
  {
    id: 'M8-2', migration: '20260814000019', severity: 'blocking',
    title: 'teacher archive table: RLS on, service-role-only reach',
    sql: `SELECT c.relrowsecurity,
                 has_table_privilege('authenticated','public.teacher_subjects_taught_archive_20260814','SELECT'),
                 has_table_privilege('anon','public.teacher_subjects_taught_archive_20260814','SELECT'),
                 has_table_privilege('service_role','public.teacher_subjects_taught_archive_20260814','SELECT')
            FROM pg_class c
           WHERE c.oid = 'public.teacher_subjects_taught_archive_20260814'::regclass`,
    expect: boolsAre(['t', 'f', 'f', 't']),
    hint: 'legacy_subjects_archive was deliberately NOT reused (it is student-keyed with an FK to students(id)).',
  },
  {
    id: 'M8-3', migration: '20260814000019', severity: 'blocking',
    title: 'exactly one teacher-trim audit row',
    sql: `SELECT count(*) FROM public.admin_audit_log
           WHERE action = 'subject.teacher_subjects.trimmed'`,
    expect: scalarIs(1),
    hint: 'On a re-run the temp table is empty; an unguarded INSERT would append a 0/0 row and destroy the support hand-off signal. The guard prevents that.',
  },
  {
    id: 'M8-4', migration: '20260814000019', severity: 'advisory',
    title: 'THE RECONCILIATION — must equal PF-4 would_be_left_with_zero',
    sql: `SELECT details->>'teachers_trimmed', details->>'teachers_left_with_zero',
                 details->>'teachers_left_with_zero_live', details->>'teachers_partially_trimmed'
            FROM public.admin_audit_log
           WHERE action = 'subject.teacher_subjects.trimmed'`,
    expect: (rows) => {
      if (rows.length !== 1) return `expected exactly one audit row, got ${rows.length}`;
      const [trimmed, zero, zeroLive, partial] = rows[0].map((v) => v.trim());
      return `COMPARE WITH PF-4 → trimmed=${trimmed} left_with_zero=${zero} left_with_zero_live=${zeroLive} partially_trimmed=${partial}. left_with_zero MUST equal PF-4 would_be_left_with_zero; a disagreement means the catalogue changed between the two runs — STOP and reconcile. left_with_zero_live is the SUPPORT HAND-OFF NUMBER.`;
    },
    hint: 'This script cannot compare across two runs; the operator must. Runbook §4 M8-4.',
  },

  // ── 20260814000020 — answer-key ACL ────────────────────────────────────────
  {
    id: 'ACL-1', migration: '20260814000020', severity: 'blocking',
    title: 'THE DENY: no client role can SELECT either answer-key column',
    sql: `SELECT ${['authenticated', 'anon']
      .flatMap((role) => ANSWER_KEY_COLUMNS
        .map((col) => `has_column_privilege('${role}','${SHUFFLES}','${col}','SELECT')`))
      .join(', ')}`,
    expect: boolsAre(['f', 'f', 'f', 'f']),
    hint: 'A TRUE here is the live production leak: any signed-in student can read the correct answer for every question of a quiz they have not yet submitted (defeats P3, makes the P1 score meaningless). Columns, in order: authenticated/idx, authenticated/hash, anon/idx, anon/hash.',
  },
  {
    id: 'ACL-2', migration: '20260814000020', severity: 'blocking',
    title: 'server-side scoring and forensics KEEP the key',
    sql: `SELECT ${ANSWER_KEY_COLUMNS
      .map((col) => `has_column_privilege('service_role','${SHUFFLES}','${col}','SELECT')`)
      .join(', ')}`,
    expect: boolsAre(['t', 't']),
    hint: 'The WhatsApp daily6 grader and public.marking_audit_last_30d read the key as service_role. Losing it breaks both.',
  },
  {
    id: 'ACL-3', migration: '20260814000020', severity: 'blocking',
    title: 'the resume path survives: all TEN granted columns readable',
    sql: `SELECT c FROM UNNEST(ARRAY[${ACL_ALLOWLIST.map((c) => `'${c}'`).join(',')}]) AS c
           WHERE NOT has_column_privilege('authenticated','${SHUFFLES}',c,'SELECT')`,
    expect: empty,
    hint: "Includes options_version_at_serve, which the migration's OWN post-condition omits (it asserts 9 of the 10 it grants). That gap is architect-owned and pinned by the REG-380 static lane; this check closes it operationally.",
  },
  {
    id: 'ACL-4', migration: '20260814000020', severity: 'blocking',
    title: 'no client-role writes; anon holds nothing at all',
    sql: `SELECT has_table_privilege('authenticated','${SHUFFLES}','INSERT'),
                 has_table_privilege('authenticated','${SHUFFLES}','UPDATE'),
                 has_table_privilege('authenticated','${SHUFFLES}','DELETE'),
                 has_any_column_privilege('anon','${SHUFFLES}','SELECT')`,
    expect: boolsAre(['f', 'f', 'f', 'f']),
    hint: 'RLS already denied these (the table has no INSERT/UPDATE/DELETE policy); the privilege layer now agrees. A future student write policy MUST re-GRANT the verb explicitly.',
  },

  // ── 20260814000021 — session_mode ──────────────────────────────────────────
  {
    id: 'SM-1', migration: '20260814000021', severity: 'blocking',
    title: 'session_mode column exists, nullable, with its CHECK',
    sql: `SELECT (SELECT count(*) FROM information_schema.columns
                   WHERE table_schema='public' AND table_name='quiz_session_shuffles'
                     AND column_name='session_mode' AND is_nullable='YES'),
                 (SELECT count(*) FROM pg_constraint
                   WHERE conname='quiz_session_shuffles_session_mode_check'
                     AND conrelid='${SHUFFLES}'::regclass)`,
    expect: (rows) => {
      if (rows.length !== 1) return `expected one row, got ${rows.length}`;
      const [col, chk] = rows[0].map((v) => v.trim());
      if (col !== '1') return 'session_mode is missing or is NOT NULL (it must stay nullable — existing rows must not be retro-labelled with a guess)';
      if (chk !== '1') return 'the CHECK constraint is missing — an arbitrary string could be stored as an instrument';
      return null;
    },
    hint: "Closed vocabulary: practice | cognitive | exam, or NULL. NULL means 'not recorded' and the resume path treats it as NOT resumable (fail-closed). Do not backfill.",
  },
  {
    id: 'SM-2', migration: '20260814000021', severity: 'blocking',
    title: 'session_mode readable by the caller-role resume path; key still denied',
    sql: `SELECT has_column_privilege('authenticated','${SHUFFLES}','session_mode','SELECT'),
                 has_column_privilege('service_role','${SHUFFLES}','session_mode','SELECT'),
                 has_column_privilege('anon','${SHUFFLES}','session_mode','SELECT'),
                 has_column_privilege('authenticated','${SHUFFLES}','correct_answer_index_snapshot','SELECT')`,
    expect: boolsAre(['t', 't', 'f', 'f']),
    hint: 'If authenticated cannot read session_mode, the /today exam-resume suppression fails OPEN and a timed exam resumes as an untimed one. Column 4 is the regression guard for 20260814000020.',
  },

  // ── 20260814000022 — written-answer scoring (P0) ───────────────────────────
  {
    id: 'WA-1', migration: '20260814000022', severity: 'blocking',
    title: 'P0: submit_quiz_results_v2 carries the written lane, one overload, anon denied',
    sql: `SELECT p.oid::regprocedure::text,
                 position('v_is_written' IN pg_get_functiondef(p.oid)) > 0,
                 position('v_marks_possible * 0.5' IN pg_get_functiondef(p.oid)) > 0,
                 has_function_privilege('anon', p.oid, 'EXECUTE'),
                 has_function_privilege('authenticated', p.oid, 'EXECUTE'),
                 has_function_privilege('service_role', p.oid, 'EXECUTE')
            FROM pg_proc p
           WHERE p.pronamespace='public'::regnamespace
             AND p.proname='submit_quiz_results_v2'`,
    expect: (rows) => {
      const want = 'submit_quiz_results_v2(uuid,uuid,text,text,text,integer,jsonb,integer,uuid,integer,integer)';
      if (rows.length !== 1) return `expected exactly 1 overload, got ${rows.length}: ${preview(rows)}`;
      const [sig, written, rule, anon, auth, svc] = rows[0].map((v) => v.trim());
      const bad = [];
      if (sig.replace(/\s+/g, '') !== want) bad.push(`signature: expected ${want}, got ${sig}`);
      if (written !== 't') bad.push('the written lane (v_is_written) is absent — the P0 is NOT fixed');
      if (rule !== 't') bad.push('the >= 50%-of-marks rule is absent');
      if (anon !== 'f') bad.push('anon holds EXECUTE');
      if (auth !== 't') bad.push('authenticated lost EXECUTE — every web/mobile submit breaks');
      if (svc !== 't') bad.push('service_role lost EXECUTE');
      return bad.length === 0 ? null : bad.join('; ');
    },
    hint: 'Static proof only. The real acceptance is WA-2 in the runbook: submit a real MIXED quiz and a real PURE-WRITTEN quiz end to end in the browser. The pure-written case additionally needs the client half (collectSessionQuestionIds) shipped in the same release.',
  },

  // ── 20260814000023 — keyless serving + server-side P6 ──────────────────────
  {
    id: 'K-1', migration: '20260814000023', severity: 'blocking',
    title: 'question_bank_p6_valid exists: IMMUTABLE, SECURITY INVOKER, both roles',
    sql: `SELECT (p.provolatile = 'i'), p.prosecdef,
                 has_function_privilege('authenticated', p.oid, 'EXECUTE'),
                 has_function_privilege('service_role',  p.oid, 'EXECUTE')
            FROM pg_proc p
           WHERE p.pronamespace='public'::regnamespace
             AND p.proname='question_bank_p6_valid'`,
    expect: boolsAre(['t', 'f', 't', 't']),
    hint: 'It is a pure predicate over VALUES it is HANDED — it reads no table, so it must NOT be SECURITY DEFINER (that would make it a potential back-door read) and IMMUTABLE is what lets it sit in a WHERE clause on the hot serve path.',
  },
  {
    id: 'K-2', migration: '20260814000023', severity: 'blocking',
    title: "THE DENY: no serving RPC emits a 'correct_answer_index' JSON member",
    sql: `SELECT p.oid::regprocedure::text FROM pg_proc p
           WHERE p.pronamespace='public'::regnamespace
             AND p.proname IN (${SERVING_FUNCTIONS_SQL})
             AND position('''correct_answer_index''' IN p.prosrc) > 0
           ORDER BY 1`,
    expect: empty,
    hint: "Probes the QUOTED literal (a jsonb_build_object key in prosrc), not the bare identifier — the bare word legitimately survives as an ARGUMENT to question_bank_p6_valid. A hit means a student calling that RPC for their own grade+subject still harvests answer keys.",
  },
  {
    id: 'K-3', migration: '20260814000023', severity: 'blocking',
    title: 'every serving overload survived AND calls the P6 predicate',
    sql: `SELECT p.oid::regprocedure::text,
                 position('question_bank_p6_valid' IN p.prosrc) > 0
            FROM pg_proc p
           WHERE p.pronamespace='public'::regnamespace
             AND p.proname IN (${SERVING_FUNCTIONS_SQL})
           ORDER BY 1`,
    expect: (rows) => {
      const bad = [];
      if (rows.length !== SERVING_OVERLOAD_COUNT) {
        bad.push(`expected ${SERVING_OVERLOAD_COUNT} overloads, got ${rows.length} (both get_quiz_questions overloads must survive)`);
      }
      for (const r of rows) {
        if (r[1].trim() !== 't') bad.push(`${r[0]} does not call question_bank_p6_valid — P6 is unenforced on that path`);
      }
      return bad.length === 0 ? null : bad.join('; ');
    },
    hint: 'start_quiz_session is the single checkpoint every direct-question_bank student path funnels through (deep link ?qid=, SRS review, PYQ preferred fetch, adaptive candidate provider, v1 fallback). Losing its gate un-gates all of them at once.',
  },
  {
    id: 'K-4', migration: '20260814000023', severity: 'blocking',
    title: 'P1 substrate intact: start_quiz_session still SNAPSHOTS the key; anon denied on check_formative_answer',
    sql: `SELECT (SELECT position('correct_answer_index_snapshot' IN p.prosrc) > 0
                    FROM pg_proc p
                   WHERE p.pronamespace='public'::regnamespace
                     AND p.proname='start_quiz_session'),
                 has_function_privilege('anon','public.check_formative_answer(uuid,integer)','EXECUTE'),
                 has_function_privilege('authenticated','public.check_formative_answer(uuid,integer)','EXECUTE')`,
    expect: boolsAre(['t', 'f', 't']),
    hint: 'Column 1 is the critical one: if start_quiz_session stopped snapshotting the key, submit_quiz_results_v2 would have NOTHING to grade against and P1 would be silently broken for every quiz.',
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Offline (static) lane — runs with or without a database
// ─────────────────────────────────────────────────────────────────────────────

function staticChecks() {
  const results = [];
  let present;
  try {
    present = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql'));
  } catch (e) {
    return [{
      id: 'ST-0', severity: 'blocking', title: 'migrations directory is readable',
      status: 'FAIL', detail: `cannot read ${MIGRATIONS_DIR}: ${e.message}`,
    }];
  }

  const missing = MIGRATION_SET.filter((f) => !present.includes(f));
  results.push({
    id: 'ST-1', severity: 'blocking',
    title: 'every covered migration file is present on disk',
    status: missing.length === 0 ? 'PASS' : 'FAIL',
    detail: missing.length === 0 ? `${MIGRATION_SET.length} files` : `missing: ${missing.join(', ')}`,
  });

  const sorted = [...MIGRATION_SET].sort();
  results.push({
    id: 'ST-2', severity: 'blocking',
    title: 'the documented apply order is the version-sort order (what db push uses)',
    status: sorted.join('|') === MIGRATION_SET.join('|') ? 'PASS' : 'FAIL',
    detail: sorted.join('|') === MIGRATION_SET.join('|')
      ? 'in order'
      : `sort order differs: ${sorted.join(', ')}`,
  });

  const notTransactional = [];
  for (const f of MIGRATION_SET) {
    if (missing.includes(f)) continue;
    const body = fs.readFileSync(path.join(MIGRATIONS_DIR, f), 'utf8').replace(/\r/g, '');
    const begins = (body.match(/^\s*BEGIN;/gm) ?? []).length;
    const commits = (body.match(/^COMMIT;/gm) ?? []).length;
    if (begins !== 1 || commits !== 1) notTransactional.push(`${f} (BEGIN×${begins}, COMMIT×${commits})`);
  }
  results.push({
    id: 'ST-3', severity: 'blocking',
    title: 'each migration is a single BEGIN; … COMMIT; transaction (so an assertion aborts cleanly)',
    status: notTransactional.length === 0 ? 'PASS' : 'FAIL',
    detail: notTransactional.length === 0 ? `all ${MIGRATION_SET.length}` : notTransactional.join('; '),
  });

  // ST-4 detects a migration appended AFTER this gate's tail. Since 2026-08-11
  // that is no longer sufficient on its own: the renumber left a HOLE at
  // 0012-0017, and anything landing IN the hole sorts BELOW the tail, so ST-4
  // cannot see it. ST-5 below covers the hole. Keep both.
  const newer = present
    .filter((f) => f > MIGRATION_SET[MIGRATION_SET.length - 1] && /^2026081400\d{4}_/.test(f));
  results.push({
    id: 'ST-4', severity: 'advisory',
    title: 'no newer 20260814* migration has appeared outside this gate',
    status: newer.length === 0 ? 'PASS' : 'WARN',
    detail: newer.length === 0
      ? 'none'
      : `NOT covered by this gate — read them and extend MIGRATION_SET + the runbook: ${newer.join(', ')}`,
  });

  // ST-5 — THE COLLISION TRIPWIRE. Any 20260814* file on disk that this gate does
  // not name, at ANY position, including the 0012-0017 hole the 2026-08-11
  // renumber deliberately left empty.
  //
  // Why this is blocking and ST-4 is advisory: a file appearing in the hole is
  // the exact failure mode the renumber existed to prevent. `supabase db push`
  // records applied migrations by numeric version prefix ALONE, so two different
  // files at one version means the second is skipped with NO ERROR — the failure
  // is invisible at apply time, which is precisely why it has to be caught here.
  // If this fires, do NOT renumber to make it green without first checking every
  // branch (`git ls-tree` across `git branch --list`) for what else claims that
  // version.
  // Scoped to this gate's own version WINDOW — from its lowest version upward.
  // 20260814000000-06 are a separate, pre-existing set this runbook never
  // covered; flagging them would be noise that trains operators to ignore ST-5.
  const windowStart = MIGRATION_SET[0].slice(0, 14);
  const unknown = present.filter(
    (f) => /^2026081400\d{4}_/.test(f)
      && f.slice(0, 14) >= windowStart
      && !MIGRATION_SET.includes(f),
  );
  results.push({
    id: 'ST-5', severity: 'blocking',
    title: `no unaccounted-for 20260814* migration at or above ${windowStart} (incl. the 0012-0017 hole)`,
    status: unknown.length === 0 ? 'PASS' : 'FAIL',
    detail: unknown.length === 0
      ? `${MIGRATION_SET.length} covered, none unaccounted for`
      : `UNACCOUNTED FOR: ${unknown.join(', ')} — these are NOT verified by this gate. `
        + 'If any sits at 0012-0017 it is another branch\'s file that has been merged in; '
        + 'confirm it does not collide with a version this gate already claims.',
  });

  return results;
}

// ─────────────────────────────────────────────────────────────────────────────
// Runner
// ─────────────────────────────────────────────────────────────────────────────

function parseArgs() {
  const argv = process.argv.slice(2);
  const unknown = argv.filter((a) => !['--preflight', '--offline', '--json', '--help', '-h'].includes(a));
  return {
    preflight: argv.includes('--preflight'),
    offline: argv.includes('--offline'),
    json: argv.includes('--json'),
    help: argv.includes('--help') || argv.includes('-h'),
    unknown,
  };
}

function usage() {
  console.log(`
verify-20260814-migrations — deploy gate for migrations 20260814000007..11 + ..18..23
Runbook: ${RUNBOOK}

  node scripts/verify-20260814-migrations.mjs              post-apply verification
  node scripts/verify-20260814-migrations.mjs --preflight  run BEFORE supabase db push
  node scripts/verify-20260814-migrations.mjs --offline    static checks only (NOT a gate)
  node scripts/verify-20260814-migrations.mjs --json       machine-readable output

Database channel: psql on PATH + DB_URL | SUPABASE_DB_URL | DATABASE_URL.

Exit codes
  0  every blocking check ran and passed
  1  a blocking check FAILED
  2  usage / internal error
  3  no database reachable — NOTHING was verified (never a silent pass)
`.trim());
}

function main() {
  const args = parseArgs();
  if (args.help) { usage(); process.exit(0); }
  if (args.unknown.length > 0) {
    console.error(`unknown argument(s): ${args.unknown.join(', ')}`);
    usage();
    process.exit(2);
  }

  const lane = args.preflight ? 'PRE-FLIGHT' : 'POST-APPLY';
  const checks = args.preflight ? PREFLIGHT_CHECKS : VERIFY_CHECKS;
  const results = staticChecks();

  const conn = resolveConnString();
  const havePsql = psqlAvailable();
  const dbReachable = Boolean(conn) && havePsql && !args.offline;

  if (dbReachable) {
    const probe = runSql(conn, 'SELECT 1');
    if (probe.error) {
      results.push({
        id: 'DB-0', severity: 'blocking', title: 'database connection',
        status: 'FAIL', detail: probe.error,
      });
      report(results, checks, lane, args.json, 'connect-failed');
      process.exit(3);
    }
    for (const c of checks) {
      const r = runSql(conn, c.sql);
      if (r.error) {
        results.push({ ...c, status: 'ERROR', detail: r.error });
        continue;
      }
      const detail = c.expect(r.rows);
      if (detail === null) {
        results.push({ ...c, status: 'PASS', detail: `${r.rows.length} row(s)` });
      } else if (c.severity === 'advisory') {
        results.push({ ...c, status: 'INFO', detail });
      } else {
        results.push({ ...c, status: 'FAIL', detail });
      }
    }
  } else {
    for (const c of checks) {
      results.push({ ...c, status: 'UNVERIFIED', detail: 'no database channel' });
    }
  }

  const reason = args.offline
    ? 'offline mode requested'
    : !conn
      ? 'no connection string in DB_URL / SUPABASE_DB_URL / DATABASE_URL'
      : !havePsql
        ? 'psql is not on PATH'
        : null;

  report(results, checks, lane, args.json, reason);

  const failed = results.filter((r) => r.status === 'FAIL' || r.status === 'ERROR');
  if (failed.length > 0) process.exit(1);
  if (!dbReachable && !args.offline) process.exit(3);
  process.exit(0);
}

function report(results, checks, lane, asJson, degradedReason) {
  if (asJson) {
    console.log(JSON.stringify({
      lane,
      runbook: RUNBOOK,
      degraded: degradedReason,
      results: results.map(({ id, migration, title, severity, status, detail }) =>
        ({ id, migration, title, severity, status, detail })),
    }, null, 2));
    return;
  }

  console.log(`\nverify-20260814-migrations — ${lane} lane`);
  console.log(`runbook: ${RUNBOOK}`);
  console.log('─'.repeat(78));

  for (const r of results) {
    const tag = { PASS: 'PASS', FAIL: 'FAIL', INFO: 'INFO', WARN: 'WARN', ERROR: 'ERR ', UNVERIFIED: '????' }[r.status];
    const mig = r.migration ? ` [${r.migration}]` : '';
    console.log(`  ${tag}  ${r.id.padEnd(7)}${mig} ${r.title}`);
    if (r.status !== 'PASS' && r.detail) console.log(`         → ${r.detail}`);
    if ((r.status === 'FAIL' || r.status === 'ERROR') && r.hint) console.log(`         ↳ ${r.hint}`);
  }

  const n = (s) => results.filter((r) => r.status === s).length;
  console.log('─'.repeat(78));
  console.log(
    `  ${n('PASS')} passed · ${n('FAIL')} failed · ${n('ERROR')} errored · ` +
    `${n('INFO')} advisory · ${n('WARN')} warn · ${n('UNVERIFIED')} UNVERIFIED`,
  );

  if (degradedReason) {
    const unverified = results.filter((r) => r.status === 'UNVERIFIED');
    console.error('\n' + '='.repeat(78));
    console.error('DEGRADED RUN — THE DATABASE LANE DID NOT EXECUTE.');
    console.error(`reason: ${degradedReason}`);
    if (unverified.length > 0) {
      console.error(`\nThe following ${unverified.length} check(s) were NOT run and are UNKNOWN, not passing:`);
      for (const r of unverified) console.error(`  - ${r.id} [${r.migration}] ${r.title}`);
    }
    console.error(
      '\nTo run them:\n' +
      '  export DB_URL="postgresql://postgres.<ref>:<password>@aws-0-ap-south-1.pooler.supabase.com:5432/postgres"\n' +
      '  node scripts/verify-20260814-migrations.mjs' +
      (lane === 'PRE-FLIGHT' ? ' --preflight' : ''),
    );
    console.error(
      '\nNOTE: the migrations this gate covers are UNEXECUTED and syntax-validated\n' +
      'only. Nothing here has been applied to any database.',
    );
    console.error('='.repeat(78));
  }
}

main();
