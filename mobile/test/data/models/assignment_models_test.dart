// Tests for assignment_models.dart's fromJson decoders and pure helpers —
// Assignment/AssignmentSubmission/AssignmentTopic decoding,
// deriveAssignmentViewStatus, deriveDueBadge, AssignmentListItem.canAttempt,
// and AssignmentCompletionSuccess.fromJson (the full multi-attempt /
// due-date-lockout response shape).
library;

import 'package:flutter_test/flutter_test.dart';

import 'package:alfanumrik/data/models/assignment_models.dart';

void main() {
  group('Assignment.fromJson', () {
    test('parses a full assignments-row shape with column defaults applied', () {
      final a = Assignment.fromJson(const {
        'id': 'a-1',
        'class_id': 'class-1',
        'title': 'Chapter 3 Practice',
        'description': 'Do the 10 questions',
        'assignment_type': 'quiz',
        'subject': 'math',
        'grade': '9',
        'topic_id': 'topic-1',
        'bloom_level': 'apply',
        'question_count': 10,
        'due_date': '2026-07-25T00:00:00.000Z',
        'max_attempts': 3,
        'allow_late_submission': false,
        'status': 'active',
        'created_at': '2026-07-01T00:00:00.000Z',
      });

      expect(a.id, 'a-1');
      expect(a.title, 'Chapter 3 Practice');
      expect(a.maxAttempts, 3);
      expect(a.allowLateSubmission, isFalse);
      expect(a.dueDateTime, isNotNull);
    });

    test('defaults max_attempts to 3 and allow_late_submission to true when absent', () {
      final a = Assignment.fromJson(const {'id': 'a-2', 'title': 'No deadline'});
      expect(a.maxAttempts, 3);
      expect(a.allowLateSubmission, isTrue);
      expect(a.dueDateTime, isNull);
    });
  });

  group('AssignmentSubmission.fromJson', () {
    test('parses a full assignment_submissions row', () {
      final s = AssignmentSubmission.fromJson(const {
        'id': 'sub-1',
        'assignment_id': 'a-1',
        'attempt_number': 2,
        'status': 'submitted',
        'score': 80,
        'questions_total': 10,
        'questions_correct': 8,
        'submitted_at': '2026-07-20T10:00:00.000Z',
        'graded_at': null,
        'teacher_feedback': null,
        'teacher_feedback_hi': null,
      });

      expect(s.attemptNumber, 2);
      expect(s.score, 80);
      expect(s.gradedAt, isNull);
    });

    test('defaults attempt_number to 1 when absent', () {
      final s = AssignmentSubmission.fromJson(const {'id': 's', 'assignment_id': 'a'});
      expect(s.attemptNumber, 1);
    });

    test('decodes both teacher_feedback and teacher_feedback_hi', () {
      final s = AssignmentSubmission.fromJson(const {
        'id': 's',
        'assignment_id': 'a',
        'teacher_feedback': 'Well done',
        'teacher_feedback_hi': 'शाबाश',
      });
      expect(s.teacherFeedback, 'Well done');
      expect(s.teacherFeedbackHi, 'शाबाश');
    });
  });

  group('AssignmentSubmission.feedbackFor — P7 language-aware pick', () {
    const both = AssignmentSubmission(
      id: 's',
      assignmentId: 'a',
      teacherFeedback: 'Well done',
      teacherFeedbackHi: 'शाबाश',
    );
    const englishOnly = AssignmentSubmission(
      id: 's',
      assignmentId: 'a',
      teacherFeedback: 'Well done',
    );
    const hindiOnly = AssignmentSubmission(
      id: 's',
      assignmentId: 'a',
      teacherFeedbackHi: 'शाबाश',
    );
    const neither = AssignmentSubmission(id: 's', assignmentId: 'a');

    test('Hindi student + Hindi variant -> Hindi', () {
      expect(both.feedbackFor(true), 'शाबाश');
    });

    test('Hindi student + no Hindi variant -> English fallback (never blank)', () {
      expect(englishOnly.feedbackFor(true), 'Well done');
    });

    test('English student -> always English even when a Hindi variant exists', () {
      expect(both.feedbackFor(false), 'Well done');
    });

    test('English student + only Hindi filled -> still shows the Hindi (never hide feedback)', () {
      expect(hindiOnly.feedbackFor(false), 'शाबाश');
    });

    test('no feedback either language -> null (caller renders nothing)', () {
      expect(neither.feedbackFor(true), isNull);
      expect(neither.feedbackFor(false), isNull);
    });

    test('whitespace-only variants are treated as absent', () {
      const ws = AssignmentSubmission(
        id: 's',
        assignmentId: 'a',
        teacherFeedback: '   ',
        teacherFeedbackHi: '   ',
      );
      expect(ws.feedbackFor(true), isNull);
    });
  });

  group('deriveAssignmentViewStatus', () {
    test('null submission -> notStarted', () {
      expect(deriveAssignmentViewStatus(null), AssignmentViewStatus.notStarted);
    });

    test('graded_at set -> graded (wins over submitted_at)', () {
      const sub = AssignmentSubmission(
        id: 's',
        assignmentId: 'a',
        submittedAt: '2026-07-01T00:00:00.000Z',
        gradedAt: '2026-07-02T00:00:00.000Z',
      );
      expect(deriveAssignmentViewStatus(sub), AssignmentViewStatus.graded);
    });

    test('status == reviewed -> graded even without graded_at', () {
      const sub = AssignmentSubmission(id: 's', assignmentId: 'a', status: 'reviewed');
      expect(deriveAssignmentViewStatus(sub), AssignmentViewStatus.graded);
    });

    test('submitted_at set, not graded -> submitted', () {
      const sub = AssignmentSubmission(
        id: 's',
        assignmentId: 'a',
        submittedAt: '2026-07-01T00:00:00.000Z',
      );
      expect(deriveAssignmentViewStatus(sub), AssignmentViewStatus.submitted);
    });

    test('neither submitted_at/graded_at nor a matching status -> notStarted', () {
      const sub = AssignmentSubmission(id: 's', assignmentId: 'a');
      expect(deriveAssignmentViewStatus(sub), AssignmentViewStatus.notStarted);
    });
  });

  group('deriveDueBadge', () {
    final now = DateTime(2026, 7, 21, 12);

    test('null due date -> none', () {
      expect(deriveDueBadge(null, now), AssignmentDueBadge.none);
    });

    test('due date in the past -> overdue', () {
      expect(deriveDueBadge(DateTime(2026, 7, 20), now), AssignmentDueBadge.overdue);
    });

    test('due date today -> dueToday', () {
      expect(deriveDueBadge(DateTime(2026, 7, 21, 23, 59), now), AssignmentDueBadge.dueToday);
    });

    test('due date in the future -> dueSoon', () {
      expect(deriveDueBadge(DateTime(2026, 7, 25), now), AssignmentDueBadge.dueSoon);
    });
  });

  group('AssignmentListItem.canAttempt', () {
    Assignment baseAssignment({int maxAttempts = 3, bool allowLate = true, String? dueDate}) {
      return Assignment(
        id: 'a-1',
        title: 'T',
        maxAttempts: maxAttempts,
        allowLateSubmission: allowLate,
        dueDate: dueDate,
      );
    }

    test('true when no attempts yet and no due date', () {
      final item = AssignmentListItem(assignment: baseAssignment());
      expect(item.canAttempt(), isTrue);
    });

    test('false once attempts.length reaches max_attempts', () {
      final item = AssignmentListItem(
        assignment: baseAssignment(maxAttempts: 2),
        attempts: const [
          AssignmentSubmission(id: 's1', assignmentId: 'a-1', attemptNumber: 1),
          AssignmentSubmission(id: 's2', assignmentId: 'a-1', attemptNumber: 2),
        ],
      );
      expect(item.canAttempt(), isFalse);
    });

    test('false when past due and allow_late_submission is false', () {
      final item = AssignmentListItem(
        assignment: baseAssignment(
          allowLate: false,
          dueDate: '2020-01-01T00:00:00.000Z',
        ),
      );
      expect(item.canAttempt(now: DateTime(2026, 7, 21)), isFalse);
    });

    test('true when past due but allow_late_submission is true (accept-and-flag policy)', () {
      final item = AssignmentListItem(
        assignment: baseAssignment(
          allowLate: true,
          dueDate: '2020-01-01T00:00:00.000Z',
        ),
      );
      expect(item.canAttempt(now: DateTime(2026, 7, 21)), isTrue);
    });

    test('bestScore is the MAX score across every attempt', () {
      final item = AssignmentListItem(
        assignment: baseAssignment(),
        attempts: const [
          AssignmentSubmission(id: 's1', assignmentId: 'a-1', attemptNumber: 1, score: 40),
          AssignmentSubmission(id: 's2', assignmentId: 'a-1', attemptNumber: 2, score: 90),
          AssignmentSubmission(id: 's3', assignmentId: 'a-1', attemptNumber: 3, score: 70),
        ],
      );
      expect(item.bestScore, 90);
    });

    test('bestScore is null when there are no attempts', () {
      final item = AssignmentListItem(assignment: baseAssignment());
      expect(item.bestScore, isNull);
    });
  });

  group('AssignmentCompletionSuccess.fromJson', () {
    test('parses the full Phase 3 multi-attempt + due-date-lockout response shape', () {
      final s = AssignmentCompletionSuccess.fromJson(const {
        'success': true,
        'status': 'submitted',
        'submissionId': 'sub-9',
        'scorePercent': 80,
        'attemptNumber': 2,
        'bestScorePercent': 90,
        'isLateSubmission': true,
      });

      expect(s.status, 'submitted');
      expect(s.attemptNumber, 2);
      expect(s.bestScorePercent, 90);
      expect(s.isLateSubmission, isTrue);
      expect(s.isAlreadyGraded, isFalse);
    });

    test('isAlreadyGraded is true for the soft already_graded status', () {
      final s = AssignmentCompletionSuccess.fromJson(const {'status': 'already_graded'});
      expect(s.isAlreadyGraded, isTrue);
    });

    test('isLateSubmission defaults to false when absent (older/non-late responses)', () {
      final s = AssignmentCompletionSuccess.fromJson(const {'status': 'submitted'});
      expect(s.isLateSubmission, isFalse);
    });
  });
}
