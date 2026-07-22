import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../data/models/revision_models.dart';
import '../data/repositories/revision_repository.dart';
import 'auth_provider.dart';

final revisionRepositoryProvider = Provider<RevisionRepository>((ref) {
  return RevisionRepository();
});

/// Number of Quick Recall cards fetched/displayed on the overview screen and
/// the initial page of the flashcard flow — mirrors the web's
/// `.slice(0, 5)` in `QuickRecallSection.tsx`.
const int kQuickRecallDisplayLimit = 5;

/// Aggregate state for the `/refresh` overview screen — mobile parity for
/// `apps/host/src/app/refresh/page.tsx`'s three auto-hiding sections.
class RevisionOverviewState {
  final int quickRecallCount;
  final List<RevisionStackItem> reviseStack;
  final List<RevisionRetentionTest> retentionTests;

  const RevisionOverviewState({
    this.quickRecallCount = 0,
    this.reviseStack = const <RevisionStackItem>[],
    this.retentionTests = const <RevisionRetentionTest>[],
  });

  /// True when all three sections are empty — the caller then shows the
  /// single "Nothing to refresh right now" nudge (mirrors the web's
  /// `sectionACount === 0` check, extended to all three sections since
  /// mobile renders them in a single fetch rather than three independent
  /// components).
  bool get isAllEmpty =>
      quickRecallCount == 0 && reviseStack.isEmpty && retentionTests.isEmpty;

  @override
  String toString() =>
      'RevisionOverviewState(quickRecallCount: $quickRecallCount, '
      'reviseStack: ${reviseStack.length}, retentionTests: ${retentionTests.length})';
}

final revisionOverviewProvider =
    AsyncNotifierProvider<RevisionOverviewNotifier, RevisionOverviewState>(
  RevisionOverviewNotifier.new,
);

class RevisionOverviewNotifier extends AsyncNotifier<RevisionOverviewState> {
  @override
  Future<RevisionOverviewState> build() => _fetch();

  /// Pull-to-refresh / retry.
  Future<void> refresh() async {
    state = const AsyncLoading();
    state = await AsyncValue.guard(_fetch);
  }

  Future<RevisionOverviewState> _fetch() async {
    final student = ref.watch(studentProvider).valueOrNull;
    if (student == null) return const RevisionOverviewState();

    final repo = ref.watch(revisionRepositoryProvider);

    // Fetch the same 20-candidate window the web fetches, then take the
    // first 5 — matches `getDomainReviewCards(student.id, 20)` +
    // `.slice(0, 5)` in `QuickRecallSection.tsx`.
    final cardsResult = await repo.getQuickRecallCards(
      studentId: student.id,
      limit: 20,
    );
    final stackResult = await repo.getReviseStack();
    final testsResult = await repo.getRetentionTests(studentId: student.id);

    final cards = cardsResult.dataOrNull ?? const <RevisionCard>[];
    return RevisionOverviewState(
      quickRecallCount: cards.length > kQuickRecallDisplayLimit
          ? kQuickRecallDisplayLimit
          : cards.length,
      reviseStack: stackResult.dataOrNull ?? const <RevisionStackItem>[],
      retentionTests: testsResult.dataOrNull ?? const <RevisionRetentionTest>[],
    );
  }
}

/// Screen states for the Quick Recall flashcard flow — mirrors the implicit
/// state machine in `QuickRecallSection.tsx` (`loading` → cards.isEmpty
/// null-render vs the card-flip UI, then empties out again when the last
/// card is graded).
enum QuickRecallPageState { loading, empty, playing, done }

class QuickRecallState {
  final QuickRecallPageState pageState;
  final List<RevisionCard> cards;
  final int currentIndex;
  final bool flipped;
  final bool showHint;

  const QuickRecallState({
    this.pageState = QuickRecallPageState.loading,
    this.cards = const <RevisionCard>[],
    this.currentIndex = 0,
    this.flipped = false,
    this.showHint = false,
  });

  RevisionCard? get currentCard =>
      currentIndex < cards.length ? cards[currentIndex] : null;

  QuickRecallState copyWith({
    QuickRecallPageState? pageState,
    List<RevisionCard>? cards,
    int? currentIndex,
    bool? flipped,
    bool? showHint,
  }) {
    return QuickRecallState(
      pageState: pageState ?? this.pageState,
      cards: cards ?? this.cards,
      currentIndex: currentIndex ?? this.currentIndex,
      flipped: flipped ?? this.flipped,
      showHint: showHint ?? this.showHint,
    );
  }
}

final quickRecallProvider =
    NotifierProvider<QuickRecallNotifier, QuickRecallState>(
  QuickRecallNotifier.new,
);

/// Quick Recall flashcard flow — mobile parity for the card-flip + rate UI
/// in `packages/ui/src/refresh/QuickRecallSection.tsx`.
///
/// SAFETY: [rate] never computes an SM-2 schedule itself. It POSTs
/// `{cardId, quality}` to the server via
/// [RevisionRepository.gradeCard] and discards the response body other than
/// using it to confirm success — the server-returned new schedule is not
/// needed by this screen (the card simply advances, exactly like the web).
class QuickRecallNotifier extends Notifier<QuickRecallState> {
  final Set<String> _reviewedCardIds = <String>{};
  final List<DateTime> _reviewTimestamps = <DateTime>[];

  /// Mirrors the web's `MAX_REVIEWS_PER_MINUTE = 20` client-side throttle
  /// (defense-in-depth; the server is the real rate limiter).
  static const int _maxReviewsPerMinute = 20;

  @override
  QuickRecallState build() => const QuickRecallState();

  /// Full data-fetch. Call on screen entry and on retry.
  Future<void> load() async {
    final student = ref.read(studentProvider).valueOrNull;
    if (student == null) {
      state = const QuickRecallState(pageState: QuickRecallPageState.empty);
      return;
    }

    state = state.copyWith(pageState: QuickRecallPageState.loading);
    _reviewedCardIds.clear();
    _reviewTimestamps.clear();

    final repo = ref.read(revisionRepositoryProvider);
    final result = await repo.getQuickRecallCards(studentId: student.id, limit: 20);
    final cards = (result.dataOrNull ?? const <RevisionCard>[])
        .take(kQuickRecallDisplayLimit)
        .toList(growable: false);

    if (cards.isEmpty) {
      state = const QuickRecallState(pageState: QuickRecallPageState.empty);
      return;
    }

    state = QuickRecallState(pageState: QuickRecallPageState.playing, cards: cards);
  }

  void flip() {
    if (state.pageState != QuickRecallPageState.playing) return;
    state = state.copyWith(flipped: !state.flipped);
  }

  void revealHint() {
    if (state.pageState != QuickRecallPageState.playing) return;
    state = state.copyWith(showHint: true);
  }

  /// Rate the current card. [quality] is one of `0` (forgot), `3` (hard),
  /// `4` (good), `5` (easy) — the same 4 buttons the web exposes.
  Future<void> rate(int quality) async {
    if (state.pageState != QuickRecallPageState.playing) return;
    final card = state.currentCard;
    if (card == null) return;

    // Double-rate guard: same card rated twice (e.g. a stray double tap)
    // just advances without a second server call.
    if (_reviewedCardIds.contains(card.id)) {
      _advance();
      return;
    }

    final now = DateTime.now();
    _reviewTimestamps.removeWhere((t) => now.difference(t).inSeconds >= 60);
    if (_reviewTimestamps.length >= _maxReviewsPerMinute) return;
    _reviewTimestamps.add(now);

    _reviewedCardIds.add(card.id);

    final repo = ref.read(revisionRepositoryProvider);
    final result = await repo.gradeCard(cardId: card.id, quality: quality);
    if (result.isFailure) {
      // Allow a retry on the same card if the server call failed.
      _reviewedCardIds.remove(card.id);
    }

    _advance();
  }

  void _advance() {
    final nextIndex = state.currentIndex + 1;
    if (nextIndex < state.cards.length) {
      state = state.copyWith(
        currentIndex: nextIndex,
        flipped: false,
        showHint: false,
      );
    } else {
      state = state.copyWith(
        pageState: QuickRecallPageState.done,
        flipped: false,
        showHint: false,
      );
    }
  }
}
