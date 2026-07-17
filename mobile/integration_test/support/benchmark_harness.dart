// Physical-device benchmark harness — shared scaffolding for the jank drivers.
//
// WHY THIS FILE EXISTS
// --------------------
// The chapter-list and quiz surfaces are both data-driven (Riverpod providers
// backed by Supabase / the /v2 REST client). Booting the real app (main.dart)
// for a jank benchmark would drag in Supabase.initialize(), Hive, Sentry and a
// live network round-trip — none of which we want in a RENDER benchmark, and
// none of which are available in CI. So this harness pumps the REAL screen
// widgets (ChaptersScreen, QuizScreen) directly, with the providers those
// screens read overridden to return large, DETERMINISTIC, in-memory datasets.
// What we measure is Flutter's build + raster pipeline for the actual shipping
// widget trees — not the network.
//
// NO FABRICATED WIDGET KEYS
// -------------------------
// chapters_screen.dart and quiz_screen.dart currently expose NO stable
// `Key`s and no `ListView` `contentType`s (verified 2026-07-17). The drivers
// therefore target real, already-present finders — `find.byType(Scrollable)`
// for the scrollables and `find.text('A')` for the quiz option letter that the
// widget renders via `String.fromCharCode(65 + i)`. We do NOT invent keys.
// Adding `ValueKey`s to the chapter rows and quiz option tiles is a
// recommended (not required) prerequisite for long-term finder stability —
// see docs/benchmark-runbook.md §"Prerequisites & known gaps".
//
// This whole directory is a dev/CI-and-device-only artifact. It never ships:
// integration_test + flutter_driver are dev_dependencies (see pubspec.yaml).

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:alfanumrik/data/models/chapter.dart';
import 'package:alfanumrik/data/models/quiz_question.dart';
import 'package:alfanumrik/data/models/student.dart';
import 'package:alfanumrik/data/repositories/learning_repository.dart';
import 'package:alfanumrik/providers/auth_provider.dart';
import 'package:alfanumrik/providers/learning_provider.dart';
import 'package:alfanumrik/providers/quiz_provider.dart';
import 'package:alfanumrik/ui/screens/learning/chapters_screen.dart';
import 'package:alfanumrik/ui/screens/quiz/quiz_screen.dart';

/// 60 fps frame budget in microseconds. A frame whose build (or raster) time
/// exceeds this is "jank". 1000 ms / 60 = 16.666… ms → 16667 µs. The driver
/// (test_driver/perf_driver.dart) computes the P95 and the % of frames over
/// this budget from the captured `frame_build_times` / `frame_rasterizer_times`
/// arrays, which Flutter reports in microseconds.
const int kJankBudgetMicros = 16667;

/// Same budget expressed in milliseconds, for docs / assertions.
const double kJankBudgetMillis = 1000 / 60; // 16.666…

// ─────────────────────────────────────────────────────────────────────────
// Synthetic data builders (deterministic — no RNG, so runs are comparable)
// ─────────────────────────────────────────────────────────────────────────

/// A realistically-long chapter title so each row has representative text
/// layout cost (not a one-word stub). Deterministic per chapter number.
String _chapterTitle(int n) {
  const stems = <String>[
    'Force, Motion and the Laws that Govern Everyday Movement',
    'Structure of the Atom and the Periodic Arrangement of Elements',
    'Life Processes: Nutrition, Respiration, Transport and Excretion',
    'Light — Reflection, Refraction and the Behaviour of Lenses',
    'Linear Equations, Ratios and Proportional Reasoning in Practice',
    'Our Environment, Ecosystems and the Flow of Energy in Nature',
  ];
  return stems[n % stems.length];
}

/// Build a large, deterministic chapter list so the ListView actually scrolls.
List<Chapter> benchmarkChapters({
  int count = 60,
  String subjectCode = 'science',
  String grade = '8',
}) {
  return List<Chapter>.generate(count, (i) {
    final n = i + 1;
    final topicCount = 4 + (i % 6);
    return Chapter(
      id: 'bench-chapter-$n',
      title: _chapterTitle(n),
      chapterNumber: n,
      subjectCode: subjectCode,
      grade: grade,
      topicCount: topicCount,
      // Mix of zero / partial progress so ~half the rows also paint the
      // CircularProgressIndicator ring (extra layout + raster per row).
      completedTopics: i.isEven ? (i % topicCount) : 0,
    );
  });
}

/// Long question + long options so a SINGLE quiz question has real vertical
/// extent to scroll on a phone viewport, and the option tiles carry
/// representative text-layout cost.
QuizQuestion _benchmarkQuestion(int n, String subject, String grade) {
  final body = 'Q$n. A uniform metre scale is balanced at its centre. When a '
      '20 g mass is hung at the 10 cm mark and a 30 g mass at the 90 cm mark, '
      'analyse the net turning effect about the pivot and determine the '
      'direction in which the scale rotates, explaining each step of your '
      'reasoning before selecting the single best option below.';
  String opt(String letter, String tail) =>
      'Option $letter — $tail (question $n). This distractor is written long '
      'enough to exercise multi-line text layout inside the option tile.';
  return QuizQuestion(
    id: 'bench-q-$n',
    questionText: body,
    options: <String>[
      opt('A', 'the scale rotates clockwise about the pivot'),
      opt('B', 'the scale rotates anticlockwise about the pivot'),
      opt('C', 'the scale stays in rotational equilibrium'),
      opt('D', 'there is insufficient information to decide'),
    ],
    // -1 = server-authoritative sentinel, exactly as the v2 shuffle path sets
    // it. The client never scores locally; the benchmark never submits.
    correctIndex: -1,
    subject: subject,
    grade: grade,
    difficulty: 1 + (n % 5),
    bloomLevel: 'understand',
  );
}

/// Build a deterministic in-progress quiz of [count] questions.
List<QuizQuestion> benchmarkQuestions({
  int count = 20,
  String subject = 'science',
  String grade = '8',
}) {
  return List<QuizQuestion>.generate(
    count,
    (i) => _benchmarkQuestion(i + 1, subject, grade),
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Provider overrides — replace the network-backed providers with in-memory
// fakes so the real widgets render without Supabase / Dio / the /v2 client.
// ─────────────────────────────────────────────────────────────────────────

/// Replaces [studentProvider] so screens see a signed-in student WITHOUT
/// touching `Supabase.instance` (which is never initialised in the harness).
class _BenchmarkStudentNotifier extends StudentNotifier {
  @override
  Future<Student?> build() async => const Student(
        id: 'bench-student',
        authUserId: 'bench-auth-user',
        name: 'Benchmark Student',
        grade: '8',
      );
}

/// Replaces [quizProvider] with a notifier pre-seeded into the "quiz in
/// progress" state so QuizScreen renders `_QuizInProgress` immediately. The
/// real navigation methods (selectAnswer / nextQuestion) are inherited
/// unchanged and touch no network; the driver never calls submitQuiz().
class _BenchmarkQuizNotifier extends QuizNotifier {
  _BenchmarkQuizNotifier(this._seed);

  final List<QuizQuestion> _seed;

  @override
  QuizState build() {
    final now = DateTime.now();
    return QuizState(
      questions: _seed,
      subject: 'science',
      startedAt: now,
      currentQuestionStartedAt: now,
      // serverSessionId intentionally null → the offline/submit branches stay
      // inert. This harness only exercises display + in-quiz navigation.
    );
  }
}

/// Pump the REAL [ChaptersScreen] with a large synthetic chapter list.
Future<void> pumpChapterListBenchmark(
  WidgetTester tester, {
  int chapterCount = 60,
}) async {
  const subjectCode = 'science';
  await tester.pumpWidget(
    ProviderScope(
      overrides: <Override>[
        studentProvider.overrideWith(_BenchmarkStudentNotifier.new),
        // #1322 changed chaptersProvider to return the LearnData envelope
        // (LearnData<List<Chapter>>) instead of the bare List<Chapter>, so the
        // override wraps the synthetic list. serve: LearnServe.live = the happy
        // path (no offline "as of {date}" chip); the fixtures are unchanged.
        chaptersProvider.overrideWith(
          (ref, code) async => LearnData<List<Chapter>>(
            benchmarkChapters(count: chapterCount, subjectCode: code),
            serve: LearnServe.live,
          ),
        ),
      ],
      // Plain MaterialApp (no GoRouter): the driver only scrolls; it never taps
      // a chapter row (whose onTap calls context.go). Building the screen does
      // not reference the router.
      child: const MaterialApp(home: ChaptersScreen(subjectCode: subjectCode)),
    ),
  );
  await tester.pumpAndSettle();
}

/// Pump the REAL [QuizScreen] pre-seeded into an in-progress quiz.
Future<void> pumpQuizBenchmark(
  WidgetTester tester, {
  int questionCount = 20,
}) async {
  final questions = benchmarkQuestions(count: questionCount);
  await tester.pumpWidget(
    ProviderScope(
      overrides: <Override>[
        studentProvider.overrideWith(_BenchmarkStudentNotifier.new),
        quizProvider.overrideWith(() => _BenchmarkQuizNotifier(questions)),
      ],
      child: const MaterialApp(home: QuizScreen()),
    ),
  );
  await tester.pumpAndSettle();
}
