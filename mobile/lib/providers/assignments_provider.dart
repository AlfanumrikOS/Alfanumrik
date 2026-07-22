import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../data/models/assignment_models.dart';
import '../data/repositories/assignments_repository.dart';
import 'auth_provider.dart';

final assignmentsRepositoryProvider = Provider<AssignmentsRepository>((ref) {
  return AssignmentsRepository();
});

/// Assignments list — mobile parity for the `assignments`/`assignment_submissions`
/// load in `apps/host/src/app/(student)/assignments/page.tsx`. Auto-fetches
/// once a student is resolved; `refresh()` powers pull-to-refresh + retry.
final assignmentsListProvider =
    AsyncNotifierProvider<AssignmentsListNotifier, List<AssignmentListItem>>(
  AssignmentsListNotifier.new,
);

class AssignmentsListNotifier extends AsyncNotifier<List<AssignmentListItem>> {
  @override
  Future<List<AssignmentListItem>> build() => _fetch();

  Future<void> refresh() async {
    state = const AsyncLoading();
    state = await AsyncValue.guard(_fetch);
  }

  Future<List<AssignmentListItem>> _fetch() async {
    final student = ref.watch(studentProvider).valueOrNull;
    if (student == null) return const <AssignmentListItem>[];

    final repo = ref.watch(assignmentsRepositoryProvider);
    final result = await repo.getAssignments();
    return result.when(
      success: (items) => items,
      // Thrown so `AsyncNotifier` surfaces a real AsyncError — the screen
      // shows a distinct "failed to load, retry" state rather than folding
      // a fetch failure into the (very different) "no assignments yet" empty
      // state.
      failure: (msg) => throw AssignmentsLoadException(msg),
    );
  }
}

class AssignmentsLoadException implements Exception {
  final String message;
  const AssignmentsLoadException(this.message);
  @override
  String toString() => message;
}

/// Single-assignment detail — used by the detail screen so it works from a
/// direct deep link (`/assignments/:id`) even before the list has loaded.
final assignmentDetailProvider =
    FutureProvider.family<AssignmentListItem?, String>((ref, assignmentId) async {
  final repo = ref.watch(assignmentsRepositoryProvider);
  final result = await repo.getAssignmentDetail(assignmentId);
  return result.dataOrNull;
});

/// States for the completion flow triggered after a quiz launched from an
/// assignment deep link finishes submitting. Each state maps to visibly
/// DIFFERENT copy on the result screen — `maxAttemptsReached` and
/// `submissionClosed` must never collapse into one generic "error" banner
/// (explicit product requirement — see `assignments_repository.dart`'s
/// `classifyCompletionResponse` doc comment for how the two are told apart).
enum AssignmentCompletionStatus {
  idle,
  submitting,
  success,
  maxAttemptsReached,
  submissionClosed,
  error,
}

class AssignmentCompletionState {
  final AssignmentCompletionStatus status;
  final AssignmentCompletionSuccess? success;
  final String? message;

  const AssignmentCompletionState({
    this.status = AssignmentCompletionStatus.idle,
    this.success,
    this.message,
  });

  @override
  String toString() => 'AssignmentCompletionState($status, message: $message)';
}

final assignmentCompletionProvider =
    NotifierProvider<AssignmentCompletionNotifier, AssignmentCompletionState>(
  AssignmentCompletionNotifier.new,
);

/// Drives the "record this quiz attempt against its assignment" side-effect.
/// Called by [QuizNotifier.submitQuiz] AFTER a normal (P1-P4 untouched) quiz
/// submission succeeds — this notifier NEVER computes score/XP itself, only
/// relays the already-graded session id to
/// `POST /api/student/assignments/[id]/complete` and surfaces the result.
class AssignmentCompletionNotifier extends Notifier<AssignmentCompletionState> {
  @override
  AssignmentCompletionState build() => const AssignmentCompletionState();

  Future<void> completeFromQuiz({
    required String assignmentId,
    required String sessionId,
  }) async {
    state = const AssignmentCompletionState(status: AssignmentCompletionStatus.submitting);

    final repo = ref.read(assignmentsRepositoryProvider);
    final outcome = await repo.completeAssignment(
      assignmentId: assignmentId,
      sessionId: sessionId,
    );

    state = switch (outcome) {
      final AssignmentCompletionSuccess s => AssignmentCompletionState(
          status: AssignmentCompletionStatus.success,
          success: s,
        ),
      final AssignmentCompletionMaxAttemptsReached m => AssignmentCompletionState(
          status: AssignmentCompletionStatus.maxAttemptsReached,
          message: m.message,
        ),
      final AssignmentCompletionClosed c => AssignmentCompletionState(
          status: AssignmentCompletionStatus.submissionClosed,
          message: c.message,
        ),
      final AssignmentCompletionFailure f => AssignmentCompletionState(
          status: AssignmentCompletionStatus.error,
          message: f.message,
        ),
    };

    // Best-effort: refresh the list so a student navigating back to
    // /assignments sees the new attempt/status immediately. A failure here
    // is silently ignored — the next manual pull-to-refresh will catch up.
    ref.invalidate(assignmentsListProvider);
  }

  /// Reset to idle — called when leaving the quiz result screen so a later,
  /// unrelated quiz attempt doesn't inherit a stale completion banner.
  void reset() => state = const AssignmentCompletionState();
}
