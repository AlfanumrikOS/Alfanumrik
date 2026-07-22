// Data models for teacher-created Assignments — mobile parity for
// `apps/host/src/app/(student)/assignments/page.tsx`.
//
// Read surfaces (list + detail) mirror the web page EXACTLY: direct
// RLS-scoped Supabase table reads (`assignments`, `assignment_submissions`,
// `curriculum_topics`) — there is NO `GET /api/student/assignments` REST
// route on disk (verified 2026-07-21; only the completion route exists at
// `apps/host/src/app/api/student/assignments/[id]/complete/route.ts`). See
// [AssignmentsRepository] for the read implementation.
//
// The WRITE surface (completion) goes through the hardened
// `POST /api/student/assignments/[id]/complete` route, whose response shape
// (as of the Phase 3 multi-attempt + due-date-lockout hardening —
// `packages/lib/src/learn/assignment-submission.ts`) is modelled in full
// below: `attemptNumber`, `bestScorePercent`, `isLateSubmission` on success,
// and distinct 409 branches (`max_attempts_reached`, `submission_closed`)
// on failure.
library;

import 'package:equatable/equatable.dart';

/// `assignments` table row (teacher-created). Read-only on mobile — every
/// write goes through [AssignmentsRepository.completeAssignment].
class Assignment extends Equatable {
  final String id;
  final String? classId;
  final String title;
  final String? description;
  final String? assignmentType;
  final String? subject;
  final String? grade;
  final String? topicId;
  final String? bloomLevel;
  final int? questionCount;

  /// ISO-8601 due date, or null if the assignment has no deadline.
  final String? dueDate;

  /// `assignments.max_attempts` — DB column default is 3 (matches
  /// `DEFAULT_MAX_ATTEMPTS` in `packages/lib/src/learn/assignment-submission.ts`);
  /// defensively defaulted here too in case a row predates the column.
  final int maxAttempts;

  /// `assignments.allow_late_submission` — DB column default is `true`.
  final bool allowLateSubmission;

  final String? status;
  final String? createdAt;

  const Assignment({
    required this.id,
    this.classId,
    required this.title,
    this.description,
    this.assignmentType,
    this.subject,
    this.grade,
    this.topicId,
    this.bloomLevel,
    this.questionCount,
    this.dueDate,
    this.maxAttempts = 3,
    this.allowLateSubmission = true,
    this.status,
    this.createdAt,
  });

  factory Assignment.fromJson(Map<String, dynamic> json) {
    return Assignment(
      id: json['id'] as String? ?? '',
      classId: json['class_id'] as String?,
      title: json['title'] as String? ?? '',
      description: json['description'] as String?,
      assignmentType: json['assignment_type'] as String?,
      subject: json['subject'] as String?,
      grade: json['grade'] as String?,
      topicId: json['topic_id'] as String?,
      bloomLevel: json['bloom_level'] as String?,
      questionCount: (json['question_count'] as num?)?.toInt(),
      dueDate: json['due_date'] as String?,
      maxAttempts: (json['max_attempts'] as num?)?.toInt() ?? 3,
      allowLateSubmission: json['allow_late_submission'] as bool? ?? true,
      status: json['status'] as String?,
      createdAt: json['created_at'] as String?,
    );
  }

  DateTime? get dueDateTime => dueDate == null ? null : DateTime.tryParse(dueDate!);

  @override
  List<Object?> get props => [
        id,
        classId,
        title,
        description,
        assignmentType,
        subject,
        grade,
        topicId,
        bloomLevel,
        questionCount,
        dueDate,
        maxAttempts,
        allowLateSubmission,
        status,
        createdAt,
      ];
}

/// One row of `assignment_submissions` — a single attempt. Uniquely keyed
/// server-side on (assignment_id, student_id, attempt_number); mobile reads
/// the FULL attempt history (not just the latest row) so the detail screen
/// can show attempt-by-attempt history once `attemptNumber > 1` exists.
class AssignmentSubmission extends Equatable {
  final String id;
  final String assignmentId;
  final int attemptNumber;
  final String? status;
  final int? score;
  final int? questionsTotal;
  final int? questionsCorrect;
  final String? submittedAt;
  final String? gradedAt;
  final String? teacherFeedback;
  final String? teacherFeedbackHi;

  const AssignmentSubmission({
    required this.id,
    required this.assignmentId,
    this.attemptNumber = 1,
    this.status,
    this.score,
    this.questionsTotal,
    this.questionsCorrect,
    this.submittedAt,
    this.gradedAt,
    this.teacherFeedback,
    this.teacherFeedbackHi,
  });

  factory AssignmentSubmission.fromJson(Map<String, dynamic> json) {
    return AssignmentSubmission(
      id: json['id'] as String? ?? '',
      assignmentId: json['assignment_id'] as String? ?? '',
      attemptNumber: (json['attempt_number'] as num?)?.toInt() ?? 1,
      status: json['status'] as String?,
      score: (json['score'] as num?)?.toInt(),
      questionsTotal: (json['questions_total'] as num?)?.toInt(),
      questionsCorrect: (json['questions_correct'] as num?)?.toInt(),
      submittedAt: json['submitted_at'] as String?,
      gradedAt: json['graded_at'] as String?,
      teacherFeedback: json['teacher_feedback'] as String?,
      teacherFeedbackHi: json['teacher_feedback_hi'] as String?,
    );
  }

  /// P7 language-aware teacher-feedback pick (mirrors the web
  /// `pickTeacherFeedback` in apps/host/src/app/(student)/assignments/page.tsx):
  ///  - Hindi-preferring student WITH a Hindi variant  → Hindi.
  ///  - Hindi-preferring student WITHOUT a Hindi variant → English fallback.
  ///  - English-preferring student → always English.
  /// Returns null only when there is genuinely no feedback in either language.
  String? feedbackFor(bool isHi) {
    final en = teacherFeedback?.trim();
    final hi = teacherFeedbackHi?.trim();
    if (isHi && hi != null && hi.isNotEmpty) return hi;
    if (en != null && en.isNotEmpty) return en;
    if (hi != null && hi.isNotEmpty) return hi;
    return null;
  }

  @override
  List<Object?> get props => [
        id,
        assignmentId,
        attemptNumber,
        status,
        score,
        questionsTotal,
        questionsCorrect,
        submittedAt,
        gradedAt,
        teacherFeedback,
        teacherFeedbackHi,
      ];
}

/// `curriculum_topics` row used only to label an assignment with a chapter
/// number + title (mirrors the web page's `TopicRow`).
class AssignmentTopic extends Equatable {
  final String id;
  final int? chapterNumber;
  final String? title;
  final String? titleHi;

  const AssignmentTopic({
    required this.id,
    this.chapterNumber,
    this.title,
    this.titleHi,
  });

  factory AssignmentTopic.fromJson(Map<String, dynamic> json) {
    return AssignmentTopic(
      id: json['id'] as String? ?? '',
      chapterNumber: (json['chapter_number'] as num?)?.toInt(),
      title: json['title'] as String?,
      titleHi: json['title_hi'] as String?,
    );
  }

  @override
  List<Object?> get props => [id, chapterNumber, title, titleHi];
}

/// View-level status used for the list/detail badge — pure port of the
/// web's `deriveViewStatus()` in `apps/host/src/app/(student)/assignments/page.tsx`.
enum AssignmentViewStatus { notStarted, submitted, graded }

/// Pure function (not a getter) so it is directly unit-testable without
/// constructing a whole [AssignmentListItem]. Mirrors the web's
/// `deriveViewStatus()` EXACTLY: `graded_at` (or `status` in {graded,
/// reviewed}) wins over `submitted_at`/{submitted,completed}.
AssignmentViewStatus deriveAssignmentViewStatus(AssignmentSubmission? sub) {
  if (sub == null) return AssignmentViewStatus.notStarted;
  if (sub.gradedAt != null || sub.status == 'graded' || sub.status == 'reviewed') {
    return AssignmentViewStatus.graded;
  }
  if (sub.submittedAt != null || sub.status == 'submitted' || sub.status == 'completed') {
    return AssignmentViewStatus.submitted;
  }
  return AssignmentViewStatus.notStarted;
}

/// Due-date badge classification — pure port of the web's `dueBadge()`.
enum AssignmentDueBadge { overdue, dueToday, dueSoon, none }

/// [now] is injected so this stays deterministically testable (no hidden
/// `DateTime.now()` call inside pure logic).
AssignmentDueBadge deriveDueBadge(DateTime? dueDate, DateTime now) {
  if (dueDate == null) return AssignmentDueBadge.none;
  final today = DateTime(now.year, now.month, now.day);
  final dueDay = DateTime(dueDate.year, dueDate.month, dueDate.day);
  final diffDays = dueDay.difference(today).inDays;
  if (diffDays < 0) return AssignmentDueBadge.overdue;
  if (diffDays == 0) return AssignmentDueBadge.dueToday;
  return AssignmentDueBadge.dueSoon;
}

/// One row in the assignments list — an [Assignment] joined with every one
/// of this student's attempts (if any, ordered attempt_number ascending) and
/// the resolved [AssignmentTopic] label. Mirrors the web page's per-row
/// composition.
class AssignmentListItem extends Equatable {
  final Assignment assignment;
  final List<AssignmentSubmission> attempts;
  final AssignmentTopic? topic;

  const AssignmentListItem({
    required this.assignment,
    this.attempts = const <AssignmentSubmission>[],
    this.topic,
  });

  AssignmentSubmission? get latestAttempt => attempts.isEmpty ? null : attempts.last;

  AssignmentViewStatus get viewStatus => deriveAssignmentViewStatus(latestAttempt);

  /// Best (max) score across every attempt so far, or null if never attempted.
  int? get bestScore {
    final scores = attempts.map((a) => a.score).whereType<int>();
    if (scores.isEmpty) return null;
    return scores.reduce((a, b) => a > b ? a : b);
  }

  /// Client-side PRE-EMPTIVE gate mirroring the server's authoritative
  /// `max_attempts_reached` / `submission_closed` checks in
  /// `completeAssignmentFromSession()`. This is UX-only — the server remains
  /// the single source of truth and is re-checked on every completion call;
  /// this getter only decides whether to show a "Start"/"Retry" CTA at all
  /// versus a disabled/explained state, so the student isn't invited to
  /// re-attempt something the server will certainly reject.
  bool canAttempt({DateTime? now}) {
    if (attempts.length >= assignment.maxAttempts) return false;
    if (!assignment.allowLateSubmission) {
      final due = assignment.dueDateTime;
      if (due != null && (now ?? DateTime.now()).isAfter(due)) return false;
    }
    return true;
  }

  @override
  List<Object?> get props => [assignment, attempts, topic];
}

/// Discriminated result of `POST /api/student/assignments/[id]/complete`.
///
/// Modelled as 4 distinct outcomes (rather than a single generic
/// success/failure pair) precisely because the two 409 branches
/// (`max_attempts_reached`, `submission_closed`) need DIFFERENT student-facing
/// copy and neither is a transient/retriable error — this is a deliberate
/// UX requirement (see [AssignmentCompletionMaxAttemptsReached] /
/// [AssignmentCompletionClosed] doc comments for the fragility note on how
/// they're distinguished).
sealed class AssignmentCompletionOutcome extends Equatable {
  const AssignmentCompletionOutcome();
}

/// 2xx success — either a fresh/replayed `status: 'submitted'` completion or
/// the soft `status: 'already_graded'` idempotent-friendly response (the
/// route returns 200 for an already-graded replay rather than an error).
class AssignmentCompletionSuccess extends AssignmentCompletionOutcome {
  final String status;
  final String? submissionId;
  final int? scorePercent;
  final int? attemptNumber;
  final int? bestScorePercent;
  final bool isLateSubmission;

  const AssignmentCompletionSuccess({
    required this.status,
    this.submissionId,
    this.scorePercent,
    this.attemptNumber,
    this.bestScorePercent,
    this.isLateSubmission = false,
  });

  bool get isAlreadyGraded => status == 'already_graded';

  factory AssignmentCompletionSuccess.fromJson(Map<String, dynamic> json) {
    return AssignmentCompletionSuccess(
      status: json['status'] as String? ?? 'submitted',
      submissionId: json['submissionId'] as String?,
      scorePercent: (json['scorePercent'] as num?)?.toInt(),
      attemptNumber: (json['attemptNumber'] as num?)?.toInt(),
      bestScorePercent: (json['bestScorePercent'] as num?)?.toInt(),
      isLateSubmission: json['isLateSubmission'] as bool? ?? false,
    );
  }

  @override
  List<Object?> get props => [
        status,
        submissionId,
        scorePercent,
        attemptNumber,
        bestScorePercent,
        isLateSubmission,
      ];
}

/// 409 `max_attempts_reached` — the student has already used every attempt
/// `assignments.max_attempts` allows. Distinct from
/// [AssignmentCompletionClosed]: the recovery message/copy must be
/// different (this is "you're out of attempts", not "it's past due").
class AssignmentCompletionMaxAttemptsReached extends AssignmentCompletionOutcome {
  final String message;
  const AssignmentCompletionMaxAttemptsReached(this.message);

  @override
  List<Object?> get props => [message];
}

/// 409 `submission_closed` — the assignment's due date has passed and
/// `assignments.allow_late_submission` is `false`. Distinct from
/// [AssignmentCompletionMaxAttemptsReached] for the same reason in reverse.
class AssignmentCompletionClosed extends AssignmentCompletionOutcome {
  final String message;
  const AssignmentCompletionClosed(this.message);

  @override
  List<Object?> get props => [message];
}

/// Anything else: network failure, 4xx the classifier doesn't recognise,
/// 5xx, etc. Generic, retriable-by-the-user framing.
class AssignmentCompletionFailure extends AssignmentCompletionOutcome {
  final String message;
  final int? statusCode;
  const AssignmentCompletionFailure(this.message, [this.statusCode]);

  @override
  List<Object?> get props => [message, statusCode];
}
