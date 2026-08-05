/**
 * Phase 3B Wave C — school-admin role→permission MATRIX unit tests (NO DB, NO mocks).
 *
 * Pins the CEO-approved capability matrix (school-admin-auth.ts
 * SCHOOL_ADMIN_ROLE_CAPABILITIES + schoolAdminRoleAllows) cell-by-cell. This is
 * the PURE contract: every (role × matrix-code) pair must match the table the CEO
 * approved on 2026-06-08 (extended 2026-08-05: safeguarding.review, A1
 * safeguarding scope — owner roles only), including the negative carve-outs
 * (academic_coordinator ∌ institution.manage / billing / staff /
 * safeguarding.review; vice_principal ∌ manage_billing / manage_staff /
 * safeguarding.review). A non-matrix code defers (returns allowed) for
 * every role — Wave C only ever NARROWS the RBAC superset, never grants beyond it.
 *
 * If a cell here ever disagrees with the source map, that is a blocking defect:
 * either the matrix drifted from the CEO contract or this contract test is stale.
 * These tests do NOT mock the map — they assert the real exported behaviour.
 */

import { describe, it, expect } from 'vitest';
import {
  schoolAdminRoleAllows,
  type SchoolAdminRole,
} from '@alfanumrik/lib/school-admin-auth';

// ── The 11 matrix-governed permission codes pinned by this grid. ──
// (institution.use_principal_ai is also matrix-governed — principal-only,
// pinned elsewhere.) 'safeguarding.review' added 2026-08-05: CEO full
// approval 2026-08-05 covers this addition under the A1 safeguarding scope
// (Foxy North-Star Phase 1, S5.6/U6) — owner roles only (principal +
// institution_admin); academic_coordinator must NOT read disclosure excerpts.
const MATRIX_CODES = [
  'institution.view_analytics',
  'report.view_class',
  'institution.export_reports',
  'institution.manage_students',
  'institution.manage_teachers',
  'class.manage',
  'institution.manage',
  'institution.manage_billing',
  'institution.view_billing',
  'institution.manage_staff',
  'safeguarding.review',
] as const;

// ── The CEO-approved expected allow/deny per (role × code). ──────────────────
// `true` = role is allowed the code; `false` = explicitly denied by the matrix.
// This literal is the SECOND independent copy of the contract (the source map is
// the first) — they must agree or one of them is wrong.
type Code = (typeof MATRIX_CODES)[number];
const EXPECTED: Record<SchoolAdminRole, Record<Code, boolean>> = {
  principal: {
    'institution.view_analytics': true,
    'report.view_class': true,
    'institution.export_reports': true,
    'institution.manage_students': true,
    'institution.manage_teachers': true,
    'class.manage': true,
    'institution.manage': true,
    'institution.manage_billing': true,
    'institution.view_billing': true,
    'institution.manage_staff': true,
    'safeguarding.review': true, // owner role (CEO 2026-08-05, A1)
  },
  vice_principal: {
    'institution.view_analytics': true,
    'report.view_class': true,
    'institution.export_reports': true,
    'institution.manage_students': true,
    'institution.manage_teachers': true,
    'class.manage': true,
    'institution.manage': true,
    'institution.manage_billing': false, // ✗ carve-out
    'institution.view_billing': true,
    'institution.manage_staff': false, // ✗ carve-out
    'safeguarding.review': false, // ✗ owner roles only (CEO 2026-08-05, A1)
  },
  academic_coordinator: {
    'institution.view_analytics': true,
    'report.view_class': true,
    'institution.export_reports': true,
    'institution.manage_students': true,
    'institution.manage_teachers': true,
    'class.manage': true,
    'institution.manage': false, // ✗ carve-out
    'institution.manage_billing': false, // ✗ carve-out
    'institution.view_billing': false, // ✗ carve-out
    'institution.manage_staff': false, // ✗ carve-out
    'safeguarding.review': false, // ✗ MUST NOT read disclosure excerpts (CEO 2026-08-05, A1)
  },
  institution_admin: {
    'institution.view_analytics': true,
    'report.view_class': true,
    'institution.export_reports': true,
    'institution.manage_students': true,
    'institution.manage_teachers': true,
    'class.manage': true,
    'institution.manage': true,
    'institution.manage_billing': true,
    'institution.view_billing': true,
    'institution.manage_staff': true,
    'safeguarding.review': true, // owner role (multi-school owner equivalent; CEO 2026-08-05, A1)
  },
};

const ALL_ROLES: SchoolAdminRole[] = [
  'principal',
  'vice_principal',
  'academic_coordinator',
  'institution_admin',
];

describe('schoolAdminRoleAllows — full role × matrix-code grid (CEO contract)', () => {
  for (const role of ALL_ROLES) {
    for (const code of MATRIX_CODES) {
      const want = EXPECTED[role][code];
      it(`${role} ${want ? 'ALLOWS' : 'DENIES'} ${code}`, () => {
        expect(schoolAdminRoleAllows(role, code)).toBe(want);
      });
    }
  }
});

describe('schoolAdminRoleAllows — per-role coarse summary (count of allowed matrix codes)', () => {
  function allowedCount(role: SchoolAdminRole): number {
    return MATRIX_CODES.filter((c) => schoolAdminRoleAllows(role, c)).length;
  }

  it('principal allows ALL 11 matrix codes', () => {
    expect(allowedCount('principal')).toBe(11);
  });

  it('institution_admin allows ALL 11 matrix codes (full superset)', () => {
    expect(allowedCount('institution_admin')).toBe(11);
  });

  it('vice_principal allows exactly 8 (denies manage_billing + manage_staff + safeguarding.review)', () => {
    expect(allowedCount('vice_principal')).toBe(8);
    expect(schoolAdminRoleAllows('vice_principal', 'institution.manage_billing')).toBe(false);
    expect(schoolAdminRoleAllows('vice_principal', 'institution.manage_staff')).toBe(false);
    expect(schoolAdminRoleAllows('vice_principal', 'safeguarding.review')).toBe(false);
    // keeps view_billing + institution.manage (the two it is NOT carved out of)
    expect(schoolAdminRoleAllows('vice_principal', 'institution.view_billing')).toBe(true);
    expect(schoolAdminRoleAllows('vice_principal', 'institution.manage')).toBe(true);
  });

  it('academic_coordinator allows exactly the 6 shared codes (no manage, no billing, no staff, no safeguarding)', () => {
    expect(allowedCount('academic_coordinator')).toBe(6);
    const shared = [
      'institution.view_analytics',
      'report.view_class',
      'institution.export_reports',
      'institution.manage_students',
      'institution.manage_teachers',
      'class.manage',
    ];
    for (const c of shared) {
      expect(schoolAdminRoleAllows('academic_coordinator', c)).toBe(true);
    }
    for (const denied of [
      'institution.manage',
      'institution.manage_billing',
      'institution.view_billing',
      'institution.manage_staff',
      // Quality-gate blocker #2 fix: without the matrix row this code was
      // non-governed and DEFERRED — academic_coordinator (who holds
      // institution.view_analytics) would have passed the narrowing gate and
      // read disclosure excerpts under ff_school_admin_rbac.
      'safeguarding.review',
    ]) {
      expect(schoolAdminRoleAllows('academic_coordinator', denied)).toBe(false);
    }
  });
});

describe('schoolAdminRoleAllows — non-matrix codes DEFER (allowed) for every role', () => {
  // Codes outside the matrix union are NOT narrowed by Wave C — authorizeRequest
  // is the authority for them, so schoolAdminRoleAllows must return true (defer).
  const NON_MATRIX = [
    'school.manage_settings',
    'school.manage_modules',
    'some.unknown.code',
    'analytics.read',
  ];

  for (const role of ALL_ROLES) {
    for (const code of NON_MATRIX) {
      it(`${role} defers (allows) non-matrix code ${code}`, () => {
        expect(schoolAdminRoleAllows(role, code)).toBe(true);
      });
    }
  }
});

describe('schoolAdminRoleAllows — defensive: unknown role denies everything', () => {
  it('an impossible role value (not in the map) is denied a matrix code', () => {
    // The DB CHECK constraint makes this unreachable in practice; the conservative
    // default must still be DENY, never an accidental allow.
    expect(
      schoolAdminRoleAllows('superuser' as unknown as SchoolAdminRole, 'institution.manage_staff'),
    ).toBe(false);
  });

  it('an impossible role value is also denied a NON-matrix code (no defer for unknown roles)', () => {
    // The early `if (!allowed) return false` short-circuits before the defer
    // branch, so an unknown role gets nothing at all — strictly fail-closed.
    expect(
      schoolAdminRoleAllows('superuser' as unknown as SchoolAdminRole, 'school.manage_settings'),
    ).toBe(false);
  });
});
