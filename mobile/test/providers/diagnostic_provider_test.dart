// Tests for diagnostic_provider.dart's setup -> quiz-loop -> complete state
// machine, following the same fake-repository + ProviderContainer pattern as
// test/providers/notifications_provider_test.dart / pyq_provider_test.dart.
library;

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:alfanumrik/core/network/api_result.dart';
import 'package:alfanumrik/data/models/diagnostic_models.dart';
import 'package:alfanumrik/data/models/student.dart';
import 'package:alfanumrik/data/repositories/diagnostic_repository.dart';
import 'package:alfanumrik/providers/auth_provider.dart';
import 'package:alfanumrik/providers/diagnostic_provider.dart';

class _EmptyStudentNotifier extends StudentNotifier {
  @override
  Future<Student?> build() async => null;
}

class _FakeDiagnosticRepository implements DiagnosticRepository {
  ApiResult<DiagnosticStartResult>? startResult;
  ApiResult<DiagnosticSummary>? completeResult;
  int startCalls = 0;
  int completeCalls = 0;
  List<DiagnosticResponseItem>? lastResponses;

  _FakeDiagnosticRepository({this.startResult, this.completeResult});

  @override
  Future<ApiResult<DiagnosticStartResult>> start({
    required String grade,
    required String subject,
  }) async {
    startCalls++;
    return startResult ?? const ApiFailure('no result configured');
  }

  @override
  Future<ApiResult<DiagnosticSummary>> complete({
    required String sessionId,
    required List<DiagnosticResponseItem> responses,
  }) async {
    completeCalls++;
    lastResponses = responses;
    return completeResult ?? const ApiFailure('no result configured');
  }
}

DiagnosticQuestion _q(String id, {int correct = 0}) => DiagnosticQuestion(
      id: id,
      questionText: 'Question $id',
      options: const ['A', 'B', 'C', 'D'],
      correctAnswerIndex: correct,
    );

void main() {
  ProviderContainer buildContainer(_FakeDiagnosticRepository fake) {
    return ProviderContainer(overrides: [
      studentProvider.overrideWith(_EmptyStudentNotifier.new),
      diagnosticRepositoryProvider.overrideWithValue(fake),
    ]);
  }

  group('DiagnosticNotifier.start', () {
    test('sets missingSelection when grade or subject is not chosen', () async {
      final fake = _FakeDiagnosticRepository();
      final container = buildContainer(fake);
      addTearDown(container.dispose);

      await container.read(diagnosticProvider.notifier).start();

      expect(container.read(diagnosticProvider).missingSelection, isTrue);
      expect(fake.startCalls, 0);
    });

    test('transitions to quiz on success', () async {
      final fake = _FakeDiagnosticRepository(
        startResult: ApiSuccess(
          DiagnosticStartResult(sessionId: 'sess-1', questions: [_q('q1'), _q('q2')]),
        ),
      );
      final container = buildContainer(fake);
      addTearDown(container.dispose);

      final notifier = container.read(diagnosticProvider.notifier)
        ..selectGrade('9')
        ..selectSubject('math');
      await notifier.start();

      final state = container.read(diagnosticProvider);
      expect(state.screen, DiagnosticScreenState.quiz);
      expect(state.sessionId, 'sess-1');
      expect(state.questions, hasLength(2));
      expect(fake.startCalls, 1);
    });

    test('selecting a new grade resets the selected subject', () {
      final fake = _FakeDiagnosticRepository();
      final container = buildContainer(fake);
      addTearDown(container.dispose);

      final notifier = container.read(diagnosticProvider.notifier)
        ..selectGrade('9')
        ..selectSubject('physics');
      expect(container.read(diagnosticProvider).subject, 'physics');

      notifier.selectGrade('6');
      expect(container.read(diagnosticProvider).subject, isNull);
    });

    test('surfaces the server error message on failure', () async {
      final fake = _FakeDiagnosticRepository(
        startResult: const ApiFailure('Grade must be between 6 and 10.'),
      );
      final container = buildContainer(fake);
      addTearDown(container.dispose);

      final notifier = container.read(diagnosticProvider.notifier)
        ..selectGrade('9')
        ..selectSubject('math');
      await notifier.start();

      expect(container.read(diagnosticProvider).setupError, 'Grade must be between 6 and 10.');
      expect(container.read(diagnosticProvider).screen, DiagnosticScreenState.setup);
    });
  });

  group('DiagnosticNotifier answer + submit flow', () {
    late ProviderContainer container;
    late _FakeDiagnosticRepository fake;

    setUp(() async {
      fake = _FakeDiagnosticRepository(
        startResult: ApiSuccess(
          DiagnosticStartResult(
            sessionId: 'sess-1',
            questions: [_q('q1', correct: 1), _q('q2', correct: 2)],
          ),
        ),
        completeResult: const ApiSuccess(DiagnosticSummary(
          sessionId: 'sess-1',
          scorePercent: 50,
          correctAnswers: 1,
          totalQuestions: 2,
          weakTopics: [],
          strongTopics: [],
          recommendedDifficulty: 'medium',
        )),
      );
      container = buildContainer(fake);
      final notifier = container.read(diagnosticProvider.notifier)
        ..selectGrade('9')
        ..selectSubject('math');
      await notifier.start();
    });

    tearDown(() => container.dispose());

    test('selectOption stores the tapped index without locking (untimed, no reveal)', () {
      container.read(diagnosticProvider.notifier).selectOption(1);
      expect(container.read(diagnosticProvider).selectedOption, 1);
    });

    test('next() with no selection is a no-op', () async {
      await container.read(diagnosticProvider.notifier).next();
      expect(container.read(diagnosticProvider).currentIdx, 0);
    });

    test('next() advances to the following question and records the response', () async {
      final notifier = container.read(diagnosticProvider.notifier);
      notifier.selectOption(1); // correct for q1
      await notifier.next();

      final state = container.read(diagnosticProvider);
      expect(state.currentIdx, 1);
      expect(state.selectedOption, isNull);
      expect(state.responses, hasLength(1));
      expect(state.responses.single.isCorrect, isTrue);
    });

    test('next() on the last question submits and shows results', () async {
      final notifier = container.read(diagnosticProvider.notifier);
      notifier.selectOption(1); // q1 correct
      await notifier.next();
      notifier.selectOption(0); // q2 incorrect (correct=2)
      await notifier.next();

      final state = container.read(diagnosticProvider);
      expect(state.screen, DiagnosticScreenState.results);
      expect(state.summary?.scorePercent, 50);
      expect(fake.completeCalls, 1);
      expect(fake.lastResponses, hasLength(2));
      expect(fake.lastResponses![0].isCorrect, isTrue);
      expect(fake.lastResponses![1].isCorrect, isFalse);
    });
  });
}
