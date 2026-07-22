// Tests for revision_provider.dart's two notifiers:
//   - RevisionOverviewNotifier (the /refresh overview aggregate fetch)
//   - QuickRecallNotifier (the flashcard flip-and-rate state machine)
//
// Follows the same fake-repository + ProviderContainer pattern as
// test/providers/notifications_provider_test.dart and
// test/providers/challenge_provider_test.dart.
//
// SAFETY: none of these tests assert on any SM-2 schedule VALUE the fake
// repository returns from gradeCard — that would risk baking a formula
// assumption into a mobile test. They only assert on CALL COUNTS / CALL
// ARGUMENTS (was gradeCard called once, with which cardId/quality) and on
// screen-state transitions (advance to next card / done). The actual SM-2
// math is exclusively the server's responsibility.
library;

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:alfanumrik/core/network/api_result.dart';
import 'package:alfanumrik/data/models/revision_models.dart';
import 'package:alfanumrik/data/models/student.dart';
import 'package:alfanumrik/data/repositories/revision_repository.dart';
import 'package:alfanumrik/providers/auth_provider.dart';
import 'package:alfanumrik/providers/revision_provider.dart';

class _FixedStudentNotifier extends StudentNotifier {
  @override
  Future<Student?> build() async => const Student(
        id: 'student-1',
        authUserId: 'auth-1',
        name: 'Test Student',
        grade: '8',
      );
}

class _EmptyStudentNotifier extends StudentNotifier {
  @override
  Future<Student?> build() async => null;
}

RevisionCard _card(String id) => RevisionCard(
      id: id,
      subject: 'math',
      topic: 'math:3:$id',
      chapterTitle: 'Chapter 3',
      frontText: 'front-$id',
      backText: 'back-$id',
      hint: '',
      easeFactor: 2.5,
      intervalDays: 1,
      streak: 0,
      repetitionCount: 0,
      totalReviews: 0,
      correctReviews: 0,
    );

class _FakeRevisionRepository implements RevisionRepository {
  List<RevisionCard> cards;
  List<RevisionStackItem> stack;
  List<RevisionRetentionTest> tests;
  bool gradeShouldFail;

  int getCardsCalls = 0;
  int getStackCalls = 0;
  int getTestsCalls = 0;
  int gradeCalls = 0;
  final List<(String cardId, int quality)> gradeArgs = [];

  _FakeRevisionRepository({
    this.cards = const [],
    this.stack = const [],
    this.tests = const [],
    this.gradeShouldFail = false,
  });

  @override
  Future<ApiResult<List<RevisionCard>>> getQuickRecallCards({
    required String studentId,
    int limit = 20,
  }) async {
    getCardsCalls++;
    return ApiSuccess(cards);
  }

  @override
  Future<ApiResult<RevisionGradeResult>> gradeCard({
    required String cardId,
    required int quality,
  }) async {
    gradeCalls++;
    gradeArgs.add((cardId, quality));
    if (gradeShouldFail) {
      return const ApiFailure('grade failed');
    }
    return ApiSuccess(RevisionGradeResult.fromJson({
      'id': cardId,
      'ease_factor': 2.5,
      'interval_days': 1,
      'streak': 1,
      'repetition_count': 1,
      'next_review_date': '2026-07-22',
      'last_review_date': '2026-07-21',
      'last_quality': quality,
      'total_reviews': 1,
      'correct_reviews': quality >= 3 ? 1 : 0,
    }));
  }

  @override
  Future<ApiResult<List<RevisionStackItem>>> getReviseStack() async {
    getStackCalls++;
    return ApiSuccess(stack);
  }

  @override
  Future<ApiResult<List<RevisionRetentionTest>>> getRetentionTests({
    required String studentId,
    int limit = 5,
  }) async {
    getTestsCalls++;
    return ApiSuccess(tests);
  }
}

void main() {
  group('RevisionOverviewNotifier.build', () {
    test('returns an empty overview when there is no student', () async {
      final fake = _FakeRevisionRepository(cards: [_card('c1')]);
      final container = ProviderContainer(overrides: [
        studentProvider.overrideWith(_EmptyStudentNotifier.new),
        revisionRepositoryProvider.overrideWithValue(fake),
      ]);
      addTearDown(container.dispose);
      // Resolve studentProvider's own async build FIRST. Both notifiers read
      // `studentProvider` synchronously (via `.valueOrNull`) inside their own
      // build/load — without this, a not-yet-resolved studentProvider reads
      // as `null` on the first pass, which looks identical to "no student".
      await container.read(studentProvider.future);

      final overview = await container.read(revisionOverviewProvider.future);
      expect(overview.quickRecallCount, 0);
      expect(overview.reviseStack, isEmpty);
      expect(overview.retentionTests, isEmpty);
      expect(overview.isAllEmpty, isTrue);
      expect(fake.getCardsCalls, 0);
    });

    test('aggregates all three sections for the current student', () async {
      final fake = _FakeRevisionRepository(
        cards: [_card('c1'), _card('c2')],
        stack: const [
          RevisionStackItem(
            subjectCode: 'science',
            chapterNumber: 4,
            mastery: 0.4,
            daysSinceLastTouch: 10,
            recommendedModality: RevisionModality.read,
            url: '/learn/science/4',
          ),
        ],
        tests: const [
          RevisionRetentionTest(
            id: 'rt-1',
            topicTitle: 'Newton',
            subject: 'physics',
            predictedRetention: 0.3,
            scheduledDate: '2026-07-20',
          ),
        ],
      );
      final container = ProviderContainer(overrides: [
        studentProvider.overrideWith(_FixedStudentNotifier.new),
        revisionRepositoryProvider.overrideWithValue(fake),
      ]);
      addTearDown(container.dispose);
      // Resolve studentProvider's own async build FIRST. Both notifiers read
      // `studentProvider` synchronously (via `.valueOrNull`) inside their own
      // build/load — without this, a not-yet-resolved studentProvider reads
      // as `null` on the first pass, which looks identical to "no student".
      await container.read(studentProvider.future);

      final overview = await container.read(revisionOverviewProvider.future);
      expect(overview.quickRecallCount, 2);
      expect(overview.reviseStack, hasLength(1));
      expect(overview.retentionTests, hasLength(1));
      expect(overview.isAllEmpty, isFalse);
      expect(fake.getCardsCalls, 1);
      expect(fake.getStackCalls, 1);
      expect(fake.getTestsCalls, 1);
    });

    test('caps quickRecallCount at 5 even with more due cards', () async {
      final fake = _FakeRevisionRepository(
        cards: List.generate(9, (i) => _card('c$i')),
      );
      final container = ProviderContainer(overrides: [
        studentProvider.overrideWith(_FixedStudentNotifier.new),
        revisionRepositoryProvider.overrideWithValue(fake),
      ]);
      addTearDown(container.dispose);
      // Resolve studentProvider's own async build FIRST. Both notifiers read
      // `studentProvider` synchronously (via `.valueOrNull`) inside their own
      // build/load — without this, a not-yet-resolved studentProvider reads
      // as `null` on the first pass, which looks identical to "no student".
      await container.read(studentProvider.future);

      final overview = await container.read(revisionOverviewProvider.future);
      expect(overview.quickRecallCount, kQuickRecallDisplayLimit);
    });

    test('isAllEmpty is true only when every section is empty', () async {
      final fake = _FakeRevisionRepository();
      final container = ProviderContainer(overrides: [
        studentProvider.overrideWith(_FixedStudentNotifier.new),
        revisionRepositoryProvider.overrideWithValue(fake),
      ]);
      addTearDown(container.dispose);
      // Resolve studentProvider's own async build FIRST. Both notifiers read
      // `studentProvider` synchronously (via `.valueOrNull`) inside their own
      // build/load — without this, a not-yet-resolved studentProvider reads
      // as `null` on the first pass, which looks identical to "no student".
      await container.read(studentProvider.future);

      final overview = await container.read(revisionOverviewProvider.future);
      expect(overview.isAllEmpty, isTrue);
    });
  });

  group('QuickRecallNotifier.load', () {
    test('transitions to empty when there are no due cards', () async {
      final fake = _FakeRevisionRepository(cards: const []);
      final container = ProviderContainer(overrides: [
        studentProvider.overrideWith(_FixedStudentNotifier.new),
        revisionRepositoryProvider.overrideWithValue(fake),
      ]);
      addTearDown(container.dispose);
      // Resolve studentProvider's own async build FIRST. Both notifiers read
      // `studentProvider` synchronously (via `.valueOrNull`) inside their own
      // build/load — without this, a not-yet-resolved studentProvider reads
      // as `null` on the first pass, which looks identical to "no student".
      await container.read(studentProvider.future);

      await container.read(quickRecallProvider.notifier).load();
      final state = container.read(quickRecallProvider);
      expect(state.pageState, QuickRecallPageState.empty);
    });

    test('transitions to playing with cards capped at 5', () async {
      final fake = _FakeRevisionRepository(
        cards: List.generate(8, (i) => _card('c$i')),
      );
      final container = ProviderContainer(overrides: [
        studentProvider.overrideWith(_FixedStudentNotifier.new),
        revisionRepositoryProvider.overrideWithValue(fake),
      ]);
      addTearDown(container.dispose);
      // Resolve studentProvider's own async build FIRST. Both notifiers read
      // `studentProvider` synchronously (via `.valueOrNull`) inside their own
      // build/load — without this, a not-yet-resolved studentProvider reads
      // as `null` on the first pass, which looks identical to "no student".
      await container.read(studentProvider.future);

      await container.read(quickRecallProvider.notifier).load();
      final state = container.read(quickRecallProvider);
      expect(state.pageState, QuickRecallPageState.playing);
      expect(state.cards, hasLength(kQuickRecallDisplayLimit));
      expect(state.currentIndex, 0);
    });
  });

  group('QuickRecallNotifier.flip / revealHint', () {
    test('flip toggles the flipped flag while playing', () async {
      final fake = _FakeRevisionRepository(cards: [_card('c1')]);
      final container = ProviderContainer(overrides: [
        studentProvider.overrideWith(_FixedStudentNotifier.new),
        revisionRepositoryProvider.overrideWithValue(fake),
      ]);
      addTearDown(container.dispose);
      // Resolve studentProvider's own async build FIRST. Both notifiers read
      // `studentProvider` synchronously (via `.valueOrNull`) inside their own
      // build/load — without this, a not-yet-resolved studentProvider reads
      // as `null` on the first pass, which looks identical to "no student".
      await container.read(studentProvider.future);

      await container.read(quickRecallProvider.notifier).load();
      expect(container.read(quickRecallProvider).flipped, isFalse);

      container.read(quickRecallProvider.notifier).flip();
      expect(container.read(quickRecallProvider).flipped, isTrue);

      container.read(quickRecallProvider.notifier).flip();
      expect(container.read(quickRecallProvider).flipped, isFalse);
    });
  });

  group('QuickRecallNotifier.rate', () {
    test('grades the current card and advances to the next', () async {
      final fake = _FakeRevisionRepository(cards: [_card('c1'), _card('c2')]);
      final container = ProviderContainer(overrides: [
        studentProvider.overrideWith(_FixedStudentNotifier.new),
        revisionRepositoryProvider.overrideWithValue(fake),
      ]);
      addTearDown(container.dispose);
      // Resolve studentProvider's own async build FIRST. Both notifiers read
      // `studentProvider` synchronously (via `.valueOrNull`) inside their own
      // build/load — without this, a not-yet-resolved studentProvider reads
      // as `null` on the first pass, which looks identical to "no student".
      await container.read(studentProvider.future);

      await container.read(quickRecallProvider.notifier).load();
      await container.read(quickRecallProvider.notifier).rate(4);

      expect(fake.gradeCalls, 1);
      expect(fake.gradeArgs.single, ('c1', 4));
      final state = container.read(quickRecallProvider);
      expect(state.currentIndex, 1);
      expect(state.pageState, QuickRecallPageState.playing);
      expect(state.flipped, isFalse);
    });

    test('rating the last card transitions to done', () async {
      final fake = _FakeRevisionRepository(cards: [_card('c1')]);
      final container = ProviderContainer(overrides: [
        studentProvider.overrideWith(_FixedStudentNotifier.new),
        revisionRepositoryProvider.overrideWithValue(fake),
      ]);
      addTearDown(container.dispose);
      // Resolve studentProvider's own async build FIRST. Both notifiers read
      // `studentProvider` synchronously (via `.valueOrNull`) inside their own
      // build/load — without this, a not-yet-resolved studentProvider reads
      // as `null` on the first pass, which looks identical to "no student".
      await container.read(studentProvider.future);

      await container.read(quickRecallProvider.notifier).load();
      await container.read(quickRecallProvider.notifier).rate(5);

      final state = container.read(quickRecallProvider);
      expect(state.pageState, QuickRecallPageState.done);
      expect(fake.gradeArgs.single, ('c1', 5));
    });

    test('double-rating the same card (stray double tap) does not call the server twice',
        () async {
      final fake = _FakeRevisionRepository(cards: [_card('c1'), _card('c2')]);
      final container = ProviderContainer(overrides: [
        studentProvider.overrideWith(_FixedStudentNotifier.new),
        revisionRepositoryProvider.overrideWithValue(fake),
      ]);
      addTearDown(container.dispose);
      // Resolve studentProvider's own async build FIRST. Both notifiers read
      // `studentProvider` synchronously (via `.valueOrNull`) inside their own
      // build/load — without this, a not-yet-resolved studentProvider reads
      // as `null` on the first pass, which looks identical to "no student".
      await container.read(studentProvider.future);

      await container.read(quickRecallProvider.notifier).load();
      // Rate card 1 twice back-to-back without the state machine having
      // advanced in between is impossible via the public API in a single
      // synchronous call, but a fast repeat rate() call before load's
      // advance would be blocked by the reviewedCardIds guard once the
      // first grade lands on the same id. This test exercises the guard by
      // calling rate() again on the SAME index using an unawaited call.
      final first = container.read(quickRecallProvider.notifier).rate(4);
      final second = container.read(quickRecallProvider.notifier).rate(4);
      await Future.wait([first, second]);

      // At most the first in-flight call should have reached the server for
      // card 'c1' — the guard prevents a genuine double submit once the id
      // is marked reviewed.
      expect(fake.gradeArgs.where((a) => a.$1 == 'c1').length, lessThanOrEqualTo(1));
    });

    test('advances even when the server grade call fails (never blocks the flow)',
        () async {
      final fake = _FakeRevisionRepository(
        cards: [_card('c1'), _card('c2')],
        gradeShouldFail: true,
      );
      final container = ProviderContainer(overrides: [
        studentProvider.overrideWith(_FixedStudentNotifier.new),
        revisionRepositoryProvider.overrideWithValue(fake),
      ]);
      addTearDown(container.dispose);
      // Resolve studentProvider's own async build FIRST. Both notifiers read
      // `studentProvider` synchronously (via `.valueOrNull`) inside their own
      // build/load — without this, a not-yet-resolved studentProvider reads
      // as `null` on the first pass, which looks identical to "no student".
      await container.read(studentProvider.future);

      await container.read(quickRecallProvider.notifier).load();
      await container.read(quickRecallProvider.notifier).rate(0);

      final state = container.read(quickRecallProvider);
      expect(state.currentIndex, 1);
      expect(fake.gradeCalls, 1);
    });
  });
}
