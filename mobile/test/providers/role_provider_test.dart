// Tests for the role-fork mapping (Wave 2.4 parent surface).
//
// `mapPrimaryRole` is the pure heart of the guardian↔student fork: it turns the
// `get_user_role` RPC payload (the SAME RPC web's AuthContext calls) into a
// [UserRole]. The router uses guardian → /parent, everything-else → student
// flow. Unknown remains a distinct fail-closed result so a transient/odd
// payload can never fork a guardian, teacher or operator into the student tree.
//
// Pure — no Supabase, no network.
import 'package:flutter_test/flutter_test.dart';
import 'package:alfanumrik/providers/role_provider.dart';

void main() {
  group('mapPrimaryRole — object shape { primary_role }', () {
    test('guardian → UserRole.guardian', () {
      expect(mapPrimaryRole({'primary_role': 'guardian'}), UserRole.guardian);
    });

    test('student → UserRole.student', () {
      expect(mapPrimaryRole({'primary_role': 'student'}), UserRole.student);
    });

    test(
      'teacher → UserRole.unknown (not surfaced on mobile; never guardian)',
      () {
        expect(mapPrimaryRole({'primary_role': 'teacher'}), UserRole.unknown);
      },
    );

    test('none → UserRole.unknown', () {
      expect(mapPrimaryRole({'primary_role': 'none'}), UserRole.unknown);
    });

    test('ignores extra roles[] field, reads primary_role only', () {
      expect(
        mapPrimaryRole({
          'primary_role': 'guardian',
          'roles': ['guardian', 'student'],
        }),
        UserRole.guardian,
      );
    });
  });

  group('mapPrimaryRole — defensive shapes', () {
    test('bare string "guardian" → UserRole.guardian', () {
      expect(mapPrimaryRole('guardian'), UserRole.guardian);
    });

    test('bare string "student" → UserRole.student', () {
      expect(mapPrimaryRole('student'), UserRole.student);
    });

    test('null → UserRole.unknown', () {
      expect(mapPrimaryRole(null), UserRole.unknown);
    });

    test('empty map → UserRole.unknown', () {
      expect(mapPrimaryRole(<String, dynamic>{}), UserRole.unknown);
    });

    test('unexpected type (int) → UserRole.unknown', () {
      expect(mapPrimaryRole(42), UserRole.unknown);
    });

    test('primary_role of wrong type → UserRole.unknown', () {
      expect(mapPrimaryRole({'primary_role': 7}), UserRole.unknown);
    });
  });
}
