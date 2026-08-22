import '../../core/network/api_result.dart';
import '../models/offline_quiz_models.dart';
import '../models/quiz_question.dart';
import 'offline_quiz_store.dart';

/// Outcome of submitting ONE queued attempt to `POST /v2/quiz/submit`.
///
/// The classification — not the HTTP detail — is what drives the drain's
/// discard-vs-retain decision, so it is modelled explicitly and is the unit
/// the drain logic tests assert against.
enum DrainOutcomeKind {
  /// 200 (fresh grade) or an idempotent replay. Store the result, surface it,
  /// remove the attempt from the queue.
  success,

  /// Permanently un-replayable: 409 `session_not_started`, or 422
  /// `REPLAY_TOO_STALE` / `REPLAY_CLOCK_INVALID` / `SHUFFLE_MAP_MISMATCH`, or
  /// any 4xx the server returns for this attempt. DISCARD (remove from queue) +
  /// surface a friendly message; retrying would just hit the same wall.
  discard,

  /// Transient: network error / timeout / 503. KEEP in the queue and retry on
  /// the next reconnect. The idempotency key is NEVER regenerated, so a retry
  /// after a server-side commit is short-circuited as an idempotent replay.
  retain,
}

/// The result of draining one attempt: its classification, the (optional)
/// server-graded result on success, and a short reason code for surfacing /
/// telemetry (never PII — code strings only).
class DrainOutcome {
  final DrainOutcomeKind kind;
  final QuizResult? result;
  final String reasonCode;

  const DrainOutcome(this.kind, {this.result, this.reasonCode = ''});
}

/// Submits a single queued attempt to the server. Abstracted so the drain
/// logic is testable with a fake (no Dio / Supabase). The real implementation
/// ([V2OfflineQuizSubmitter]) builds the `QuizSubmitRequest` with
/// `attemptMode: offline_replay` + every offline field + the stored
/// `Idempotency-Key` header.
abstract class OfflineQuizSubmitter {
  Future<DrainOutcome> submit(QueuedQuizAttempt attempt);
}

/// Notified when an offline attempt finishes draining so the UI/providers can
/// surface a bilingual "your offline quiz synced — X%" / "couldn't sync" notice.
typedef DrainNotice = void Function(
  QueuedQuizAttempt attempt,
  DrainOutcome outcome,
);

/// Drains the offline submission queue FIFO when connectivity returns.
///
/// ## Immutable idempotency-key guarantee (the single most important rule, P2)
/// The drain NEVER constructs a new idempotency key. It reads each attempt's
/// stored [QueuedQuizAttempt.idempotencyKey] verbatim and passes it to the
/// submitter, which stamps it on the `Idempotency-Key` header. On a `retain`
/// (network/503) outcome the attempt stays in the queue with its key UNCHANGED;
/// the next drain re-sends the SAME key. The only field the drain mutates is
/// [QueuedQuizAttempt.drainAttempt] (the telemetry counter). This is what stops
/// a re-drain after a server-side commit from double-granting XP — the server
/// matches the repeated key and returns the cached row as an idempotent replay.
///
/// ## Serialization
/// A single [_draining] guard ensures only one drain pass runs at a time, so
/// the connectivity listener and the app-foreground trigger can both call
/// [drain] without the same record being submitted concurrently.
class OfflineDrainService {
  final OfflineQuizStore _store;
  final OfflineQuizSubmitter _submitter;
  final DrainNotice? _onNotice;

  bool _draining = false;

  OfflineDrainService({
    required OfflineQuizStore store,
    required OfflineQuizSubmitter submitter,
    DrainNotice? onNotice,
  })  : _store = store,
        _submitter = submitter,
        _onNotice = onNotice;

  bool get isDraining => _draining;

  /// Drain the queue once, FIFO. Returns the per-attempt outcomes for the
  /// records it processed this pass. Re-entrant calls while a drain is already
  /// running return an empty list immediately (serialization guard) so the same
  /// attempt is never double-sent.
  Future<List<DrainOutcome>> drain() async {
    if (_draining) return const [];
    _draining = true;
    final outcomes = <DrainOutcome>[];
    try {
      // Snapshot the queue at entry. New enqueues that land mid-drain are
      // intentionally picked up by the NEXT trigger — never by this pass — so
      // a freshly-saved attempt can't be raced by an in-flight drain.
      final pending = _store.queue();
      for (final attempt in pending) {
        // Bump the telemetry counter (drainAttempt) WITHOUT touching the
        // idempotency key, then persist so a crash mid-drain still reflects the
        // retry count. The key + capturedAt + timings are carried through
        // unchanged by withDrainAttempt().
        final attempting = attempt.withDrainAttempt(attempt.drainAttempt + 1);
        await _store.update(attempting);

        final outcome = await _submitter.submit(attempting);
        outcomes.add(outcome);

        switch (outcome.kind) {
          case DrainOutcomeKind.success:
          case DrainOutcomeKind.discard:
            // Either graded (or idempotent-replayed) OR permanently
            // un-replayable — both leave the queue.
            await _store.remove(attempting.localId);
            break;
          case DrainOutcomeKind.retain:
            // Transient — leave it in the queue with the bumped drainAttempt
            // and the UNCHANGED idempotency key. Stop the pass here so we don't
            // hammer the server with the rest of the queue during an outage;
            // the next reconnect resumes FIFO from this record.
            _onNotice?.call(attempting, outcome);
            return outcomes;
        }

        _onNotice?.call(attempting, outcome);
      }
    } finally {
      _draining = false;
    }
    return outcomes;
  }

  /// Classify a submit [ApiResult] + HTTP status into a drain outcome. Pure +
  /// static so the discard-vs-retry matrix is unit-testable in isolation.
  ///
  /// Matrix:
  ///   * success                                   → success
  ///   * 409 (session_not_started)                 → discard
  ///   * 422 (REPLAY_TOO_STALE / REPLAY_CLOCK_INVALID / SHUFFLE_MAP_MISMATCH)
  ///                                               → discard
  ///   * 400 (OFFLINE_CAPTURED_AT_REQUIRED /
  ///          OFFLINE_TIME_INCONSISTENT)           → discard (un-fixable client bug)
  ///   * any other 4xx                             → discard
  ///   * 503 / 5xx / network error / null status   → retain
  static DrainOutcome classify(
    ApiResult<QuizResult> result, {
    int? statusCode,
    String reasonCode = '',
  }) {
    return result.when(
      success: (r) => DrainOutcome(
        DrainOutcomeKind.success,
        result: r,
        reasonCode: r.idempotentReplay ? 'idempotent_replay' : 'graded',
      ),
      failure: (msg) {
        final code = statusCode;
        // No status (network/timeout) → transient, keep retrying.
        if (code == null) {
          return DrainOutcome(DrainOutcomeKind.retain,
              reasonCode: reasonCode.isNotEmpty ? reasonCode : 'network_error');
        }
        // 5xx (incl. 503) → transient.
        if (code >= 500) {
          return DrainOutcome(DrainOutcomeKind.retain,
              reasonCode: reasonCode.isNotEmpty ? reasonCode : 'server_5xx');
        }
        // Any 4xx (409 / 422 / 400 / ...) → permanently un-replayable, discard.
        if (code >= 400) {
          return DrainOutcome(DrainOutcomeKind.discard,
              reasonCode: reasonCode.isNotEmpty ? reasonCode : 'unreplayable_4xx');
        }
        // Anything else unexpected → keep (fail safe; don't lose the attempt).
        return DrainOutcome(DrainOutcomeKind.retain,
            reasonCode: reasonCode.isNotEmpty ? reasonCode : 'unknown');
      },
    );
  }
}
