// Tests for diagnostic_provider.dart's setup -> quiz-loop -> complete state
// machine, plus the two non-error HTTP 200 stop states the API gained on
// 2026-07-29 (`insufficientContent` and `streamRequired`, both with
// `diagnostic: null`). Follows the same fake-repository + ProviderContainer
// pattern as test/providers/notifications_provider_test.dart.
library;

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:alfanumrik/core/constants/diagnostic_copy.dart';
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
  String? lastGrade;

  _FakeDiagnosticRepository({this.startResult, this.completeResult});

  @override
  Future<ApiResult<DiagnosticStartResult>> start({
    required String grade,
    required String subject,
  }) async {
    startCalls++;
    lastGrade = grade;
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

const _bilingual = DiagnosticBilingual(en: 'English copy', hi: 'हिंदी कॉपी');

void main() {
  ProviderContainer buildContainer(_FakeDiagnosticRepository fake) {
    return ProviderContainer(overrides: [
      studentProvider.overrideWith(_EmptyStudentNotifier.new),
      diagnosticRepositoryProvider.overrideWithValue(fake),
    ]);
  }

  group('grade contract (P5)', () {
    test('accepts grades "6".."12" as STRINGS', () {
      expect(kDiagnosticGrades, ['6', '7', '8', '9', '10', '11', '12']);
      // Every entry is a String, never an int — the route hard-rejects a
      // non-string with 400 INVALID_GRADE.
      for (final g in kDiagnosticGrades) {
        expect(g, isA<String>());
      }
    });

    test('a grade-11 student can start (no client-side 6-10 gate)', () async {
      final fake = _FakeDiagnosticRepository(
        startResult: ApiSuccess(
          DiagnosticFormReady(sessionId: 'sess-11', questions: [_q('q1')]),
        ),
      );
      final container = buildContainer(fake);
      addTearDown(container.dispose);

      final notifier = container.read(diagnosticProvider.notifier)
        ..selectGrade('11')
        ..selectSubject('physics');
      await notifier.start();

      expect(fake.lastGrade, '11');
      expect(container.read(diagnosticProvider).screen, DiagnosticScreenState.quiz);
    });
  });

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
          DiagnosticFormReady(sessionId: 'sess-1', questions: [_q('q1'), _q('q2')]),
        ),
      );
      final container = buildContainer(fake);
      addTearDown(container.dispose);

      final notifier = container.read(diagnosticProvider.notifier)
        ..selectGrade('9')
        ..selectSubject('science');
      await notifier.start();

      final state = container.read(diagnosticProvider);
      expect(state.screen, DiagnosticScreenState.quiz);
      expect(state.sessionId, 'sess-1');
      expect(state.questions, hasLength(2));
      expect(fake.startCalls, 1);
    });

    test('carries the short-form banner when the server sent one', () async {
      final fake = _FakeDiagnosticRepository(
        startResult: ApiSuccess(
          DiagnosticFormReady(
            sessionId: 'sess-1',
            questions: [_q('q1')],
            qualityTier: 'short_form',
            shortForm: true,
            shortFormMessage: _bilingual,
          ),
        ),
      );
      final container = buildContainer(fake);
      addTearDown(container.dispose);

      final notifier = container.read(diagnosticProvider.notifier)
        ..selectGrade('7')
        ..selectSubject('science');
      await notifier.start();

      expect(container.read(diagnosticProvider).shortFormMessage, _bilingual);
    });

    test('selecting a new grade resets the selected subject', () {
      final fake = _FakeDiagnosticRepository();
      final container = buildContainer(fake);
      addTearDown(container.dispose);

      final notifier = container.read(diagnosticProvider.notifier)
        ..selectGrade('9')
        ..selectSubject('science');
      expect(container.read(diagnosticProvider).subject, 'science');

      notifier.selectGrade('6');
      expect(container.read(diagnosticProvider).subject, isNull);
    });

    test('resolves a server error code to bilingual copy (P7)', () async {
      final fake = _FakeDiagnosticRepository(
        startResult: const ApiFailure('INVALID_GRADE'),
      );
      final container = buildContainer(fake);
      addTearDown(container.dispose);

      final notifier = container.read(diagnosticProvider.notifier)
        ..selectGrade('9')
        ..selectSubject('science');
      await notifier.start();

      final error = container.read(diagnosticProvider).setupError;
      expect(error, isNotNull);
      expect(error!.en, isNotEmpty);
      expect(error.hi, isNotEmpty);
      expect(error.hi, isNot(error.en));
      expect(container.read(diagnosticProvider).screen, DiagnosticScreenState.setup);
    });

    test('an unknown key is shown verbatim rather than swallowed', () async {
      final fake = _FakeDiagnosticRepository(
        startResult: const ApiFailure('Something specific from the server.'),
      );
      final container = buildContainer(fake);
      addTearDown(container.dispose);

      final notifier = container.read(diagnosticProvider.notifier)
        ..selectGrade('9')
        ..selectSubject('science');
      await notifier.start();

      expect(container.read(diagnosticProvider).setupError!.en,
          'Something specific from the server.');
    });
  });

  group('HTTP 200 with diagnostic: null', () {
    test('insufficientContent renders its own screen state, not the quiz',
        () async {
      final fake = _FakeDiagnosticRepository(
        startResult: const ApiSuccess(
          DiagnosticInsufficientContent(
            headline: _bilingual,
            message: _bilingual,
            reason: 'INSUFFICIENT_POOL',
            detailReason: 'too_few_items',
            alternatives: [
              DiagnosticAlternative(
                kind: 'foxy',
                label: _bilingual,
                href: '/foxy?subject=math&from=diagnostic_unavailable',
              ),
            ],
          ),
        ),
      );
      final container = buildContainer(fake);
      addTearDown(container.dispose);

      final notifier = container.read(diagnosticProvider.notifier)
        ..selectGrade('12')
        ..selectSubject('math');
      await notifier.start();

      final state = container.read(diagnosticProvider);
      expect(state.screen, DiagnosticScreenState.insufficient);
      expect(state.starting, isFalse); // never an infinite spinner
      expect(state.setupError, isNull); // it is NOT an error
      expect(state.insufficient!.alternatives, hasLength(1));
    });

    test('streamRequired renders its own screen state', () async {
      final fake = _FakeDiagnosticRepository(
        startResult: const ApiSuccess(
          DiagnosticStreamRequired(
            headline: _bilingual,
            message: _bilingual,
            cta: _bilingual,
            streamOptions: ['science', 'commerce', 'humanities'],
          ),
        ),
      );
      final container = buildContainer(fake);
      addTearDown(container.dispose);

      final notifier = container.read(diagnosticProvider.notifier)
        ..selectGrade('11')
        ..selectSubject('math');
      await notifier.start();

      final state = container.read(diagnosticProvider);
      expect(state.screen, DiagnosticScreenState.streamRequired);
      expect(state.starting, isFalse);
      expect(state.setupError, isNull);
      expect(state.streamRequired!.streamOptions, hasLength(3));
    });

    test('switchSubjectAndRestart re-runs start for the suggested subject',
        () async {
      final fake = _FakeDiagnosticRepository(
        startResult: ApiSuccess(
          DiagnosticFormReady(sessionId: 'sess-2', questions: [_q('q1')]),
        ),
      );
      final container = buildContainer(fake);
      addTearDown(container.dispose);

      final notifier = container.read(diagnosticProvider.notifier)
        ..selectGrade('9');
      await notifier.switchSubjectAndRestart('science');

      final state = container.read(diagnosticProvider);
      expect(state.subject, 'science');
      expect(state.screen, DiagnosticScreenState.quiz);
      expect(fake.startCalls, 1);
    });

    test('retakeAnotherSubject clears the stop states', () async {
      final fake = _FakeDiagnosticRepository(
        startResult: const ApiSuccess(
          DiagnosticStreamRequired(
            headline: _bilingual,
            message: _bilingual,
            cta: _bilingual,
            streamOptions: [],
          ),
        ),
      );
      final container = buildContainer(fake);
      addTearDown(container.dispose);

      final notifier = container.read(diagnosticProvider.notifier)
        ..selectGrade('11')
        ..selectSubject('math');
      await notifier.start();
      notifier.retakeAnotherSubject();

      final state = container.read(diagnosticProvider);
      expect(state.screen, DiagnosticScreenState.setup);
      expect(state.streamRequired, isNull);
      expect(state.insufficient, isNull);
      expect(state.grade, '11'); // grade is kept
      expect(state.subject, isNull);
    });
  });

  group('DiagnosticNotifier answer + submit flow', () {
    late ProviderContainer container;
    late _FakeDiagnosticRepository fake;

    setUp(() async {
      fake = _FakeDiagnosticRepository(
        startResult: ApiSuccess(
          DiagnosticFormReady(
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
          placementConfidence: 'normal',
        )),
      );
      container = buildContainer(fake);
      final notifier = container.read(diagnosticProvider.notifier)
        ..selectGrade('9')
        ..selectSubject('science');
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
      // `is_correct` is still sent (wire-compat) even though /complete §C1
      // re-derives correctness server-side and ignores it.
      expect(fake.lastResponses![0].toJson()['is_correct'], isTrue);
      expect(fake.lastResponses![1].toJson()['is_correct'], isFalse);
    });

    test('the displayed score is the SERVER value, never re-derived (P1)', () async {
      // Server says 50% for 1/2 — mobile shows exactly that, and would show
      // whatever the server sent even if it disagreed with the local count.
      final notifier = container.read(diagnosticProvider.notifier);
      notifier.selectOption(1);
      await notifier.next();
      notifier.selectOption(0);
      await notifier.next();

      final summary = container.read(diagnosticProvider).summary!;
      expect(summary.scorePercent, 50);
      expect(summary.correctAnswers, 1);
      expect(summary.recommendedDifficulty, 'medium');
    });
  });

  group('DiagnosticCopy', () {
    test('every mapped error code has non-empty EN and Hindi (P7)', () {
      for (final code in const [
        'INVALID_GRADE',
        'INVALID_SUBJECT',
        'NO_STUDENT',
        'SUBJECT_LOCKED',
        DiagnosticCopy.connectionErrorKey,
        DiagnosticCopy.genericErrorKey,
      ]) {
        final copy = DiagnosticCopy.errorFor(code);
        expect(copy.en, isNotEmpty, reason: code);
        expect(copy.hi, isNotEmpty, reason: code);
        expect(copy.hi, isNot(copy.en), reason: code);
      }
    });

    test('fill() substitutes tokens in both languages', () {
      final filled =
          DiagnosticCopy.insufficientBody.fill({'grade': '9', 'subject': 'science'});
      expect(filled.en.contains('{grade}'), isFalse);
      expect(filled.hi.contains('{grade}'), isFalse);
      expect(filled.en.contains('9'), isTrue);
      expect(filled.hi.contains('9'), isTrue);
    });

    test('unknown tokens are left visible rather than silently dropped', () {
      const copy = DiagnosticBilingual(en: 'Hi {name}', hi: 'नमस्ते {name}');
      final filled = copy.fill(const {});
      expect(filled.en, 'Hi {name}');
      expect(filled.hi, 'नमस्ते {name}');
    });
  });
}
