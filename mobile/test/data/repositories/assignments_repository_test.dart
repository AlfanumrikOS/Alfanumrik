// Tests for AssignmentsRepository.classifyCompletionResponse — the pure
// (no Dio/network needed) function that maps a completion HTTP response to
// a distinct AssignmentCompletionOutcome. This is the critical piece for the
// product requirement that `max_attempts_reached` and `submission_closed`
// (both HTTP 409) surface with DIFFERENT, non-generic messaging.
library;

import 'package:flutter_test/flutter_test.dart';

import 'package:alfanumrik/data/models/assignment_models.dart';
import 'package:alfanumrik/data/repositories/assignments_repository.dart';

void main() {
  group('classifyCompletionResponse — success', () {
    test('maps a 2xx { success: true, status: submitted, ... } body to AssignmentCompletionSuccess', () {
      final outcome = AssignmentsRepository.classifyCompletionResponse(200, {
        'success': true,
        'status': 'submitted',
        'submissionId': 'sub-1',
        'scorePercent': 80,
        'attemptNumber': 1,
        'bestScorePercent': 80,
        'isLateSubmission': false,
      });

      expect(outcome, isA<AssignmentCompletionSuccess>());
      final success = outcome as AssignmentCompletionSuccess;
      expect(success.attemptNumber, 1);
      expect(success.bestScorePercent, 80);
      expect(success.isLateSubmission, isFalse);
    });

    test('maps the soft 200 { success: true, status: already_graded } replay response', () {
      final outcome = AssignmentsRepository.classifyCompletionResponse(200, {
        'success': true,
        'status': 'already_graded',
      });

      expect(outcome, isA<AssignmentCompletionSuccess>());
      expect((outcome as AssignmentCompletionSuccess).isAlreadyGraded, isTrue);
    });
  });

  group('classifyCompletionResponse — 409 branches (must stay DISTINCT)', () {
    test('max_attempts_reached 409 -> AssignmentCompletionMaxAttemptsReached', () {
      final outcome = AssignmentsRepository.classifyCompletionResponse(409, {
        'success': false,
        'error': 'You have used all allowed attempts for this assignment',
      });

      expect(outcome, isA<AssignmentCompletionMaxAttemptsReached>());
      expect(
        (outcome as AssignmentCompletionMaxAttemptsReached).message,
        contains('allowed attempts'),
      );
    });

    test('submission_closed 409 -> AssignmentCompletionClosed', () {
      final outcome = AssignmentsRepository.classifyCompletionResponse(409, {
        'success': false,
        'error': 'This assignment no longer accepts submissions (past due)',
      });

      expect(outcome, isA<AssignmentCompletionClosed>());
      expect(
        (outcome as AssignmentCompletionClosed).message,
        contains('no longer accepts submissions'),
      );
    });

    test('the two 409 outcomes are never the same runtime type', () {
      final maxAttempts = AssignmentsRepository.classifyCompletionResponse(409, {
        'success': false,
        'error': 'You have used all allowed attempts for this assignment',
      });
      final closed = AssignmentsRepository.classifyCompletionResponse(409, {
        'success': false,
        'error': 'This assignment no longer accepts submissions (past due)',
      });

      expect(maxAttempts.runtimeType, isNot(closed.runtimeType));
    });

    test('an unrecognised 409 body still returns a non-retriable Closed outcome, never a generic Failure', () {
      final outcome = AssignmentsRepository.classifyCompletionResponse(409, {
        'success': false,
        'error': 'some future copy the client does not yet recognise',
      });

      expect(outcome, isA<AssignmentCompletionClosed>());
    });

    test('a 409 with no body at all still returns Closed with a safe fallback message', () {
      final outcome = AssignmentsRepository.classifyCompletionResponse(409, null);
      expect(outcome, isA<AssignmentCompletionClosed>());
      expect((outcome as AssignmentCompletionClosed).message, isNotEmpty);
    });
  });

  group('classifyCompletionResponse — other failures', () {
    test('403 not_enrolled -> generic AssignmentCompletionFailure carrying the server message', () {
      final outcome = AssignmentsRepository.classifyCompletionResponse(403, {
        'success': false,
        'error': 'This assignment is not assigned to you',
      });

      expect(outcome, isA<AssignmentCompletionFailure>());
      final failure = outcome as AssignmentCompletionFailure;
      expect(failure.message, 'This assignment is not assigned to you');
      expect(failure.statusCode, 403);
    });

    test('404 assignment_not_found -> generic AssignmentCompletionFailure', () {
      final outcome = AssignmentsRepository.classifyCompletionResponse(404, {
        'success': false,
        'error': 'Assignment not found',
      });

      expect(outcome, isA<AssignmentCompletionFailure>());
      expect((outcome as AssignmentCompletionFailure).statusCode, 404);
    });

    test('5xx with no parseable body -> generic AssignmentCompletionFailure with a safe fallback message', () {
      final outcome = AssignmentsRepository.classifyCompletionResponse(500, 'Internal Server Error');
      expect(outcome, isA<AssignmentCompletionFailure>());
      expect((outcome as AssignmentCompletionFailure).message, isNotEmpty);
      expect(outcome.statusCode, 500);
    });

    test('null status code (network failure) -> generic AssignmentCompletionFailure', () {
      final outcome = AssignmentsRepository.classifyCompletionResponse(null, null);
      expect(outcome, isA<AssignmentCompletionFailure>());
    });
  });
}
