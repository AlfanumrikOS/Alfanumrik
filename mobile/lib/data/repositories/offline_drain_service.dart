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

  /// Permanently un-replayable AT THE SESSION LEVEL: 409 `session_not_started`,
  /// or 422 `REPLAY_TOO_STALE` / `REPLAY_CLOCK_INVALID` / `SHUFFLE_MAP_MISMATCH`,
  /// or any 4xx the server returns for this attempt. DISCARD (remove from queue)
  /// + surface a friendly message; retrying would just hit the same wall and the
  /// server has already refused to grade this session at all.
  discard,

  /// Transient: network error / timeout / 5xx WITHOUT an explicit
  /// `retryable: false`. KEEP in the queue and retry on the next reconnect,
  /// subject to the retry budget below. The idempotency key is NEVER
  /// regenerated, so a retry after a server-side commit is short-circuited as
  /// an idempotent replay.
  retain,

  /// TERMINAL but NOT thrown away — the attempt stops being re-sent and is
  /// quarantined on-device as "needs attention". Two triggers:
  ///
  ///   1. the server explicitly said the failure is permanent (a 5xx body
  ///      carrying top-level `retryable: false` — e.g. the SQLSTATE
  ///      42501/42883/23514 class, which no amount of retrying can fix);
  ///   2. the LOCAL retry budget was exhausted (the attempt aged past
  ///      [maxAttemptAge], or — only when `capturedAt` will not parse — hit
  ///      [maxDrainAttempts] sends). This is the durable bound that holds even
  ///      against a server that never sends `retryable`.
  ///
  /// This is deliberately NOT [discard]: a completed quiz is student work, so
  /// the record is RETAINED with its idempotency key intact, remains listable
  /// (`OfflineQuizStore.failed()`), and is RECOVERABLE — `OfflineQuizStore`
  /// `.requeue()` returns it to the drainable queue with key + answers +
  /// `capturedAt` unchanged.
  ///
  /// ⚠️ Retained and recoverable is NOT the same as *shown*. No widget consumes
  /// the failed-count / sync-notice providers today, so nothing about this
  /// state currently reaches the student's screen. Say "kept and recoverable",
  /// not "surfaced", until a UI lands.
  failedPermanent,
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

/// What the local retry budget says about sending a queued attempt right now.
enum RetryBudgetVerdict {
  /// Send it: within the attempt cap, within the replay window, backoff elapsed.
  send,

  /// Not yet — the exponential backoff since the last send has not elapsed.
  /// The attempt stays queued, NOTHING is sent, and no counter is consumed.
  defer,

  /// Budget gone (attempt cap or max age). Mark terminal; send nothing.
  exhausted,
}

/// A budget verdict plus the short code explaining it (never PII).
typedef RetryBudgetDecision = ({RetryBudgetVerdict verdict, String reasonCode});

/// Submits a single queued attempt to the server. Abstracted so the drain
/// logic is testable with a fake (no Dio / Supabase). The real implementation
/// ([V2OfflineQuizSubmitter]) builds the `QuizSubmitRequest` with
/// `attemptMode: offline_replay` + every offline field + the stored
/// `Idempotency-Key` header.
abstract class OfflineQuizSubmitter {
  Future<DrainOutcome> submit(QueuedQuizAttempt attempt);
}

/// Notified when an offline attempt finishes draining. The intent is a
/// bilingual "your offline quiz synced — X%" / "couldn't sync" notice; today
/// the only subscriber is `offlineSyncNoticeProvider`, which no widget reads —
/// so this is a PUBLISH point, not yet a display path (P7 bilingual rendering
/// lands with the UI).
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
/// the next drain re-sends the SAME key. On a terminal outcome the record is
/// quarantined with its key STILL UNCHANGED. The only fields the drain mutates
/// are [QueuedQuizAttempt.drainAttempt] (the telemetry/budget counter),
/// [QueuedQuizAttempt.lastAttemptAt] (the backoff stamp) and
/// [QueuedQuizAttempt.failureCode] (the terminal marker). This is what stops a
/// re-drain after a server-side commit from double-granting XP — the server
/// matches the repeated key and returns the cached row as an idempotent replay.
///
/// ## Bounded retries (the durable fix)
/// Before every send the drain consults a PURE, STATIC retry budget
/// ([evaluateRetryBudget]):
///
///   * **exponential backoff** — attempt N waits `min(30s * 2^(N-1), 6h)` since
///     the last send, so an app that is foregrounded twenty times an hour still
///     sends at most one request per window (battery / metered-4G defect fix);
///   * **age cap** — [maxAttemptAge] since `capturedAt`, then terminal WITHOUT
///     sending. THIS IS THE BINDING BOUND in every normal case. It mirrors the
///     server's own `OFFLINE_REPLAY_MAX_STALENESS_HOURS = 168` replay-staleness
///     gate: past that point the server answers 422 `REPLAY_TOO_STALE`, so the
///     request can only ever be wasted bytes;
///   * **attempt cap** — [maxDrainAttempts] sends. Deliberately sized so the
///     age cap is reached FIRST (see [maxDrainAttempts]); it exists only as the
///     backstop for a record whose `capturedAt` will not parse, where the age
///     gate cannot fire at all.
///
/// The budget is enforced independently of any server signal, so it holds even
/// against a server that never sends `retryable`.
///
/// ## Serialization
/// A single [_draining] guard ensures only one drain pass runs at a time, so
/// the connectivity listener and the app-foreground trigger can both call
/// [drain] without the same record being submitted concurrently.
class OfflineDrainService {
  /// Hard ceiling on how many times ONE attempt is ever SENT — the BACKSTOP,
  /// not the intended bound.
  ///
  /// It is sized so the [maxAttemptAge] gate always fires first. Cumulative
  /// backoff before send `k` is `sum(backoffFor(1..k-1))` (see
  /// [cumulativeBackoffBefore]):
  ///
  /// ```
  /// sends 1..10 :  30+60+120+240+480+960+1920+3840+7680+15360 = 30_690 s  ( 8.53 h)
  /// sends 11..N :  + 21_600 s (the 6 h cap) each
  /// ⇒ send #37 becomes due at  30_690 + 26*21_600 = 592_290 s = 164.5 h   (< 168 h)
  /// ⇒ send #38 becomes due at             613_890 s = 170.5 h   (> 168 h)  ✗
  /// ⇒ send #40 becomes due at             657_090 s = 182.5 h
  /// ```
  ///
  /// So with `maxDrainAttempts = 40` an attempt gets at most **37** sends
  /// before the 168 h age gate quarantines it — the age gate, which is the one
  /// aligned with the server, is what actually ends the loop.
  ///
  /// **Why the cap still exists.** [evaluateRetryBudget] deliberately does NOT
  /// expire an attempt whose `capturedAt` fails to parse (a corrupt timestamp
  /// must not destroy student work). Without a count cap, such a record would
  /// retry every 6 h forever — exactly the unbounded loop this whole fix
  /// exists to kill. The cap bounds that path at 40 sends / ~182.5 h.
  ///
  /// This ordering (age-before-count) is pinned by a regression test; changing
  /// either constant without re-deriving the arithmetic will fail it.
  ///
  /// HISTORY: this was 12, which exhausted at 52_290 s = **14.5 h** and
  /// forfeited ~153 h of the window the server would still have honoured. The
  /// comment then claimed "≥ ~20h" and called the cap server-aligned; both were
  /// wrong. An overstated safety margin is worse than no comment.
  static const int maxDrainAttempts = 40;

  /// Oldest an offline attempt may be and still be worth sending, and the REAL
  /// bound on the drain loop. Aligned with the server's
  /// `OFFLINE_REPLAY_MAX_STALENESS_HOURS = 168` (7 days) in
  /// `apps/host/src/app/api/v2/quiz/submit/route.ts` — beyond it the server
  /// returns 422 `REPLAY_TOO_STALE`, so the client stops one step earlier and
  /// spends zero bytes reaching the same verdict.
  static const Duration maxAttemptAge = Duration(hours: 168);

  /// First backoff window after a failed send; doubles per attempt.
  static const Duration retryBackoffBase = Duration(seconds: 30);

  /// Ceiling for the doubling backoff (attempts 11+ all wait this long).
  static const Duration retryBackoffCap = Duration(hours: 6);

  final OfflineQuizStore _store;
  final OfflineQuizSubmitter _submitter;
  final DrainNotice? _onNotice;

  /// Injectable clock (tests drive backoff/age without sleeping). Production
  /// uses [DateTime.now].
  final DateTime Function() _clock;

  bool _draining = false;

  OfflineDrainService({
    required OfflineQuizStore store,
    required OfflineQuizSubmitter submitter,
    DrainNotice? onNotice,
    DateTime Function()? clock,
  })  : _store = store,
        _submitter = submitter,
        _onNotice = onNotice,
        _clock = clock ?? DateTime.now;

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
        // Defensive: `queue()` already excludes terminal records. A terminal
        // record is NEVER re-sent, whatever else happens.
        if (attempt.isTerminal) continue;

        final now = _clock();
        final budget = evaluateRetryBudget(attempt, now);

        if (budget.verdict == RetryBudgetVerdict.defer) {
          // Backoff window still open. Send NOTHING, consume NO attempt, emit
          // no notice — and move on so a healthy attempt behind this one can
          // still sync.
          continue;
        }

        if (budget.verdict == RetryBudgetVerdict.exhausted) {
          // Local budget gone. Quarantine WITHOUT sending (zero bytes) and
          // publish a notice — the student's work stays on the device and can
          // be returned to the queue via OfflineQuizStore.requeue().
          final terminal = attempt.withFailure(budget.reasonCode);
          await _store.update(terminal);
          final outcome = DrainOutcome(DrainOutcomeKind.failedPermanent,
              reasonCode: budget.reasonCode);
          outcomes.add(outcome);
          _onNotice?.call(terminal, outcome);
          continue;
        }

        // Bump the telemetry/budget counter (drainAttempt) and stamp the
        // backoff clock WITHOUT touching the idempotency key, then persist so a
        // crash mid-drain still reflects the retry count. The key + capturedAt
        // + timings are carried through unchanged by withDrainAttempt().
        final attempting = attempt.withDrainAttempt(
          attempt.drainAttempt + 1,
          lastAttemptAt: now.toUtc().toIso8601String(),
        );
        await _store.update(attempting);

        final outcome = await _submitter.submit(attempting);
        outcomes.add(outcome);

        switch (outcome.kind) {
          case DrainOutcomeKind.success:
          case DrainOutcomeKind.discard:
            // Either graded (or idempotent-replayed) OR refused at the session
            // level — both leave the queue.
            await _store.remove(attempting.localId);
            break;
          case DrainOutcomeKind.failedPermanent:
            // The server declared this permanent (`retryable: false`). Keep the
            // record (student work) but stop re-sending it, and stop the pass —
            // a server failing permanently for one attempt is very likely
            // failing for the rest too, so we don't spend more requests to
            // learn the same thing. The remaining records are untouched and
            // resume on the next trigger.
            final terminal = attempting.withFailure(
              outcome.reasonCode.isNotEmpty
                  ? outcome.reasonCode
                  : 'server_permanent',
            );
            await _store.update(terminal);
            _onNotice?.call(terminal, outcome);
            return outcomes;
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
  /// [retryable] is the server's EXPLICIT signal, read from the top-level
  /// `retryable` boolean of the error body (see [parseRetryable]). `null` means
  /// the field was ABSENT — an older server, a proxy-generated error page, or a
  /// body that failed to parse — in which case the historical status-only
  /// behaviour applies unchanged.
  ///
  /// Matrix:
  ///   * success                                   → success
  ///   * 409 (session_not_started)                 → discard
  ///   * 422 (REPLAY_TOO_STALE / REPLAY_CLOCK_INVALID / SHUFFLE_MAP_MISMATCH)
  ///                                               → discard
  ///   * 400 (OFFLINE_CAPTURED_AT_REQUIRED /
  ///          OFFLINE_TIME_INCONSISTENT)           → discard (un-fixable client bug)
  ///   * any other 4xx                             → discard
  ///   * 5xx / network / null status WITH
  ///     `retryable: false`                        → failedPermanent (terminal,
  ///                                                 quarantined, never dropped)
  ///   * 5xx / network / null status otherwise
  ///     (`retryable: true` or ABSENT)             → retain
  ///
  /// Note the deliberate asymmetry: [retryable] is consulted ONLY where the
  /// outcome would otherwise be `retain`. It can turn an unbounded retry into a
  /// terminal state, but it can NEVER resurrect a 4xx the server has already
  /// refused (a `retryable: true` on a `REPLAY_TOO_STALE` 422 would be an
  /// infinite loop by another name).
  static DrainOutcome classify(
    ApiResult<QuizResult> result, {
    int? statusCode,
    String reasonCode = '',
    bool? retryable,
  }) {
    return result.when(
      success: (r) => DrainOutcome(
        DrainOutcomeKind.success,
        result: r,
        reasonCode: r.idempotentReplay ? 'idempotent_replay' : 'graded',
      ),
      failure: (msg) {
        final code = statusCode;

        // Any 4xx (409 / 422 / 400 / ...) → refused at the session level,
        // discard. Decided BEFORE the retryable signal is consulted.
        if (code != null && code >= 400 && code < 500) {
          return DrainOutcome(DrainOutcomeKind.discard,
              reasonCode: reasonCode.isNotEmpty ? reasonCode : 'unreplayable_4xx');
        }

        // Everything below would historically have been an UNBOUNDED retain.
        // An explicit `retryable: false` makes it terminal instead.
        if (retryable == false) {
          return DrainOutcome(DrainOutcomeKind.failedPermanent,
              reasonCode:
                  reasonCode.isNotEmpty ? reasonCode : 'server_permanent');
        }

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
        // Anything else unexpected → keep (fail safe; don't lose the attempt).
        return DrainOutcome(DrainOutcomeKind.retain,
            reasonCode: reasonCode.isNotEmpty ? reasonCode : 'unknown');
      },
    );
  }

  /// Read the server's explicit `retryable` signal out of an error body.
  ///
  /// The `/v2` error envelope is `{ success: false, error, code?, retryable? }`,
  /// so the field is read TOP-LEVEL first; a nested `error.retryable` object
  /// form is also tolerated. Returns `null` whenever the field is absent or not
  /// interpretable — which [classify] treats as "old server, behave exactly as
  /// before". Never throws: a parse failure must never change an outcome.
  static bool? parseRetryable(Object? body) {
    try {
      if (body is! Map) return null;
      final direct = _asBool(body['retryable']);
      if (direct != null) return direct;
      final err = body['error'];
      if (err is Map) return _asBool(err['retryable']);
      return null;
    } catch (_) {
      // Defensive: an exotic body shape must not alter the classification.
      return null;
    }
  }

  static bool? _asBool(Object? v) {
    if (v is bool) return v;
    // Some proxies stringify JSON booleans; accept only the exact literals.
    if (v is String) {
      if (v == 'true') return true;
      if (v == 'false') return false;
    }
    return null;
  }

  /// The backoff that must elapse after [drainAttempt] sends before the next
  /// send: `min(retryBackoffBase * 2^(drainAttempt - 1), retryBackoffCap)`.
  /// Pure + static so the schedule is unit-testable.
  ///
  /// 30s, 1m, 2m, 4m, 8m, 16m, 32m, 64m, ~2.1h, ~4.3h, 6h, 6h …
  static Duration backoffFor(int drainAttempt) {
    if (drainAttempt <= 0) return Duration.zero;
    // Guard the shift: beyond ~26 doublings we are far past the cap anyway.
    final exponent = drainAttempt - 1;
    if (exponent >= 26) return retryBackoffCap;
    final ms = retryBackoffBase.inMilliseconds * (1 << exponent);
    return ms >= retryBackoffCap.inMilliseconds
        ? retryBackoffCap
        : Duration(milliseconds: ms);
  }

  /// Total ONLINE time that must elapse before send number [sendNumber] is
  /// permitted: `sum(backoffFor(1..sendNumber-1))`. `sendNumber <= 1` is zero
  /// (the first send is immediate).
  ///
  /// Pure + static so the "which gate binds first" arithmetic is a mechanical
  /// assertion in the test suite rather than a claim in a doc comment. The
  /// previous doc comment asserted a margin ("≥ ~20h") that was 40% larger than
  /// the real one; this helper is what makes that class of drift impossible to
  /// repeat silently.
  static Duration cumulativeBackoffBefore(int sendNumber) {
    if (sendNumber <= 1) return Duration.zero;
    var total = Duration.zero;
    for (var i = 1; i < sendNumber; i++) {
      total += backoffFor(i);
    }
    return total;
  }

  /// Decide whether [attempt] may be SENT at [now]. Pure + static so the whole
  /// bound is unit-testable without Hive or a network.
  ///
  /// Order matters: the age gate runs before the attempt-count gate so a stale
  /// attempt reports the reason the server would have given it — and, given the
  /// sizing of [maxDrainAttempts], the age gate is the one that actually fires
  /// for any attempt with a parseable `capturedAt`.
  static RetryBudgetDecision evaluateRetryBudget(
    QueuedQuizAttempt attempt,
    DateTime now,
  ) {
    // Already terminal — never send again (defensive; the store filters these).
    if (attempt.isTerminal) {
      return (
        verdict: RetryBudgetVerdict.exhausted,
        reasonCode: attempt.failureCode ?? 'terminal',
      );
    }

    // Age cap. An unparseable capturedAt must NOT expire student work — we fall
    // through to the attempt-count cap, which needs no clock at all.
    final capturedAt = DateTime.tryParse(attempt.capturedAt);
    if (capturedAt != null) {
      final age = now.toUtc().difference(capturedAt.toUtc());
      if (age >= maxAttemptAge) {
        return (
          verdict: RetryBudgetVerdict.exhausted,
          reasonCode: 'REPLAY_WINDOW_EXPIRED',
        );
      }
    }

    // Attempt cap.
    if (attempt.drainAttempt >= maxDrainAttempts) {
      return (
        verdict: RetryBudgetVerdict.exhausted,
        reasonCode: 'MAX_DRAIN_ATTEMPTS',
      );
    }

    // Backoff since the last SEND.
    final last = attempt.lastAttemptAt == null
        ? null
        : DateTime.tryParse(attempt.lastAttemptAt!);
    if (last != null) {
      final elapsed = now.toUtc().difference(last.toUtc());
      // A negative elapsed means the device clock moved backwards. Don't wedge
      // the queue on a bad clock — allow the send.
      if (!elapsed.isNegative && elapsed < backoffFor(attempt.drainAttempt)) {
        return (verdict: RetryBudgetVerdict.defer, reasonCode: 'backoff');
      }
    }

    return (verdict: RetryBudgetVerdict.send, reasonCode: '');
  }
}
