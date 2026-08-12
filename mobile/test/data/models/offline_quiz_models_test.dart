// Unit tests for the Wave 2.5.2 offline quiz value types — pure serialization
// + the immutable-key invariant on QueuedQuizAttempt. No Hive / network.

import 'package:flutter_test/flutter_test.dart';

import 'package:alfanumrik/data/models/offline_quiz_models.dart';

void main() {
  group('QueuedQuizAttempt', () {
    QueuedQuizAttempt sample({int drainAttempt = 0}) => QueuedQuizAttempt(
          localId: 'local-1',
          sessionId: 'sess-1',
          studentId: 'stu-1',
          subject: 'math',
          grade: '7',
          topic: 'fractions',
          chapter: 3,
          responses: const [
            OfflineResponse(
                questionId: 'q1', selectedDisplayedIndex: 2, timeSpent: 7),
            OfflineResponse(
                questionId: 'q2', selectedDisplayedIndex: -1, timeSpent: 4),
          ],
          totalTimeSeconds: 120,
          capturedAt: '2026-06-07T09:00:00.000Z',
          idempotencyKey: 'key-immutable-xyz',
          shuffleMaps: const {
            'q1': [2, 0, 3, 1],
          },
          drainAttempt: drainAttempt,
        );

    test('round-trips through JSON verbatim (incl. shuffleMaps + key)', () {
      final decoded = QueuedQuizAttempt.fromJson(sample().toJson());

      expect(decoded.localId, 'local-1');
      expect(decoded.sessionId, 'sess-1');
      expect(decoded.studentId, 'stu-1');
      expect(decoded.subject, 'math');
      expect(decoded.grade, '7');
      expect(decoded.topic, 'fractions');
      expect(decoded.chapter, 3);
      expect(decoded.responses, hasLength(2));
      expect(decoded.responses[0].questionId, 'q1');
      expect(decoded.responses[0].selectedDisplayedIndex, 2);
      expect(decoded.responses[0].timeSpent, 7);
      expect(decoded.responses[1].selectedDisplayedIndex, -1);
      expect(decoded.totalTimeSeconds, 120);
      expect(decoded.capturedAt, '2026-06-07T09:00:00.000Z');
      expect(decoded.idempotencyKey, 'key-immutable-xyz');
      // P-obligation 4: shuffleMaps populated and carried verbatim.
      expect(decoded.shuffleMaps['q1'], [2, 0, 3, 1]);
      expect(decoded.drainAttempt, 0);
    });

    test('withDrainAttempt bumps ONLY the counter — key + capturedAt + '
        'timings unchanged (P2 immutable idempotency key)', () {
      final original = sample(drainAttempt: 1);
      final bumped = original.withDrainAttempt(2);

      expect(bumped.drainAttempt, 2);
      // The single most important rule: the key is NEVER regenerated.
      expect(bumped.idempotencyKey, original.idempotencyKey);
      expect(bumped.capturedAt, original.capturedAt);
      expect(bumped.totalTimeSeconds, original.totalTimeSeconds);
      expect(bumped.responses, original.responses);
      expect(bumped.shuffleMaps, original.shuffleMaps);
      expect(bumped.localId, original.localId);
      // Backoff stamp is only touched when explicitly supplied.
      expect(bumped.lastAttemptAt, isNull);
      expect(bumped.isTerminal, isFalse);
    });

    test('withDrainAttempt stamps lastAttemptAt without touching the key', () {
      final bumped =
          sample().withDrainAttempt(1, lastAttemptAt: '2026-06-07T10:00:00.000Z');

      expect(bumped.drainAttempt, 1);
      expect(bumped.lastAttemptAt, '2026-06-07T10:00:00.000Z');
      expect(bumped.idempotencyKey, 'key-immutable-xyz');
      expect(bumped.capturedAt, '2026-06-07T09:00:00.000Z');
    });

    test('withFailure marks TERMINAL while carrying the key + answers through',
        () {
      final terminal = sample(drainAttempt: 4).withFailure('MAX_DRAIN_ATTEMPTS');

      expect(terminal.isTerminal, isTrue);
      expect(terminal.failureCode, 'MAX_DRAIN_ATTEMPTS');
      // The student's work and the grading token are preserved verbatim, so
      // quarantine is recoverable and can never double-score (P2).
      expect(terminal.idempotencyKey, 'key-immutable-xyz');
      expect(terminal.responses, sample().responses);
      expect(terminal.totalTimeSeconds, 120);
      expect(terminal.capturedAt, '2026-06-07T09:00:00.000Z');
      expect(terminal.drainAttempt, 4);
    });

    test('requeued() is the EXACT inverse of withFailure: budget counters reset, '
        'everything grading-relevant byte-identical (P2)', () {
      final original = sample(drainAttempt: 9);
      final terminal = original
          .withDrainAttempt(9, lastAttemptAt: '2026-06-07T11:00:00.000Z')
          .withFailure('MAX_DRAIN_ATTEMPTS');

      final back = terminal.requeued();

      // Drainable again.
      expect(back.isTerminal, isFalse);
      expect(back.failureCode, isNull);
      // Budget genuinely reset — otherwise the very next drain would re-fire
      // the MAX_DRAIN_ATTEMPTS gate and requeue would be theatre.
      expect(back.drainAttempt, 0);
      expect(back.lastAttemptAt, isNull);

      // DOUBLE-SCORE SAFETY: the grading token is reused VERBATIM, so a
      // re-send after a server-side commit is short-circuited by the server's
      // (student_id, idempotency_key) match into an idempotent replay.
      expect(back.idempotencyKey, 'key-immutable-xyz');
      expect(back.idempotencyKey, original.idempotencyKey);
      // capturedAt is NOT refreshed — refreshing it would let a client dodge
      // the server's 168h staleness gate.
      expect(back.capturedAt, '2026-06-07T09:00:00.000Z');
      // The student's actual work is untouched.
      expect(back.responses, original.responses);
      expect(back.totalTimeSeconds, 120);
      expect(back.shuffleMaps, original.shuffleMaps);
      expect(back.localId, 'local-1');
      expect(back.sessionId, 'sess-1');
      expect(back.subject, 'math');
      expect(back.grade, '7');
      expect(back.topic, 'fractions');
      expect(back.chapter, 3);
    });

    test('requeued() on an already-pending attempt only clears the budget', () {
      final back = sample(drainAttempt: 3).requeued();
      expect(back.drainAttempt, 0);
      expect(back.failureCode, isNull);
      expect(back.idempotencyKey, 'key-immutable-xyz');
    });

    test('requeue survives a JSON round-trip (persisted, not just in-memory)',
        () {
      final terminal = sample(drainAttempt: 5).withFailure('RPC_FAILED');
      final revived =
          QueuedQuizAttempt.fromJson(terminal.requeued().toJson());

      expect(revived.isTerminal, isFalse);
      expect(revived.drainAttempt, 0);
      expect(revived.lastAttemptAt, isNull);
      expect(revived.idempotencyKey, 'key-immutable-xyz');
      expect(revived.capturedAt, '2026-06-07T09:00:00.000Z');
      expect(revived.responses, hasLength(2));
    });

    test('lastAttemptAt + failureCode round-trip; legacy JSON decodes as '
        'pending (additive upgrade)', () {
      final terminal = sample(drainAttempt: 2)
          .withDrainAttempt(2, lastAttemptAt: '2026-06-07T11:00:00.000Z')
          .withFailure('RPC_FAILED');
      final decoded = QueuedQuizAttempt.fromJson(terminal.toJson());

      expect(decoded.lastAttemptAt, '2026-06-07T11:00:00.000Z');
      expect(decoded.failureCode, 'RPC_FAILED');
      expect(decoded.isTerminal, isTrue);

      // A record written by an OLDER build carries neither field.
      final legacy = sample().toJson()
        ..remove('last_attempt_at')
        ..remove('failure_code');
      final decodedLegacy = QueuedQuizAttempt.fromJson(legacy);
      expect(decodedLegacy.lastAttemptAt, isNull);
      expect(decodedLegacy.isTerminal, isFalse,
          reason: 'an already-queued attempt keeps draining after an upgrade');
      expect(decodedLegacy.idempotencyKey, 'key-immutable-xyz');
    });
  });
}
