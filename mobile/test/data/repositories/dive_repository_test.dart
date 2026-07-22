// Tests for DiveRepository's pure response classifier.
//
// `classifyArtifactResponse` is the whole reason /api/dive/artifact bypasses
// ApiClient.post: the route's non-2xx branches are NOT interchangeable, and
// ApiClient's `_mapStatusCode` would flatten each into one opaque exception
// with no body. Same testing shape as
// AssignmentsRepository.classifyCompletionResponse.
library;

import 'package:flutter_test/flutter_test.dart';

import 'package:alfanumrik/data/models/dive_models.dart';
import 'package:alfanumrik/data/repositories/dive_repository.dart';

void main() {
  group('DiveRepository.classifyArtifactResponse', () {
    test('200 with an artifactId → saved, carrying the server streak', () {
      final outcome = DiveRepository.classifyArtifactResponse(200, {
        'artifactId': 'a-1',
        'weeklyStreakCount': 6,
        'isoWeek': '2026-W30',
      });
      expect(outcome, isA<DiveArtifactSaved>());
      final saved = outcome as DiveArtifactSaved;
      expect(saved.result.artifactId, 'a-1');
      // The streak is the SERVER's recomputed value — never derived locally.
      expect(saved.result.weeklyStreakCount, 6);
      expect(saved.result.isoWeek, '2026-W30');
    });

    test('200 without an artifactId is a retriable failure, not a fake save',
        () {
      final outcome = DiveRepository.classifyArtifactResponse(200, {});
      expect(outcome, isA<DiveArtifactFailure>());
    });

    test('409 already_saved_this_week → AlreadySaved (a success for the student)',
        () {
      final outcome = DiveRepository.classifyArtifactResponse(
        409,
        {'error': 'already_saved_this_week'},
      );
      expect(outcome, isA<DiveArtifactAlreadySaved>());
    });

    test('404 (flag off OR missing student profile) → Unavailable', () {
      expect(
        DiveRepository.classifyArtifactResponse(404, {'error': 'not_found'}),
        isA<DiveArtifactUnavailable>(),
      );
      expect(
        DiveRepository.classifyArtifactResponse(
            404, {'error': 'student_profile_not_found'}),
        isA<DiveArtifactUnavailable>(),
      );
    });

    test('400 surfaces the machine-readable validation code verbatim', () {
      final missingTitle =
          DiveRepository.classifyArtifactResponse(400, {'error': 'missing_title'});
      expect(missingTitle, isA<DiveArtifactInvalid>());
      expect((missingTitle as DiveArtifactInvalid).errorCode, 'missing_title');

      final missingVoice = DiveRepository.classifyArtifactResponse(
          400, {'error': 'missing_student_voice'});
      expect((missingVoice as DiveArtifactInvalid).errorCode,
          'missing_student_voice');
    });

    test('400 with no error code falls back to invalid_body', () {
      final outcome = DiveRepository.classifyArtifactResponse(400, {});
      expect((outcome as DiveArtifactInvalid).errorCode, 'invalid_body');
    });

    test('500 and a null status (transport failure) are both retriable failures',
        () {
      expect(
        DiveRepository.classifyArtifactResponse(
            500, {'error': 'artifact_save_failed'}),
        isA<DiveArtifactFailure>(),
      );
      expect(
        DiveRepository.classifyArtifactResponse(null, null),
        isA<DiveArtifactFailure>(),
      );
    });

    test('a non-Map body never throws', () {
      expect(
        DiveRepository.classifyArtifactResponse(200, 'not json'),
        isA<DiveArtifactFailure>(),
      );
      expect(
        DiveRepository.classifyArtifactResponse(409, '<html>'),
        isA<DiveArtifactAlreadySaved>(),
      );
    });
  });
}
