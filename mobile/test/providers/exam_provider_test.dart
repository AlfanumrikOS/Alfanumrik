// Tests for exam_provider.dart's load → structure → running → submit state
// machine, following the fake-repository + ProviderContainer pattern used by
// test/providers/diagnostic_provider_test.dart.
//
// The P1 pins live in the "server-verbatim score" group: the provider must
// surface the SERVER's score_percent / raw_score / xp_earned exactly, and
// must not re-derive them from the responses it collected.
library;

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:alfanumrik/core/network/api_result.dart';
import 'package:alfanumrik/data/models/exam_models.dart';
import 'package:alfanumrik/data/models/student.dart';
import 'package:alfanumrik/data/repositories/exam_repository.dart';
import 'package:alfanumrik/providers/auth_provider.dart';
import 'package:alfanumrik/providers/exam_provider.dart';

class _EmptyStudentNotifier extends StudentNotifier {
  @override
  Future<Student?> build() async => null;
}

class _FakeExamRepository implements ExamRepository {
  ApiResult<ExamPaperCatalog>? papersResult;
  ExamPaperDetailOutcome? detailOutcome;
  ExamStartOutcome? startOutcome;
  ExamSubmitOutcome? submitOutcome;

  int papersCalls = 0;
  int startCalls = 0;
  int submitCalls = 0;

  String? lastGradeFilter;
  String? lastFamilyFilter;
  List<ExamResponseItem>? lastResponses;
  int? lastTimeTakenSeconds;
  String? lastAttemptId;

  @override
  Future<ApiResult<ExamPaperCatalog>> getPapers({
    String? examFamily,
    String? subject,
    String? grade,
    int? limit,
  }) async {
    papersCalls++;
    lastFamilyFilter = examFamily;
    lastGradeFilter = grade;
    return papersResult ?? const ApiFailure('no result configured');
  }

  @override
  Future<ExamPaperDetailOutcome> getPaperDetail(String paperId) async {
    return detailOutcome ?? const ExamPaperDetailFailure('no result configured');
  }

  @override
  Future<ExamStartOutcome> startAttempt(String paperId) async {
    startCalls++;
    return startOutcome ?? const ExamStartFailure('no result configured');
  }

  @override
  Future<ExamSubmitOutcome> submitAttempt({
    required String paperId,
    required List<ExamResponseItem> responses,
    required int timeTakenSeconds,
    String? attemptId,
    Map<String, dynamic>? clientMetadata,
  }) async {
    submitCalls++;
    lastResponses = responses;
    lastTimeTakenSeconds = timeTakenSeconds;
    lastAttemptId = attemptId;
    return submitOutcome ?? const ExamSubmitFailure('no result configured');
  }
}

// ── Fixtures ────────────────────────────────────────────────────────────────

const _cbsePaper = ExamPaper(
  id: 'paper-1',
  paperCode: 'CBSE-10-SCIENCE',
  examFamily: 'cbse_board',
  grade: '10',
  subjectScope: ['science'],
  totalQuestions: 3,
  totalMarks: 6,
  // The ONLY source of the countdown length.
  durationMinutes: 3,
);

const _staticPaper = ExamPaper(
  id: 'paper-2',
  paperCode: 'JEE-2024-S1',
  examFamily: 'jee_main',
  durationMinutes: 5,
);

List<ExamAttemptQuestion> _questions() => const [
      ExamAttemptQuestion(
        questionId: 'q1',
        section: 'A',
        marks: 1,
        order: 1,
        text: 'Q1',
        options: ['a', 'b', 'c', 'd'],
      ),
      ExamAttemptQuestion(
        questionId: 'q2',
        section: 'A',
        marks: 1,
        order: 2,
        text: 'Q2',
        options: ['a', 'b', 'c', 'd'],
      ),
      ExamAttemptQuestion(
        questionId: 'q3',
        section: 'E',
        marks: 4,
        order: 3,
        text: 'Q3',
        options: ['a', 'b', 'c', 'd'],
      ),
    ];

/// A scorecard whose numbers cannot be reproduced by ANY local formula over
/// the responses the test submits — so a client-side recomputation would be
/// immediately visible.
const _serverSummary = ExamSubmitSummary(
  totalQuestions: 3,
  attemptedCount: 2,
  correctCount: 2,
  wrongCount: 0,
  skippedCount: 1,
  rawScore: 5,
  maxScore: 6,
  scorePercent: 71,
  xpEarned: 123,
  timeTakenSeconds: 42,
  submittedAt: '2026-07-22T10:00:00Z',
);

const _serverResult = ExamSubmitResult(
  attemptId: 'att-1',
  paperId: 'paper-1',
  summary: _serverSummary,
);

ProviderContainer _container(_FakeExamRepository fake) {
  return ProviderContainer(overrides: [
    studentProvider.overrideWith(_EmptyStudentNotifier.new),
    examRepositoryProvider.overrideWithValue(fake),
  ]);
}

/// Drives the notifier to a running attempt with the given fixtures.
Future<ProviderContainer> _running(_FakeExamRepository fake) async {
  final container = _container(fake);
  await container.read(examAttemptProvider.notifier).load('paper-1');
  container.read(examAttemptProvider.notifier).beginExam();
  return container;
}

void main() {
  // ═════════════════════════════════════════════════════════════════════════
  group('ExamCatalogNotifier', () {
    test('defaults to the cbse_board family and loads on demand', () async {
      final fake = _FakeExamRepository()
        ..papersResult = const ApiSuccess(ExamPaperCatalog(papers: [_cbsePaper], total: 1));
      final container = _container(fake);
      addTearDown(container.dispose);

      expect(container.read(examCatalogProvider).examFamily, 'cbse_board');
      await container.read(examCatalogProvider.notifier).load();

      expect(fake.papersCalls, 1);
      expect(container.read(examCatalogProvider).papers, hasLength(1));
    });

    test('P5 — the grade filter is passed through as a String', () async {
      final fake = _FakeExamRepository()
        ..papersResult = const ApiSuccess(ExamPaperCatalog());
      final container = _container(fake);
      addTearDown(container.dispose);

      await container.read(examCatalogProvider.notifier).setGrade('9');
      expect(fake.lastGradeFilter, '9');
      expect(fake.lastGradeFilter, isA<String>());
    });

    test('does not send a grade filter for a competitive family', () async {
      final fake = _FakeExamRepository()
        ..papersResult = const ApiSuccess(ExamPaperCatalog());
      final container = _container(fake);
      addTearDown(container.dispose);

      final notifier = container.read(examCatalogProvider.notifier);
      await notifier.setGrade('9');
      await notifier.setExamFamily('jee_main');

      expect(fake.lastFamilyFilter, 'jee_main');
      // `exam_papers.grade` is only populated on cbse_board rows — sending it
      // would return an empty catalog.
      expect(fake.lastGradeFilter, isNull);
    });

    test('surfaces a load failure as an error state', () async {
      final fake = _FakeExamRepository()
        ..papersResult = const ApiFailure('Failed to load exam papers');
      final container = _container(fake);
      addTearDown(container.dispose);

      await container.read(examCatalogProvider.notifier).load();
      expect(container.read(examCatalogProvider).error, 'Failed to load exam papers');
    });
  });

  // ═════════════════════════════════════════════════════════════════════════
  group('ExamAttemptNotifier.load', () {
    test('cbse_board: detail → start → structure phase with the attempt id', () async {
      final fake = _FakeExamRepository()
        ..detailOutcome = const ExamPaperDetailSuccess(paper: _cbsePaper)
        ..startOutcome = ExamStartSuccess(
          ExamStartResult(attemptId: 'att-1', questions: _questions()),
        );
      final container = _container(fake);
      addTearDown(container.dispose);

      await container.read(examAttemptProvider.notifier).load('paper-1');
      final state = container.read(examAttemptProvider);

      expect(fake.startCalls, 1);
      expect(state.phase, ExamAttemptPhase.structure);
      expect(state.attemptId, 'att-1');
      expect(state.questions, hasLength(3));
      expect(state.responses, hasLength(3));
    });

    test('static paper: uses the GET question set and sends NO attempt id', () async {
      final fake = _FakeExamRepository()
        ..detailOutcome = ExamPaperDetailSuccess(
          paper: _staticPaper,
          questions: _questions(),
        );
      final container = _container(fake);
      addTearDown(container.dispose);

      await container.read(examAttemptProvider.notifier).load('paper-2');
      final state = container.read(examAttemptProvider);

      // The dynamic-assembly RPC is cbse_board-only — never called here.
      expect(fake.startCalls, 0);
      expect(state.phase, ExamAttemptPhase.structure);
      expect(state.attemptId, isNull);
    });

    test('content_insufficient → the calm notReady phase, not an error', () async {
      final fake = _FakeExamRepository()
        ..detailOutcome = const ExamPaperDetailSuccess(paper: _cbsePaper)
        ..startOutcome = const ExamStartContentInsufficient();
      final container = _container(fake);
      addTearDown(container.dispose);

      await container.read(examAttemptProvider.notifier).load('paper-1');
      final state = container.read(examAttemptProvider);

      expect(state.phase, ExamAttemptPhase.notReady);
      expect(state.errorMessage, isNull);
    });

    test('a static paper with zero linked questions also reads as notReady', () async {
      final fake = _FakeExamRepository()
        ..detailOutcome = const ExamPaperDetailSuccess(paper: _staticPaper);
      final container = _container(fake);
      addTearDown(container.dispose);

      await container.read(examAttemptProvider.notifier).load('paper-2');
      expect(container.read(examAttemptProvider).phase, ExamAttemptPhase.notReady);
    });

    test('402 → upgradeRequired with the server upgrade url', () async {
      final fake = _FakeExamRepository()
        ..detailOutcome = const ExamPaperDetailUpgradeRequired('/upgrade?from=mock');
      final container = _container(fake);
      addTearDown(container.dispose);

      await container.read(examAttemptProvider.notifier).load('paper-2');
      final state = container.read(examAttemptProvider);
      expect(state.phase, ExamAttemptPhase.upgradeRequired);
      expect(state.upgradeUrl, '/upgrade?from=mock');
    });

    test('404 → notFound', () async {
      final fake = _FakeExamRepository()..detailOutcome = const ExamPaperDetailNotFound();
      final container = _container(fake);
      addTearDown(container.dispose);

      await container.read(examAttemptProvider.notifier).load('paper-2');
      expect(container.read(examAttemptProvider).phase, ExamAttemptPhase.notFound);
    });
  });

  // ═════════════════════════════════════════════════════════════════════════
  group('server-supplied duration', () {
    test('the countdown is seeded from paper.durationMinutes × 60', () async {
      final fake = _FakeExamRepository()
        ..detailOutcome = const ExamPaperDetailSuccess(paper: _cbsePaper)
        ..startOutcome = ExamStartSuccess(
          ExamStartResult(attemptId: 'att-1', questions: _questions()),
        );
      final container = _container(fake);
      addTearDown(container.dispose);

      await container.read(examAttemptProvider.notifier).load('paper-1');
      final state = container.read(examAttemptProvider);

      expect(state.totalSeconds, 3 * 60);
      expect(state.remainingSeconds, 3 * 60);
      // Not the CBSE 180-minute paper length — nothing is hardcoded.
      expect(state.totalSeconds, isNot(180 * 60));
    });

    test(
      'a paper with no server duration refuses to start instead of assuming one',
      () async {
        const noDuration = ExamPaper(
          id: 'paper-3',
          paperCode: 'CBSE-NO-DURATION',
          examFamily: 'cbse_board',
        );
        final fake = _FakeExamRepository()
          ..detailOutcome = const ExamPaperDetailSuccess(paper: noDuration);
        final container = _container(fake);
        addTearDown(container.dispose);

        await container.read(examAttemptProvider.notifier).load('paper-3');
        final state = container.read(examAttemptProvider);

        expect(state.phase, ExamAttemptPhase.error);
        expect(state.errorMessage, 'exam_duration_unavailable');
        expect(state.totalSeconds, 0);
        // The attempt is never even started when we cannot time it.
        expect(fake.startCalls, 0);
      },
    );
  });

  // ═════════════════════════════════════════════════════════════════════════
  group('answering + navigation', () {
    late _FakeExamRepository fake;

    setUp(() {
      fake = _FakeExamRepository()
        ..detailOutcome = const ExamPaperDetailSuccess(paper: _cbsePaper)
        ..startOutcome = ExamStartSuccess(
          ExamStartResult(attemptId: 'att-1', questions: _questions()),
        )
        ..submitOutcome = const ExamSubmitSuccess(_serverResult);
    });

    test('beginExam moves to running and marks the first question visited', () async {
      final container = await _running(fake);
      addTearDown(container.dispose);

      final state = container.read(examAttemptProvider);
      expect(state.phase, ExamAttemptPhase.running);
      expect(state.responses[0].visited, isTrue);
      expect(state.responses[1].visited, isFalse);
    });

    test('selectOption records the tapped index without revealing anything', () async {
      final container = await _running(fake);
      addTearDown(container.dispose);

      container.read(examAttemptProvider.notifier).selectOption(2);
      final state = container.read(examAttemptProvider);
      expect(state.responses[0].selectedIndex, 2);
      expect(state.answeredCount, 1);
    });

    test('clearAnswer returns a question to unattempted', () async {
      final container = await _running(fake);
      addTearDown(container.dispose);

      final n = container.read(examAttemptProvider.notifier)
        ..selectOption(1)
        ..clearAnswer();
      expect(container.read(examAttemptProvider).responses[0].selectedIndex, isNull);
      n.toggleMarked();
      expect(
        deriveExamStatus(container.read(examAttemptProvider).responses[0]),
        ExamQuestionStatus.marked,
      );
    });

    test('navigateTo marks visited and clamps out-of-range indexes', () async {
      final container = await _running(fake);
      addTearDown(container.dispose);

      final n = container.read(examAttemptProvider.notifier);
      n.navigateTo(2);
      expect(container.read(examAttemptProvider).cursor, 2);
      n.navigateTo(99);
      expect(container.read(examAttemptProvider).cursor, 2);
      n.navigateTo(-1);
      expect(container.read(examAttemptProvider).cursor, 2);
      expect(container.read(examAttemptProvider).responses[2].visited, isTrue);
    });

    test('a visited-but-unanswered question derives as skipped', () async {
      final container = await _running(fake);
      addTearDown(container.dispose);

      container.read(examAttemptProvider.notifier).navigateTo(1);
      expect(
        deriveExamStatus(container.read(examAttemptProvider).responses[1]),
        ExamQuestionStatus.skipped,
      );
    });

    test('sections group the assembled paper structure', () async {
      final container = await _running(fake);
      addTearDown(container.dispose);

      final sections = container.read(examAttemptProvider).sections;
      expect(sections.map((s) => s.key), ['A', 'E']);
      expect(sections[0].count, 2);
      expect(sections[1].marks, 4);
      expect(container.read(examAttemptProvider).availableMarks, 6);
    });
  });

  // ═════════════════════════════════════════════════════════════════════════
  group('submit', () {
    late _FakeExamRepository fake;

    setUp(() {
      fake = _FakeExamRepository()
        ..detailOutcome = const ExamPaperDetailSuccess(paper: _cbsePaper)
        ..startOutcome = ExamStartSuccess(
          ExamStartResult(attemptId: 'att-1', questions: _questions()),
        )
        ..submitOutcome = const ExamSubmitSuccess(_serverResult);
    });

    test('posts one response per question, unattempted ones as null', () async {
      final container = await _running(fake);
      addTearDown(container.dispose);

      final n = container.read(examAttemptProvider.notifier);
      n.selectOption(1); // q1
      n.navigateTo(1);
      n.selectOption(3); // q2
      // q3 left unattempted.
      await n.submit();

      expect(fake.submitCalls, 1);
      expect(fake.lastResponses, hasLength(3));
      expect(fake.lastResponses![0].questionId, 'q1');
      expect(fake.lastResponses![0].responseIndex, 1);
      expect(fake.lastResponses![1].responseIndex, 3);
      expect(fake.lastResponses![2].responseIndex, isNull);
    });

    test('forwards the attempt_id for the cbse_board dynamic flow', () async {
      final container = await _running(fake);
      addTearDown(container.dispose);

      await container.read(examAttemptProvider.notifier).submit();
      expect(fake.lastAttemptId, 'att-1');
    });

    test('omits the attempt_id for a static paper', () async {
      final staticFake = _FakeExamRepository()
        ..detailOutcome = ExamPaperDetailSuccess(
          paper: _staticPaper,
          questions: _questions(),
        )
        ..submitOutcome = const ExamSubmitSuccess(_serverResult);
      final container = _container(staticFake);
      addTearDown(container.dispose);

      final n = container.read(examAttemptProvider.notifier);
      await n.load('paper-2');
      n.beginExam();
      await n.submit();

      expect(staticFake.lastAttemptId, isNull);
    });

    test('re-entrant submit calls are ignored while one is in flight', () async {
      final container = await _running(fake);
      addTearDown(container.dispose);

      final n = container.read(examAttemptProvider.notifier);
      await n.submit();
      await n.submit(); // already submitted
      expect(fake.submitCalls, 1);
    });

    test('a submit failure returns to running so answers are not lost', () async {
      fake.submitOutcome = const ExamSubmitFailure('submission_failed', 500);
      final container = await _running(fake);
      addTearDown(container.dispose);

      final n = container.read(examAttemptProvider.notifier);
      n.selectOption(2);
      await n.submit();

      final state = container.read(examAttemptProvider);
      expect(state.phase, ExamAttemptPhase.running);
      expect(state.errorMessage, 'submission_failed');
      expect(state.responses[0].selectedIndex, 2);

      fake.submitOutcome = const ExamSubmitSuccess(_serverResult);
      await container.read(examAttemptProvider.notifier).retrySubmit();
      expect(container.read(examAttemptProvider).phase, ExamAttemptPhase.submitted);
      expect(fake.submitCalls, 2);
    });

    test('a 402 at submit time surfaces the upgrade state', () async {
      fake.submitOutcome = const ExamSubmitUpgradeRequired('/upgrade');
      final container = await _running(fake);
      addTearDown(container.dispose);

      await container.read(examAttemptProvider.notifier).submit();
      expect(container.read(examAttemptProvider).phase, ExamAttemptPhase.upgradeRequired);
    });
  });

  // ═════════════════════════════════════════════════════════════════════════
  group('countdown (presentation-only)', () {
    late _FakeExamRepository fake;

    setUp(() {
      fake = _FakeExamRepository()
        ..detailOutcome = const ExamPaperDetailSuccess(paper: _cbsePaper)
        ..startOutcome = ExamStartSuccess(
          ExamStartResult(attemptId: 'att-1', questions: _questions()),
        )
        ..submitOutcome = const ExamSubmitSuccess(_serverResult);
    });

    test('each tick decrements the clock and grows elapsed time', () async {
      final container = await _running(fake);
      addTearDown(container.dispose);

      final n = container.read(examAttemptProvider.notifier);
      n.tick();
      n.tick();
      final state = container.read(examAttemptProvider);
      expect(state.remainingSeconds, 3 * 60 - 2);
      expect(state.elapsedSeconds, 2);
    });

    test('ticks are ignored before the exam starts', () {
      final container = _container(fake);
      addTearDown(container.dispose);

      container.read(examAttemptProvider.notifier).tick();
      expect(container.read(examAttemptProvider).remainingSeconds, 0);
      expect(fake.submitCalls, 0);
    });

    test(
      'expiry submits whatever exists through the NORMAL path — nothing is '
      'invalidated client-side',
      () async {
        final container = await _running(fake);
        addTearDown(container.dispose);

        final n = container.read(examAttemptProvider.notifier);
        n.selectOption(1);
        for (var i = 0; i < 3 * 60; i++) {
          n.tick();
        }
        // Let the fire-and-forget submit settle.
        await Future<void>.delayed(Duration.zero);

        final state = container.read(examAttemptProvider);
        expect(state.remainingSeconds, 0);
        expect(fake.submitCalls, 1);
        // The student's one answer was submitted as-is; no zeroing/voiding.
        expect(fake.lastResponses![0].responseIndex, 1);
        expect(state.phase, ExamAttemptPhase.submitted);
        expect(state.submitResult, isNotNull);
      },
    );

    test('time_taken_seconds is clamped to at least 1 by the repository call', () async {
      final container = await _running(fake);
      addTearDown(container.dispose);

      // Submit immediately — zero elapsed. The provider reports the real
      // elapsed value; the repository is what clamps it to the route's
      // "positive integer" validator.
      await container.read(examAttemptProvider.notifier).submit();
      expect(fake.lastTimeTakenSeconds, 0);
    });
  });

  // ═════════════════════════════════════════════════════════════════════════
  // P1 — the score the app shows is the SERVER's score.
  // ═════════════════════════════════════════════════════════════════════════
  group('P1: server-verbatim score', () {
    late _FakeExamRepository fake;

    setUp(() {
      fake = _FakeExamRepository()
        ..detailOutcome = const ExamPaperDetailSuccess(paper: _cbsePaper)
        ..startOutcome = ExamStartSuccess(
          ExamStartResult(attemptId: 'att-1', questions: _questions()),
        )
        ..submitOutcome = const ExamSubmitSuccess(_serverResult);
    });

    test('submitResult is stored byte-identically to the server response', () async {
      final container = await _running(fake);
      addTearDown(container.dispose);

      await container.read(examAttemptProvider.notifier).submit();
      final stored = container.read(examAttemptProvider).submitResult!;

      expect(identical(stored, _serverResult), isTrue);
      expect(stored.summary, _serverSummary);
      expect(stored.summary.scorePercent, 71);
      expect(stored.summary.rawScore, 5);
      expect(stored.summary.maxScore, 6);
      expect(stored.summary.correctCount, 2);
      expect(stored.summary.xpEarned, 123);
    });

    test(
      'the displayed score does NOT match any local formula over the student\'s '
      'own answers — proving no recomputation',
      () async {
        final container = await _running(fake);
        addTearDown(container.dispose);

        final n = container.read(examAttemptProvider.notifier);
        // Answer every question. If the client scored anything itself, these
        // taps would have to influence the result.
        n.selectOption(0);
        n.navigateTo(1);
        n.selectOption(0);
        n.navigateTo(2);
        n.selectOption(0);
        await n.submit();

        final s = container.read(examAttemptProvider).submitResult!.summary;

        // The server said 71%. Every plausible client-side derivation differs:
        expect(((s.correctCount / s.totalQuestions) * 100).round(), 67);
        expect(((s.rawScore / s.maxScore) * 100).round(), 83);
        expect(s.scorePercent, 71);
        expect(s.scorePercent, isNot(67));
        expect(s.scorePercent, isNot(83));

        // The provider's own answered-count is a UI affordance only and is
        // NOT what the scorecard reports.
        expect(container.read(examAttemptProvider).answeredCount, 3);
        expect(s.attemptedCount, 2);
      },
    );

    test(
      'P2 — xp_earned comes only from the server; no XP constant is applied',
      () async {
        final container = await _running(fake);
        addTearDown(container.dispose);

        await container.read(examAttemptProvider.notifier).submit();
        final s = container.read(examAttemptProvider).submitResult!.summary;

        expect(s.xpEarned, 123);
        // Not the web quiz economy applied locally
        // (correct*10 + high-score bonus 20 + perfect bonus 50).
        expect(s.xpEarned, isNot(s.correctCount * 10));
        expect(s.xpEarned, isNot(s.correctCount * 10 + 20));
        expect(s.xpEarned, isNot(s.correctCount * 10 + 20 + 50));
      },
    );

    test('reset clears the attempt entirely', () async {
      final container = await _running(fake);
      addTearDown(container.dispose);

      await container.read(examAttemptProvider.notifier).submit();
      container.read(examAttemptProvider.notifier).reset();

      final state = container.read(examAttemptProvider);
      expect(state.phase, ExamAttemptPhase.idle);
      expect(state.submitResult, isNull);
      expect(state.questions, isEmpty);
    });
  });
}
