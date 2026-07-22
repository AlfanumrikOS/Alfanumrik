import 'package:dio/dio.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import '../../core/network/api_client.dart';
import '../../core/network/api_result.dart';
import '../models/assignment_models.dart';

/// Assignments repository — mobile parity for
/// `apps/host/src/app/(student)/assignments/page.tsx`.
///
/// READ surfaces (list + detail) use direct RLS-scoped Supabase table reads,
/// matching the web page EXACTLY — there is no `GET /api/student/assignments`
/// REST route on disk (confirmed 2026-07-21: only the completion route
/// exists). `assignments` is scoped by the "Students can view class
/// assignments" RLS policy; `assignment_submissions` by "Students can manage
/// own submissions" — a plain `select()` already returns only this student's
/// rows, no manual student_id filter required (mirrors the web).
///
/// WRITE surface (completion) goes through
/// `POST /api/student/assignments/[id]/complete` via [ApiClient] — same
/// REST-via-ApiClient transport pattern as [DiagnosticRepository].
class AssignmentsRepository {
  final SupabaseClient _client;
  final ApiClient _api;

  AssignmentsRepository({SupabaseClient? client, ApiClient? api})
      : _client = client ?? Supabase.instance.client,
        _api = api ?? ApiClient();

  /// Fetch every assignment issued to this student's class(es), each joined
  /// with its FULL attempt history (not just the latest row — the detail
  /// screen needs every attempt) and resolved topic label.
  Future<ApiResult<List<AssignmentListItem>>> getAssignments() async {
    try {
      final asgnRows = await _client
          .from('assignments')
          .select('*')
          .order('due_date', ascending: true, nullsFirst: false)
          .order('created_at', ascending: false);

      final assignments = (asgnRows as List)
          .map((r) => Assignment.fromJson(Map<String, dynamic>.from(r as Map)))
          .toList(growable: false);

      if (assignments.isEmpty) return const ApiSuccess(<AssignmentListItem>[]);

      final ids = assignments.map((a) => a.id).toList(growable: false);
      final submissionsByAssignment = await _fetchSubmissionsByAssignment(ids);
      final topicsById = await _fetchTopics(
        assignments.map((a) => a.topicId).whereType<String>().toSet().toList(growable: false),
      );

      final items = assignments
          .map(
            (a) => AssignmentListItem(
              assignment: a,
              attempts: submissionsByAssignment[a.id] ?? const <AssignmentSubmission>[],
              topic: a.topicId != null ? topicsById[a.topicId] : null,
            ),
          )
          .toList(growable: false);

      return ApiSuccess(items);
    } catch (e) {
      return ApiFailure('Failed to load assignments: ${e.toString()}');
    }
  }

  /// Fetch a single assignment with its full attempt history + topic label.
  /// Used by the detail screen (which the list screen may not have fully
  /// hydrated, e.g. after a deep link straight to `/assignments/:id`).
  Future<ApiResult<AssignmentListItem>> getAssignmentDetail(String assignmentId) async {
    try {
      final row = await _client
          .from('assignments')
          .select('*')
          .eq('id', assignmentId)
          .maybeSingle();
      if (row == null) {
        return const ApiFailure('Assignment not found.');
      }
      final assignment = Assignment.fromJson(Map<String, dynamic>.from(row));

      final submissionsByAssignment = await _fetchSubmissionsByAssignment([assignmentId]);
      AssignmentTopic? topic;
      if (assignment.topicId != null) {
        final topicsById = await _fetchTopics([assignment.topicId!]);
        topic = topicsById[assignment.topicId];
      }

      return ApiSuccess(
        AssignmentListItem(
          assignment: assignment,
          attempts: submissionsByAssignment[assignmentId] ?? const <AssignmentSubmission>[],
          topic: topic,
        ),
      );
    } catch (e) {
      return ApiFailure('Failed to load assignment: ${e.toString()}');
    }
  }

  Future<Map<String, List<AssignmentSubmission>>> _fetchSubmissionsByAssignment(
    List<String> assignmentIds,
  ) async {
    if (assignmentIds.isEmpty) return const {};
    final subRows = await _client
        .from('assignment_submissions')
        .select(
          'id, assignment_id, attempt_number, status, score, questions_total, '
          'questions_correct, submitted_at, graded_at, teacher_feedback, '
          'teacher_feedback_hi',
        )
        .inFilter('assignment_id', assignmentIds)
        .order('attempt_number', ascending: true);

    final map = <String, List<AssignmentSubmission>>{};
    for (final row in (subRows as List)) {
      final sub = AssignmentSubmission.fromJson(Map<String, dynamic>.from(row as Map));
      map.putIfAbsent(sub.assignmentId, () => <AssignmentSubmission>[]).add(sub);
    }
    return map;
  }

  Future<Map<String, AssignmentTopic>> _fetchTopics(List<String> topicIds) async {
    if (topicIds.isEmpty) return const {};
    final topicRows = await _client
        .from('curriculum_topics')
        .select('id, chapter_number, title, title_hi')
        .inFilter('id', topicIds);

    final map = <String, AssignmentTopic>{};
    for (final row in (topicRows as List)) {
      final topic = AssignmentTopic.fromJson(Map<String, dynamic>.from(row as Map));
      map[topic.id] = topic;
    }
    return map;
  }

  /// Record an already-graded quiz session against [assignmentId]. This
  /// mirrors the web's fire-and-forget call in `(student)/quiz/page.tsx`
  /// EXCEPT mobile surfaces the outcome distinctly to the student instead of
  /// swallowing it — see [classifyCompletionResponse] for why.
  ///
  /// Deliberately bypasses [ApiClient.post]'s generic error mapping (which
  /// collapses every non-2xx response into one fixed message PER status
  /// code) by calling [ApiClient.dio] directly — this is the only way to
  /// read the server's `error` string, which is the ONLY signal available to
  /// tell `max_attempts_reached` apart from `submission_closed` (both 409;
  /// see [classifyCompletionResponse]'s fragility note).
  Future<AssignmentCompletionOutcome> completeAssignment({
    required String assignmentId,
    required String sessionId,
  }) async {
    try {
      final response = await _api.dio.post(
        '/student/assignments/$assignmentId/complete',
        data: {'session_id': sessionId},
      );
      return classifyCompletionResponse(response.statusCode, response.data);
    } on DioException catch (e) {
      return classifyCompletionResponse(e.response?.statusCode, e.response?.data);
    } catch (e) {
      return const AssignmentCompletionFailure('Connection error. Please try again.');
    }
  }

  // ── Pure helper (testable without network) ──────────────────────────────

  /// Maps a completion HTTP response — either a 2xx success or a
  /// DioException's `(statusCode, body)` — to a distinct
  /// [AssignmentCompletionOutcome].
  ///
  /// FRAGILITY NOTE (flagged for backend/assessment follow-up): the route
  /// (`apps/host/src/app/api/student/assignments/[id]/complete/route.ts`)
  /// does NOT return a machine-readable `code`/`reason` field for its two
  /// 409 branches — only a human-readable `error` string. This function
  /// disambiguates `max_attempts_reached` vs `submission_closed` by matching
  /// substrings of that EXACT copy (as of 2026-07-21):
  ///   - "...used all allowed attempts..."      -> max_attempts_reached
  ///   - "...no longer accepts submissions..."   -> submission_closed
  /// If that copy changes without a matching update here, the fallback
  /// still returns a distinct, non-retriable [AssignmentCompletionClosed]
  /// (never silently misroutes to a generic/retriable failure) — see the
  /// `default` 409 branch below. Recommend the route add a structured
  /// `reason` field (the underlying `completeAssignmentFromSession()` helper
  /// ALREADY returns one internally — it's just not threaded into the HTTP
  /// response) to remove this string-matching fragility entirely.
  static AssignmentCompletionOutcome classifyCompletionResponse(
    int? statusCode,
    dynamic data,
  ) {
    final map = data is Map ? Map<String, dynamic>.from(data) : const <String, dynamic>{};
    final success = map['success'] == true;
    final errorMsg = map['error'] as String?;

    if (success) {
      return AssignmentCompletionSuccess.fromJson(map);
    }

    if (statusCode == 409) {
      if (errorMsg != null && errorMsg.contains('allowed attempts')) {
        return AssignmentCompletionMaxAttemptsReached(errorMsg);
      }
      if (errorMsg != null &&
          (errorMsg.contains('no longer accepts submissions') || errorMsg.contains('past due'))) {
        return AssignmentCompletionClosed(errorMsg);
      }
      // Unknown 409 shape from this route — every 409 it emits is a "no
      // further action here" outcome, never a retry-able network blip, so
      // default to the closed/locked framing rather than a generic failure.
      return AssignmentCompletionClosed(
        errorMsg ?? 'This assignment can no longer be submitted.',
      );
    }

    if (errorMsg != null) {
      return AssignmentCompletionFailure(errorMsg, statusCode);
    }
    return AssignmentCompletionFailure(
      'Could not record assignment completion. Please try again.',
      statusCode,
    );
  }
}
