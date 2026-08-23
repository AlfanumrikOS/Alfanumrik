import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../core/network/network_info.dart';
import '../data/models/offline_quiz_models.dart';
import '../data/repositories/offline_drain_service.dart';
import '../data/repositories/offline_quiz_store.dart';
import '../data/repositories/quiz_repository.dart';
import 'experience_provider.dart';
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
  if (!ref.watch(oneExperienceRuntimeEnabledProvider)) return null;
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

/// The most-recent offline-sync notice INTENDED for the student (bilingual
/// rendering would happen at the widget; this carries only the data). Null when
/// there's nothing to show.
///
/// ⚠️ No widget reads [offlineSyncNoticeProvider] yet, so nothing is displayed
/// today — the drain publishes here and the value is simply overwritten by the
/// next outcome. Kept because it is the data contract a future surface renders
/// against, but it must not be cited as evidence that failures are "surfaced".
class OfflineSyncNotice {
  /// [DrainOutcomeKind.success] → "synced — X%".
  /// [DrainOutcomeKind.discard] → "couldn't sync" (session refused; dropped).
  /// [DrainOutcomeKind.failedPermanent] → "couldn't sync — needs attention".
  /// The attempt is KEPT on-device (see [offlineFailedCountProvider]); this is
  /// the terminal-but-not-lost case and should read differently from a discard.
  final DrainOutcomeKind kind;

  /// Server score percent on a successful sync (for "your offline quiz synced
  /// — X%"). Null for discard / failedPermanent.
  final int? scorePercent;

  /// Short reason code (e.g. `REPLAY_TOO_STALE`, `MAX_DRAIN_ATTEMPTS`) for
  /// messaging / telemetry. Never PII.
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

/// Number of attempts currently queued and still drainable (for a "N quizzes
/// waiting to sync" badge). Terminal records are EXCLUDED — they are not
/// waiting for anything. 0 when `useV2` is OFF or the store isn't open yet.
final offlineQueueCountProvider = Provider<int>((ref) {
  final store = ref.watch(offlineQuizStoreProvider).valueOrNull;
  return store?.queueLength ?? 0;
});

/// Number of attempts in the terminal "needs attention" state — permanently
/// failed server-side, or out of retry budget. They are STILL ON THE DEVICE
/// (never deleted) and are recoverable via
/// [OfflineQuizCoordinator.requeueFailed]. 0 when `useV2` is OFF or the store
/// isn't open.
///
/// ⚠️ NOT YET RENDERED. This provider — like [offlineQueueCountProvider] and
/// [offlineSyncNoticeProvider] — currently has ZERO widget consumers. The
/// quarantined attempt is kept, listable and requeueable; it is NOT yet shown
/// to the student. Building that surface is a separate product/frontend
/// decision. Until it lands, do not describe quarantined work as "surfaced".
final offlineFailedCountProvider = Provider<int>((ref) {
  final store = ref.watch(offlineQuizStoreProvider).valueOrNull;
  return store?.failedLength ?? 0;
});

/// The drain coordinator. Owns the [OfflineDrainService], installs the
/// connectivity listener that drains on reconnect, and exposes imperative
/// [drain] / [enqueueCompletedAttempt] entry points for the foreground /
/// quiz-completion call sites.
final offlineQuizCoordinatorProvider =
    Provider<OfflineQuizCoordinator?>((ref) {
  if (!ref.watch(oneExperienceRuntimeEnabledProvider)) return null;
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

/// Coordinates offline enqueue and drain. The connectivity listener lives in
/// [offlineQuizCoordinatorProvider]; this class holds the imperative methods
/// the app calls on foreground / quiz completion.
class OfflineQuizCoordinator {
  final OfflineQuizStore _store;
  final OfflineDrainService _drainService;

  OfflineQuizCoordinator({
    required Ref ref,
    required OfflineQuizStore store,
    required OfflineQuizSubmitter submitter,
  })  : _store = store,
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
              case DrainOutcomeKind.failedPermanent:
                // Terminal but NOT lost — the attempt is quarantined on-device,
                // counted by offlineFailedCountProvider and recoverable via
                // requeueFailed(). The notice is PUBLISHED here; note that no
                // widget currently listens to offlineSyncNoticeProvider, so it
                // is not yet visible to the student (see that provider's doc).
                ref.read(offlineSyncNoticeProvider.notifier).set(
                      OfflineSyncNotice(
                        kind: DrainOutcomeKind.failedPermanent,
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

  /// Enqueue a completed-OFFLINE attempt for later drain.
  ///
  /// CRITICAL (P2): [idempotencyKey] and [capturedAt] MUST already have been
  /// generated EXACTLY ONCE by the caller at attempt completion. This method
  /// stores them immutably; the drain reuses them verbatim and never
  /// regenerates them. This method does NOT call the network.
  Future<void> enqueueCompletedAttempt(QueuedQuizAttempt attempt) async {
    await _store.enqueue(attempt);
  }

  /// Terminal ("needs attention") attempts still held on-device. Listable so a
  /// future surface — or a support/debug path — can enumerate what failed
  /// without touching the store directly. Ids + reason codes only, no PII.
  List<QueuedQuizAttempt> failedAttempts() => _store.failed();

  /// Return ONE quarantined attempt to the drainable queue. The idempotency
  /// key, answers and `capturedAt` are preserved verbatim, so the re-send is an
  /// idempotent replay server-side and can never double-score (P2). Returns
  /// false for an unknown id or one that is not terminal.
  ///
  /// MUST be invoked deliberately (user/operator action). Never auto-call this
  /// from the drain or a foreground hook — that re-creates the unbounded retry
  /// loop the retry budget bounds.
  Future<bool> requeueFailed(String localId) => _store.requeue(localId);

  /// Bulk form of [requeueFailed]; returns how many were re-queued. Same
  /// deliberate-action rule applies.
  Future<int> requeueAllFailed() => _store.requeueAllFailed();
}
