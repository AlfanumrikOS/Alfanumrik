// Unit tests for OfflineDrainService — the core offline-replay drain logic:
//   * the IMMUTABLE idempotency key is reused VERBATIM across drains (P2 — the
//     single most important rule);
//   * success / idempotent-replay removes the attempt from the queue;
//   * 409 / 422 (un-replayable) DISCARDS;
//   * 503 / network RETAINS and leaves the key unchanged for the next drain;
//   * an explicit server `retryable: false` is TERMINAL — quarantined on-device
//     (never re-sent, never silently dropped), and a MISSING `retryable` keeps
//     the historical retain behaviour byte-for-byte;
//   * the LOCAL retry budget (backoff + attempt cap + 168h age cap) bounds the
//     loop even against a server that never sends `retryable`;
//   * FIFO order + serialization (no double-send under concurrent triggers).
//
// A fake submitter records every key + drainAttempt it sees, so we can assert
// the key never changes. The store is the real Hive-backed store on a temp dir
// so FIFO/remove behavior is exercised end-to-end. The service clock is
// injected so backoff/age are exercised without sleeping.

import 'dart:async';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:hive_flutter/hive_flutter.dart';

import 'package:alfanumrik/core/network/api_result.dart';
import 'package:alfanumrik/data/models/offline_quiz_models.dart';
import 'package:alfanumrik/data/models/quiz_question.dart';
import 'package:alfanumrik/data/repositories/offline_drain_service.dart';
import 'package:alfanumrik/data/repositories/offline_quiz_store.dart';

/// Records each submitted attempt and returns a scripted outcome per localId.
class _FakeSubmitter implements OfflineQuizSubmitter {
  /// localId → list of outcomes to return on successive submits of that id.
  final Map<String, List<DrainOutcome>> scripted;

  /// Every (localId, idempotencyKey, drainAttempt) the drain submitted, in
  /// order. Used to assert the key never changes across retries.
  final List<({String localId, String key, int drainAttempt})> calls = [];

  /// Optional async barrier to test serialization (held while "in flight").
  Future<void>? gate;

  _FakeSubmitter(this.scripted);

  @override
  Future<DrainOutcome> submit(QueuedQuizAttempt attempt) async {
    if (gate != null) await gate;
    calls.add((
      localId: attempt.localId,
      key: attempt.idempotencyKey,
      drainAttempt: attempt.drainAttempt,
    ));
    final queue = scripted[attempt.localId];
    if (queue == null || queue.isEmpty) {
      return const DrainOutcome(DrainOutcomeKind.retain, reasonCode: 'no_script');
    }
    return queue.removeAt(0);
  }
}

QuizResult _result(int score) => QuizResult(
      totalQuestions: 10,
      correctAnswers: score ~/ 10,
      scorePercent: score,
      xpEarned: 50,
      timeTaken: const Duration(seconds: 60),
    );

/// Fixed "now" the attempts are captured at; tests move the clock relative to
/// it so backoff/age windows are deterministic.
final DateTime _t0 = DateTime.utc(2026, 6, 7, 9, 0, 0);

QueuedQuizAttempt _attempt(
  String localId, {
  required String key,
  int drainAttempt = 0,
  String? lastAttemptAt,
  String? capturedAt,
  String? failureCode,
}) =>
    QueuedQuizAttempt(
      localId: localId,
      sessionId: 'sess-$localId',
      studentId: 'stu-1',
      subject: 'math',
      grade: '7',
      responses: const [
        OfflineResponse(questionId: 'q1', selectedDisplayedIndex: 1, timeSpent: 5),
        OfflineResponse(questionId: 'q2', selectedDisplayedIndex: 0, timeSpent: 9),
      ],
      totalTimeSeconds: 30,
      capturedAt: capturedAt ?? _t0.toIso8601String(),
      idempotencyKey: key,
      drainAttempt: drainAttempt,
      lastAttemptAt: lastAttemptAt,
      failureCode: failureCode,
    );

void main() {
  late Directory tempDir;
  late OfflineQuizStore store;
  int boxSeq = 0;

  /// Test clock. Every drain-group service reads this, so tests advance time
  /// explicitly (backoff / age) instead of sleeping.
  late DateTime now;

  OfflineDrainService service(
    OfflineQuizSubmitter submitter, {
    DrainNotice? onNotice,
  }) =>
      OfflineDrainService(
        store: store,
        submitter: submitter,
        onNotice: onNotice,
        clock: () => now,
      );

  setUp(() async {
    tempDir = await Directory.systemTemp.createTemp('offline_drain_test');
    Hive.init(tempDir.path);
    boxSeq++;
    final bundleBox = await Hive.openBox<String>('b_$boxSeq');
    final queueBox = await Hive.openBox<String>('q_$boxSeq');
    store = OfflineQuizStore(bundleBox: bundleBox, queueBox: queueBox);
    now = _t0;
  });

  tearDown(() async {
    await Hive.deleteFromDisk();
    if (tempDir.existsSync()) await tempDir.delete(recursive: true);
  });

  group('classify (discard-vs-retry matrix)', () {
    test('success → success (records idempotent_replay reason)', () {
      final fresh = OfflineDrainService.classify(
        ApiSuccess(_result(80)),
        statusCode: 200,
      );
      expect(fresh.kind, DrainOutcomeKind.success);
      expect(fresh.reasonCode, 'graded');

      final replay = OfflineDrainService.classify(
        const ApiSuccess(QuizResult(
          totalQuestions: 10,
          correctAnswers: 8,
          scorePercent: 80,
          xpEarned: 50,
          timeTaken: Duration(seconds: 60),
          idempotentReplay: true,
        )),
        statusCode: 200,
      );
      expect(replay.kind, DrainOutcomeKind.success);
      expect(replay.reasonCode, 'idempotent_replay');
    });

    test('409 / 422 / 400 → discard (un-replayable)', () {
      for (final code in [409, 422, 400, 403]) {
        final o = OfflineDrainService.classify(
          const ApiFailure<QuizResult>('x'),
          statusCode: code,
          reasonCode: 'CODE_$code',
        );
        expect(o.kind, DrainOutcomeKind.discard, reason: 'status $code');
        expect(o.reasonCode, 'CODE_$code');
      }
    });

    test('503 / 5xx → retain (transient)', () {
      for (final code in [500, 502, 503]) {
        final o = OfflineDrainService.classify(
          const ApiFailure<QuizResult>('x'),
          statusCode: code,
        );
        expect(o.kind, DrainOutcomeKind.retain, reason: 'status $code');
      }
    });

    test('null status (network/timeout) → retain', () {
      final o = OfflineDrainService.classify(
        const ApiFailure<QuizResult>('connection failed'),
        statusCode: null,
      );
      expect(o.kind, DrainOutcomeKind.retain);
      expect(o.reasonCode, 'network_error');
    });

    // ── Explicit server permanence signal ────────────────────────────────
    // The P0: `POST /v2/quiz/submit` answered 503 RPC_FAILED for a PERMANENT
    // SQLSTATE 42501 (permission denied), and the drain retried it forever.
    test('5xx WITH retryable:false → failedPermanent (not an unbounded retain)',
        () {
      for (final code in [500, 502, 503]) {
        final o = OfflineDrainService.classify(
          const ApiFailure<QuizResult>('x'),
          statusCode: code,
          reasonCode: 'RPC_FAILED',
          retryable: false,
        );
        expect(o.kind, DrainOutcomeKind.failedPermanent, reason: 'status $code');
        expect(o.reasonCode, 'RPC_FAILED');
      }
    });

    test('5xx WITH retryable:true → retain (genuine transient)', () {
      final o = OfflineDrainService.classify(
        const ApiFailure<QuizResult>('x'),
        statusCode: 503,
        retryable: true,
      );
      expect(o.kind, DrainOutcomeKind.retain);
    });

    test('5xx with MISSING retryable → retain (old server, unchanged behaviour)',
        () {
      final o = OfflineDrainService.classify(
        const ApiFailure<QuizResult>('x'),
        statusCode: 503,
        // retryable omitted entirely
      );
      expect(o.kind, DrainOutcomeKind.retain);
      expect(o.reasonCode, 'server_5xx');
    });

    test('network error (null status) WITH retryable:false → failedPermanent',
        () {
      final o = OfflineDrainService.classify(
        const ApiFailure<QuizResult>('x'),
        statusCode: null,
        retryable: false,
      );
      expect(o.kind, DrainOutcomeKind.failedPermanent);
      expect(o.reasonCode, 'server_permanent');
    });

    test('retryable NEVER resurrects a 4xx — a discard stays a discard', () {
      for (final flag in [true, false, null]) {
        final o = OfflineDrainService.classify(
          const ApiFailure<QuizResult>('x'),
          statusCode: 422,
          reasonCode: 'REPLAY_TOO_STALE',
          retryable: flag,
        );
        expect(o.kind, DrainOutcomeKind.discard, reason: 'retryable=$flag');
      }
    });
  });

  group('parseRetryable (defensive — a parse must never change an outcome)', () {
    test('reads the top-level /v2 error-envelope boolean', () {
      expect(
        OfflineDrainService.parseRetryable(
            {'success': false, 'error': 'boom', 'code': 'RPC_FAILED', 'retryable': false}),
        isFalse,
      );
      expect(
        OfflineDrainService.parseRetryable(
            {'success': false, 'error': 'boom', 'retryable': true}),
        isTrue,
      );
    });

    test('tolerates a nested error object', () {
      expect(
        OfflineDrainService.parseRetryable({
          'error': {'code': 'RPC_FAILED', 'retryable': false}
        }),
        isFalse,
      );
    });

    test('tolerates stringified booleans', () {
      expect(OfflineDrainService.parseRetryable({'retryable': 'false'}), isFalse);
      expect(OfflineDrainService.parseRetryable({'retryable': 'true'}), isTrue);
    });

    test('returns null (= absent) for every unparseable shape', () {
      expect(OfflineDrainService.parseRetryable(null), isNull);
      expect(OfflineDrainService.parseRetryable('<html>502</html>'), isNull);
      expect(OfflineDrainService.parseRetryable(<String, dynamic>{}), isNull);
      expect(OfflineDrainService.parseRetryable({'retryable': 'maybe'}), isNull);
      expect(OfflineDrainService.parseRetryable({'retryable': 0}), isNull);
      expect(OfflineDrainService.parseRetryable({'error': 'plain string'}), isNull);
      expect(OfflineDrainService.parseRetryable([1, 2, 3]), isNull);
    });
  });

  group('retry budget (bounds the loop with NO server signal at all)', () {
    test('backoffFor doubles from 30s and caps at 6h', () {
      expect(OfflineDrainService.backoffFor(0), Duration.zero);
      expect(OfflineDrainService.backoffFor(1), const Duration(seconds: 30));
      expect(OfflineDrainService.backoffFor(2), const Duration(minutes: 1));
      expect(OfflineDrainService.backoffFor(3), const Duration(minutes: 2));
      expect(OfflineDrainService.backoffFor(9), const Duration(minutes: 128));
      // Ceiling reached and held (never overflows).
      expect(OfflineDrainService.backoffFor(11), const Duration(hours: 6));
      expect(OfflineDrainService.backoffFor(64), const Duration(hours: 6));
    });

    test('a fresh attempt is sendable', () {
      final d = OfflineDrainService.evaluateRetryBudget(
          _attempt('a', key: 'k'), _t0);
      expect(d.verdict, RetryBudgetVerdict.send);
    });

    test('defers inside the backoff window, sends once it elapses', () {
      final a = _attempt('a',
          key: 'k',
          drainAttempt: 1,
          lastAttemptAt: _t0.toIso8601String());

      expect(
        OfflineDrainService.evaluateRetryBudget(
                a, _t0.add(const Duration(seconds: 29)))
            .verdict,
        RetryBudgetVerdict.defer,
      );
      expect(
        OfflineDrainService.evaluateRetryBudget(
                a, _t0.add(const Duration(seconds: 30)))
            .verdict,
        RetryBudgetVerdict.send,
      );
    });

    test('exhausts at maxDrainAttempts', () {
      final a = _attempt('a',
          key: 'k', drainAttempt: OfflineDrainService.maxDrainAttempts);
      final d = OfflineDrainService.evaluateRetryBudget(
          a, _t0.add(const Duration(days: 1)));
      expect(d.verdict, RetryBudgetVerdict.exhausted);
      expect(d.reasonCode, 'MAX_DRAIN_ATTEMPTS');
    });

    // ── THE GATE-ORDERING PIN ────────────────────────────────────────────
    // The attempt cap was originally 12, which exhausted after only
    //   30+60+120+240+480+960+1920+3840+7680+15360+21600 = 52_290 s = 14.5 h
    // of online time — ~10x tighter than the 168 h window the SERVER would
    // still have honoured, so a server outage quarantined a perfectly valid
    // attempt and forfeited ~153 h of replayable window. These tests make the
    // arithmetic mechanical: lower maxDrainAttempts (or lengthen the backoff)
    // and the suite fails instead of the margin silently shrinking again.
    test('cumulativeBackoffBefore reproduces the documented schedule', () {
      expect(OfflineDrainService.cumulativeBackoffBefore(1), Duration.zero);
      expect(OfflineDrainService.cumulativeBackoffBefore(2),
          const Duration(seconds: 30));
      // Sum of 30*2^0..30*2^9 = 30 * (2^10 - 1) = 30_690 s.
      expect(OfflineDrainService.cumulativeBackoffBefore(11).inSeconds, 30690);
      // From send #11 on, every step is the 6h cap (21_600 s).
      expect(OfflineDrainService.cumulativeBackoffBefore(12).inSeconds, 52290,
          reason: 'the OLD cap of 12 exhausted here — 14.5h, not "≥ ~20h"');
      expect(OfflineDrainService.cumulativeBackoffBefore(37).inSeconds, 592290);
      expect(OfflineDrainService.cumulativeBackoffBefore(38).inSeconds, 613890);
    });

    test('the AGE gate is the binding bound: the 168h window is reached before '
        'the attempt cap', () {
      final toExhaustCount = OfflineDrainService.cumulativeBackoffBefore(
          OfflineDrainService.maxDrainAttempts);
      expect(
        toExhaustCount,
        greaterThan(OfflineDrainService.maxAttemptAge),
        reason: 'maxDrainAttempts must NOT be reachable inside the server\'s '
            '168h replay window — otherwise the count cap silently overrides '
            'the only gate that is actually server-aligned',
      );
      // Concretely: 40 sends need 657_090 s = 182.5 h > 168 h.
      expect(toExhaustCount.inSeconds, 657090);
      expect(OfflineDrainService.maxAttemptAge.inSeconds, 604800);
    });

    test('an attempt with a parseable capturedAt gets 37 sends, then the AGE '
        'gate (not the count cap) ends it', () {
      // Largest k whose cumulative backoff still fits inside 168h.
      var maxSends = 0;
      for (var k = 1; k <= OfflineDrainService.maxDrainAttempts; k++) {
        if (OfflineDrainService.cumulativeBackoffBefore(k) <
            OfflineDrainService.maxAttemptAge) {
          maxSends = k;
        }
      }
      expect(maxSends, 37);

      // And the record that reaches the window edge reports the SERVER's
      // reason, not the local counter's.
      final a = _attempt('a', key: 'k', drainAttempt: maxSends);
      final d = OfflineDrainService.evaluateRetryBudget(
          a, _t0.add(OfflineDrainService.maxAttemptAge));
      expect(d.verdict, RetryBudgetVerdict.exhausted);
      expect(d.reasonCode, 'REPLAY_WINDOW_EXPIRED');
    });

    test('the count cap still backstops a record whose capturedAt will not '
        'parse (the age gate cannot fire there)', () {
      final a = _attempt('a',
          key: 'k',
          capturedAt: 'not-a-date',
          drainAttempt: OfflineDrainService.maxDrainAttempts);
      final d = OfflineDrainService.evaluateRetryBudget(
          a, _t0.add(const Duration(days: 400)));
      expect(d.verdict, RetryBudgetVerdict.exhausted);
      expect(d.reasonCode, 'MAX_DRAIN_ATTEMPTS',
          reason: 'without this backstop a corrupt timestamp means an '
              'unbounded 6-hourly retry forever');
    });

    test('exhausts at the 168h replay window (aligned with the server gate)',
        () {
      final a = _attempt('a', key: 'k');
      // 167h59m — still inside the window the server will replay.
      expect(
        OfflineDrainService.evaluateRetryBudget(
                a, _t0.add(const Duration(hours: 167, minutes: 59)))
            .verdict,
        RetryBudgetVerdict.send,
      );
      final d = OfflineDrainService.evaluateRetryBudget(
          a, _t0.add(const Duration(hours: 168)));
      expect(d.verdict, RetryBudgetVerdict.exhausted);
      expect(d.reasonCode, 'REPLAY_WINDOW_EXPIRED');
    });

    test('an unparseable capturedAt does NOT expire student work', () {
      final a = _attempt('a', key: 'k', capturedAt: 'not-a-date');
      expect(
        OfflineDrainService.evaluateRetryBudget(
                a, _t0.add(const Duration(days: 30)))
            .verdict,
        RetryBudgetVerdict.send,
      );
    });

    test('a backwards device clock does not wedge the queue', () {
      final a = _attempt('a',
          key: 'k',
          drainAttempt: 1,
          lastAttemptAt: _t0.add(const Duration(hours: 2)).toIso8601String());
      // "now" is BEFORE the stored lastAttemptAt (clock moved back).
      expect(
        OfflineDrainService.evaluateRetryBudget(a, _t0).verdict,
        RetryBudgetVerdict.send,
      );
    });

    test('an already-terminal attempt is never sendable', () {
      final a = _attempt('a', key: 'k', failureCode: 'RPC_FAILED');
      final d = OfflineDrainService.evaluateRetryBudget(a, _t0);
      expect(d.verdict, RetryBudgetVerdict.exhausted);
      expect(d.reasonCode, 'RPC_FAILED');
    });
  });

  group('drain', () {
    test('success removes the attempt from the queue and surfaces the score',
        () async {
      await store.enqueue(_attempt('a', key: 'key-a'));
      final submitter = _FakeSubmitter({
        'a': [DrainOutcome(DrainOutcomeKind.success, result: _result(90))],
      });
      final notices = <DrainOutcome>[];
      final svc = service(submitter, onNotice: (_, o) => notices.add(o));

      final outcomes = await svc.drain();

      expect(outcomes.single.kind, DrainOutcomeKind.success);
      expect(store.queueLength, 0, reason: 'graded attempt leaves the queue');
      expect(notices.single.result!.scorePercent, 90);
    });

    test('409 session_not_started DISCARDS (does not infinitely retry)',
        () async {
      await store.enqueue(_attempt('a', key: 'key-a'));
      final submitter = _FakeSubmitter({
        'a': [const DrainOutcome(DrainOutcomeKind.discard, reasonCode: 'SESSION_NOT_STARTED')],
      });
      final svc = service(submitter);

      final outcomes = await svc.drain();

      expect(outcomes.single.kind, DrainOutcomeKind.discard);
      expect(store.queueLength, 0, reason: 'un-replayable attempt is dropped');
    });

    test('422 REPLAY_TOO_STALE / SHUFFLE_MAP_MISMATCH DISCARDS', () async {
      await store.enqueue(_attempt('a', key: 'key-a'));
      await store.enqueue(_attempt('b', key: 'key-b'));
      final submitter = _FakeSubmitter({
        'a': [const DrainOutcome(DrainOutcomeKind.discard, reasonCode: 'REPLAY_TOO_STALE')],
        'b': [const DrainOutcome(DrainOutcomeKind.discard, reasonCode: 'SHUFFLE_MAP_MISMATCH')],
      });
      final svc = service(submitter);

      await svc.drain();

      expect(store.queueLength, 0);
    });

    test('503 RETAINS the attempt and the idempotency key is UNCHANGED across '
        'drains (P2 — never regenerate the key)', () async {
      await store.enqueue(_attempt('a', key: 'immutable-key-a'));
      // First drain: 503 (retain). Second drain: success.
      final submitter = _FakeSubmitter({
        'a': [
          const DrainOutcome(DrainOutcomeKind.retain, reasonCode: 'server_5xx'),
          DrainOutcome(DrainOutcomeKind.success, result: _result(70)),
        ],
      });
      final svc = service(submitter);

      // Drain #1 — 503, stays queued.
      final first = await svc.drain();
      expect(first.single.kind, DrainOutcomeKind.retain);
      expect(store.queueLength, 1, reason: 'transient failure stays queued');

      // Drain #2 — once the (30s) backoff has elapsed: success, removed.
      now = now.add(const Duration(seconds: 30));
      final second = await svc.drain();
      expect(second.single.kind, DrainOutcomeKind.success);
      expect(store.queueLength, 0);

      // THE CRITICAL ASSERTION: the SAME idempotency key was sent on BOTH
      // drains. A regenerated key would double-grant XP on the server replay.
      expect(submitter.calls.map((c) => c.key).toSet(), {'immutable-key-a'});
      expect(submitter.calls, hasLength(2));
      // The drainAttempt counter DID advance (telemetry), proving the key is
      // immutable independently of the retry counter.
      expect(submitter.calls[0].drainAttempt, 1);
      expect(submitter.calls[1].drainAttempt, 2);
    });

    test('drains FIFO and stops at the first transient failure (resumes next '
        'reconnect)', () async {
      await store.enqueue(_attempt('a', key: 'key-a'));
      await store.enqueue(_attempt('b', key: 'key-b'));
      await store.enqueue(_attempt('c', key: 'key-c'));
      final submitter = _FakeSubmitter({
        'a': [DrainOutcome(DrainOutcomeKind.success, result: _result(50))],
        'b': [const DrainOutcome(DrainOutcomeKind.retain, reasonCode: 'server_5xx')],
        'c': [DrainOutcome(DrainOutcomeKind.success, result: _result(60))],
      });
      final svc = service(submitter);

      await svc.drain();

      // a graded+removed; b stays (503); c NOT attempted this pass (stopped at b).
      expect(submitter.calls.map((c) => c.localId).toList(), ['a', 'b']);
      final remaining = store.queue().map((e) => e.localId).toList();
      expect(remaining, ['b', 'c'], reason: 'b retained, c not yet attempted');
    });

    test('serializes: a re-entrant drain while one is in flight is a no-op',
        () async {
      await store.enqueue(_attempt('a', key: 'key-a'));
      final submitter = _FakeSubmitter({
        'a': [DrainOutcome(DrainOutcomeKind.success, result: _result(80))],
      });
      // Hold the first submit mid-flight so we can fire a concurrent drain.
      final completer = Completer<void>();
      submitter.gate = completer.future;
      final svc = service(submitter);

      final firstDrain = svc.drain();
      // Concurrent re-entrant call — must short-circuit (guard) and submit
      // NOTHING (no double-send of attempt 'a').
      final concurrent = await svc.drain();
      expect(concurrent, isEmpty, reason: 'serialization guard blocks re-entry');

      completer.complete();
      await firstDrain;

      expect(submitter.calls, hasLength(1),
          reason: 'attempt a was submitted exactly once despite two triggers');
      expect(store.queueLength, 0);
    });

    // ── The P0 fix: a PERMANENT server failure must stop, but must NOT eat
    //    the student's completed quiz. ─────────────────────────────────────
    test('a permanent server failure QUARANTINES the attempt: never re-sent, '
        'never dropped, key intact', () async {
      await store.enqueue(_attempt('a', key: 'immutable-key-a'));
      final submitter = _FakeSubmitter({
        'a': [
          const DrainOutcome(DrainOutcomeKind.failedPermanent,
              reasonCode: 'RPC_FAILED'),
        ],
      });
      final notices = <DrainOutcome>[];
      final svc = service(submitter, onNotice: (_, o) => notices.add(o));

      final outcomes = await svc.drain();

      expect(outcomes.single.kind, DrainOutcomeKind.failedPermanent);
      // NOT discarded — the completed quiz is still on the device.
      expect(store.queueLength, 0, reason: 'no longer waiting to sync');
      expect(store.failedLength, 1, reason: 'quarantined, not deleted');
      final quarantined = store.failed().single;
      expect(quarantined.failureCode, 'RPC_FAILED');
      expect(quarantined.idempotencyKey, 'immutable-key-a',
          reason: 'P2 — the key survives quarantine unchanged');
      expect(quarantined.responses, hasLength(2));
      // Surfaced, not silent.
      expect(notices.single.kind, DrainOutcomeKind.failedPermanent);
      expect(notices.single.reasonCode, 'RPC_FAILED');

      // AND the loop is over: later drains send nothing at all, forever.
      now = now.add(const Duration(days: 3));
      final again = await svc.drain();
      expect(again, isEmpty);
      expect(submitter.calls, hasLength(1),
          reason: 'a permanently-failed attempt is never re-sent');
    });

    test('backoff: repeated foreground drains inside the window send NOTHING',
        () async {
      await store.enqueue(_attempt('a', key: 'key-a'));
      final submitter = _FakeSubmitter({
        'a': List.generate(
          10,
          (_) => const DrainOutcome(DrainOutcomeKind.retain,
              reasonCode: 'server_5xx'),
        ),
      });
      final svc = service(submitter);

      await svc.drain(); // sends #1
      // Five more app-foregrounds within the 30s window — the old code sent
      // five more requests; now they cost zero bytes.
      for (var i = 0; i < 5; i++) {
        final o = await svc.drain();
        expect(o, isEmpty, reason: 'deferred by backoff, nothing submitted');
      }
      expect(submitter.calls, hasLength(1));

      // Window elapsed → exactly one more send.
      now = now.add(const Duration(seconds: 31));
      await svc.drain();
      expect(submitter.calls, hasLength(2));
      expect(store.queueLength, 1, reason: 'still a transient — still queued');
    });

    test('an endlessly-503ing server (NO retryable signal) is bounded by the '
        'AGE gate — the server-aligned bound, not the count cap', () async {
      await store.enqueue(_attempt('a', key: 'key-a'));
      final submitter = _FakeSubmitter({
        'a': List.generate(
          80,
          (_) => const DrainOutcome(DrainOutcomeKind.retain,
              reasonCode: 'server_5xx'),
        ),
      });
      final svc = service(submitter);

      // Drain repeatedly, always jumping past the largest backoff window (6h),
      // so the ONLY thing that can stop the loop is a budget gate.
      for (var i = 0; i < 60; i++) {
        await svc.drain();
        now = now.add(const Duration(hours: 7));
      }

      // 7h per pass ⇒ the 168h window is crossed on pass 24: 24 sends, then
      // quarantine. Crucially FEWER than maxDrainAttempts — the count cap
      // never got a say.
      expect(submitter.calls, hasLength(24),
          reason: 'the loop is bounded even with no server signal');
      expect(submitter.calls.length,
          lessThan(OfflineDrainService.maxDrainAttempts),
          reason: 'the age gate must bind before the count cap');
      expect(store.queueLength, 0);
      expect(store.failed().single.failureCode, 'REPLAY_WINDOW_EXPIRED');
      // Key never regenerated on ANY of the bounded retries (P2).
      expect(submitter.calls.map((c) => c.key).toSet(), {'key-a'});
    });

    test('count cap backstop: with an UNPARSEABLE capturedAt (age gate cannot '
        'fire) the loop still stops at maxDrainAttempts', () async {
      await store.enqueue(
          _attempt('a', key: 'key-a', capturedAt: 'corrupt-timestamp'));
      final submitter = _FakeSubmitter({
        'a': List.generate(
          80,
          (_) => const DrainOutcome(DrainOutcomeKind.retain,
              reasonCode: 'server_5xx'),
        ),
      });
      final svc = service(submitter);

      for (var i = 0; i < 60; i++) {
        await svc.drain();
        now = now.add(const Duration(hours: 7));
      }

      expect(submitter.calls, hasLength(OfflineDrainService.maxDrainAttempts),
          reason: 'a corrupt timestamp must not mean unbounded retries');
      expect(store.queueLength, 0);
      expect(store.failed().single.failureCode, 'MAX_DRAIN_ATTEMPTS');
      expect(submitter.calls.map((c) => c.key).toSet(), {'key-a'});
    });

    test('age cap: past the 168h replay window the attempt is quarantined '
        'WITHOUT spending a request', () async {
      await store.enqueue(_attempt('a', key: 'key-a'));
      final submitter = _FakeSubmitter({
        'a': [DrainOutcome(DrainOutcomeKind.success, result: _result(90))],
      });
      final svc = service(submitter);

      now = now.add(const Duration(hours: 169));
      final outcomes = await svc.drain();

      expect(outcomes.single.kind, DrainOutcomeKind.failedPermanent);
      expect(outcomes.single.reasonCode, 'REPLAY_WINDOW_EXPIRED');
      expect(submitter.calls, isEmpty,
          reason: 'the server would only answer 422 — spend zero bytes');
      expect(store.failedLength, 1);
    });

    // ── The inverse of quarantine ─────────────────────────────────────────
    // Before this, a terminal record's ONLY reachable end state was deletion
    // (remove / clearFailed), which made "kept, never silently dropped" an
    // empty guarantee. requeue() is the inverse of withFailure().
    test('a quarantined attempt can be REQUEUED and is then actually re-sent — '
        'with the SAME idempotency key (cannot double-score)', () async {
      await store.enqueue(_attempt('a', key: 'immutable-key-a'));
      final submitter = _FakeSubmitter({
        'a': [
          const DrainOutcome(DrainOutcomeKind.failedPermanent,
              reasonCode: 'RPC_FAILED'),
          // After the outage is fixed, the requeued attempt grades — as an
          // idempotent replay if the first send had in fact committed.
          DrainOutcome(DrainOutcomeKind.success, result: _result(90)),
        ],
      });
      final svc = service(submitter);

      await svc.drain();
      expect(store.failedLength, 1);
      expect(store.queueLength, 0, reason: 'not drainable while terminal');

      // Requeue: the ONLY thing that returns it to the drainable queue.
      final ok = await store.requeue('a');
      expect(ok, isTrue);
      expect(store.failedLength, 0);
      expect(store.queueLength, 1);

      final requeued = store.queue().single;
      // Everything that feeds grading survives VERBATIM.
      expect(requeued.idempotencyKey, 'immutable-key-a',
          reason: 'P2 — same key ⇒ the server replays its cached result '
              'instead of grading twice');
      expect(requeued.capturedAt, _t0.toIso8601String(),
          reason: 'capturedAt is never refreshed to dodge the staleness gate');
      expect(requeued.responses, _attempt('a', key: 'x').responses);
      expect(requeued.totalTimeSeconds, 30);
      expect(requeued.sessionId, 'sess-a');
      // Only the retry-budget counters were reset.
      expect(requeued.failureCode, isNull);
      expect(requeued.drainAttempt, 0);
      expect(requeued.lastAttemptAt, isNull);

      // And it really is re-sendable: no lingering backoff, no exhausted cap.
      final outcomes = await svc.drain();
      expect(outcomes.single.kind, DrainOutcomeKind.success);
      expect(submitter.calls, hasLength(2));
      expect(submitter.calls.map((c) => c.key).toSet(), {'immutable-key-a'},
          reason: 'the re-send carries the ORIGINAL key');
      expect(store.queueLength, 0);
      expect(store.failedLength, 0);
    });

    test('requeue does NOT resurrect a window-expired attempt: it re-quarantines '
        'without spending a request', () async {
      // capturedAt is preserved by design, so the 168h server gate still holds.
      await store.enqueue(_attempt('a',
          key: 'key-a',
          capturedAt:
              _t0.subtract(const Duration(hours: 200)).toIso8601String()));
      final submitter = _FakeSubmitter({});
      final svc = service(submitter);

      await svc.drain();
      expect(store.failed().single.failureCode, 'REPLAY_WINDOW_EXPIRED');

      expect(await store.requeue('a'), isTrue);
      final again = await svc.drain();

      expect(again.single.kind, DrainOutcomeKind.failedPermanent);
      expect(again.single.reasonCode, 'REPLAY_WINDOW_EXPIRED');
      expect(submitter.calls, isEmpty,
          reason: 'requeue restores re-sendability, not server acceptance — '
              'the server would only answer 422 REPLAY_TOO_STALE');
    });

    test('a locally-expired attempt does not block a healthy one behind it',
        () async {
      // 'a' captured 8 days ago (expired); 'b' captured now (fine).
      await store.enqueue(_attempt('a',
          key: 'key-a',
          capturedAt: _t0.subtract(const Duration(hours: 200)).toIso8601String()));
      await store.enqueue(_attempt('b', key: 'key-b'));
      final submitter = _FakeSubmitter({
        'b': [DrainOutcome(DrainOutcomeKind.success, result: _result(60))],
      });
      final svc = service(submitter);

      final outcomes = await svc.drain();

      expect(outcomes.map((o) => o.kind).toList(),
          [DrainOutcomeKind.failedPermanent, DrainOutcomeKind.success]);
      expect(submitter.calls.map((c) => c.localId).toList(), ['b'],
          reason: 'only the healthy attempt was sent');
      expect(store.queueLength, 0);
      expect(store.failed().single.localId, 'a');
    });
  });
}
