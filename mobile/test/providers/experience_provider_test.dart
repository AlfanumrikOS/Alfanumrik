import 'package:alfanumrik/providers/experience_provider.dart';
import 'package:alfanumrik/providers/role_provider.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('maps only supported native roles to governed web role names', () {
    expect(experienceRoleFor(UserRole.student), 'student');
    expect(experienceRoleFor(UserRole.guardian), 'parent');
    expect(experienceRoleFor(UserRole.unknown), isNull);
  });

  group('server assignment response fails closed', () {
    test('accepts only an explicit enabled 200 response', () {
      expect(
        isOneExperienceResponseEnabled(
          statusCode: 200,
          data: {'enabled': true},
        ),
        isTrue,
      );
    });

    test('rejects disabled, malformed and non-success responses', () {
      expect(
        isOneExperienceResponseEnabled(
          statusCode: 200,
          data: {'enabled': false},
        ),
        isFalse,
      );
      expect(
        isOneExperienceResponseEnabled(
          statusCode: 200,
          data: {'enabled': 'true'},
        ),
        isFalse,
      );
      expect(
        isOneExperienceResponseEnabled(
          statusCode: 503,
          data: {'enabled': true},
        ),
        isFalse,
      );
      expect(
        isOneExperienceResponseEnabled(statusCode: 200, data: null),
        isFalse,
      );
    });
  });
}
