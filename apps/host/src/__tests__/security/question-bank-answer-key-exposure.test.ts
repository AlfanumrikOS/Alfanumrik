import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, relative, sep } from 'node:path';

/**
 * R2 / finding C2 — `question_bank` answer key is readable by ANY authenticated
 * user (P1 / P3 / P6 / P8).
 *
 * WHAT IS BROKEN, RIGHT NOW, IN PRODUCTION
 * ========================================
 * `public.question_bank` has RLS enabled (baseline:21665, re-asserted
 * 20260728090000:308) and exactly ONE policy:
 *
 *   question_bank_authenticated_read  FOR SELECT TO authenticated USING (true)
 *                                     (20260728090000:311-312)
 *
 * The baseline pg_dump ships no per-table GRANT and ends with
 * `ALTER DEFAULT PRIVILEGES ... GRANT ALL ON TABLES TO anon, authenticated,
 * service_role` (baseline:22640-22643). PostgreSQL RLS is ROW-level and cannot
 * restrict COLUMNS, so `authenticated` holds a table-level ALL and row
 * visibility is the only gate. Therefore:
 *
 *   GET /rest/v1/question_bank?select=id,correct_answer_index&id=eq.<uuid>
 *
 * returns the answer key for ANY of the ~12.8k questions to ANY signed-in user.
 * This is strictly WIDER than the per-session leak closed by 20260814000020
 * (that one covered a single in-flight session; this one is the whole bank).
 *
 * WHY THERE IS NO ACL MIGRATION YET
 * =================================
 * The fix shape is settled and matches 20260814000020: table-level `REVOKE ALL`
 * from the client roles, then a literal column-level `GRANT SELECT` on the 94
 * non-key columns, withholding the 9 in KEY_COLUMNS below. It cannot ship alone,
 * because consumers read those columns TODAY under the CALLER's role — and one
 * class of them is unfixable by any code change:
 *
 *   mobile/lib/data/repositories/quiz_repository.dart:104 calls `.select()`
 *   with no argument => PostgREST `select=*` => `SELECT question_bank.*`, which
 *   needs SELECT on EVERY column and so fails under ANY column allowlist,
 *   whichever columns are withheld. `useV2` is a COMPILE-TIME constant
 *   defaulting to false (mobile/lib/core/constants/api_constants.dart:61;
 *   mobile/build_apk.sh:93 passes `USE_V2="${USE_V2:-false}"`), so every APK
 *   already installed takes that path. Applying the ACL before a forced mobile
 *   upgrade is a live outage for the installed base.
 *
 * WHAT THIS FILE PINS
 * ===================
 * It is a BLOCKER-INVENTORY canary, not a proof that the hole is closed — the
 * hole is open and this file says so out loud rather than asserting a fiction.
 *
 *   Lane A  The defect is still exactly as described (policy shape + absence of
 *           any table-level REVOKE on question_bank anywhere in the chain).
 *           When someone finally ships the ACL, Lane A goes red and whoever
 *           does it must come here and convert this file into the real
 *           "authenticated is refused 42501" assertion.
 *
 *   Lane B  The exact set of caller-role `question_bank` readers that consume a
 *           withheld column is FROZEN. A new one going red means R2 just got
 *           wider. An old one going red means a blocker was cleared and the
 *           ship set shrank. Either way it is news, and either way it is
 *           reviewed rather than discovered in production.
 *
 *   Lane C  The P1/P4 scoring + serving RPCs stay SECURITY DEFINER. That is the
 *           single property that makes the eventual column ACL safe for
 *           scoring: DEFINER functions execute as the OWNER, so caller-role
 *           ACLs never apply to them. If one of these silently flips to
 *           INVOKER, the ACL stops being safe and this test says so BEFORE the
 *           migration lands.
 *
 * P1/P4 note: nothing in this file executes SQL or touches scoring. It is a
 * static scan of the repo and the migration chain.
 */

const REPO_ROOT = resolve(__dirname, '../../../../..');
const MIGRATIONS = resolve(REPO_ROOT, 'supabase/migrations');

/**
 * The 9 columns of `question_bank` that ARE the answer key, or reconstruct it.
 *
 *   correct_answer_index   the MCQ key (CHECK chk_valid_answer_index 0..3)
 *   correct_answer_text    the same key as text
 *   expected_answer(_hi)   written-answer model answer (question_type_v2 in
 *                          short_answer / long_answer / case_based)
 *   answer_text(_hi)       written-answer key — /api/quiz/ncert-questions:305
 *                          reads it as `modelAnswer` (service-role)
 *   answer_rubric          per-point marking scheme; reconstructs the model
 *                          answer point by point
 *   answer_methodology     names the solution shape
 *   solution_steps         the full worked solution
 *
 * DELIBERATELY NOT LISTED, and this is a known residual rather than an
 * oversight: `explanation` / `explanation_hi` usually NAME the correct option,
 * and are read pre-answer by every client feedback path. `search_vector` is
 * GENERATED from question_text || explanation, so it leaks nothing beyond
 * `explanation`. Withholding those would break the product; closing that vector
 * needs session-gated serving (check_quiz_answer, 20260802130000), not a
 * column list.
 */
const KEY_COLUMNS = [
  'correct_answer_index',
  'correct_answer_text',
  'expected_answer',
  'expected_answer_hi',
  'answer_text',
  'answer_text_hi',
  'answer_rubric',
  'answer_methodology',
  'solution_steps',
] as const;

/**
 * Modules that read `question_bank` through an INJECTED client which every
 * production call site supplies as service-role. They have no `supabaseAdmin`
 * import of their own, so the import heuristic alone would misclassify them as
 * caller-role. Listed explicitly so the classification is auditable rather than
 * accidental.
 */
const SERVICE_ROLE_INJECTED = new Set([
  'packages/lib/src/quiz/post-submit-telemetry.ts', // `admin: SupabaseClient` param
]);

/** Directories scanned for caller-role `question_bank` reads. */
const SCAN_ROOTS = ['packages/lib/src', 'packages/ui/src', 'apps/host/src/app'];

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '__tests__' || entry === '_archive') continue;
    const full = resolve(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full);
  }
  return out;
}

const posix = (p: string) => relative(REPO_ROOT, p).split(sep).join('/');

type Finding = { file: string; select: string; keyColumns: string[]; isStar: boolean };

/**
 * Extract every `.from('question_bank')` read in caller-role code and the
 * column list of the `.select(...)` that follows it, then flag the ones that
 * pull a withheld column or a bare `*`.
 *
 * The select argument may be a concatenation of string literals split across
 * lines (`'a, b, ' + 'c'`), so the literals are stitched before tokenising.
 */
function scanCallerRoleReads(): Finding[] {
  const findings: Finding[] = [];
  for (const root of SCAN_ROOTS) {
    for (const abs of walk(resolve(REPO_ROOT, root))) {
      const src = readFileSync(abs, 'utf8');
      if (!src.includes("from('question_bank')")) continue;

      const rel = posix(abs);
      const usesAdmin = /getSupabaseAdmin|supabaseAdmin/.test(src);
      if (usesAdmin || SERVICE_ROLE_INJECTED.has(rel)) continue;

      // Each read: everything between `.from('question_bank')` and the first
      // chained call that is not `.select(...)`'s argument list.
      const re = /from\('question_bank'\)\s*([\s\S]{0,900}?)(?:\.eq\(|\.in\(|\.not\(|\.is\(|\.limit\(|\.contains\(|\.order\(|\.maybeSingle\(|\.single\(|;)/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(src)) !== null) {
        const tail = m[1];
        const sel = /\.select\(([\s\S]*?)\)\s*$|\.select\(([\s\S]*?)\)/.exec(tail);
        if (!sel) continue;
        let rawArg = (sel[1] ?? sel[2] ?? '').trim();

        // The column list is often a module const (QB_COLUMNS, PYQ_COLUMNS,
        // _questionColumns). Resolve a bare identifier to its declaration in
        // the same file before tokenising — otherwise it reads as an empty
        // argument and gets misreported as `SELECT *`.
        const ident = /^[A-Za-z_$][\w$]*$/.exec(rawArg);
        if (ident) {
          const decl = new RegExp(`\\b(?:const|let|var)\\s+${rawArg}\\s*=([\\s\\S]*?);`).exec(src);
          if (decl) rawArg = decl[1];
        }

        // Drop a trailing options object — `.select('*', { count: 'exact' })`
        // — so its string values are not mistaken for column names.
        rawArg = rawArg.split(/,\s*\{/)[0];

        // Stitch concatenated string literals into one column list.
        const literals = [...rawArg.matchAll(/'([^']*)'|"([^"]*)"/g)].map(x => x[1] ?? x[2]);
        const columns = literals.join('').split(',').map(s => s.trim()).filter(Boolean);

        // `.select()` with no argument, or `.select('*')`, is `SELECT *`.
        const isStar = literals.length === 0 || columns.includes('*');
        const keyColumns = KEY_COLUMNS.filter(k => columns.includes(k));
        if (isStar || keyColumns.length > 0) {
          findings.push({ file: rel, select: columns.join(',') || '*', keyColumns: [...keyColumns], isStar });
        }
      }
    }
  }
  return findings;
}

function rootMigrations(): { name: string; sql: string }[] {
  return readdirSync(MIGRATIONS)
    .filter(f => f.endsWith('.sql'))
    .sort()
    .map(name => ({ name, sql: readFileSync(resolve(MIGRATIONS, name), 'utf8') }));
}

/** Strip `--` line comments so prose about a REVOKE is not mistaken for one. */
const uncommented = (sql: string) =>
  sql.split('\n').map(l => l.replace(/--.*$/, '')).join('\n');

describe('R2 — question_bank answer-key exposure (P1/P3/P6/P8)', () => {
  // ── Lane A: the hole is still open, and shaped exactly as documented ──────
  describe('Lane A — the defect, asserted from the migration chain', () => {
    it('the only SELECT policy on question_bank scoped TO authenticated is USING (true)', () => {
      // Migration 20260814000015 (content-reporter read-only role) added a SECOND,
      // later, SELECT policy on question_bank -- "question_bank_content_reporter_read"
      // FOR SELECT TO content_reporter USING (true). That policy is scoped to a
      // distinct, non-interactive DB role (content_reporter) whose column-level
      // GRANTs withhold every answer-key column (see that migration's section 5.3) --
      // RLS policies for different roles do not OR together across roles, so it adds
      // ZERO visibility for `authenticated` and does not touch R2 at all. Taking the
      // chronologically LAST `CREATE POLICY ... ON question_bank` regardless of role
      // (the original mechanism here) picked up that unrelated addition and went red
      // on a change that never touched the authenticated-role posture this test
      // exists to pin. Filtering to policies scoped `TO authenticated` restores the
      // original intent: still-open R2 is `question_bank_authenticated_read`
      // (20260728090000:311-312), untouched by every migration since (verified by
      // grep -- 20260814000000/20260814000020/20260814000023 only reference it in
      // prose, never redefine it).
      const policies: { migration: string; text: string }[] = [];
      for (const { name, sql } of rootMigrations()) {
        const re = /CREATE POLICY\s+"?([\w]+)"?\s+ON\s+"?public"?\."?question_bank"?([\s\S]{0,240}?);/gi;
        let m: RegExpExecArray | null;
        while ((m = re.exec(uncommented(sql))) !== null) {
          policies.push({ migration: name, text: m[0] });
        }
      }
      expect(policies.length).toBeGreaterThan(0);
      const authenticatedPolicies = policies.filter(p =>
        /FOR SELECT\s+TO\s+"?authenticated"?/i.test(p.text),
      );
      expect(authenticatedPolicies.length).toBeGreaterThan(0);
      const live = authenticatedPolicies[authenticatedPolicies.length - 1];
      expect(live.migration).toBe('20260728090000_lockdown_anon_readable_public_tables.sql');
      expect(live.text).toMatch(/FOR SELECT\s+TO\s+"?authenticated"?/i);
      expect(live.text).toMatch(/USING\s*\(\s*true\s*\)/i);
    });

    it('no migration revokes the baseline table-level grant on question_bank', () => {
      // The ALTER DEFAULT PRIVILEGES in the baseline (22640-22643) hands anon +
      // authenticated a table-level ALL. Until some migration revokes it, RLS
      // row visibility is the ONLY gate and every column is readable.
      const revokes: string[] = [];
      for (const { name, sql } of rootMigrations()) {
        if (/REVOKE[\s\S]{0,120}?ON\s+TABLE\s+"?public"?\."?question_bank"?/i.test(uncommented(sql))) {
          revokes.push(name);
        }
      }
      expect(
        revokes,
        'A migration now REVOKEs on question_bank — R2 may be closed. Convert this ' +
          'file into the real "authenticated is refused 42501 on the key" assertion ' +
          '(see apps/host/src/__tests__/security/quiz-session-shuffles-answer-key-acl.test.ts) ' +
          'and delete Lane A.',
      ).toEqual([]);
    });

    it('no migration grants question_bank column-level SELECT to a client role', () => {
      const grants: string[] = [];
      for (const { name, sql } of rootMigrations()) {
        if (/GRANT\s+SELECT\s*\([\s\S]{0,4000}?\)\s*ON\s+TABLE\s+"?public"?\."?question_bank"?/i.test(uncommented(sql))) {
          grants.push(name);
        }
      }
      expect(grants).toEqual([]);
    });
  });

  // ── Lane B: the blocker inventory, frozen ────────────────────────────────
  describe('Lane B — caller-role readers of a withheld column (the ship-set blockers)', () => {
    const findings = scanCallerRoleReads();

    it('is exactly the known blocker inventory — no more, no fewer', () => {
      // EMPTY as of 2026-08-14 (migration 20260814000023 + its companion client
      // change). The inventory is now a REGRESSION GUARD rather than a backlog:
      // any file appearing here is a NEW caller-role read of a withheld column,
      // i.e. R2 re-opening.
      //
      // Where each former blocker went — all seven cleared, none deferred:
      //
      //  packages/lib/src/supabase.ts
      //    getQuizQuestions' direct-query FALLBACK 3 and getChapterQuestions
      //    both dropped `correct_answer_index` from their projections; the
      //    `select('*', { count })` in getQuestionHistoryStats became
      //    `select('id', { count })` (a `*` count still NAMES every column and
      //    so needs SELECT on all of them).
      //  packages/lib/src/adaptive/select-adaptive-questions.ts
      //    both question_bank projections dropped it; isUsableCandidate's
      //    "index 0-3" clause moved into start_quiz_session's server-side gate.
      //  packages/lib/src/quiz-assembler.ts       PYQ_COLUMNS dropped it.
      //  packages/lib/src/domains/quiz.ts         direct-query fallback dropped it.
      //  apps/host/src/app/(student)/quiz/page.tsx
      //    QB_COLUMNS (qid deep link + SRS review) dropped it; isValidQuestion
      //    lost its "index 0-3" clause to the same server-side gate.
      //  apps/host/src/app/(student)/learn/[subject]/[chapter]/page.tsx
      //    the Quick Check stopped grading in the browser; it calls the new
      //    check_formative_answer RPC.
      //  apps/host/src/app/teacher/worksheets/page.tsx
      //    CLEARED 2026-08-11 (R2 step C) — the one LEGITIMATE caller-role need
      //    for the key on this list. RLS/ACL cannot tell a teacher from a
      //    student (both are the `authenticated` DB role), so it moved behind
      //    GET /api/teacher/worksheets/answer-key, gated by
      //    authorizeRequest(request, 'worksheet.create') plus a server-side
      //    (subject, grade) content-scope check. Pinned by
      //    src/__tests__/api/teacher/worksheet-answer-key-authz.test.ts.
      //
      // A NEW entry => R2 just got wider; do not merge without a plan.
      const expected: string[] = [];

      expect([...new Set(findings.map(f => f.file))].sort()).toEqual(expected);
    });

    it('records which withheld column each blocker reads', () => {
      const byFile = new Map<string, Set<string>>();
      for (const f of findings) {
        if (!byFile.has(f.file)) byFile.set(f.file, new Set());
        for (const k of f.keyColumns) byFile.get(f.file)!.add(k);
      }
      // Every blocker today reads the MCQ key specifically. If a future edit
      // adds a written-answer key read under the caller's role, this catches it.
      for (const [file, cols] of byFile) {
        expect(cols.has('correct_answer_index'), `${file} reads a withheld column`).toBe(true);
      }
    });

    it('pins the SELECT * reads, which break under ANY column allowlist', () => {
      // PostgREST turns `select=*` into `SELECT question_bank.*`, which requires
      // SELECT on EVERY column — so these fail regardless of which columns are
      // withheld. They are the hardest blockers, not the softest.
      const stars = findings.filter(f => f.isStar).map(f => f.file).sort();
      // Cleared 2026-08-14: the last one was getQuestionHistoryStats' head-only
      // COUNT in packages/lib/src/supabase.ts, now `select('id', { count })`.
      // "head: true" does not help — PostgreSQL checks column privilege on
      // every column a query NAMES, materialised or not.
      expect(stars).toEqual([]);
    });

    it('the installed mobile base still reads question_bank directly (forced upgrade required)', () => {
      // The mobile Dart repositories are outside SCAN_ROOTS and are owned by
      // the mobile agent, so this lane deliberately asserts only the ONE
      // durable fact that makes R2 a forced-app-release change rather than a
      // code change:
      //
      //   `useV2` is a COMPILE-TIME constant defaulting to false, and
      //   mobile/build_apk.sh passes `USE_V2="${USE_V2:-false}"`. Every APK
      //   already installed therefore reads `question_bank` from the device
      //   under the caller's role, with whatever column list it was COMPILED
      //   with. Fixing the Dart source does not fix those binaries.
      //
      // Audit note (2026-08-11): at the time of the R2 audit
      // mobile/lib/data/repositories/quiz_repository.dart used a bare
      // `.select()` (== PostgREST `select=*`, which fails under ANY column
      // allowlist) and pyq_repository.dart selected correct_answer_index
      // explicitly. Both were repaired in-source by the concurrent mobile
      // workstream while this audit was running. That shrinks the ship set to
      // "release + force upgrade"; it does not remove it. No assertion is made
      // on those two files here — they are actively churning and are not this
      // file's to pin.
      const api = readFileSync(
        resolve(REPO_ROOT, 'mobile/lib/core/constants/api_constants.dart'), 'utf8');
      expect(api).toMatch(/useV2\s*=\s*bool\.fromEnvironment\('USE_V2',\s*defaultValue:\s*false\)/);

      const build = readFileSync(resolve(REPO_ROOT, 'mobile/build_apk.sh'), 'utf8');
      expect(build).toMatch(/USE_V2="\$\{USE_V2:-false\}"/);
    });
  });

  // ── Lane C: the property that makes the eventual ACL safe for P1/P4 ──────
  describe('Lane C — scoring and serving RPCs are SECURITY DEFINER', () => {
    const RPCS: Record<string, string> = {
      // fn name -> migration that last (re)defines it
      submit_quiz_results_v2: '20260814000022_submit_quiz_v2_written_answer_scoring.sql',
      // Repointed 2026-08-14: 20260814000023 is now the LAST definition of
      // start_quiz_session and of all three serving RPCs.
      start_quiz_session: '20260814000023_keyless_question_serving_and_server_side_p6.sql',
      check_quiz_answer: '20260802130000_check_quiz_answer_rpc.sql',
      select_quiz_questions_rag: '20260814000023_keyless_question_serving_and_server_side_p6.sql',
      select_quiz_questions_v2: '20260814000023_keyless_question_serving_and_server_side_p6.sql',
      get_quiz_questions: '20260814000023_keyless_question_serving_and_server_side_p6.sql',
      check_formative_answer: '20260814000023_keyless_question_serving_and_server_side_p6.sql',
      get_adaptive_questions: '20260702200000_fix_get_adaptive_questions_srs_due_predicate.sql',
    };

    it.each(Object.entries(RPCS))(
      '%s is SECURITY DEFINER, so caller-role ACLs never apply to it',
      (fn, migration) => {
        const sql = readFileSync(resolve(MIGRATIONS, migration), 'utf8');
        const head = new RegExp(
          `CREATE OR REPLACE FUNCTION\\s+"?public"?\\."?${fn}"?\\s*\\(([\\s\\S]{0,2400}?)\\bAS\\b`,
          'i',
        ).exec(sql);
        expect(head, `${fn} not found in ${migration}`).not.toBeNull();
        expect(head![0]).toMatch(/SECURITY\s+DEFINER/i);
      },
    );

    it('the serving RPCs no longer return the key (the residual this file used to record)', () => {
      // INVERTED 2026-08-14. This assertion previously read "the serving RPCs
      // STILL return the key, so the ACL alone is not full closure" — because
      // they did, and a SECURITY DEFINER function is invisible to a caller-role
      // column ACL, so shipping the ACL alone would have left the bulk harvest
      // wide open. Migration 20260814000023 removed the member from all three
      // payloads (both get_quiz_questions overloads included), which is what
      // makes the ACL worth shipping.
      const sql = readFileSync(
        resolve(MIGRATIONS, '20260814000023_keyless_question_serving_and_server_side_p6.sql'),
        'utf8',
      );

      // Isolate the body of each SERVING function by name, so migration PROSE
      // about the key — and check_formative_answer, which legitimately reveals
      // ONE question's key after the student has answered — are not mistaken
      // for a serving payload.
      //
      // The regex mirrors the migration's own section-7a post-condition, which
      // greps pg_proc.prosrc for the same quoted literal: comments count, which
      // is why the migration deliberately avoids quoting the member name inside
      // a function body.
      const bodyOf = (needle: string): string => {
        const at = sql.indexOf(needle);
        expect(at, `${needle} not found in the keyless-serving migration`).toBeGreaterThan(-1);
        const m = /\$function\$([\s\S]*?)\$function\$/.exec(sql.slice(at));
        expect(m, `no body found for ${needle}`).not.toBeNull();
        return m![1];
      };

      const serving = [
        'FUNCTION public.select_quiz_questions_rag(',
        'FUNCTION public.select_quiz_questions_v2(',
        // both get_quiz_questions overloads
        'FUNCTION public.get_quiz_questions(\n  p_subject       text',
        'FUNCTION public.get_quiz_questions(\n  p_subject    text',
      ];
      for (const needle of serving) {
        // The quoted form is the jsonb_build_object key. The bare identifier
        // legitimately survives as an ARGUMENT to question_bank_p6_valid, which
        // is the whole point of the change.
        expect(bodyOf(needle), `${needle} still emits the key`).not.toMatch(/'correct_answer_index'/);
      }
    });

    it('every serving RPC enforces P6 server-side, so the keyless payload is safe', () => {
      // A keyless payload WITHOUT this would be strictly worse than the leak: the
      // browser could no longer run the "correct_answer_index 0-3" half of P6 and
      // nothing else would. The check moved, it did not disappear.
      const sql = readFileSync(
        resolve(MIGRATIONS, '20260814000023_keyless_question_serving_and_server_side_p6.sql'),
        'utf8',
      );
      const uncom = uncommented(sql);
      for (const fn of [
        'select_quiz_questions_rag',
        'select_quiz_questions_v2',
        'get_quiz_questions',
        'start_quiz_session',
      ]) {
        const start = uncom.indexOf(fn);
        expect(start, `${fn} missing from 20260814000023`).toBeGreaterThan(-1);
      }
      // Count the call sites rather than merely asserting presence: rag/v2 apply
      // it to four predicate blocks each, get_quiz_questions to one per overload,
      // start_quiz_session once.
      const calls = [...uncom.matchAll(/question_bank_p6_valid\(/g)].length;
      expect(calls).toBeGreaterThanOrEqual(12);
    });
  });
});
