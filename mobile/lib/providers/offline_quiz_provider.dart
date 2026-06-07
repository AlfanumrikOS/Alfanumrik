import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../core/constants/api_constants.dart';
import '../core/network/network_info.dart';
import '../data/models/offline_quiz_models.dart';
import '../data/repositories/offline_drain_service.dart';
import '../data/repositories/offline_quiz_store.dart';
import '../data/repositories/quiz_repository.dart';
import 'quiz_provider.dart';

/// ────────────────────────────────────────────────────────────────────────
/// Wave 2.5.2 — offline quiz provider wiring.
///
/// Everything here is GATED on [ApiConstants.useV2]. When the flag is OFF the
/// store is never opened, the drain listener is never installed, and the queue
/// API is inert — so a flag-OFF build is byte-identical to today (no offline
/// path exists). The offline submit route + replay fields are a `useV2`-ON-only
/// feature.
/// ────────────────────────────────────────────────────────────────────────

/// Opens the two Hive boxes once and exposes the [OfflineQuizStore]. Returns
/// null when `useV2` is OFF (no offline path). App-scoped (no autoDispose) so
/// the boxes stay open for the process lifetime.
final offlineQuizStoreProvider = FutureProvider<OfflineQuizStore?>((ref) async {
  if (!ApiConstants.useV2) return null;
  return OfflineQuizStore.open();
});

/// Bridges [QuizRepository.submitOfflineReplay] to the [OfflineQuizSubmitter]
/// interface the drain service depends on. Keeps the drain logic decoupled from
/// Dio/Supabase for testing (a fake submitter is injected in unit tests).
class V2OfflineQuizSubmitter implements OfflineQuizSubmitter {
  final QuizRepository _repo;
  const V2OfflineQuizSubmitter(this._repo);

  @override
  Future<DrainOutcome> submit(QueuedQuizAttempt attempt) =>
      _repo.submitOfflineReplay(attempt);
}

/// The most-recent offline-sync notice to surface to the student (bilingual
/// rendering happens at the widget; this carries only the data). Null when
/// there's nothing to show. Cleared by the UI after display.
class OfflineSyncNotice {
  final DrainOutcomeKind kind;

  /// Server score percent on a successful sync (for "your offline quiz synced
  /// — X%"). Null for discard.
  final int? scorePercent;

  /// Short reason code (e.g. `REPLAY_TOO_STALE`) for discard messaging /
  /// telemetry. Never PII.
  final String reasonCode;

  const OfflineSyncNotice({
    required this.kind,
    this.scorePercent,
    this.reasonCode = '',
  });
}

/// Holds the latest offline-sync notice. The drain service pushes into this so
/// the UI can react. A [Notifier] (not derived) because it is imperatively set.
final offlineSyncNoticeProvider =
    NotifierProvider<OfflineSyncNoticeNotifier, OfflineSyncNotice?>(
        OfflineSyncNoticeNotifier.new);

class OfflineSyncNoticeNotifier extends Notifier<OfflineSyncNotice?> {
  @override
  OfflineSyncNotice? build() => null;

  void set(OfflineSyncNotice notice) => state = notice;
  void clear() => state = null;
}

/// Number of attempts currently queued (for a "N quizzes waiting to sync"
/// badge). 0 when `useV2` is OFF or the store isn't open yet.
final offlineQueueCountProvider = Provider<int>((ref) {
  final store = ref.watch(offlineQuizStoreProvider).valueOrNull;
  return store?.queueLength ?? 0;
});

/// The drain coordinator. Owns the [OfflineDrainService], installs the
/// connectivity listener that drains on reconnect, and exposes imperative
/// [drain] / [prefetchTodayBundle] / [enqueueCompletedAttempt] entry points
/// for the foreground / today-load / quiz-completion call sites.
final offlineQuizCoordinatorProvider =
    Provider<OfflineQuizCoordinator?>((ref) {
  if (!ApiConstants.useV2) return null;
  final store = ref.watch(offlineQuizStoreProvider).valueOrNull;
  if (store == null) return null;

  final repo = ref.read(quizRepositoryProvider);
  final submitter = V2OfflineQuizSubmitter(repo);
  final coordinator = OfflineQuizCoordinator(
    ref: ref,
    store: store,
    submitter: submitter,
  );

  // Drain on reconnect: when connectivity transitions to online, kick a drain.
  // The drain serializes internally so overlapping triggers can't double-send.
  final sub = ref.listen<AsyncValue<bool>>(connectivityProvider, (prev, next) {
    final wasOffline = prev?.valueOrNull == false;
    final isOnline = next.valueOrNull == true;
    if (isOnline && (wasOffline || prev == null)) {
      // Fire-and-forget; outcomes are surfaced via the notice provider.
      unawaited(coordinator.drain());
    }
  });
  ref.onDispose(sub.close);

  return coordinator;
});

/// Coordinates offline prefetch, enqueue, and drain. The connectivity listener
/// lives in [offlineQuizCoordinatorProvider]; this class holds the imperative
/// methods the app calls on foreground / today-load / quiz completion.
class OfflineQuizCoordinator {
  final Ref _ref;
  final OfflineQuizStore _store;
  final OfflineDrainService _drainService;

  OfflineQuizCoordinator({
    required Ref ref,
    required OfflineQuizStore store,
    required OfflineQuizSubmitter submitter,
  })  : _ref = ref,
        _store = store,
        _drainService = OfflineDrainService(
          store: store,
          submitter: submitter,
          onNotice: (attempt, outcome) {
            switch (outcome.kind) {
              case DrainOutcomeKind.success:
                ref.read(offlineSyncNoticeProvider.notifier).set(
                      OfflineSyncNotice(
                        kind: DrainOutcomeKind.success,
                        scorePercent: outcome.result?.scorePercent,
                        reasonCode: outcome.reasonCode,
                      ),
                    );
                break;
              case DrainOutcomeKind.discard:
                ref.read(offlineSyncNoticeProvider.notifier).set(
                      OfflineSyncNotice(
                        kind: DrainOutcomeKind.discard,
                        reasonCode: outcome.reasonCode,
                      ),
                    );
                break;
              case DrainOutcomeKind.retain:
                // Stays queued; no user-facing notice (it'll retry silently).
                break;
            }
          },
        );

  OfflineQuizStore get store => _store;
  bool get isDraining => _drainService.isDraining;

  /// Drain the queue once (FIFO). Safe to call from the connectivity listener
  /// AND on app foreground — the drain serializes internally.
  Future<void> drain() => _drainService.drain();

  /// Cache the day's quiz session so a student can attempt it OFFLINE. Call on
  /// app foreground / today-load when connected. Persists the server-shuffled
  /// session + display-ordered questions (no correct answers — P6) keyed by
  /// subject. No-op on any soft failure (the student just won't have an offline
  /// bundle for that subject).
  Future<void> prefetchTodayBundle({
    required String studentId,
    required String subject,
    required String grade,
    String? chapterTitle,
    int count = 10,
  }) async {
    if (!await hasConnection()) return; // only prefetch while online
    final repo = _ref.read(quizRepositoryProvider);

    final fetch = await repo.getQuestions(
      subject: subject,
      grade: grade,
      count: count,
      chapterTitle: chapterTitle,
    );
    final raw = fetch.dataOrNull;
    if (raw == null || raw.isEmpty) return;

    final session = await repo.startSessionForQuestions(
      studentId: studentId,
      questionIds: raw.map((q) => q.id).toList(growable: false),
      subject: subject,
      grade: grade,
    );
    // A bundle without a server session id can't be graded offline — skip.
    if (session == null || session.questions.isEmpty) return;

    await _store.putBundle(
      OfflineTodayBundle(
        sessionId: session.sessionId,
        subject: subject,
        grade: grade,
        questions: session.questions,
        // Shuffle maps are NOT exposed by start_quiz_session (server keeps the
        // map server-side — P6), so the bundle stores none. The drain then
        // omits shuffleMapsClientGradedAgainst and the server verifies
        // integrity against its own snapshot.
        shuffleMaps: const {},
        cachedAtMillis: DateTime.now().millisecondsSinceEpoch,
      ),
    );
  }

  /// Read the cached offline bundle for a subject (null if none / not
  /// attemptable).
  OfflineTodayBundle? bundleFor(String subject) {
    final b = _store.getBundle(subject);
    return (b != null && b.isAttemptable) ? b : null;
  }

  /// Enqueue a completed-OFFLINE attempt for later drain.
  ///
  /// CRITICAL (P2): [idempotencyKey] and [capturedAt] MUST already have been
  /// generated EXACTLY ONCE by the caller at attempt completion. This method
  /// stores them immutably; the drain reuses them verbatim and never
  /// regenerates them. This method does NOT call the network.
  Future<void> enqueueCompletedAttempt(QueuedQuizAttempt attempt) async {
    await _store.enqueue(attempt);
  }
}
