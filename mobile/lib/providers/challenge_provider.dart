import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../core/constants/coin_rules.dart';
import '../core/game/challenge_config.dart';
import '../core/game/challenge_engine.dart';
import '../core/game/challenge_streak.dart';
import '../data/models/challenge_models.dart';
import '../data/repositories/challenge_repository.dart';
import 'auth_provider.dart';
import 'dashboard_provider.dart';

final challengeRepositoryProvider = Provider<ChallengeRepository>((ref) {
  return ChallengeRepository();
});

/// Screen states for the Daily Challenge — mirrors the `PageState` union in
/// `apps/host/src/app/challenge/page.tsx`.
enum ChallengePageState { loading, locked, playing, solved, noChallenge }

/// Returns today's date in IST as "YYYY-MM-DD" — Dart port of the web's
/// `getTodayIST()`. Computed purely from UTC arithmetic (IST = UTC+5:30) so
/// it is independent of the device's local timezone setting.
String todayIST({DateTime? now}) {
  final nowUtc = (now ?? DateTime.now()).toUtc();
  final ist = nowUtc.add(const Duration(hours: 5, minutes: 30));
  final y = ist.year.toString().padLeft(4, '0');
  final m = ist.month.toString().padLeft(2, '0');
  final d = ist.day.toString().padLeft(2, '0');
  return '$y-$m-$d';
}

/// UTC instant corresponding to 00:00 IST "today" — used to query
/// `quiz_sessions.created_at >= this` for the unlock gate.
DateTime todayStartIST({DateTime? now}) {
  final nowUtc = (now ?? DateTime.now()).toUtc();
  final ist = nowUtc.add(const Duration(hours: 5, minutes: 30));
  return DateTime.utc(ist.year, ist.month, ist.day)
      .subtract(const Duration(hours: 5, minutes: 30));
}

class ChallengeState {
  final ChallengePageState pageState;
  final DailyChallenge? challenge;
  final StreakState streak;
  final StudentChallenge? studentChallenge;
  final ChallengeAttemptRecord? attempt;
  final List<StreakMilestone> milestones;
  final bool showMilestone;
  final String? error;

  const ChallengeState({
    this.pageState = ChallengePageState.loading,
    this.challenge,
    this.streak = const StreakState(),
    this.studentChallenge,
    this.attempt,
    this.milestones = const [],
    this.showMilestone = false,
    this.error,
  });

  ChallengeState copyWith({
    ChallengePageState? pageState,
    DailyChallenge? challenge,
    StreakState? streak,
    StudentChallenge? studentChallenge,
    ChallengeAttemptRecord? attempt,
    List<StreakMilestone>? milestones,
    bool? showMilestone,
    String? error,
  }) {
    return ChallengeState(
      pageState: pageState ?? this.pageState,
      challenge: challenge ?? this.challenge,
      streak: streak ?? this.streak,
      studentChallenge: studentChallenge ?? this.studentChallenge,
      attempt: attempt ?? this.attempt,
      milestones: milestones ?? this.milestones,
      showMilestone: showMilestone ?? this.showMilestone,
      error: error,
    );
  }
}

final challengeProvider =
    NotifierProvider<ChallengeNotifier, ChallengeState>(ChallengeNotifier.new);

/// Daily Challenge state machine — mobile parity for the data-fetch +
/// unlock-gate + solve flow in `apps/host/src/app/challenge/page.tsx`.
///
/// NOT ported: the ADR-001 `ff_personalised_compete_v1` weak-topic-ranked
/// challenge picker (web fetches up to 12 candidates and ranks them via
/// `/api/learner/weak-topics`). This notifier always uses the single-best
/// (first) challenge for the day, which is exactly what the web does when
/// that flag is off — i.e. today's default production behaviour.
class ChallengeNotifier extends Notifier<ChallengeState> {
  DateTime? _startedAt;
  String? _todayStr;

  @override
  ChallengeState build() => const ChallengeState();

  /// Full data-fetch + unlock-gate flow. Call on screen entry and on retry.
  Future<void> load() async {
    final student = ref.read(studentProvider).valueOrNull;
    if (student == null) return;

    state = state.copyWith(pageState: ChallengePageState.loading, error: null);

    final repo = ref.read(challengeRepositoryProvider);
    final today = todayIST();
    _todayStr = today;

    final challengeResult =
        await repo.getTodayChallenge(grade: student.grade, todayIso: today);
    final streakResult = await repo.getStreak(studentId: student.id);
    final attemptResult =
        await repo.getTodayAttempt(studentId: student.id, todayIso: today);

    final streak = streakResult.dataOrNull ?? const StreakState();
    final challenge = challengeResult.dataOrNull;

    if (challenge == null) {
      state = ChallengeState(
        pageState: ChallengePageState.noChallenge,
        streak: streak,
      );
      return;
    }

    final attempt = attemptResult.dataOrNull;
    if (attempt != null && attempt.solved) {
      state = ChallengeState(
        pageState: ChallengePageState.solved,
        challenge: challenge,
        streak: streak,
        attempt: attempt,
      );
      return;
    }

    // ── Unlock gate ──
    bool isUnlocked = false;

    // Grace period: new students always unlocked.
    final createdAt = student.createdAt;
    if (createdAt != null) {
      final daysSinceCreation = DateTime.now().difference(createdAt).inDays;
      if (daysSinceCreation <= kGracePeriodDays) isUnlocked = true;
    }

    if (!isUnlocked) {
      isUnlocked = await repo.hasCompletedQuizToday(
        studentId: student.id,
        todayStartUtc: todayStartIST(),
      );
    }

    if (!isUnlocked) {
      state = ChallengeState(
        pageState: ChallengePageState.locked,
        challenge: challenge,
        streak: streak,
      );
      return;
    }

    // ── Prepare game cards ──
    final challengeData = challenge.challengeData;
    if (challengeData.baseChain.isEmpty) {
      state = ChallengeState(
        pageState: ChallengePageState.noChallenge,
        streak: streak,
      );
      return;
    }

    final mastery = await repo.getAverageMastery(studentId: student.id);
    final difficulty = getDifficultyForZPD(mastery);
    final studentChallenge = selectCardsForStudent(challengeData, difficulty);
    _startedAt = DateTime.now();

    state = ChallengeState(
      pageState: ChallengePageState.playing,
      challenge: challenge,
      streak: streak,
      studentChallenge: studentChallenge,
    );
  }

  /// Called when [DailyChallengeScreen]'s Concept Chain game reports a
  /// correct solve. Submits the attempt, advances the streak, detects
  /// milestones, and transitions to the solved state.
  Future<void> handleSolved({
    required int moves,
    required int hintsUsed,
    required int distractorsExcluded,
  }) async {
    final student = ref.read(studentProvider).valueOrNull;
    final challenge = state.challenge;
    if (student == null || challenge == null) return;

    final timeSpent = _startedAt != null
        ? DateTime.now().difference(_startedAt!).inSeconds
        : 0;
    const coinsEarned = CoinRewards.challengeSolve;

    final repo = ref.read(challengeRepositoryProvider);
    final today = _todayStr ?? todayIST();

    await repo.submitAttempt(
      studentId: student.id,
      challengeId: challenge.id,
      challengeDateIso: today,
      solved: true,
      moves: moves,
      hintsUsed: hintsUsed,
      distractorsExcluded: distractorsExcluded,
      timeSpent: timeSpent,
      coinsEarned: coinsEarned,
    );

    final previousStreak = state.streak.currentStreak;
    final newStreak = processStreakDay(state.streak, today, student.grade);
    final milestones = detectMilestones(
      previousStreak,
      newStreak.currentStreak,
      state.streak.badges,
    );

    state = state.copyWith(
      pageState: ChallengePageState.solved,
      streak: newStreak,
      attempt: ChallengeAttemptRecord(
        solved: true,
        moves: moves,
        hintsUsed: hintsUsed,
        distractorsExcluded: distractorsExcluded,
        timeSpent: timeSpent,
        coinsEarned: coinsEarned,
      ),
      milestones: milestones,
      showMilestone: milestones.isNotEmpty,
    );

    // Refresh dashboard so coin/streak totals reflect the new attempt
    // (mirrors the pattern used after quiz submission).
    ref.read(dashboardProvider.notifier).refresh();
  }

  void dismissMilestone() {
    state = state.copyWith(showMilestone: false);
  }
}
