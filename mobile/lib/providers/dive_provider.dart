import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../data/models/dive_models.dart';
import '../data/repositories/dive_repository.dart';

final diveRepositoryProvider = Provider<DiveRepository>((ref) {
  return DiveRepository();
});

/// Screen phases for `/dive` — a direct port of the web page's `Phase` union
/// (`apps/host/src/app/dive/page.tsx`):
///   loading → picker | completed | unavailable
///   picker  → diveActive        (POST /api/dive/start)
///   diveActive → justSaved      (POST /api/dive/artifact 200 *or* 409)
///
/// [unavailable] is the 404/flag-off soft fallback, NOT an error state — the
/// web renders the same "not available for you yet" copy there.
enum DivePhase { loading, unavailable, error, picker, diveActive, completed, justSaved }

/// Client-side validation mirror of `<ArtifactComposer/>`'s `canSubmit`.
/// The SERVER is still the authority (it re-validates and returns 400 codes);
/// these thresholds only stop an obviously-incomplete submit from making a
/// round trip. Kept in one place so the screen never re-derives them.
const int kDiveKeyConceptsMin = 1;
const int kDiveKeyConceptsMax = 12;
const int kDiveStudentVoiceMinChars = 20;

class DiveScreenState {
  final DivePhase phase;

  /// Present in [DivePhase.picker] and [DivePhase.diveActive].
  final DiveState? state;

  /// Present in [DivePhase.diveActive].
  final ResolvedDive? resolved;

  /// Present in [DivePhase.completed] / [DivePhase.justSaved].
  final int weeklyStreakCount;
  final String isoWeek;

  /// Transient inline banner (picker start failure, artifact save failure).
  /// Never a phase of its own — the underlying surface stays interactive.
  final String? errorMessage;

  /// A 400 from `/api/dive/artifact`, surfaced as the server's raw machine
  /// code so the screen can map it to localized copy without string matching.
  final String? artifactErrorCode;

  final bool isSubmitting;

  const DiveScreenState({
    this.phase = DivePhase.loading,
    this.state,
    this.resolved,
    this.weeklyStreakCount = 0,
    this.isoWeek = '',
    this.errorMessage,
    this.artifactErrorCode,
    this.isSubmitting = false,
  });

  DiveScreenState copyWith({
    DivePhase? phase,
    DiveState? state,
    ResolvedDive? resolved,
    int? weeklyStreakCount,
    String? isoWeek,
    String? errorMessage,
    String? artifactErrorCode,
    bool? isSubmitting,
  }) {
    return DiveScreenState(
      phase: phase ?? this.phase,
      state: state ?? this.state,
      resolved: resolved ?? this.resolved,
      weeklyStreakCount: weeklyStreakCount ?? this.weeklyStreakCount,
      isoWeek: isoWeek ?? this.isoWeek,
      // Errors are deliberately NOT sticky: any copyWith that doesn't pass
      // them explicitly clears them (same convention as ChatState).
      errorMessage: errorMessage,
      artifactErrorCode: artifactErrorCode,
      isSubmitting: isSubmitting ?? this.isSubmitting,
    );
  }
}

final diveProvider = NotifierProvider<DiveNotifier, DiveScreenState>(
  DiveNotifier.new,
);

/// Weekly Curiosity Dive state machine.
///
/// NOTHING here computes an ISO week, a weekly streak, or a completion
/// verdict — every one of those is read verbatim off a server response
/// (`/api/dive/state` or `/api/dive/artifact`). Mirrors the SM-2 boundary in
/// [QuickRecallNotifier].
class DiveNotifier extends Notifier<DiveScreenState> {
  @override
  DiveScreenState build() => const DiveScreenState();

  /// Full fetch. Call on screen entry and on retry / pull-to-refresh.
  Future<void> load() async {
    state = const DiveScreenState(phase: DivePhase.loading);
    final repo = ref.read(diveRepositoryProvider);
    final result = await repo.getState();

    result.when(
      success: (diveState) {
        if (diveState == null) {
          // 404 — server flag off. Soft fallback, not an error.
          state = const DiveScreenState(phase: DivePhase.unavailable);
          return;
        }
        state = DiveScreenState(
          phase: diveState.isCompleted ? DivePhase.completed : DivePhase.picker,
          state: diveState,
          weeklyStreakCount: diveState.weeklyStreakCount,
          isoWeek: diveState.currentIsoWeek,
        );
      },
      failure: (message) {
        state = DiveScreenState(phase: DivePhase.error, errorMessage: message);
      },
    );
  }

  /// Commit a picker choice → `POST /api/dive/start` → [DivePhase.diveActive].
  /// On failure the picker stays visible with an inline banner (matches the
  /// web's `pickerError` behaviour).
  Future<void> commitPicker({
    required DivePickerOption option,
    String? phenomenonSlug,
    String? weakTopicId,
    String? ownTopic,
  }) async {
    if (state.phase != DivePhase.picker || state.isSubmitting) return;
    final currentState = state.state;
    if (currentState == null) return;

    state = state.copyWith(isSubmitting: true);

    final repo = ref.read(diveRepositoryProvider);
    final result = await repo.start(
      option: option,
      phenomenonSlug: phenomenonSlug,
      weakTopicId: weakTopicId,
      ownTopic: ownTopic,
    );

    result.when(
      success: (resolved) {
        if (resolved == null) {
          // 404 — flag off mid-session, or the phenomenon slug went inactive.
          state = state.copyWith(
            phase: DivePhase.picker,
            isSubmitting: false,
            errorMessage: 'dive_start_unavailable',
          );
          return;
        }
        state = DiveScreenState(
          phase: DivePhase.diveActive,
          state: currentState,
          resolved: resolved,
          weeklyStreakCount: currentState.weeklyStreakCount,
          isoWeek: currentState.currentIsoWeek,
        );
      },
      failure: (message) {
        state = state.copyWith(
          phase: DivePhase.picker,
          isSubmitting: false,
          errorMessage: message,
        );
      },
    );
  }

  /// Save the artifact → `POST /api/dive/artifact`.
  ///
  /// A 409 (`already_saved_this_week`) is treated as SUCCESS: the student's
  /// dive for this ISO week genuinely exists, so the screen transitions to the
  /// completed state instead of showing an error. The streak count in that
  /// case is the one already known from `/api/dive/state` — the 409 branch
  /// returns no body, and this notifier must NOT invent one.
  Future<void> saveArtifact({
    required String title,
    required List<String> keyConcepts,
    String? workedExample,
    required String studentVoice,
  }) async {
    if (state.phase != DivePhase.diveActive || state.isSubmitting) return;
    final resolved = state.resolved;
    if (resolved == null) return;

    state = state.copyWith(isSubmitting: true);

    final repo = ref.read(diveRepositoryProvider);
    final outcome = await repo.saveArtifact(
      pickerOption: resolved.pickerOption,
      diveTopic: resolved.diveTopic,
      diveSubjects: resolved.diveSubjects,
      phenomenonSlug: resolved.phenomenonSlug,
      title: title,
      keyConcepts: keyConcepts,
      workedExample: workedExample,
      studentVoice: studentVoice,
    );

    switch (outcome) {
      case DiveArtifactSaved(result: final r):
        state = DiveScreenState(
          phase: DivePhase.justSaved,
          weeklyStreakCount: r.weeklyStreakCount,
          isoWeek: r.isoWeek,
        );
      case DiveArtifactAlreadySaved():
        state = DiveScreenState(
          phase: DivePhase.completed,
          weeklyStreakCount: state.weeklyStreakCount,
          isoWeek: state.isoWeek,
        );
      case DiveArtifactUnavailable():
        state = const DiveScreenState(phase: DivePhase.unavailable);
      case DiveArtifactInvalid(errorCode: final code):
        state = state.copyWith(
          isSubmitting: false,
          artifactErrorCode: code,
        );
      case DiveArtifactFailure(message: final m):
        state = state.copyWith(isSubmitting: false, errorMessage: m);
    }
  }

  /// Return from [DivePhase.diveActive] to the picker without saving.
  void backToPicker() {
    if (state.phase != DivePhase.diveActive) return;
    final currentState = state.state;
    if (currentState == null) return;
    state = DiveScreenState(
      phase: DivePhase.picker,
      state: currentState,
      weeklyStreakCount: currentState.weeklyStreakCount,
      isoWeek: currentState.currentIsoWeek,
    );
  }

  void clearError() {
    if (state.errorMessage == null && state.artifactErrorCode == null) return;
    state = state.copyWith();
  }
}

// ─── History ────────────────────────────────────────────────────────────────

/// `/dive/history` phases — mirrors the web page's `Phase` union
/// (`apps/host/src/app/dive/history/page.tsx`), where a non-404 failure
/// degrades to the EMPTY state rather than an error screen.
enum DiveHistoryPhase { unavailable, empty, list }

class DiveHistoryState {
  final DiveHistoryPhase phase;
  final List<DiveHistoryItem> items;

  const DiveHistoryState({
    required this.phase,
    this.items = const <DiveHistoryItem>[],
  });
}

final diveHistoryProvider =
    AsyncNotifierProvider<DiveHistoryNotifier, DiveHistoryState>(
  DiveHistoryNotifier.new,
);

class DiveHistoryNotifier extends AsyncNotifier<DiveHistoryState> {
  @override
  Future<DiveHistoryState> build() => _fetch();

  /// Pull-to-refresh / retry.
  Future<void> refresh() async {
    state = const AsyncLoading();
    state = await AsyncValue.guard(_fetch);
  }

  Future<DiveHistoryState> _fetch() async {
    final repo = ref.read(diveRepositoryProvider);
    final result = await repo.getHistory();

    return result.when(
      success: (items) {
        if (items == null) {
          return const DiveHistoryState(phase: DiveHistoryPhase.unavailable);
        }
        if (items.isEmpty) {
          return const DiveHistoryState(phase: DiveHistoryPhase.empty);
        }
        return DiveHistoryState(phase: DiveHistoryPhase.list, items: items);
      },
      // Matches the web: a non-404 fetch failure renders the EMPTY journal
      // ("no artifacts yet · start this week's dive") rather than an error
      // wall — the CTA out of it is still the correct next action.
      failure: (_) => const DiveHistoryState(phase: DiveHistoryPhase.empty),
    );
  }
}
