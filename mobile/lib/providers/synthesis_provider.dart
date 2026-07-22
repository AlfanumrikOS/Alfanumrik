import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../data/models/synthesis_models.dart';
import '../data/repositories/synthesis_repository.dart';

final synthesisRepositoryProvider = Provider<SynthesisRepository>((ref) {
  return SynthesisRepository();
});

/// Screen phases for `/synthesis` — a direct port of the web page's `Phase`
/// union (`apps/host/src/app/synthesis/page.tsx`), with [error] split out
/// (the web collapses every non-200 into its `flag_off` fallback; mobile keeps
/// a retriable error distinct from "not available for you" so a transient
/// network blip doesn't tell the student their feature is switched off).
enum SynthesisPhase { loading, unavailable, notYet, ready, error }

/// Result of the most recent parent-share attempt, surfaced as a transient
/// banner. `null` means "no attempt yet / dismissed".
enum ParentShareFeedback {
  sent,
  alreadySent,
  optedOut,
  flagged,
  noGuardian,
  phoneMissing,
  unavailable,
  deliveryFailed,
  failed,
}

class SynthesisScreenState {
  final SynthesisPhase phase;
  final SynthesisRow? row;
  final bool isSharing;
  final ParentShareFeedback? shareFeedback;
  final String? errorMessage;

  const SynthesisScreenState({
    this.phase = SynthesisPhase.loading,
    this.row,
    this.isSharing = false,
    this.shareFeedback,
    this.errorMessage,
  });

  SynthesisScreenState copyWith({
    SynthesisPhase? phase,
    SynthesisRow? row,
    bool? isSharing,
    ParentShareFeedback? shareFeedback,
    String? errorMessage,
  }) {
    return SynthesisScreenState(
      phase: phase ?? this.phase,
      row: row ?? this.row,
      isSharing: isSharing ?? this.isSharing,
      // Transient: cleared unless explicitly re-passed (same convention as
      // ChatState.error / DiveScreenState.errorMessage).
      shareFeedback: shareFeedback,
      errorMessage: errorMessage,
    );
  }
}

final synthesisProvider =
    NotifierProvider<SynthesisNotifier, SynthesisScreenState>(
  SynthesisNotifier.new,
);

/// Monthly Synthesis state machine.
///
/// Every number and every sentence rendered by the screen comes verbatim from
/// `GET /api/synthesis/state`. This notifier NEVER composes summary text,
/// never recomputes a mastery delta, and never optimistically claims a
/// delivery succeeded — the parent-share status it writes locally is only ever
/// the status the SERVER told us it just persisted.
class SynthesisNotifier extends Notifier<SynthesisScreenState> {
  @override
  SynthesisScreenState build() => const SynthesisScreenState();

  Future<void> load() async {
    state = const SynthesisScreenState(phase: SynthesisPhase.loading);
    final repo = ref.read(synthesisRepositoryProvider);
    final result = await repo.getState();

    state = switch (result) {
      SynthesisUnavailable() =>
        const SynthesisScreenState(phase: SynthesisPhase.unavailable),
      SynthesisNotYet() =>
        const SynthesisScreenState(phase: SynthesisPhase.notYet),
      SynthesisReady(row: final r) =>
        SynthesisScreenState(phase: SynthesisPhase.ready, row: r),
      SynthesisStateFailure(message: final m) =>
        SynthesisScreenState(phase: SynthesisPhase.error, errorMessage: m),
    };
  }

  /// Share the summary with the linked guardian over WhatsApp.
  ///
  /// The local `parentShareStatus` is updated ONLY on branches where the
  /// server documented that it wrote that exact status to the row:
  ///   * 200            → `sent`
  ///   * 403 opted_out  → `opted_out`   (route updates the row)
  ///   * 422 flagged    → `flagged`     (route updates the row)
  ///   * 502 delivery   → `failed`      (route updates the row)
  /// Every other branch leaves the status untouched — mobile must not invent
  /// a delivery state the backend didn't record.
  Future<void> shareWithParent() async {
    final row = state.row;
    if (row == null || state.isSharing) return;
    if (row.parentShareStatus.blocksSending) return;

    state = state.copyWith(isSharing: true);

    final repo = ref.read(synthesisRepositoryProvider);
    final outcome = await repo.shareToParent(row.id);

    switch (outcome) {
      case ParentShareSent(sentAt: final sentAt):
        state = state.copyWith(
          isSharing: false,
          row: row.copyWith(
            parentShareStatus: ParentShareStatus.sent,
            // Only stamp a timestamp the SERVER returned. When it is absent
            // the chip simply renders without a date rather than showing a
            // locally-invented "sent at" time.
            parentShareSentAt: sentAt,
          ),
          shareFeedback: ParentShareFeedback.sent,
        );
      case ParentShareAlreadySent():
        state = state.copyWith(
          isSharing: false,
          row: row.copyWith(parentShareStatus: ParentShareStatus.sent),
          shareFeedback: ParentShareFeedback.alreadySent,
        );
      case ParentShareOptedOut():
        state = state.copyWith(
          isSharing: false,
          row: row.copyWith(parentShareStatus: ParentShareStatus.optedOut),
          shareFeedback: ParentShareFeedback.optedOut,
        );
      case ParentShareFlagged():
        state = state.copyWith(
          isSharing: false,
          row: row.copyWith(parentShareStatus: ParentShareStatus.flagged),
          shareFeedback: ParentShareFeedback.flagged,
        );
      case ParentShareDeliveryFailed():
        state = state.copyWith(
          isSharing: false,
          row: row.copyWith(parentShareStatus: ParentShareStatus.failed),
          shareFeedback: ParentShareFeedback.deliveryFailed,
        );
      case ParentShareNoGuardian():
        state = state.copyWith(
          isSharing: false,
          shareFeedback: ParentShareFeedback.noGuardian,
        );
      case ParentSharePhoneMissing():
        state = state.copyWith(
          isSharing: false,
          shareFeedback: ParentShareFeedback.phoneMissing,
        );
      case ParentShareUnavailable():
        state = state.copyWith(
          isSharing: false,
          shareFeedback: ParentShareFeedback.unavailable,
        );
      case ParentShareFailure(message: final m):
        state = state.copyWith(
          isSharing: false,
          shareFeedback: ParentShareFeedback.failed,
          errorMessage: m,
        );
    }
  }

  void dismissShareFeedback() {
    if (state.shareFeedback == null && state.errorMessage == null) return;
    state = state.copyWith();
  }
}
