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
    });
  });
}
