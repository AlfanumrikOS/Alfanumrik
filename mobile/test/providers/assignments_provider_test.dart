// Tests for assignments_provider.dart's AssignmentCompletionNotifier state
// machine — in particular that the two 409 branches (max_attempts_reached,
// submission_closed) produce DISTINCT AssignmentCompletionStatus values
// rather than collapsing into one generic "error" state, following the same
// fake-repository + ProviderContainer pattern as
// test/providers/diagnostic_provider_test.dart / pyq_provider_test.dart.
library;

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:alfanumrik/core/network/api_result.dart';
import 'package:alfanumrik/data/models/assignment_models.dart';
import 'package:alfanumrik/data/repositories/assignments_repository.dart';
import 'package:alfanumrik/providers/assignments_provider.dart';

class _FakeAssignmentsRepository implements AssignmentsRepository {
  AssignmentCompletionOutcome completionOutcome;
  int completeCalls = 0;
  String? lastAssignmentId;
  String? lastSessionId;

  _FakeAssignmentsRepository(this.completionOutcome);

  @override
  Future<AssignmentCompletionOutcome> completeAssignment({
    required String assignmentId,
    required String sessionId,
  }) async {
    completeCalls++;
    lastAssignmentId = assignmentId;
    lastSessionId = sessionId;
    return completionOutcome;
  }

  @override
  Future<ApiResult<List<AssignmentListItem>>> getAssignments() async {
    return const ApiSuccess(<AssignmentListItem>[]);
  }

  @override
  Future<ApiResult<AssignmentListItem>> getAssignmentDetail(String assignmentId) async {
    return const ApiFailure('not used in this test');
  }
}

void main() {
  ProviderContainer buildContainer(_FakeAssignmentsRepository fake) {
    return ProviderContainer(overrides: [
      assignmentsRepositoryProvider.overrideWithValue(fake),
    ]);
  }

  group('AssignmentCompletionNotifier.completeFromQuiz', () {
    test('starts idle', () {
      final fake = _FakeAssignmentsRepository(
        const AssignmentCompletionSuccess(status: 'submitted'),
      );
      final container = buildContainer(fake);
      addTearDown(container.dispose);

      expect(container.read(assignmentCompletionProvider).status, AssignmentCompletionStatus.idle);
      expect(fake.completeCalls, 0);
    });

    test('transitions to success and threads attemptNumber/bestScorePercent through', () async {
      final fake = _FakeAssignmentsRepository(
        const AssignmentCompletionSuccess(
          status: 'submitted',
          attemptNumber: 2,
          bestScorePercent: 90,
          isLateSubmission: false,
        ),
      );
      final container = buildContainer(fake);
      addTearDown(container.dispose);

      await container.read(assignmentCompletionProvider.notifier).completeFromQuiz(
            assignmentId: 'a-1',
            sessionId: 'sess-1',
          );

      final state = container.read(assignmentCompletionProvider);
      expect(state.status, AssignmentCompletionStatus.success);
      expect(state.success?.attemptNumber, 2);
      expect(state.success?.bestScorePercent, 90);
      expect(fake.completeCalls, 1);
      expect(fake.lastAssignmentId, 'a-1');
      expect(fake.lastSessionId, 'sess-1');
    });

    test('transitions to maxAttemptsReached — DISTINCT from submissionClosed', () async {
      final fake = _FakeAssignmentsRepository(
        const AssignmentCompletionMaxAttemptsReached(
          'You have used all allowed attempts for this assignment',
        ),
      );
      final container = buildContainer(fake);
      addTearDown(container.dispose);

      await container.read(assignmentCompletionProvider.notifier).completeFromQuiz(
            assignmentId: 'a-1',
            sessionId: 'sess-1',
          );

      final state = container.read(assignmentCompletionProvider);
      expect(state.status, AssignmentCompletionStatus.maxAttemptsReached);
      expect(state.message, contains('allowed attempts'));
    });

    test('transitions to submissionClosed — DISTINCT from maxAttemptsReached', () async {
      final fake = _FakeAssignmentsRepository(
        const AssignmentCompletionClosed(
          'This assignment no longer accepts submissions (past due)',
        ),
      );
      final container = buildContainer(fake);
      addTearDown(container.dispose);

      await container.read(assignmentCompletionProvider.notifier).completeFromQuiz(
            assignmentId: 'a-1',
            sessionId: 'sess-1',
          );

      final state = container.read(assignmentCompletionProvider);
      expect(state.status, AssignmentCompletionStatus.submissionClosed);
      expect(state.message, contains('no longer accepts submissions'));
    });

    test('maxAttemptsReached and submissionClosed never produce the same status', () async {
      final maxFake = _FakeAssignmentsRepository(
        const AssignmentCompletionMaxAttemptsReached('used all attempts'),
      );
      final maxContainer = buildContainer(maxFake);
      addTearDown(maxContainer.dispose);
      await maxContainer.read(assignmentCompletionProvider.notifier).completeFromQuiz(
            assignmentId: 'a-1',
            sessionId: 'sess-1',
          );

      final closedFake = _FakeAssignmentsRepository(
        const AssignmentCompletionClosed('past due'),
      );
      final closedContainer = buildContainer(closedFake);
      addTearDown(closedContainer.dispose);
      await closedContainer.read(assignmentCompletionProvider.notifier).completeFromQuiz(
            assignmentId: 'a-1',
            sessionId: 'sess-1',
          );

      expect(
        maxContainer.read(assignmentCompletionProvider).status,
        isNot(closedContainer.read(assignmentCompletionProvider).status),
      );
    });

    test('transitions to error on a generic failure', () async {
      final fake = _FakeAssignmentsRepository(
        const AssignmentCompletionFailure('Connection error. Please try again.'),
      );
      final container = buildContainer(fake);
      addTearDown(container.dispose);

      await container.read(assignmentCompletionProvider.notifier).completeFromQuiz(
            assignmentId: 'a-1',
            sessionId: 'sess-1',
          );

      expect(container.read(assignmentCompletionProvider).status, AssignmentCompletionStatus.error);
    });

    test('reset() returns to idle with no message', () async {
      final fake = _FakeAssignmentsRepository(
        const AssignmentCompletionMaxAttemptsReached('used all attempts'),
      );
      final container = buildContainer(fake);
      addTearDown(container.dispose);

      await container.read(assignmentCompletionProvider.notifier).completeFromQuiz(
            assignmentId: 'a-1',
            sessionId: 'sess-1',
          );
      expect(container.read(assignmentCompletionProvider).status, AssignmentCompletionStatus.maxAttemptsReached);

      container.read(assignmentCompletionProvider.notifier).reset();
      final state = container.read(assignmentCompletionProvider);
      expect(state.status, AssignmentCompletionStatus.idle);
      expect(state.message, isNull);
    });
  });
}
