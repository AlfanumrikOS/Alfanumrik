// Widget test for the mock-exam results screen.
//
// THE POINT OF THIS FILE (P1): pin that every number the student sees is the
// number the SERVER returned from POST /api/exams/papers/{id}/submit — not a
// client-side re-derivation. The fixture below is deliberately
// self-inconsistent (the server's score_percent, raw_score and xp_earned
// cannot be produced by any correct/total, raw/max, or review-sum formula),
// so if anyone ever adds local scoring to this screen, these expectations
// fail immediately.
library;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:alfanumrik/data/models/exam_models.dart';
import 'package:alfanumrik/providers/exam_provider.dart';
import 'package:alfanumrik/ui/screens/exam/mock_exam_results_screen.dart';

class _FixedAttemptNotifier extends ExamAttemptNotifier {
  final ExamAttemptState fixed;
  _FixedAttemptNotifier(this.fixed);

  @override
  ExamAttemptState build() => fixed;
}

/// Server scorecard. Note the intentional mismatches:
///   correct/total  = 21/39 → 54%
///   raw/max        = 43/80 → 54%
///   review sum     = 3
///   SERVER says    → 61%, raw 43, xp 137
const _summary = ExamSubmitSummary(
  totalQuestions: 39,
  attemptedCount: 30,
  correctCount: 21,
  wrongCount: 9,
  skippedCount: 9,
  rawScore: 43,
  maxScore: 80,
  scorePercent: 61,
  xpEarned: 137,
  timeTakenSeconds: 5400,
  submittedAt: '2026-07-22T10:00:00Z',
);

const _result = ExamSubmitResult(
  attemptId: 'att-1',
  paperId: 'paper-1',
  summary: _summary,
  review: [
    ExamReviewItem(
      questionId: 'q1',
      questionText: 'What is photosynthesis?',
      options: ['a', 'b', 'c', 'd'],
      responseIndex: 2,
      correctAnswerIndex: 2,
      isCorrect: true,
      marksAwarded: 3,
      explanation: 'Plants convert light to chemical energy.',
    ),
    ExamReviewItem(
      questionId: 'q2',
      questionText: 'Name the powerhouse of the cell.',
      options: ['a', 'b', 'c', 'd'],
      responseIndex: null,
      correctAnswerIndex: 1,
      isCorrect: false,
      marksAwarded: 0,
    ),
  ],
);

Widget _wrap(ExamAttemptState state) {
  return ProviderScope(
    overrides: [
      examAttemptProvider.overrideWith(() => _FixedAttemptNotifier(state)),
    ],
    child: const MaterialApp(home: MockExamResultsScreen(paperId: 'paper-1')),
  );
}

ExamAttemptState _submittedState() => const ExamAttemptState(
      phase: ExamAttemptPhase.submitted,
      submitResult: _result,
    );

void main() {
  group('P1 — the results screen renders the SERVER score verbatim', () {
    testWidgets('shows score_percent exactly as returned', (tester) async {
      await tester.pumpWidget(_wrap(_submittedState()));
      await tester.pumpAndSettle();

      expect(find.byKey(const Key('exam_result_score_percent')), findsOneWidget);
      final scoreText = tester.widget<Text>(
        find.byKey(const Key('exam_result_score_percent')),
      );
      expect(scoreText.data, '61%');

      // The two formulas a client-side recomputation would have used.
      expect(find.text('54%'), findsNothing);
    });

    testWidgets('shows raw_score / max_score, not a sum of review marks', (tester) async {
      await tester.pumpWidget(_wrap(_submittedState()));
      await tester.pumpAndSettle();

      final marks = tester.widget<Text>(find.byKey(const Key('exam_result_marks')));
      expect(marks.data, '43 / 80 marks');

      // Summing the review rows would give 3.
      expect(find.text('3 / 80 marks'), findsNothing);
    });

    testWidgets('shows correct_count and xp_earned from the response', (tester) async {
      await tester.pumpWidget(_wrap(_submittedState()));
      await tester.pumpAndSettle();

      expect(
        tester.widget<Text>(find.byKey(const Key('exam_result_correct'))).data,
        '21',
      );
      // P2: no local XP formula — 21*10 (+20 +50) would be 210/230/280.
      expect(
        tester.widget<Text>(find.byKey(const Key('exam_result_xp'))).data,
        '+137',
      );
      expect(find.text('+210'), findsNothing);
      expect(find.text('+230'), findsNothing);
    });

    testWidgets(
      'the rendered numbers are byte-identical to the fixture summary',
      (tester) async {
        await tester.pumpWidget(_wrap(_submittedState()));
        await tester.pumpAndSettle();

        // Assert against the SOURCE fixture, not hardcoded literals — this
        // stays true if the fixture is ever changed, and only fails if the
        // screen starts deriving its own numbers.
        expect(
          tester.widget<Text>(find.byKey(const Key('exam_result_score_percent'))).data,
          '${_summary.scorePercent}%',
        );
        expect(
          tester.widget<Text>(find.byKey(const Key('exam_result_marks'))).data,
          '${_summary.rawScore} / ${_summary.maxScore} marks',
        );
        expect(
          tester.widget<Text>(find.byKey(const Key('exam_result_correct'))).data,
          '${_summary.correctCount}',
        );
        expect(
          tester.widget<Text>(find.byKey(const Key('exam_result_xp'))).data,
          '+${_summary.xpEarned}',
        );
      },
    );
  });

  group('review + empty states', () {
    testWidgets('renders per-question review with the server marks_awarded',
        (tester) async {
      // The review section sits far below the fold in the default test
      // viewport — give the surface enough height to lay it all out.
      await tester.binding.setSurfaceSize(const Size(500, 3000));
      addTearDown(() => tester.binding.setSurfaceSize(null));

      await tester.pumpWidget(_wrap(_submittedState()));
      await tester.pumpAndSettle();

      expect(find.text('Answer review'), findsOneWidget);
      expect(find.text('What is photosynthesis?'), findsOneWidget);
      expect(find.text('Name the powerhouse of the cell.'), findsOneWidget);
      // Two each: the summary stat-tile label + the per-question badge.
      expect(find.text('Correct'), findsNWidgets(2));
      expect(find.text('Skipped'), findsNWidgets(2));
      expect(find.text('3 marks'), findsOneWidget);
      expect(find.text('0 marks'), findsOneWidget);
    });

    testWidgets('shows a calm empty state when there is no result in session',
        (tester) async {
      await tester.pumpWidget(_wrap(const ExamAttemptState()));
      await tester.pumpAndSettle();

      expect(find.text('No result to show'), findsOneWidget);
      expect(find.byKey(const Key('exam_result_score_percent')), findsNothing);
    });
  });
}
