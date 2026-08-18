// Unit tests for OfflineQuizStore — Hive-backed FIFO submission queue.
// Uses a temp-dir Hive so the real box behavior (FIFO insertion order, delete)
// is exercised without a Flutter binding.

import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:hive_flutter/hive_flutter.dart';

import 'package:alfanumrik/data/models/offline_quiz_models.dart';
import 'package:alfanumrik/data/repositories/offline_quiz_store.dart';

QueuedQuizAttempt _attempt(
  String localId, {
  String key = 'k',
  int drain = 0,
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
      ],
      totalTimeSeconds: 30,
      capturedAt: '2026-06-07T09:00:00.000Z',
      idempotencyKey: key,
      drainAttempt: drain,
      failureCode: failureCode,
    );

void main() {
  late Directory tempDir;
  late OfflineQuizStore store;
  late Box<String> queueBox;
  int boxSeq = 0;

  setUp(() async {
    tempDir = await Directory.systemTemp.createTemp('offline_quiz_store_test');
    Hive.init(tempDir.path);
    // Unique box names per test to avoid cross-test state.
    boxSeq++;
    queueBox = await Hive.openBox<String>('queue_$boxSeq');
    store = OfflineQuizStore(queueBox: queueBox);
  });

  tearDown(() async {
    await Hive.deleteFromDisk();
    if (tempDir.existsSync()) {
      await tempDir.delete(recursive: true);
    }
  });

  group('submission queue', () {
    test('enqueue preserves FIFO insertion order', () async {
      await store.enqueue(_attempt('a'));
      await store.enqueue(_attempt('b'));
      await store.enqueue(_attempt('c'));

      final q = store.queue();
      expect(q.map((e) => e.localId).toList(), ['a', 'b', 'c']);
      expect(store.queueLength, 3);
    });

    test('remove deletes by localId and preserves remaining order', () async {
      await store.enqueue(_attempt('a'));
      await store.enqueue(_attempt('b'));
      await store.enqueue(_attempt('c'));

      await store.remove('b');

      expect(store.queue().map((e) => e.localId).toList(), ['a', 'c']);
    });

    test('update replaces in place and keeps order (drainAttempt bump)',
        () async {
      await store.enqueue(_attempt('a', drain: 0));
      await store.enqueue(_attempt('b'));

      await store.update(_attempt('a', drain: 3));

      final q = store.queue();
      expect(q.map((e) => e.localId).toList(), ['a', 'b']);
      expect(q.first.drainAttempt, 3);
      // Key is unchanged across the update.
      expect(q.first.idempotencyKey, 'k');
    });

    test('enqueue is idempotent on localId (no duplicates)', () async {
      await store.enqueue(_attempt('a', key: 'k1'));
      await store.enqueue(_attempt('a', key: 'k1'));
      expect(store.queueLength, 1);
    });
  });

  group('terminal ("needs attention") records', () {
    test('queue() excludes them — a terminal attempt is never re-drained', () async {
      await store.enqueue(_attempt('a'));
      await store.enqueue(_attempt('b', failureCode: 'RPC_FAILED'));
      await store.enqueue(_attempt('c'));

      expect(store.queue().map((e) => e.localId).toList(), ['a', 'c']);
      expect(store.queueLength, 2, reason: 'badge counts only what will sync');
    });

    test('failed() lists them — the work is KEPT, not deleted', () async {
      await store.enqueue(_attempt('a'));
      await store.enqueue(
          _attempt('b', key: 'immutable-b', failureCode: 'MAX_DRAIN_ATTEMPTS'));

      final failed = store.failed();
      expect(failed.map((e) => e.localId).toList(), ['b']);
      expect(store.failedLength, 1);
      // The record survives intact, key included (P2).
      expect(failed.single.idempotencyKey, 'immutable-b');
      expect(failed.single.responses, hasLength(1));
      expect(store.all(), hasLength(2));
    });

    test('marking terminal in place preserves order and the key', () async {
      await store.enqueue(_attempt('a', key: 'key-a'));
      await store.enqueue(_attempt('b', key: 'key-b'));

      await store.update(_attempt('a', key: 'key-a').withFailure('RPC_FAILED'));

      expect(store.all().map((e) => e.localId).toList(), ['a', 'b']);
      expect(store.failed().single.idempotencyKey, 'key-a');
      expect(store.queue().map((e) => e.localId).toList(), ['b']);
    });

    test('clearFailed drops only terminal records', () async {
      await store.enqueue(_attempt('a'));
      await store.enqueue(_attempt('b', failureCode: 'RPC_FAILED'));

      await store.clearFailed();

      expect(store.failedLength, 0);
      expect(store.queue().map((e) => e.localId).toList(), ['a']);
    });

    test('byId finds pending AND terminal records', () async {
      await store.enqueue(_attempt('a'));
      await store.enqueue(_attempt('b', failureCode: 'RPC_FAILED'));

      expect(store.byId('a')?.isTerminal, isFalse);
      expect(store.byId('b')?.failureCode, 'RPC_FAILED');
      expect(store.byId('nope'), isNull);
    });
  });

  // ── requeue: the inverse of quarantine ───────────────────────────────────
  // Until this existed, the ONLY operations on a terminal record were remove()
  // and clearFailed() — both DELETE. "Kept, never silently dropped" was
  // therefore only half true: the work was retained but unrecoverable.
  group('requeue (the inverse of withFailure)', () {
    test('returns a terminal record to the drainable queue with the key, '
        'answers and capturedAt UNCHANGED', () async {
      await store.enqueue(_attempt('a', key: 'immutable-a'));
      await store.update(
          _attempt('a', key: 'immutable-a', drain: 7).withFailure('RPC_FAILED'));
      expect(store.failedLength, 1);
      expect(store.queueLength, 0);

      final ok = await store.requeue('a');

      expect(ok, isTrue);
      expect(store.failedLength, 0);
      expect(store.queueLength, 1);
      final back = store.queue().single;
      // DOUBLE-SCORE SAFETY (P2): the grading token is byte-identical, so the
      // server's (student_id, idempotency_key) short-circuit replays the cached
      // result rather than grading a second time.
      expect(back.idempotencyKey, 'immutable-a');
      expect(back.capturedAt, '2026-06-07T09:00:00.000Z');
      expect(back.responses, hasLength(1));
      expect(back.responses.single.selectedDisplayedIndex, 1);
      expect(back.responses.single.timeSpent, 5);
      expect(back.totalTimeSeconds, 30);
      expect(back.sessionId, 'sess-a');
      // Only the retry-budget counters moved.
      expect(back.failureCode, isNull);
      expect(back.drainAttempt, 0, reason: 'budget reset ⇒ actually re-sendable');
      expect(back.lastAttemptAt, isNull, reason: 'no stale backoff window');
    });

    test('preserves FIFO position (writes back under the same key)', () async {
      await store.enqueue(_attempt('a'));
      await store.enqueue(_attempt('b'));
      await store.enqueue(_attempt('c'));
      await store.update(_attempt('b').withFailure('RPC_FAILED'));

      await store.requeue('b');

      expect(store.queue().map((e) => e.localId).toList(), ['a', 'b', 'c'],
          reason: 'a recovered attempt keeps its place, it does not go last');
    });

    test('is a no-op for an unknown id or an already-pending attempt', () async {
      await store.enqueue(_attempt('a', drain: 4));

      expect(await store.requeue('nope'), isFalse);
      expect(await store.requeue('a'), isFalse,
          reason: 'must not zero the retry counter of an attempt mid-backoff');
      expect(store.queue().single.drainAttempt, 4);
    });

    test('requeueAllFailed is the bulk inverse of clearFailed', () async {
      await store.enqueue(_attempt('a'));
      await store.enqueue(_attempt('b', failureCode: 'RPC_FAILED'));
      await store.enqueue(_attempt('c', failureCode: 'MAX_DRAIN_ATTEMPTS'));

      final n = await store.requeueAllFailed();

      expect(n, 2);
      expect(store.failedLength, 0);
      expect(store.queue().map((e) => e.localId).toList(), ['a', 'b', 'c']);
    });
  });
}
