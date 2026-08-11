import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, relative, sep } from 'node:path';
import { validateQuestion } from '@alfanumrik/lib/quiz/question-validation';

/**
 * R2 steps A+B — the client is KEYLESS on every student path, and the P6 check
 * that needed the key now runs on the server.
 *
 * WHAT THIS PINS, AND WHY EACH HALF IS USELESS WITHOUT THE OTHER
 * =============================================================
 * Migration 20260814000017 does two things that only make sense together:
 *
 *   B. `correct_answer_index` is removed from the OUTBOUND payload of every
 *      question-serving RPC, and from every direct `question_bank` projection
 *      in caller-role (browser) code.
 *
 *   A. The P6 rule "correct_answer_index is present and in 0..3" moves from
 *      packages/lib/src/quiz/question-validation.ts (which runs in the browser)
 *      into `public.question_bank_p6_valid`, applied as a WHERE-clause filter
 *      inside the serving RPCs and as a hard skip inside `start_quiz_session`.
 *
 * B alone would DELETE P6 enforcement: the browser would have nothing to check
 * and no server would check for it. A alone would leave the bulk answer-key
 * harvest wide open (the serving RPCs are SECURITY DEFINER, so the drafted
 * column ACL is invisible to them). So both halves are asserted here, in the
 * same file, and neither can be regressed without the other going red.
 *
 * No SQL is executed here (no DB in CI) — the migration-chain assertions are a
 * static scan. The TypeScript half IS executed against the real gate.
 */

const REPO_ROOT = resolve(__dirname, '../../../../..');
const MIGRATIONS = resolve(REPO_ROOT, 'supabase/migrations');
const MIGRATION = '20260814000017_keyless_question_serving_and_server_side_p6.sql';

/** The seven caller-role consumers step B had to repoint. */
const CONSUMERS = [
  'packages/lib/src/supabase.ts',
  'packages/lib/src/quiz-assembler.ts',
  'packages/lib/src/domains/quiz.ts',
  'packages/lib/src/adaptive/select-adaptive-questions.ts',
  'apps/host/src/app/(student)/quiz/page.tsx',
  'apps/host/src/app/(student)/learn/[subject]/[chapter]/page.tsx',
] as const;

/** Directories whose `question_bank` reads run under the CALLER's role. */
const SCAN_ROOTS = ['packages/lib/src', 'packages/ui/src', 'apps/host/src/app'];

/**
 * Server-side surfaces that legitimately hold the key. They run as service_role
 * (bypassing both RLS and any column ACL) or are admin-only, and are excluded
 * from the student-path guard below rather than silently matching it.
 */
const SERVER_OR_ADMIN = [
  '/api/',                 // Next.js route handlers (server)
  '/super-admin/',         // admin console pages
  '/school-admin/',
  '/teacher/',             // teacher surfaces (owned by another workstream)
  '/internal/',
];

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

/**
 * Drop whole-line comments. NOTE the `\r` handling: these files are checked out
 * with CRLF on Windows, and `.` does not match `\r`, so a naive
 * `/^\s*(\/\/|\*).*$/` silently fails to strip anything — which made an earlier
 * draft of this test red against correct source, on a doc comment QUOTING the
 * deleted line.
 */
const uncommented = (src: string) =>
  src
    .split('\n')
    .map(l => (/^\s*(\/\/|\*|--)/.test(l) ? '' : l))
    .join('\n');

/**
 * Every `.select(...)` argument that belongs to a `.from('question_bank')`
 * read, with module-const identifiers (QB_COLUMNS / PYQ_COLUMNS) resolved to
 * their declaration and concatenated string literals stitched together.
 *
 * Scoped to question_bank on purpose: a `select('*')` on some OTHER table is
 * none of this test's business, and matching it would make the guard a
 * repo-wide style rule instead of an answer-key boundary.
 */
function questionBankSelectArgs(src: string): string[] {
  const clean = uncommented(src);
  const args: string[] = [];
  const re = /from\('question_bank'\)\s*([\s\S]{0,900}?)(?:\.eq\(|\.in\(|\.not\(|\.is\(|\.limit\(|\.contains\(|\.order\(|\.maybeSingle\(|\.single\(|;)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(clean)) !== null) {
    const sel = /\.select\(([\s\S]*?)\)\s*$|\.select\(([\s\S]*?)\)/.exec(m[1]);
    if (!sel) continue;
    let raw = (sel[1] ?? sel[2] ?? '').trim();
    const ident = /^[A-Za-z_$][\w$]*$/.exec(raw);
    if (ident) {
      const decl = new RegExp(`\\b(?:const|let|var)\\s+${raw}\\s*=([\\s\\S]*?);`).exec(clean);
      if (decl) raw = decl[1];
    }
    // Drop a trailing options object — `.select('id', { count: 'exact' })` —
    // so its string VALUES are not mistaken for column names.
    raw = raw.split(/,\s*\{/)[0];
    const literals = [...raw.matchAll(/'([^']*)'|"([^"]*)"/g)].map(x => x[1] ?? x[2]);
    // A bare `.select()` (no argument) is PostgREST `select=*`.
    args.push(literals.length === 0 ? '*' : literals.join(''));
  }
  return args;
}

describe('R2 A+B — keyless question serving + server-side P6', () => {
  // ── The guard the whole change stands on ─────────────────────────────────
  describe('guard — no student-path .select() names correct_answer_index', () => {
    it('finds zero caller-role projections of the answer key', () => {
      const offenders: { file: string; select: string }[] = [];

      for (const root of SCAN_ROOTS) {
        for (const abs of walk(resolve(REPO_ROOT, root))) {
          const rel = posix(abs);
          if (SERVER_OR_ADMIN.some(p => rel.includes(p))) continue;
          const src = readFileSync(abs, 'utf8');
          if (!src.includes('correct_answer_index')) continue;
          // Service-role modules are not student paths.
          if (/getSupabaseAdmin|supabaseAdmin/.test(src)) continue;

          for (const arg of questionBankSelectArgs(src)) {
            const cols = arg.split(',').map(s => s.trim()).filter(Boolean);
            if (cols.includes('correct_answer_index') || cols.includes('*')) {
              offenders.push({ file: rel, select: arg || '*' });
            }
          }
        }
      }

      expect(
        offenders,
        'A student-path query is projecting the answer key (or a bare `*`, which ' +
          'NAMES every column and so needs SELECT on all of them). Migration ' +
          '20260814000017 moved the only check that needed it server-side — ' +
          'nothing in the browser should ask for this column again.',
      ).toEqual([]);
    });

    it.each(CONSUMERS)('%s selects no answer-key column', (file) => {
      const src = readFileSync(resolve(REPO_ROOT, file), 'utf8');
      for (const arg of questionBankSelectArgs(src)) {
        const cols = arg.split(',').map(s => s.trim()).filter(Boolean);
        expect(cols).not.toContain('correct_answer_index');
        expect(cols).not.toContain('correct_answer_text');
        expect(cols).not.toContain('*');
      }
    });

    it('the browser-invoked adaptive provider no longer compares the key', () => {
      // select-adaptive-questions.ts runs IN THE BROWSER (invoked from
      // getQuizQuestionsV2). Its isUsableCandidate() used to end with an
      // "index 0-3" clause, which is precisely why its two question_bank
      // projections had to include the key.
      const src = uncommented(readFileSync(
        resolve(REPO_ROOT, 'packages/lib/src/adaptive/select-adaptive-questions.ts'), 'utf8'));
      expect(src).not.toMatch(/q\.correct_answer_index/);
    });

    it('the /learn Quick Check grades through the server, not in the browser', () => {
      const src = uncommented(readFileSync(
        resolve(REPO_ROOT, 'apps/host/src/app/(student)/learn/[subject]/[chapter]/page.tsx'), 'utf8'));
      // The exact comparison that used to exist:
      //   const isCorrect = state.selectedOption === q.correct_answer_index;
      expect(src).not.toMatch(/selectedOption\s*===\s*\w+\.correct_answer_index/);
      expect(src).not.toMatch(/idx\s*===\s*question\.correct_answer_index/);
      expect(src).toContain('checkFormativeAnswer');
    });
  });

  // ── Step A: P6 is enforced on the SERVER now, and is not weaker ──────────
  describe('step A — the P6 answer-key check moved server-side', () => {
    const sql = readFileSync(resolve(MIGRATIONS, MIGRATION), 'utf8');
    /** The `LANGUAGE sql` body of question_bank_p6_valid. */
    const predicate = (() => {
      const i = sql.indexOf('FUNCTION public.question_bank_p6_valid');
      expect(i).toBeGreaterThan(-1);
      const body = /\$function\$([\s\S]*?)\$function\$/.exec(sql.slice(i));
      return body![1];
    })();

    it('question_bank_p6_valid rejects a NULL answer key', () => {
      // The exact defect the 2026-07-29 forensic audit found in the TS gate —
      // `null < 0` and `null > 3` are BOTH false in JS — has a SQL twin in
      // start_quiz_session's COALESCE(correct_answer_index, 0). The NULL guard
      // must be explicit and must come first.
      expect(predicate).toMatch(/p_correct_answer_index IS NOT NULL/);
      expect(predicate).toMatch(/p_correct_answer_index BETWEEN 0 AND 3/);
      const nullGuardAt = predicate.indexOf('p_correct_answer_index IS NOT NULL');
      const rangeAt = predicate.indexOf('p_correct_answer_index BETWEEN 0 AND 3');
      expect(nullGuardAt).toBeLessThan(rangeAt);
    });

    it('question_bank_p6_valid carries every P6-verbatim rule, not just the key', () => {
      expect(predicate).toMatch(/jsonb_array_length\(p_options\) = 4/);   // exactly 4 options
      expect(predicate).toMatch(/count\(DISTINCT/);                       // 4 DISTINCT options
      expect(predicate).toMatch(/\{\{/);                                  // template marker
      expect(predicate).toMatch(/\[BLANK\]/);                             // template marker
      expect(predicate).toMatch(/p_explanation IS NOT NULL/);             // non-empty explanation
    });

    it('is IMMUTABLE and reads no table, so it grants no new read', () => {
      const head = sql.slice(
        sql.indexOf('FUNCTION public.question_bank_p6_valid'),
        sql.indexOf('$function$', sql.indexOf('FUNCTION public.question_bank_p6_valid')),
      );
      expect(head).toMatch(/\bIMMUTABLE\b/);
      expect(head).not.toMatch(/SECURITY\s+DEFINER/i);
      expect(predicate).not.toMatch(/\bFROM\s+question_bank\b/);
    });

    it('start_quiz_session gates on it — the checkpoint every direct path crosses', () => {
      // The deep link (?qid=), the SRS review set, the PYQ preferred fetch, the
      // adaptive candidate provider and the v1 direct-query fallback all reach
      // the student THROUGH start_quiz_session. It is the single place a P6
      // failure on those paths can now be caught.
      const i = sql.indexOf('FUNCTION "public"."start_quiz_session"');
      expect(i).toBeGreaterThan(-1);
      const body = sql.slice(i, sql.indexOf('COMMENT ON FUNCTION "public"."start_quiz_session"'));
      expect(body).toMatch(/question_bank_p6_valid\(/);
      // ... and it SKIPS rather than aborting the whole session start.
      const gateAt = body.indexOf('question_bank_p6_valid(');
      expect(body.slice(gateAt, gateAt + 400)).toMatch(/CONTINUE;/);
      // It must still snapshot the key — that snapshot IS what P1 grades against.
      expect(body).toMatch(/correct_answer_index_snapshot/);
    });

    it('the client drops any question the server declined to snapshot', () => {
      // Without this the server-side skip would be invisible: the page used to
      // keep an un-snapshotted question (`if (!s) return q`).
      const page = readFileSync(
        resolve(REPO_ROOT, 'apps/host/src/app/(student)/quiz/page.tsx'), 'utf8');
      expect(page).toMatch(/droppedByServerP6/);
      expect(page).toMatch(/qs\.filter\(\(q: Question\) => byId\.has\(q\.id\)\)/);
    });

    it('no scoring function is touched by the migration (P1/P2/P4)', () => {
      // submit_quiz_results_v2 / submit_quiz_results / atomic_quiz_profile_update
      // / check_quiz_answer must not be redefined here. The migration may NAME
      // them in prose; it must not CREATE OR REPLACE them.
      for (const fn of [
        'submit_quiz_results_v2',
        'atomic_quiz_profile_update',
        'check_quiz_answer',
      ]) {
        expect(sql).not.toMatch(
          new RegExp(`CREATE\\s+OR\\s+REPLACE\\s+FUNCTION\\s+"?public"?\\."?${fn}\\b`, 'i'),
        );
      }
    });
  });

  // ── P6 is still ENFORCED in TypeScript for everything it can still see ───
  describe('step A — the TS gate is not weakened by keylessServing', () => {
    const goodMcq = {
      question_text: 'Which of these numbers is prime, and why is it prime?',
      options: ['2', '4', '6', '8'],
      explanation: 'A prime number has exactly two distinct positive divisors, one and itself.',
      question_type: 'mcq',
    };

    it('rejects a PRESENT-but-out-of-range index even in keyless mode', () => {
      const r = validateQuestion({ ...goodMcq, correct_answer_index: 4 }, { keylessServing: true });
      expect(r).toEqual({ valid: false, reason: 'bad_answer_index' });
    });

    it('rejects a PRESENT-but-negative index even in keyless mode', () => {
      const r = validateQuestion({ ...goodMcq, correct_answer_index: -1 }, { keylessServing: true });
      expect(r).toEqual({ valid: false, reason: 'bad_answer_index' });
    });

    it('rejects a PRESENT-but-non-integer index even in keyless mode', () => {
      const r = validateQuestion({ ...goodMcq, correct_answer_index: 1.5 }, { keylessServing: true });
      expect(r).toEqual({ valid: false, reason: 'bad_answer_index' });
    });

    it('still rejects a MISSING index when keylessServing is NOT set (ingestion posture)', () => {
      // Ingestion / authoring / CMS callers hold the real row. A missing key
      // there is a genuine defect and must stay a rejection.
      const r = validateQuestion(goodMcq);
      expect(r).toEqual({ valid: false, reason: 'missing_answer_index' });
    });

    it('accepts a keyless row that is otherwise well-formed', () => {
      expect(validateQuestion(goodMcq, { keylessServing: true })).toEqual({ valid: true });
    });

    it('keylessServing relaxes NOTHING else', () => {
      const cases: Array<[Record<string, unknown>, string]> = [
        [{ ...goodMcq, options: ['2', '4', '6'] }, '3_options'],
        [{ ...goodMcq, options: ['2', '2', '6', '8'] }, 'duplicate_options'],
        [{ ...goodMcq, options: ['2', '', '6', '8'] }, 'empty_option'],
        [{ ...goodMcq, question_text: 'What is {{topic}} about in this chapter?' }, 'template_marker'],
        [{ ...goodMcq, explanation: 'Because.' }, 'weak_explanation'],
        [{ ...goodMcq, question_text: 'Too short' }, 'text_too_short'],
      ];
      for (const [row, reason] of cases) {
        expect(validateQuestion(row, { keylessServing: true })).toEqual({ valid: false, reason });
      }
    });
  });

  // ── The serving callers actually pass the flag ───────────────────────────
  describe('the serving callers opt in explicitly (and only the serving ones)', () => {
    it.each([
      'packages/lib/src/quiz-assembler.ts',
      'packages/lib/src/supabase.ts',
      'packages/lib/src/domains/quiz.ts',
    ])('%s passes keylessServing: true', (file) => {
      expect(readFileSync(resolve(REPO_ROOT, file), 'utf8')).toMatch(/keylessServing:\s*true/);
    });

    it('no ingestion/authoring caller passes it', () => {
      const offenders: string[] = [];
      for (const root of SCAN_ROOTS) {
        for (const abs of walk(resolve(REPO_ROOT, root))) {
          const rel = posix(abs);
          if ((CONSUMERS as readonly string[]).includes(rel)) continue;
          const src = readFileSync(abs, 'utf8');
          if (/keylessServing:\s*true/.test(src)) offenders.push(rel);
        }
      }
      expect(
        offenders,
        'keylessServing is for SERVING paths only — a caller holding the real ' +
          'question_bank row must still reject a missing answer key.',
      ).toEqual([]);
    });
  });
});
