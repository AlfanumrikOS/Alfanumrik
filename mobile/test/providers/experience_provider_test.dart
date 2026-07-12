import 'package:alfanumrik/providers/experience_provider.dart';
import 'package:alfanumrik/providers/role_provider.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('maps only supported native roles to governed web role names', () {
    expect(experienceRoleFor(UserRole.student), 'student');
    expect(experienceRoleFor(UserRole.guardian), 'parent');
    expect(experienceRoleFor(UserRole.unknown), isNull);
  });

  test('includes the active child in parent assignment resolution only', () {
    expect(experienceV3QueryParameters('parent', childId: 'child-2'), {
      'role': 'parent',
      'childId': 'child-2',
    });
    expect(experienceV3QueryParameters('student', childId: 'child-2'), {
      'role': 'student',
    });
  });

  group('server assignment response is tri-state and fail-closed', () {
    test('accepts only explicit boolean assignments on a 200 response', () {
      expect(
        resolveOneExperienceAssignment(
          statusCode: 200,
          data: {'enabled': true},
        ),
        OneExperienceAssignment.enabled,
      );
      expect(
        resolveOneExperienceAssignment(
          statusCode: 200,
          data: {'enabled': false},
        ),
        OneExperienceAssignment.legacy,
      );
    });

    test('denies malformed, authorization and server-error responses', () {
      expect(
        resolveOneExperienceAssignment(
          statusCode: 200,
          data: {'enabled': 'true'},
        ),
        OneExperienceAssignment.denied,
      );
      for (final status in [401, 403, 500, 503]) {
        expect(
          resolveOneExperienceAssignment(
            statusCode: status,
            data: {'enabled': status == 401 ? false : true},
          ),
          OneExperienceAssignment.denied,
        );
      }
      expect(
        resolveOneExperienceAssignment(statusCode: 200, data: null),
        OneExperienceAssignment.denied,
      );
    });
  });
}
