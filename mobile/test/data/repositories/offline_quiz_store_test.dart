// Unit tests for OfflineQuizStore — Hive-backed FIFO submission queue.
// Uses a temp-dir Hive so the real box behavior (FIFO insertion order, delete)
// is exercised without a Flutter binding.

import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:hive_flutter/hive_flutter.dart';

import 'package:alfanumrik/data/models/offline_quiz_models.dart';
import 'package:alfanumrik/data/repositories/offline_quiz_store.dart';

QueuedQuizAttempt _attempt(String localId, {String key = 'k', int drain = 0}) =>
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
}
