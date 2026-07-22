// Tests for pyq_provider.dart's state machine (select -> quiz -> done),
// following the same fake-repository + ProviderContainer pattern as
// test/providers/notifications_provider_test.dart.
library;

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:alfanumrik/core/network/api_result.dart';
import 'package:alfanumrik/data/models/pyq_models.dart';
import 'package:alfanumrik/data/repositories/pyq_repository.dart';
import 'package:alfanumrik/providers/pyq_provider.dart';

class _FakePyqRepository implements PyqRepository {
  final ApiResult<PyqFetchResult> result;
  int fetchCalls = 0;

  _FakePyqRepository(this.result);

  @override
  Future<ApiResult<PyqFetchResult>> fetchQuestions({
    required String subject,
    required String grade,
    required int year,
  }) async {
    fetchCalls++;
    return result;
  }
}

PyqQuestion _q(String id, {int correct = 0}) => PyqQuestion(
      id: id,
      questionText: 'Question $id',
      options: const ['A', 'B', 'C', 'D'],
      correctAnswerIndex: correct,
    );

void main() {
  group('PyqNotifier select flow', () {
    test('selectSubject / selectYear update state without fetching', () {
      final fake = _FakePyqRepository(const ApiSuccess(PyqFetchResult(questions: [], isFallback: false)));
      final container = ProviderContainer(overrides: [
        pyqRepositoryProvider.overrideWithValue(fake),
      ]);
      addTearDown(container.dispose);

      container.read(pyqProvider.notifier).selectSubject('math');
      container.read(pyqProvider.notifier).selectYear(2024);

      final state = container.read(pyqProvider);
      expect(state.selectedSubjectCode, 'math');
      expect(state.selectedYear, 2024);
      expect(fake.fetchCalls, 0);
    });
  });

  group('PyqNotifier.startPractice', () {
    test('transitions to quiz with year-tagged questions (isFallback false)', () async {
      final fake = _FakePyqRepository(
        ApiSuccess(PyqFetchResult(questions: [_q('q1'), _q('q2')], isFallback: false)),
      );
      final container = ProviderContainer(overrides: [
        pyqRepositoryProvider.overrideWithValue(fake),
      ]);
      addTearDown(container.dispose);

      container.read(pyqProvider.notifier)
        ..selectSubject('math')
        ..selectYear(2024);
      await container.read(pyqProvider.notifier).startPractice(grade: '9');

      final state = container.read(pyqProvider);
      expect(state.screen, PyqScreenState.quiz);
      expect(state.questions, hasLength(2));
      expect(state.isFallback, isFalse);
      expect(fake.fetchCalls, 1);
    });

    test('is a no-op when subject or year is not selected', () async {
      final fake = _FakePyqRepository(const ApiSuccess(PyqFetchResult(questions: [], isFallback: false)));
      final container = ProviderContainer(overrides: [
        pyqRepositoryProvider.overrideWithValue(fake),
      ]);
      addTearDown(container.dispose);

      await container.read(pyqProvider.notifier).startPractice(grade: '9');
      expect(fake.fetchCalls, 0);
      expect(container.read(pyqProvider).screen, PyqScreenState.select);
    });
  });

  group('PyqNotifier answer + navigation flow', () {
    late ProviderContainer container;

    setUp(() async {
      final fake = _FakePyqRepository(
        ApiSuccess(PyqFetchResult(
          questions: [_q('q1', correct: 1), _q('q2', correct: 2)],
          isFallback: true,
        )),
      );
      container = ProviderContainer(overrides: [
        pyqRepositoryProvider.overrideWithValue(fake),
      ]);
      container.read(pyqProvider.notifier)
        ..selectSubject('science')
        ..selectYear(2020);
      await container.read(pyqProvider.notifier).startPractice(grade: '10');
    });

    tearDown(() => container.dispose());

    test('selectAnswer locks in the answer and increments correctCount on a hit', () {
      container.read(pyqProvider.notifier).selectAnswer(1); // correct for q1
      final state = container.read(pyqProvider);

      expect(state.selectedOption, 1);
      expect(state.showExplanation, isTrue);
      expect(state.correctCount, 1);
    });

    test('selectAnswer does not increment correctCount on a miss', () {
      container.read(pyqProvider.notifier).selectAnswer(0); // wrong for q1 (correct=1)
      expect(container.read(pyqProvider).correctCount, 0);
    });

    test('selectAnswer is locked once answered (no re-answering)', () {
      final notifier = container.read(pyqProvider.notifier);
      notifier.selectAnswer(1); // correct
      notifier.selectAnswer(0); // should be ignored
      expect(container.read(pyqProvider).correctCount, 1);
      expect(container.read(pyqProvider).selectedOption, 1);
    });

    test('nextQuestion advances to the next question and clears selection', () {
      final notifier = container.read(pyqProvider.notifier);
      notifier.selectAnswer(1);
      notifier.nextQuestion();

      final state = container.read(pyqProvider);
      expect(state.currentIdx, 1);
      expect(state.selectedOption, isNull);
      expect(state.showExplanation, isFalse);
      expect(state.screen, PyqScreenState.quiz);
    });

    test('nextQuestion on the last question transitions to done', () {
      final notifier = container.read(pyqProvider.notifier);
      notifier.selectAnswer(1); // q1 correct
      notifier.nextQuestion();
      notifier.selectAnswer(2); // q2 correct
      notifier.nextQuestion();

      final state = container.read(pyqProvider);
      expect(state.screen, PyqScreenState.done);
      expect(state.correctCount, 2);
    });

    test('restart resets fully back to the select screen', () {
      container.read(pyqProvider.notifier).restart();
      final state = container.read(pyqProvider);
      expect(state.screen, PyqScreenState.select);
      expect(state.selectedSubjectCode, isNull);
      expect(state.questions, isEmpty);
    });
  });
}
