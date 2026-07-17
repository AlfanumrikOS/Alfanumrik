// Jank driver: CHAPTER LIST scroll.
//
// Measures build + raster frame times while fling-scrolling the real
// ChaptersScreen ListView (chapters_screen.dart) over a 60-item synthetic
// dataset. The captured timeline is reported under `chapter_list_scroll_timeline`
// and summarized into a jank report by test_driver/perf_driver.dart.
//
// RUN (on a connected PHYSICAL device — see docs/benchmark-runbook.md §2.3):
//   flutter drive \
//     --driver=test_driver/perf_driver.dart \
//     --target=integration_test/chapter_list_scroll_perf_test.dart \
//     --profile --trace-skia -d "$DEVICE_ID"
//
// NOT run here: no Flutter toolchain / device is available in this authoring
// environment. `flutter analyze` / `flutter test` / `flutter drive` MUST be
// validated in CI and on-device.

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';

import 'support/benchmark_harness.dart';

Future<void> main() async {
  final binding = IntegrationTestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('chapter list scroll jank timeline', (tester) async {
    await pumpChapterListBenchmark(tester, chapterCount: 60);

    // ChaptersScreen has exactly one Scrollable (the ListView.separated). No
    // fabricated key — we target the real widget type.
    final listFinder = find.byType(Scrollable);
    expect(
      listFinder,
      findsWidgets,
      reason: 'chapters ListView must be present before scrolling',
    );

    await binding.traceAction(
      () async {
        // Five fling cycles down-then-up. High velocity + long distance keeps
        // the scroll physics animating for many frames, which is exactly the
        // window we want the timeline to cover.
        for (var i = 0; i < 5; i++) {
          await tester.fling(listFinder.first, const Offset(0, -600), 5000);
          await tester.pumpAndSettle();
          await tester.fling(listFinder.first, const Offset(0, 600), 5000);
          await tester.pumpAndSettle();
        }
      },
      reportKey: 'chapter_list_scroll_timeline',
    );
  });
}
