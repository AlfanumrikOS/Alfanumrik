// Unit tests for QuizRepository.buildOfflineSubmitRequest — the offline-replay
// wire shape sent to POST /v2/quiz/submit. Asserts the Wave 2.5.2 obligations
// are encoded correctly. Pure (no Dio / network).

import 'package:alfanumrik_api_v2/alfanumrik_api_v2.dart' as v2;
import 'package:flutter_test/flutter_test.dart';

import 'package:alfanumrik/data/models/offline_quiz_models.dart';
import 'package:alfanumrik/data/repositories/quiz_repository.dart';

QueuedQuizAttempt _attempt({
  Map<String, List<int>> shuffleMaps = const {},
  int drainAttempt = 0,
}) =>
    QueuedQuizAttempt(
      localId: 'local-1',
      sessionId: '550e8400-e29b-41d4-a716-446655440000',
      studentId: 'stu-uuid',
      subject: 'math',
      grade: '7',
      topic: 'fractions',
      chapter: 3,
      responses: const [
        OfflineResponse(questionId: 'q1', selectedDisplayedIndex: 2, timeSpent: 7),
        OfflineResponse(questionId: 'q2', selectedDisplayedIndex: -1, timeSpent: 4),
      ],
      totalTimeSeconds: 120,
      capturedAt: '2026-06-07T09:00:00.000Z',
      idempotencyKey: 'immutable-key',
      shuffleMaps: shuffleMaps,
      drainAttempt: drainAttempt,
    );

void main() {
  group('QuizRepository.buildOfflineSubmitRequest', () {
    test('sets attemptMode=offline_replay and the offline fields', () {
      final req = QuizRepository.buildOfflineSubmitRequest(
        _attempt(drainAttempt: 2),
      );

      expect(req.attemptMode, v2.QuizSubmitRequestAttemptModeEnum.offlineReplay);
      expect(req.sessionId, '550e8400-e29b-41d4-a716-446655440000');
      expect(req.studentId, 'stu-uuid');
      expect(req.subject, 'math');
      expect(req.grade, '7');
      expect(req.topic, 'fractions');
      expect(req.chapter, 3);
      expect(req.drainAttempt, 2);
    });

    test('capturedAt is parsed from the stored ISO-8601 (captured once)', () {
      final req = QuizRepository.buildOfflineSubmitRequest(_attempt());
      expect(req.capturedAt, isNotNull);
      expect(req.capturedAt!.toUtc().toIso8601String(),
          '2026-06-07T09:00:00.000Z');
    });

    test('clientCapturedTotalSeconds EQUALS totalTimeSeconds (P3 cross-check)',
        () {
      final req = QuizRepository.buildOfflineSubmitRequest(_attempt());
      expect(req.totalTimeSeconds, 120);
      expect(req.clientCapturedTotalSeconds, 120,
          reason: 'server returns 400 OFFLINE_TIME_INCONSISTENT if they differ');
    });

    test('forwards per-question times verbatim (P3 — no recompute at drain)',
        () {
      final req = QuizRepository.buildOfflineSubmitRequest(_attempt());
      expect(req.responses, hasLength(2));
      expect(req.responses[0].questionId, 'q1');
      expect(req.responses[0].selectedOption, 2);
      expect(req.responses[0].timeTakenSeconds, 7);
      // Skipped question → -1 sentinel, time preserved.
      expect(req.responses[1].selectedOption, -1);
      expect(req.responses[1].timeTakenSeconds, 4);
    });

    test('OMITS shuffleMapsClientGradedAgainst when the bundle had none '
        '(P6 — server verifies via its own snapshot)', () {
      final req = QuizRepository.buildOfflineSubmitRequest(_attempt());
      expect(req.shuffleMapsClientGradedAgainst, isNull,
          reason: 'no fabricated map → no false SHUFFLE_MAP_MISMATCH');
    });

    test('POPULATES shuffleMapsClientGradedAgainst when the bundle carried it',
        () {
      final req = QuizRepository.buildOfflineSubmitRequest(_attempt(
        shuffleMaps: const {
          'q1': [2, 0, 3, 1],
          'q2': [0, 1, 2, 3],
        },
      ));
      final maps = req.shuffleMapsClientGradedAgainst;
      expect(maps, isNotNull);
      expect(maps!['q1']!.toList(), [2, 0, 3, 1]);
      expect(maps['q2']!.toList(), [0, 1, 2, 3]);
    });
  });
}
