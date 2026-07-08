/**
 * Phase 3B Wave C — school-admin role→permission MATRIX unit tests (NO DB, NO mocks).
 *
 * Pins the CEO-approved capability matrix (school-admin-auth.ts
 * SCHOOL_ADMIN_ROLE_CAPABILITIES + schoolAdminRoleAllows) cell-by-cell. This is
 * the PURE contract: every (role × matrix-code) pair must match the table the CEO
 * approved on 2026-06-08, including the negative carve-outs
 * (academic_coordinator ∌ institution.manage / billing / staff; vice_principal ∌
 * manage_billing / manage_staff). A non-matrix code defers (returns allowed) for
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

// ── The 10 matrix-governed permission codes (the union across all four roles). ──
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

  it('principal allows ALL 10 matrix codes', () => {
    expect(allowedCount('principal')).toBe(10);
  });

  it('institution_admin allows ALL 10 matrix codes (full superset)', () => {
    expect(allowedCount('institution_admin')).toBe(10);
  });

  it('vice_principal allows exactly 8 (denies manage_billing + manage_staff only)', () => {
    expect(allowedCount('vice_principal')).toBe(8);
    expect(schoolAdminRoleAllows('vice_principal', 'institution.manage_billing')).toBe(false);
    expect(schoolAdminRoleAllows('vice_principal', 'institution.manage_staff')).toBe(false);
    // keeps view_billing + institution.manage (the two it is NOT carved out of)
    expect(schoolAdminRoleAllows('vice_principal', 'institution.view_billing')).toBe(true);
    expect(schoolAdminRoleAllows('vice_principal', 'institution.manage')).toBe(true);
  });

  it('academic_coordinator allows exactly the 6 shared codes (no manage, no billing, no staff)', () => {
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
