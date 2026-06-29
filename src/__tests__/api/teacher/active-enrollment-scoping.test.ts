import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Tier-2 PR A (engineering-audit remediation) — teacher/enrollment `is_active`
 * scoping (P8-adjacent). Catalog: REG-201.
 *
 * THE CHANGE UNDER TEST (3 edits)
 * ===============================
 *   1. `src/app/api/teacher/remediation/route.ts` — the `class_students` roster
 *      lookup adds `.eq('is_active', true)`. A soft-de-enrolled student
 *      (is_active=false) is no longer on the caller's roster, so they cannot be
 *      assigned remediation.
 *   2. `src/app/api/teacher/parent-notify/route.ts` — the SAME `.eq('is_active',
 *      true)` is added to its `class_students` roster lookup. A de-enrolled
 *      student no longer triggers a parent-notify.
 *   3. `src/app/api/schools/enroll/route.ts` — the off-path `class_enrollments`
 *      upsert conflict payload adds `is_active: true`, so a re-enroll RESTORES
 *      the active flag (parity with the seat-enforced RPC path).
 *
 * WHY IT MATTERS (P8 boundary)
 * ----------------------------
 * Both teacher roster lookups run on the RLS-BYPASSING admin client
 * (`supabaseAdmin`). The `.eq('is_active', true)` filter is therefore the ONLY
 * boundary keeping a soft-de-enrolled student out of the teacher's roster on
 * these two routes — there is no RLS backstop on a service-role read. Dropping it
 * re-opens the divergence where a de-enrolled student stays reachable.
 *
 * ─── Lane note (why this is a SOURCE-level pin, not a behavioural test) ───────
 * These routes read through the admin client and the unit lane has NO live
 * Postgres. The established convention for "the filter IS the boundary" pins on
 * admin-client reads is source-level (see the admin-route auth-gate sweep
 * `api/super-admin/admin-route-auth-gate-sweep.test.ts` and the TSB-4 migration
 * shape pin `tsb4-class-membership-softdelete-sync.test.ts`): assert the exact
 * shape of the route source, comment-stripped, because the shape IS the
 * guarantee. The behavioural proof ("de-enrolled student → 403 on remediation")
 * would need a live DB and is deferred to an integration lane.
 *
 * Owner: testing.
 */

const REPO_ROOT = resolve(__dirname, '..', '..', '..', '..');

function resolveRepo(rel: string): string {
  for (const c of [resolve(REPO_ROOT, rel), resolve(process.cwd(), rel)]) {
    if (existsSync(c)) return c;
  }
  return resolve(REPO_ROOT, rel);
}

/**
 * Strip TS comments so the assertions inspect EXECUTABLE source only. CRITICAL
 * here: every route's header JSDoc narrates the roster join, "class_students",
 * "class_teachers", "is_active", etc. as prose. Without stripping, an assertion
 * could pass against a comment even if the live filter were removed (vacuous).
 * Strips `/* block *​/` (incl. JSDoc) first, then `// line` comments.
 */
function stripComments(src: string): string {
  return src
    .replace(/\r/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => line.replace(/\/\/.*$/, ''))
    .join('\n');
}

function readSource(rel: string): string {
  return stripComments(readFileSync(resolveRepo(rel), 'utf8'));
}

/**
 * Extract the `.from('<table>')` query-builder chain as a single whitespace-
 * collapsed string: from the `.from('<table>')` token through the first
 * terminator (`.maybeSingle(` / `.single(` / `.limit(` / `;`). Returns null when
 * the table is never queried. Lets us assert a filter is ON THE RIGHT chain.
 */
function fromChain(src: string, table: string): string | null {
  const marker = `.from('${table}')`;
  const start = src.indexOf(marker);
  if (start === -1) return null;
  const rest = src.slice(start);
  const termRe = /\.maybeSingle\(|\.single\(|;/;
  const m = termRe.exec(rest);
  const slice = m ? rest.slice(0, m.index + (m[0] === ';' ? 1 : 0)) : rest;
  return slice.replace(/\s+/g, ' ');
}

const REMEDIATION = 'src/app/api/teacher/remediation/route.ts';
const PARENT_NOTIFY = 'src/app/api/teacher/parent-notify/route.ts';
const ENROLL = 'src/app/api/schools/enroll/route.ts';

const TEACHER_ROUTES: Array<[string, string]> = [
  ['remediation', REMEDIATION],
  ['parent-notify', PARENT_NOTIFY],
];

describe('Tier-2 PR A — teacher/enrollment is_active scoping (P8) — REG-201', () => {
  // ── Assertion 1: both teacher roster lookups filter on is_active ──────────
  describe.each(TEACHER_ROUTES)(
    'teacher/%s — class_students roster lookup is is_active-scoped',
    (_name, rel) => {
      const src = readSource(rel);
      const chain = fromChain(src, 'class_students');

      it('queries class_students (non-vacuous: from + select present)', () => {
        expect(chain).not.toBeNull();
        // Confirm this is the real roster read, not a stray reference.
        expect(chain).toContain(".from('class_students')");
        expect(chain).toContain('.select(');
        // The roster read is scoped to the requested student + the teacher's classes.
        expect(chain).toContain(".eq('student_id'");
        expect(chain).toContain(".in('class_id'");
      });

      it("includes .eq('is_active', true) ON the class_students chain", () => {
        expect(chain).toContain(".eq('is_active', true)");
      });
    },
  );

  // ── Assertion 2: schools/enroll upsert restores is_active on re-enroll ────
  describe('schools/enroll — class_enrollments upsert restores is_active', () => {
    const src = readSource(ENROLL);
    const chain = fromChain(src, 'class_enrollments');

    it('upserts into class_enrollments (non-vacuous: from + upsert present)', () => {
      expect(chain).not.toBeNull();
      expect(chain).toContain(".from('class_enrollments')");
      expect(chain).toContain('.upsert(');
      // The conflict key is the natural (class, student) key.
      expect(chain).toContain("onConflict: 'class_id,student_id'");
    });

    it('the upsert conflict payload sets is_active: true', () => {
      expect(chain).toContain('is_active: true');
    });
  });

  // ── Assertion 3 (guard): the change is on the STUDENT roster lookup, the ──
  //    teacher-auth (class_teachers) lookup is untouched. ────────────────────
  describe.each(TEACHER_ROUTES)(
    'teacher/%s — guard: class_teachers (teacher-auth) lookup preserved & NOT is_active-narrowed',
    (_name, rel) => {
      const src = readSource(rel);
      const teacherChain = fromChain(src, 'class_teachers');

      it('still performs the class_teachers teacher-auth lookup', () => {
        expect(teacherChain).not.toBeNull();
        expect(teacherChain).toContain(".from('class_teachers')");
        expect(teacherChain).toContain(".eq('teacher_id'");
      });

      it('did NOT add an is_active filter to the class_teachers lookup (the change is on class_students only)', () => {
        expect(teacherChain).not.toContain('is_active');
      });
    },
  );
});
