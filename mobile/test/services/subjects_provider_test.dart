import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:alfanumrik/core/services/subjects_provider.dart';
import 'package:alfanumrik/data/models/subject.dart';

class _FakeSubjectsService implements SubjectsService {
  final List<Subject> _result;
  final Object? _throwError;
  int calls = 0;

  _FakeSubjectsService(this._result, {Object? throwError})
      : _throwError = throwError;

  @override
  Future<List<Subject>> fetchAllowedSubjects() async {
    calls++;
    if (_throwError != null) throw _throwError;
    return _result;
  }
}

void main() {
  group('Subject.fromJson', () {
    test('parses the /api/student/subjects shape', () {
      final subject = Subject.fromJson({
        'code': 'math',
        'name': 'Mathematics',
        'nameHi': 'गणित',
        'icon': '∑',
        'color': '#6C5CE7',
        'subjectKind': 'cbse_core',
        'isCore': true,
        'isLocked': false,
      });

      expect(subject.code, 'math');
      expect(subject.name, 'Mathematics');
      expect(subject.nameHi, 'गणित');
      expect(subject.icon, '∑');
      expect(subject.color, '#6C5CE7');
      expect(subject.subjectKind, 'cbse_core');
      expect(subject.isCore, isTrue);
      expect(subject.isLocked, isFalse);
    });

    test('falls back to name when nameHi is missing', () {
      final s = Subject.fromJson({
        'code': 'english',
        'name': 'English',
        'icon': 'Aa',
        'color': '#E17055',
        'subjectKind': 'cbse_core',
        'isCore': true,
        'isLocked': false,
      });
      expect(s.nameHi, 'English');
    });
  });

  group('subjectsProvider', () {
    test('returns parsed Subject objects from the service', () async {
      final fake = _FakeSubjectsService(const [
        Subject(
          code: 'math',
          name: 'Mathematics',
          nameHi: 'गणित',
          icon: '∑',
          color: '#6C5CE7',
          subjectKind: 'cbse_core',
          isCore: true,
          isLocked: false,
        ),
        Subject(
          code: 'physics',
          name: 'Physics',
          nameHi: 'भौतिकी',
          icon: '⚡',
          color: '#2563EB',
          subjectKind: 'cbse_core',
          isCore: true,
          isLocked: true,
        ),
      ]);

      final container = ProviderContainer(overrides: [
        subjectsServiceProvider.overrideWithValue(fake),
      ]);
      addTearDown(container.dispose);

      final result = await container.read(subjectsProvider.future);

      expect(fake.calls, 1);
      expect(result, hasLength(2));
      expect(result[0].code, 'math');
      expect(result[0].isLocked, isFalse);
      expect(result[1].code, 'physics');
      expect(result[1].isLocked, isTrue);
    });

    test('propagates errors from the service', () async {
      final fake = _FakeSubjectsService(
        const [],
        throwError: Exception('network down'),
      );

      final container = ProviderContainer(overrides: [
        subjectsServiceProvider.overrideWithValue(fake),
      ]);
      addTearDown(container.dispose);

      await expectLater(
        container.read(subjectsProvider.future),
        throwsA(isA<Exception>()),
      );
    });
  });
}
