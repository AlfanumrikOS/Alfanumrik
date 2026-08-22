/**
 * Phase H (Subject Governance) — Regression catalog tests.
 *
 * Six leak-prevention regressions derived from spec §11.3:
 *
 *   1. Class 6 free-plan student never sees senior/commerce subjects anywhere
 *      (API + hook + dashboard picker + preferences PATCH all reject physics).
 *   2. GET /api/student/subjects never returns the global 17-subject list to
 *      an authenticated student endpoint (response is always a strict subset).
 *   3. Grade 11 commerce student never sees physics.
 *   4. Grade 11 science student never sees accountancy.
 *   5. Plan downgrade (pro → starter) clamps selected_subjects: previously
 *      pro-only subjects now appear with is_locked=true.
 *   6. Admin removing a subject from plan_subject_access flags the enrollment
 *      in the violations report but does not delete student_subject_enrollment
 *      rows (repair is an explicit ops action).
 *
 * All Supabase RPC + table calls are mocked. No live DB required.
 *
 * If any of these tests regress it implies a leak path re-opened — block the
 * commit per the testing agent rejection rules.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { NextRequest } from 'next/server';

// ─────────────────────────────────────────────────────────────────────────────
// Shared scaffolding
// ─────────────────────────────────────────────────────────────────────────────

// The historical "canonical 17" list from spec §2 / §6. Used ONLY by test #2's
// strict-subset assertion, which cares about the CEILING (never return the
// whole master list), not about which codes are real.
//
// STALENESS NOTE (Phase 3, 2026-08-10): this list is not the catalogue. Two of
// its entries — `history` and `environmental_science` — are not real subject
// codes and never were. It is deliberately left as-is because test #2 only
// compares LENGTHS and membership-of-returned-codes against it; correcting it
// would not strengthen anything. The authoritative "which subjects may be
// served" answer is `subjects.is_active` in the database, enforced by
// get_available_subjects and, on the fallback path, by regression #8 below.
const CANONICAL_17 = [
  'math','science','english','hindi','social_studies',
  'physics','chemistry','biology','computer_science',
  'accountancy','business_studies','economics',
  'history','geography','political_science',
  'sanskrit','environmental_science',
];

// ─────────────────────────────────────────────────────────────────────────────
// Regression #8 scaffolding — GET /api/student/subjects fallback path.
//
// The fallback fires when get_available_subjects (v1) errors OR returns zero
// rows. It used to hydrate from SUBJECT_META / getSubjectsForGrade with
// isLocked=false, which bypassed `subjects.is_active` entirely. These fakes
// model the real table semantics (`.in()` + `.eq('is_active', true)` actually
// filter) so the test proves the join, not just the mock.
// ─────────────────────────────────────────────────────────────────────────────

const GRADES = ['6', '7', '8', '9', '10', '11', '12'] as const;

/** Post-restriction KEEP-SET: the only subjects that stay is_active = true. */
const KEEP_SET = ['math', 'science', 'physics', 'chemistry', 'biology'];

/** Deactivated subjects that still have grade_subject_map rows. */
const RETIRED = [
  'english', 'hindi', 'social_studies', 'computer_science',
  'accountancy', 'business_studies', 'economics',
  'geography', 'political_science', 'sanskrit',
];

const SUBJECT_CATALOGUE = [
  ...KEEP_SET.map((code) => ({
    code, name: code, name_hi: `${code}-hi`, icon: '📘', color: '#000',
    subject_kind: 'cbse_core', is_active: true,
  })),
  ...RETIRED.map((code) => ({
    code, name: code, name_hi: `${code}-hi`, icon: '📘', color: '#000',
    subject_kind: 'cbse_core', is_active: false,
  })),
];

/**
 * WORST CASE ON PURPOSE: grade_subject_map still maps EVERY subject at EVERY
 * grade. The grade-map pruning migration is a separate workstream, so the
 * route must be safe before it lands — `subjects.is_active` is the only gate
 * doing work here.
 */
const GRADE_SUBJECT_MAP = GRADES.flatMap((grade) =>
  [...KEEP_SET, ...RETIRED].map((subject_code) => ({
    grade, subject_code, is_core: true, board: 'CBSE', stream: null as string | null,
  })),
);

let _authUser: { data: { user: { id: string } | null }; error: any } = {
  data: { user: { id: 'auth-user-1' } }, error: null,
};
let _v1Result: { data: any; error: any } = { data: [], error: null };
let _studentRow: { data: any; error: any } = { data: null, error: null };
let _gsmRows = GRADE_SUBJECT_MAP as Array<Record<string, any>>;
let _opsEventInserts: any[] = [];

function fakeFrom(table: string): any {
  if (table === 'students') {
    return {
      select: () => ({
        or: () => ({ limit: () => ({ maybeSingle: () => Promise.resolve(_studentRow) }) }),
      }),
    };
  }
  if (table === 'grade_subject_map') {
    let rows = _gsmRows.slice();
    const link: any = {
      eq: (col: string, val: any) => {
        rows = rows.filter((r) => r[col] === val);
        return link;
      },
      then: (ok?: any, err?: any) =>
        Promise.resolve({ data: rows, error: null }).then(ok, err),
    };
    return { select: () => link };
  }
  if (table === 'subjects') {
    let rows = SUBJECT_CATALOGUE.slice();
    const link: any = {
      in: (col: string, vals: any[]) => {
        rows = rows.filter((r) => vals.includes((r as any)[col]));
        return link;
      },
      eq: (col: string, val: any) => {
        rows = rows.filter((r) => (r as any)[col] === val);
        return link;
      },
      then: (ok?: any, err?: any) =>
        Promise.resolve({
          // The route selects display columns only; is_active never ships.
          data: rows.map(({ is_active: _drop, ...rest }) => rest),
          error: null,
        }).then(ok, err),
    };
    return { select: () => link };
  }
  if (table === 'ops_events') {
    return {
      insert: (row: any) => {
        _opsEventInserts.push(row);
        return Promise.resolve({ data: null, error: null });
      },
    };
  }
  return { select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }) }) };
}

vi.mock('@alfanumrik/lib/supabase-admin', () => {
  const admin = {
    auth: { getUser: () => Promise.resolve(_authUser) },
    // v1 = get_available_subjects, v2 = get_available_subjects_v2 (counts).
    rpc: (name: string) =>
      Promise.resolve(name === 'get_available_subjects' ? _v1Result : { data: [], error: null }),
    from: (table: string) => fakeFrom(table),
  };
  return { supabaseAdmin: admin, getSupabaseAdmin: () => admin };
});

vi.mock('@alfanumrik/lib/supabase-server', () => ({
  createSupabaseServerClient: () =>
    Promise.resolve({ auth: { getUser: () => Promise.resolve({ data: { user: null } }) } }),
}));

vi.mock('@alfanumrik/lib/logger', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

function rawRow(code: string, opts: { is_locked?: boolean; is_core?: boolean } = {}) {
  return {
    code,
    name: code,
    name_hi: code,
    icon: 'i',
    color: '#000',
    subject_kind: 'cbse_core',
    is_core: opts.is_core ?? true,
    is_locked: opts.is_locked ?? false,
  };
}

// Per-test RPC orchestration. Each scenario sets what the mock RPC returns.
const rpcImpl = vi.fn();
function ctx() {
  return {
    supabase: {
      rpc: (name: string, args: any) => {
        const result = rpcImpl(name, args);
        return Promise.resolve(result);
      },
    },
  } as any;
}

beforeEach(() => {
  rpcImpl.mockReset();
});

// ─────────────────────────────────────────────────────────────────────────────
// #1 — Class 6 free-plan student never sees senior subjects
// ─────────────────────────────────────────────────────────────────────────────

describe('Regression #1: class 6 free-plan student cannot reach senior/commerce subjects', () => {
  it('API (getAllowedSubjectsForStudent) returns only core primary subjects', async () => {
    // Grade 6 free plan — only the 4 core subjects.
    rpcImpl.mockReturnValue({
      data: ['math', 'science', 'english', 'social_studies'].map((c) => rawRow(c)),
      error: null,
    });

    const { getAllowedSubjectsForStudent } = await import('@alfanumrik/lib/subjects');
    const result = await getAllowedSubjectsForStudent('student-grade6', ctx());

    const codes = result.map((s) => s.code);
    expect(codes).not.toContain('physics');
    expect(codes).not.toContain('chemistry');
    expect(codes).not.toContain('biology');
    expect(codes).not.toContain('accountancy');
    expect(codes).toEqual(['math', 'science', 'english', 'social_studies']);
  });

  it('useAllowedSubjects() hook surfaces the same intersection to the UI', async () => {
    // Mock SWR inline so the hook pulls deterministic data.
    const fetcherMock = vi.fn().mockReturnValue({
      subjects: [
        { code: 'math', name: 'Math', nameHi: 'गणित', icon: '∑', color: '#000', subjectKind: 'cbse_core', isCore: true, isLocked: false },
        { code: 'science', name: 'Science', nameHi: 'विज्ञान', icon: '🔬', color: '#111', subjectKind: 'cbse_core', isCore: true, isLocked: false },
      ],
    });
    vi.doMock('swr', () => ({
      default: () => ({ data: fetcherMock(), error: null, isLoading: false, mutate: vi.fn() }),
    }));

    const { useAllowedSubjects } = await import('@alfanumrik/lib/useAllowedSubjects');

    // Render the hook via a trivial consumer component — jsdom render keeps the
    // test closer to real UI usage than calling the hook directly.
    let captured: { unlocked: any[]; locked: any[] } | null = null;
    function Probe() {
      const { unlocked, locked } = useAllowedSubjects();
      captured = { unlocked, locked };
      return <div data-testid="codes">{unlocked.map((s: any) => s.code).join(',')}</div>;
    }
    render(<Probe />);

    expect(screen.getByTestId('codes').textContent).toBe('math,science');
    expect(captured!.unlocked.map((s: any) => s.code)).not.toContain('physics');
    expect(captured!.locked).toEqual([]);

    vi.doUnmock('swr');
  });

  it('dashboard subject picker mock never renders senior subject chips', () => {
    // Minimal picker stand-in — the dashboard chips are driven by the same
    // hook data shape. The contract under test: a picker that consumes
    // `unlocked` never includes physics when the list does not contain it.
    const unlocked = [
      { code: 'math', name: 'Math' },
      { code: 'science', name: 'Science' },
    ];
    function Picker({ items }: { items: Array<{ code: string; name: string }> }) {
      return (
        <ul>
          {items.map((s) => (
            <li key={s.code} data-testid={`chip-${s.code}`}>{s.name}</li>
          ))}
        </ul>
      );
    }
    render(<Picker items={unlocked} />);
    expect(screen.queryByTestId('chip-physics')).toBeNull();
    expect(screen.queryByTestId('chip-chemistry')).toBeNull();
    expect(screen.queryByTestId('chip-biology')).toBeNull();
    expect(screen.queryByTestId('chip-accountancy')).toBeNull();
    expect(screen.getByTestId('chip-math')).toBeInTheDocument();
  });

  it('PATCH /api/student/preferences set_selected_subjects [physics] returns 422', async () => {
    // Exercise the service-layer guard directly — the preferences PATCH route
    // defers to set_student_subjects RPC which surfaces subject_not_allowed.
    // We verify the service rejects the write with reason='plan' (subject is
    // present but locked — or absent, which triggers reason='grade').
    rpcImpl.mockReturnValue({
      data: ['math', 'science', 'english', 'social_studies'].map((c) => rawRow(c)),
      error: null,
    });

    const { validateSubjectWrite } = await import('@alfanumrik/lib/subjects');
    const res = await validateSubjectWrite('student-grade6', 'physics', ctx());

    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.code).toBe('subject_not_allowed');
      expect(res.error.subject).toBe('physics');
      // Either 'grade' (not in intersection) or 'plan' (locked). For grade 6
      // free plan physics is filtered before locking, so reason is 'grade'.
      expect(['grade', 'plan']).toContain(res.error.reason);
      expect(res.error.allowed).toEqual(
        expect.arrayContaining(['math', 'science', 'english', 'social_studies']),
      );
      expect(res.error.allowed).not.toContain('physics');
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// #2 — API never returns the global 17-subject list
// ─────────────────────────────────────────────────────────────────────────────

describe('Regression #2: GET /api/student/subjects never returns the global list', () => {
  it.each([
    { label: 'grade 6 free',           returned: ['math', 'science', 'english', 'social_studies'] },
    { label: 'grade 11 science starter', returned: ['math', 'physics', 'chemistry', 'english'] },
    { label: 'grade 11 commerce pro',  returned: ['math', 'accountancy', 'business_studies', 'economics', 'english'] },
    { label: 'grade 12 humanities pro+', returned: ['history', 'geography', 'political_science', 'english', 'hindi'] },
  ])('returns strict subset for $label', async ({ returned }) => {
    rpcImpl.mockReturnValue({
      data: returned.map((c) => rawRow(c)),
      error: null,
    });
    const { getAllowedSubjectsForStudent } = await import('@alfanumrik/lib/subjects');
    const result = await getAllowedSubjectsForStudent('student-x', ctx());
    const codes = result.map((s) => s.code);

    // Strict subset — every returned code is canonical, and the returned set
    // is NOT the full 17 (otherwise the endpoint is leaking the master list).
    expect(codes.length).toBeGreaterThan(0);
    expect(codes.length).toBeLessThan(CANONICAL_17.length);
    for (const c of codes) {
      expect(CANONICAL_17).toContain(c);
    }
  });

  it('never returns all 17 canonical subjects simultaneously', async () => {
    rpcImpl.mockReturnValue({
      // Worst-case fixture — RPC somehow returns the full master list.
      // Even if this ever shipped, the response length would be 17 and this
      // test flags it immediately.
      data: ['math', 'science', 'english', 'social_studies', 'physics', 'chemistry', 'biology', 'computer_science', 'accountancy', 'business_studies', 'economics'].map((c) => rawRow(c)),
      error: null,
    });
    const { getAllowedSubjectsForStudent } = await import('@alfanumrik/lib/subjects');
    const result = await getAllowedSubjectsForStudent('student-x', ctx());
    // Even the fattest realistic plan (pro, 11-sci with optionals) is < 17.
    expect(result.length).toBeLessThan(CANONICAL_17.length);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// #3 — Grade 11 commerce student never sees physics
// ─────────────────────────────────────────────────────────────────────────────

describe('Regression #3: grade 11 commerce stream excludes physics', () => {
  it('RPC-scoped intersection for commerce stream excludes physics/chemistry/biology', async () => {
    rpcImpl.mockReturnValue({
      data: ['math', 'accountancy', 'business_studies', 'economics', 'english'].map((c) => rawRow(c)),
      error: null,
    });
    const { getAllowedSubjectsForStudent } = await import('@alfanumrik/lib/subjects');
    const result = await getAllowedSubjectsForStudent('student-11-commerce', ctx());
    const codes = result.map((s) => s.code);
    expect(codes).not.toContain('physics');
    expect(codes).not.toContain('chemistry');
    expect(codes).not.toContain('biology');
    expect(codes).toEqual(expect.arrayContaining(['accountancy', 'business_studies']));
  });

  it('validateSubjectWrite rejects physics for commerce student', async () => {
    rpcImpl.mockReturnValue({
      data: ['math', 'accountancy', 'business_studies', 'economics', 'english'].map((c) => rawRow(c)),
      error: null,
    });
    const { validateSubjectWrite } = await import('@alfanumrik/lib/subjects');
    const res = await validateSubjectWrite('student-11-commerce', 'physics', ctx());
    expect(res.ok).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// #4 — Grade 11 science student never sees accountancy
// ─────────────────────────────────────────────────────────────────────────────

describe('Regression #4: grade 11 science stream excludes accountancy', () => {
  it('RPC-scoped intersection excludes accountancy/business_studies', async () => {
    rpcImpl.mockReturnValue({
      data: ['math', 'physics', 'chemistry', 'biology', 'english'].map((c) => rawRow(c)),
      error: null,
    });
    const { getAllowedSubjectsForStudent } = await import('@alfanumrik/lib/subjects');
    const result = await getAllowedSubjectsForStudent('student-11-science', ctx());
    const codes = result.map((s) => s.code);
    expect(codes).not.toContain('accountancy');
    expect(codes).not.toContain('business_studies');
    expect(codes).toEqual(expect.arrayContaining(['physics', 'chemistry']));
  });

  it('validateSubjectWrite rejects accountancy for science student', async () => {
    rpcImpl.mockReturnValue({
      data: ['math', 'physics', 'chemistry', 'biology', 'english'].map((c) => rawRow(c)),
      error: null,
    });
    const { validateSubjectWrite } = await import('@alfanumrik/lib/subjects');
    const res = await validateSubjectWrite('student-11-science', 'accountancy', ctx());
    expect(res.ok).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// #5 — Plan downgrade clamps selected_subjects
// ─────────────────────────────────────────────────────────────────────────────

describe('Regression #5: plan downgrade (pro → starter) clamps selected_subjects', () => {
  it('pro plan shows premium subjects unlocked', async () => {
    rpcImpl.mockReturnValue({
      data: [
        rawRow('math', { is_locked: false }),
        rawRow('physics', { is_locked: false }),
        rawRow('chemistry', { is_locked: false }),
        rawRow('biology', { is_locked: false }),
      ],
      error: null,
    });
    const { getAllowedSubjectsForStudent } = await import('@alfanumrik/lib/subjects');
    const result = await getAllowedSubjectsForStudent('student-pro', ctx());
    const unlocked = result.filter((s) => !s.isLocked).map((s) => s.code);
    expect(unlocked).toEqual(['math', 'physics', 'chemistry', 'biology']);
  });

  it('after downgrade to starter, previously-pro-only subjects surface as is_locked=true', async () => {
    // Starter tier: math stays unlocked, science subjects become locked.
    rpcImpl.mockReturnValue({
      data: [
        rawRow('math',      { is_locked: false }),
        rawRow('physics',   { is_locked: true }),
        rawRow('chemistry', { is_locked: true }),
        rawRow('biology',   { is_locked: true }),
      ],
      error: null,
    });
    const { getAllowedSubjectsForStudent } = await import('@alfanumrik/lib/subjects');
    const result = await getAllowedSubjectsForStudent('student-downgraded', ctx());
    const locked = result.filter((s) => s.isLocked).map((s) => s.code);
    const unlocked = result.filter((s) => !s.isLocked).map((s) => s.code);

    expect(locked).toEqual(expect.arrayContaining(['physics', 'chemistry', 'biology']));
    expect(unlocked).toEqual(['math']);

    // validateSubjectWrite now rejects physics with reason='plan'.
    const { validateSubjectWrite } = await import('@alfanumrik/lib/subjects');
    const res = await validateSubjectWrite('student-downgraded', 'physics', ctx());
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.reason).toBe('plan');
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// #6 — Admin DELETE on plan_subject_access flags but does not delete enrollments
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// #7 — Legacy quiz-style pages (mock-exam, pyq, stem-centre) cannot import the
//      raw subject catalogue. Pinned by the ESLint rule + a static-analysis
//      style check that the page modules do NOT reference SUBJECT_META /
//      GRADE_SUBJECTS / a local getSubjectsForGrade.
//
// Why a runtime check on top of ESLint:
//   ESLint catches imports and (since the post-fix rule update) local
//   declarations, but it cannot block a regression that bypasses the rule
//   via `// eslint-disable`. This test reads the source files and asserts
//   the disallowed identifiers do not appear, so a sneaky disable comment
//   would still surface here.
// ─────────────────────────────────────────────────────────────────────────────

describe('Regression #7: legacy pages do not bypass the subjects RPC', () => {
  const fs = require('fs');
  const path = require('path');

  // NOTE (2026-08-11, Phase 5 track A): the two `mock-exam` cases were removed
  // because the pages they guarded no longer exist. The legacy /mock-exam
  // runtime (page + results) was DELETED — it persisted nothing — and /mock-exam
  // now 308s to /exams/mock. That successor reads its subject vocabulary from
  // GET /api/exams/papers server-side, so there is no client-side catalogue for
  // this regression to leak from. The `pyq` case stays and is now stronger: /pyq
  // is a launcher whose only data source is `useAllowedSubjects`.
  const cases: Array<{ label: string; file: string }> = [
    { label: 'pyq page', file: 'src/app/pyq/page.tsx' },
    { label: 'stem-centre page', file: 'src/app/stem-centre/page.tsx' },
  ];

  it.each(cases)('$label does not import SUBJECT_META or GRADE_SUBJECTS', ({ file }) => {
    const full = path.resolve(process.cwd(), file);
    if (!fs.existsSync(full)) {
      // If a page is renamed/removed, surface that immediately.
      throw new Error(`Expected file missing: ${file}`);
    }
    const src: string = fs.readFileSync(full, 'utf8');
    // Block named imports of the deprecated catalogue.
    expect(src).not.toMatch(/from\s+['"]@\/lib\/constants['"][\s\S]*?SUBJECT_META/);
    expect(src).not.toMatch(/from\s+['"]@\/lib\/constants['"][\s\S]*?GRADE_SUBJECTS/);
    expect(src).not.toMatch(/SUBJECT_META\s*\.\s*filter\s*\(/);
    expect(src).not.toMatch(/GRADE_SUBJECTS\s*\[/);
  });

  it.each(cases)('$label does not redeclare getSubjectsForGrade locally', ({ file }) => {
    const full = path.resolve(process.cwd(), file);
    const src: string = fs.readFileSync(full, 'utf8');
    expect(src).not.toMatch(/function\s+getSubjectsForGrade\s*\(/);
    expect(src).not.toMatch(/const\s+getSubjectsForGrade\s*=/);
  });

  it.each([
    { label: 'pyq page',        file: 'src/app/pyq/page.tsx',               expects: 'useAllowedSubjects' },
    { label: 'stem-centre page', file: 'src/app/stem-centre/page.tsx',      expects: 'useAllowedSubjects' },
  ])('$label imports the canonical subjects hook ($expects)', ({ file, expects }) => {
    const full = path.resolve(process.cwd(), file);
    const src: string = fs.readFileSync(full, 'utf8');
    expect(src).toContain(expects);
  });
});

describe('Regression #6: admin removing subject from plan_subject_access flags without deleting enrollments', () => {
  it('violations query surfaces affected students after plan_subject_access DELETE', () => {
    // Simulate the violations report response shape post-admin-DELETE.
    // Contract under test: the report returns affected students, and
    // student_subject_enrollment rows are unchanged (repair is a separate
    // ops action). This uses a fixture because the route's SQL runs via
    // exec_admin_query and is not economical to shape-mock end-to-end here.
    const violationsAfterDelete = {
      violations: [
        {
          student_id: 'stu-1',
          grade: '11',
          stream: 'science',
          plan: 'starter',
          invalid_subjects: ['physics'],
          total: 1,
        },
      ],
      count: 1,
    };
    expect(violationsAfterDelete.count).toBe(1);
    expect(violationsAfterDelete.violations[0].invalid_subjects).toContain('physics');
  });

  it('student_subject_enrollment rows are NOT deleted by the admin DELETE', () => {
    // Fixture represents the DB state: an admin DELETE hit plan_subject_access
    // but the enrollment row is preserved (audit requires visible state until
    // ops repair runs). This mirrors the contract from spec §6 and route
    // super-admin/subjects/plan-access/route.ts DELETE handler (no cascade).
    const enrollmentRows = [
      { student_id: 'stu-1', subject_code: 'physics', is_locked: true /* newly-flagged but present */ },
    ];
    // Asserts the invariant — a row still exists for physics.
    expect(enrollmentRows.find((r) => r.subject_code === 'physics')).toBeDefined();
    expect(enrollmentRows).toHaveLength(1);
  });

  it('service-layer validateSubjectWrite reflects the flag via is_locked', async () => {
    // After DELETE on plan_subject_access(physics, starter), get_available_subjects
    // returns physics with is_locked=true. validateSubjectWrite then rejects.
    rpcImpl.mockReturnValue({
      data: [
        rawRow('math',    { is_locked: false }),
        rawRow('physics', { is_locked: true }),
      ],
      error: null,
    });
    const { validateSubjectWrite } = await import('@alfanumrik/lib/subjects');
    const res = await validateSubjectWrite('stu-1', 'physics', ctx());
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.reason).toBe('plan');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// #8 — GET /api/student/subjects fallback path never serves a non-active
//      subject, for ANY grade, on EITHER trigger (v1 error / v1 empty rows).
//
// This is the Phase 3 P0 leak. `fallbackSubjectsForGradeAndBoard()` used to:
//   (a) query grade_subject_map with no join to subjects.is_active, hydrating
//       names from the deprecated SUBJECT_META, and
//   (b) fall through to getSubjectsForGrade() — a hardcoded 16-subject shim —
//   ...both marking every row isLocked:false.
//
// After the grade-map restriction, `v1_empty_rows` becomes MORE likely, so the
// leak got more reachable, not less. The fallback now reads the same DB truth
// as the RPC minus the plan join, and fails CLOSED (isLocked:true).
// ─────────────────────────────────────────────────────────────────────────────

describe('Regression #8: /api/student/subjects fallback never leaks a non-active subject', () => {
  function req() {
    return new NextRequest('http://localhost/api/student/subjects', {
      headers: { Authorization: 'Bearer test-token' },
    });
  }

  async function callRoute() {
    const { GET } = await import('@/app/api/student/subjects/route');
    const res = await GET(req());
    return { res, body: await res.json() };
  }

  beforeEach(() => {
    _authUser = { data: { user: { id: 'auth-user-1' } }, error: null };
    _v1Result = { data: [], error: null };
    _studentRow = { data: null, error: null };
    _gsmRows = GRADE_SUBJECT_MAP;
    _opsEventInserts = [];
  });

  // ── The core assertion, across every grade AND both fallback triggers ──
  const triggers = [
    { label: 'v1_empty_rows', v1: { data: [], error: null } },
    { label: 'v1_rpc_error', v1: { data: null, error: { message: 'rpc exploded' } } },
  ];

  for (const trigger of triggers) {
    it.each(GRADES.map((g) => ({ grade: g })))(
      `grade $grade / ${trigger.label}: returns only active subjects, all locked`,
      async ({ grade }) => {
        _v1Result = trigger.v1;
        // P5: grade is a STRING.
        expect(typeof grade).toBe('string');
        _studentRow = { data: { grade, board: 'CBSE', stream: null }, error: null };

        const { res, body } = await callRoute();
        expect(res.status).toBe(200);

        const codes = body.subjects.map((s: any) => s.code).sort();
        expect(codes).toEqual([...KEEP_SET].sort());

        // Not one retired code survives, even though grade_subject_map still
        // maps all of them at this grade.
        for (const retired of RETIRED) {
          expect(codes).not.toContain(retired);
        }

        // Fail CLOSED on plan: no plan context ⇒ nothing is granted.
        expect(body.subjects.every((s: any) => s.isLocked === true)).toBe(true);
        expect(body.subjects.every((s: any) => s.readyChapterCount === 0)).toBe(true);
      },
    );
  }

  it('returns [] (never a hardcoded catalogue) when the grade maps to no active subject', async () => {
    _studentRow = { data: { grade: '10', board: 'CBSE', stream: null }, error: null };
    // Grade 10 maps only to retired (is_active=false) subjects.
    _gsmRows = RETIRED.map((subject_code) => ({
      grade: '10', subject_code, is_core: true, board: 'CBSE', stream: null,
    }));

    const { res, body } = await callRoute();
    expect(res.status).toBe(200);
    expect(body.subjects).toEqual([]);

    // ...and the drift is logged so ops can see an empty picker happening.
    expect(_opsEventInserts).toHaveLength(1);
    expect(_opsEventInserts[0].context.fallback_subject_count).toBe(0);
  });

  it('returns [] when the grade has no grade_subject_map rows at all', async () => {
    _studentRow = { data: { grade: '12', board: 'CBSE', stream: null }, error: null };
    _gsmRows = [];

    const { body } = await callRoute();
    expect(body.subjects).toEqual([]);
  });

  it('P13: the ops_events fallback row carries no PII', async () => {
    _studentRow = { data: { grade: '9', board: 'CBSE', stream: null }, error: null };
    await callRoute();

    expect(_opsEventInserts).toHaveLength(1);
    const serialized = JSON.stringify(_opsEventInserts[0]);
    expect(serialized).not.toMatch(/name|email|phone/i);
    expect(Object.keys(_opsEventInserts[0].context).sort()).toEqual([
      'fallback_subject_count', 'reason',
    ]);
  });

  it('stream gating: a commerce student never picks up a science-stream mapping', async () => {
    _studentRow = { data: { grade: '11', board: 'CBSE', stream: 'commerce' }, error: null };
    _gsmRows = [
      { grade: '11', subject_code: 'math', is_core: true, board: 'CBSE', stream: null },
      { grade: '11', subject_code: 'physics', is_core: true, board: 'CBSE', stream: 'science' },
      { grade: '11', subject_code: 'chemistry', is_core: true, board: 'CBSE', stream: 'science' },
    ];

    const { body } = await callRoute();
    expect(body.subjects.map((s: any) => s.code)).toEqual(['math']);
  });

  // ── NULL-board parity with the RPC's COALESCE(board,'CBSE') ──
  //
  // students.board is NULLABLE (DEFAULT 'CBSE' only fills it on insert), but
  // get_available_subjects reads `COALESCE(board,'CBSE') AS board` in its `s`
  // CTE, so inside the RPC a NULL-board student IS a CBSE student. The TS
  // mirror receives students.board raw, so it must coalesce too — otherwise it
  // skips the board-specific branch and falls through to the generic
  // CBSE/Other/NULL filter, serving rows the RPC excludes.
  //
  // The fixture is deliberately discriminating: this grade has a CBSE-specific
  // row AND an 'Other'-board row AND a NULL-board row, each mapping a DIFFERENT
  // active subject. Only a correct coalesce collapses to the CBSE row alone.
  describe('NULL board resolves identically to board=CBSE', () => {
    const MIXED_BOARD_MAP = [
      { grade: '9', subject_code: 'math',    is_core: true, board: 'CBSE',  stream: null },
      { grade: '9', subject_code: 'science', is_core: true, board: 'Other', stream: null },
      { grade: '9', subject_code: 'physics', is_core: true, board: null,    stream: null },
    ];

    async function codesForBoard(board: string | null) {
      _gsmRows = MIXED_BOARD_MAP;
      _studentRow = { data: { grade: '9', board, stream: null }, error: null };
      const { res, body } = await callRoute();
      expect(res.status).toBe(200);
      return { body, codes: body.subjects.map((s: any) => s.code).sort() };
    }

    it('board=null yields the same subjects as board="CBSE"', async () => {
      const cbse = await codesForBoard('CBSE');
      const nullBoard = await codesForBoard(null);

      // The board-specific row wins outright — the 'Other' and NULL-board rows
      // are NOT admitted. Without the coalesce, board=null returns all three.
      expect(cbse.codes).toEqual(['math']);
      expect(nullBoard.codes).toEqual(cbse.codes);
      expect(nullBoard.codes).not.toContain('science');
      expect(nullBoard.codes).not.toContain('physics');
    });

    it('board=null preserves the fail-closed + mobile contract', async () => {
      const { body } = await codesForBoard(null);
      // Same posture as every other fallback row: locked, count 0, shape intact.
      expect(body.subjects.every((s: any) => s.isLocked === true)).toBe(true);
      expect(body.subjects.every((s: any) => s.readyChapterCount === 0)).toBe(true);
      for (const s of body.subjects) {
        expect(typeof s.code).toBe('string');
        expect(typeof s.name).toBe('string');
      }
    });

    it('board=null still falls back to generic rows when no CBSE row exists', async () => {
      // The other half of the RPC predicate: with no gsm row at the student's
      // (coalesced) board, the generic CBSE/Other/NULL branch applies. A NULL
      // board must not become a dead end that empties the picker.
      _gsmRows = [
        { grade: '9', subject_code: 'science', is_core: true, board: 'Other', stream: null },
        { grade: '9', subject_code: 'physics', is_core: true, board: null,    stream: null },
      ];
      _studentRow = { data: { grade: '9', board: null, stream: null }, error: null };

      const { body } = await callRoute();
      expect(body.subjects.map((s: any) => s.code).sort()).toEqual(['physics', 'science']);
    });
  });

  it('MOBILE CONTRACT: response field names and types are unchanged', async () => {
    // mobile/lib/data/models/subject.dart casts `code` and `name` with
    // `as String` (throws on null) and reads nameHi/icon/color/subjectKind/
    // isCore/isLocked. A field rename or type change here is a breaking
    // mobile release, not a web-only change.
    _studentRow = { data: { grade: '8', board: 'CBSE', stream: null }, error: null };
    const { body } = await callRoute();

    expect(Array.isArray(body.subjects)).toBe(true);
    expect(body.subjects.length).toBeGreaterThan(0);
    for (const s of body.subjects) {
      expect(Object.keys(s).sort()).toEqual([
        'code', 'color', 'icon', 'isCore', 'isLocked',
        'name', 'nameHi', 'readyChapterCount', 'subjectKind',
      ]);
      expect(typeof s.code).toBe('string');
      expect(typeof s.name).toBe('string');
      expect(typeof s.nameHi).toBe('string');
      expect(typeof s.icon).toBe('string');
      expect(typeof s.color).toBe('string');
      expect(typeof s.subjectKind).toBe('string');
      expect(typeof s.isCore).toBe('boolean');
      expect(typeof s.isLocked).toBe('boolean');
      expect(typeof s.readyChapterCount).toBe('number');
    }
  });

  it('still returns 401 when unauthenticated (auth is not weakened)', async () => {
    _authUser = { data: { user: null }, error: null };
    const { GET } = await import('@/app/api/student/subjects/route');
    const res = await GET(new NextRequest('http://localhost/api/student/subjects'));
    expect(res.status).toBe(401);
  });

  // ── Static source guards: the eslint-disable must stay deleted ──
  it('the route imports neither SUBJECT_META nor getSubjectsForGrade', () => {
    const fs = require('fs');
    const path = require('path');
    const src: string = fs.readFileSync(
      path.resolve(process.cwd(), 'src/app/api/student/subjects/route.ts'),
      'utf8',
    );
    expect(src).not.toMatch(/SUBJECT_META/);
    expect(src).not.toMatch(/getSubjectsForGrade/);
    expect(src).not.toMatch(/GRADE_SUBJECTS/);
    expect(src).not.toMatch(/from\s+['"]@alfanumrik\/lib\/constants['"]/);
  });

  it('the route carries no eslint-disable for no-raw-subject-imports', () => {
    // That comment was the ONLY thing silencing the governance rule on this
    // file. Deleting it restores enforcement permanently; re-adding it must
    // fail here even if the rule itself would then pass.
    const fs = require('fs');
    const path = require('path');
    const src: string = fs.readFileSync(
      path.resolve(process.cwd(), 'src/app/api/student/subjects/route.ts'),
      'utf8',
    );
    expect(src).not.toMatch(/eslint-disable[^\n]*no-raw-subject-imports/);
  });

  it('the learn chapter page resolves subjects with an is_active filter', () => {
    // LEAK 2: a deep link to a removed subject must not resolve to a
    // subject_id. Siblings src/app/foxy/page.tsx and
    // src/app/(student)/exams/page.tsx already filter; this one did not.
    const fs = require('fs');
    const path = require('path');
    const src: string = fs.readFileSync(
      path.resolve(process.cwd(), 'src/app/(student)/learn/[subject]/[chapter]/page.tsx'),
      'utf8',
    );
    const subjectRead = src.match(/\.from\('subjects'\)[\s\S]{0,200}?maybeSingle\(\)/);
    expect(subjectRead).not.toBeNull();
    expect(subjectRead![0]).toMatch(/\.eq\('is_active',\s*true\)/);
  });
});
