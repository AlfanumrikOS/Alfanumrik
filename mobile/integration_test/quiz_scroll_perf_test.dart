// Jank driver: QUIZ surface.
//
// The quiz-in-progress surface (quiz_screen.dart `_QuizInProgress`) is a
// `SingleChildScrollView` holding the question + option tiles — NOT a long
// list. Its representative jank sources are therefore two things, and this
// driver exercises BOTH inside one timeline:
//   1. Scrolling a single (deliberately long) question's SingleChildScrollView.
//   2. Paging forward question→question. Each "Next" tap rebuilds the whole
//      question, advances the LinearProgressIndicator, and re-runs the 200 ms
//      AnimatedContainer on every option tile — the quiz's real animation path.
//
// Reported under `quiz_scroll_timeline`; summarized by
// test_driver/perf_driver.dart.
//
// RUN (on a connected PHYSICAL device — see docs/benchmark-runbook.md §2.3):
//   flutter drive \
//     --driver=test_driver/perf_driver.dart \
//     --target=integration_test/quiz_scroll_perf_test.dart \
//     --profile --trace-skia -d "$DEVICE_ID"
//
// NOT run here: no Flutter toolchain / device in this authoring environment.

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';

import 'support/benchmark_harness.dart';

Future<void> main() async {
  final binding = IntegrationTestWidgetsFlutterBinding.ensureInitialized();

  const questionCount = 20;

  testWidgets('quiz surface scroll + question-paging jank timeline',
      (tester) async {
    await pumpQuizBenchmark(tester, questionCount: questionCount);

    final scrollFinder = find.byType(Scrollable);
    expect(
      scrollFinder,
      findsWidgets,
      reason: 'quiz SingleChildScrollView must be present',
    );

    await binding.traceAction(
      () async {
        // 1) Scroll the current question up/down a few times.
        for (var i = 0; i < 3; i++) {
          await tester.fling(scrollFinder.first, const Offset(0, -400), 4000);
          await tester.pumpAndSettle();
          await tester.fling(scrollFinder.first, const Offset(0, 400), 4000);
          await tester.pumpAndSettle();
        }

        // 2) Page forward through the questions. Select option A (the letter
        //    the widget renders via String.fromCharCode(65) — a real, present
        //    finder, not a fabricated key) to enable "Next", then advance.
        //    Stop before the final question so we never hit "Submit" (which
        //    would drive the network submit path — out of scope for a render
        //    benchmark).
        for (var i = 0; i < questionCount - 2; i++) {
          final optionA = find.text('A');
          if (optionA.evaluate().isEmpty) break;
          // Ensure the tile is on-screen after the earlier scroll flings; on a
          // fresh question it starts at the top so this is a no-op.
          await tester.ensureVisible(optionA.first);
          await tester.pump();
          await tester.tap(optionA.first);
          await tester.pump();

          final next = find.text('Next');
          if (next.evaluate().isEmpty) break; // reached last question (Submit)
          await tester.tap(next);
          await tester.pumpAndSettle();
        }
      },
      reportKey: 'quiz_scroll_timeline',
    );
  });
}
