// Unit tests for OfflineDrainService — the core offline-replay drain logic:
//   * the IMMUTABLE idempotency key is reused VERBATIM across drains (P2 — the
//     single most important rule);
//   * success / idempotent-replay removes the attempt from the queue;
//   * 409 / 422 (un-replayable) DISCARDS;
//   * 503 / network RETAINS and leaves the key unchanged for the next drain;
//   * FIFO order + serialization (no double-send under concurrent triggers).
//
// A fake submitter records every key + drainAttempt it sees, so we can assert
// the key never changes. The store is the real Hive-backed store on a temp dir
// so FIFO/remove behavior is exercised end-to-end.

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

QueuedQuizAttempt _attempt(String localId, {required String key}) =>
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
      capturedAt: '2026-06-07T09:00:00.000Z',
      idempotencyKey: key,
    );

void main() {
  late Directory tempDir;
  late OfflineQuizStore store;
  int boxSeq = 0;

  setUp(() async {
    tempDir = await Directory.systemTemp.createTemp('offline_drain_test');
    Hive.init(tempDir.path);
    boxSeq++;
    final bundleBox = await Hive.openBox<String>('b_$boxSeq');
    final queueBox = await Hive.openBox<String>('q_$boxSeq');
    store = OfflineQuizStore(bundleBox: bundleBox, queueBox: queueBox);
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
  });

  group('drain', () {
    test('success removes the attempt from the queue and surfaces the score',
        () async {
      await store.enqueue(_attempt('a', key: 'key-a'));
      final submitter = _FakeSubmitter({
        'a': [DrainOutcome(DrainOutcomeKind.success, result: _result(90))],
      });
      final notices = <DrainOutcome>[];
      final svc = OfflineDrainService(
        store: store,
        submitter: submitter,
        onNotice: (_, o) => notices.add(o),
      );

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
      final svc = OfflineDrainService(store: store, submitter: submitter);

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
      final svc = OfflineDrainService(store: store, submitter: submitter);

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
      final svc = OfflineDrainService(store: store, submitter: submitter);

      // Drain #1 — 503, stays queued.
      final first = await svc.drain();
      expect(first.single.kind, DrainOutcomeKind.retain);
      expect(store.queueLength, 1, reason: 'transient failure stays queued');

      // Drain #2 — success, removed.
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
      final svc = OfflineDrainService(store: store, submitter: submitter);

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
      final svc = OfflineDrainService(store: store, submitter: submitter);

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
  });
}
