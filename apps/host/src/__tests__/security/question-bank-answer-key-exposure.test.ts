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
 * This is strictly WIDER than the per-session leak closed by 20260814000014
 * (that one covered a single in-flight session; this one is the whole bank).
 *
 * WHY THERE IS NO ACL MIGRATION YET
 * =================================
 * The fix shape is settled and matches 20260814000014: table-level `REVOKE ALL`
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
    it('the only SELECT policy on question_bank is TO authenticated USING (true)', () => {
      const policies: { migration: string; text: string }[] = [];
      for (const { name, sql } of rootMigrations()) {
        const re = /CREATE POLICY\s+"?([\w]+)"?\s+ON\s+"?public"?\."?question_bank"?([\s\S]{0,240}?);/gi;
        let m: RegExpExecArray | null;
        while ((m = re.exec(uncommented(sql))) !== null) {
          policies.push({ migration: name, text: m[0] });
        }
      }
      expect(policies.length).toBeGreaterThan(0);
      const live = policies[policies.length - 1];
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
      // Frozen 2026-08-11. Every entry must be repointed to a server route or a
      // keyless RPC before the column ACL can be applied.
      //
      // A NEW entry  => R2 just got wider; do not merge without a plan.
      // A GONE entry => a blocker was cleared; shrink this list in the same PR
      //                 and update the ship set in the drafted migration.
      const expected = [
        // FALLBACK 3 of the live quiz ladder (getQuizQuestionsV2 -> :1608)
        'packages/lib/src/supabase.ts',
        // /learn chapter quiz + the browser-invoked adaptive provider (:1432)
        'packages/lib/src/adaptive/select-adaptive-questions.ts',
        // /pyq -> /quiz handoff, PYQ_COLUMNS (:83-85)
        'packages/lib/src/quiz-assembler.ts',
        // domain-layer quiz fetch
        'packages/lib/src/domains/quiz.ts',
        // qid deep link + SRS review, QB_COLUMNS (:262-265)
        'apps/host/src/app/(student)/quiz/page.tsx',
        // teacher worksheet + printable answer key — a LEGITIMATE caller-role
        // need for the key. RLS/ACL cannot tell a teacher from a student (both
        // are the `authenticated` DB role), so this must move behind
        // authorizeRequest() on the server before the ACL can land.
        'apps/host/src/app/teacher/worksheets/page.tsx',
      ].sort();

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
      expect(stars).toEqual(['packages/lib/src/supabase.ts']); // getQuestionAvailability:1698
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
      submit_quiz_results_v2: '20260814000016_submit_quiz_v2_written_answer_scoring.sql',
      start_quiz_session: '20260801100900_fix_start_quiz_session_digest_schema_qualify.sql',
      check_quiz_answer: '20260802130000_check_quiz_answer_rpc.sql',
      select_quiz_questions_rag: '20260802100000_select_quiz_questions_rag_verification_gate.sql',
      select_quiz_questions_v2: '20260625000200_fix_pool_reset_min_pool_guard.sql',
      get_quiz_questions: '20260505155525_fix_get_quiz_questions_verified_filter.sql',
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

    it('the serving RPCs still return the key, so the ACL alone is not full closure', () => {
      // Honest residual: even after the column ACL lands, a signed-in student
      // can call select_quiz_questions_rag / _v2 for their own grade+subject and
      // harvest keys. Full R2 closure needs the key stripped from these payloads
      // and per-answer feedback routed through check_quiz_answer.
      for (const m of [
        '20260802100000_select_quiz_questions_rag_verification_gate.sql',
        '20260625000200_fix_pool_reset_min_pool_guard.sql',
      ]) {
        expect(readFileSync(resolve(MIGRATIONS, m), 'utf8')).toContain('correct_answer_index');
      }
    });
  });
});
