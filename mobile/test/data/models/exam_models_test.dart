// Decode tests for exam_models.dart against the CURRENT (post Phase 2.2)
// API shapes:
//   GET  /api/exams/papers
//   GET  /api/exams/papers/{id}
//   POST /api/exams/papers/{id}/start
//   POST /api/exams/papers/{id}/submit
library;

import 'package:flutter_test/flutter_test.dart';

import 'package:alfanumrik/data/models/exam_models.dart';

void main() {
  group('ExamPaper', () {
    test('decodes a cbse_board catalog row and exposes the SERVER duration', () {
      final paper = ExamPaper.fromJson(const {
        'id': 'p-1',
        'paper_code': 'CBSE-10-SCIENCE',
        'exam_family': 'cbse_board',
        'exam_year': 2026,
        'grade': '10',
        'subject_scope': ['science'],
        'total_questions': 39,
        'total_marks': 80,
        'duration_minutes': 180,
      });

      expect(paper.isCbseBoard, isTrue);
      expect(paper.grade, '10');
      expect(paper.durationMinutes, 180);
      expect(paper.hasServerDuration, isTrue);
      expect(paper.durationSeconds, 180 * 60);
      expect(paper.primarySubject, 'science');
    });

    test('P5 — an integer grade from the server is coerced to a String', () {
      final paper = ExamPaper.fromJson(const {
        'id': 'p-2',
        'paper_code': 'X',
        'exam_family': 'cbse_board',
        'grade': 9,
      });
      expect(paper.grade, '9');
      expect(paper.grade, isA<String>());
    });

    test('a missing duration is reported as unavailable, never defaulted', () {
      final paper = ExamPaper.fromJson(const {
        'id': 'p-3',
        'paper_code': 'X',
        'exam_family': 'cbse_board',
      });
      expect(paper.durationMinutes, 0);
      expect(paper.hasServerDuration, isFalse);
      // Explicitly NOT 180 — there is no client-side exam-length constant.
      expect(paper.durationSeconds, 0);
    });
  });

  group('ExamPaperCatalog', () {
    test('decodes the envelope and locks non-cbse papers when the flag is off', () {
      final catalog = ExamPaperCatalog.fromJson(const {
        'papers': [
          {'id': 'a', 'paper_code': 'CBSE', 'exam_family': 'cbse_board'},
          {'id': 'b', 'paper_code': 'JEE', 'exam_family': 'jee_main'},
        ],
        'flag_enabled': false,
        'total': 2,
      });

      expect(catalog.papers, hasLength(2));
      expect(catalog.total, 2);
      expect(catalog.isLocked(catalog.papers[0]), isFalse);
      expect(catalog.isLocked(catalog.papers[1]), isTrue);
    });

    test('unlocks competitive papers when flag_enabled is true', () {
      final catalog = ExamPaperCatalog.fromJson(const {
        'papers': [
          {'id': 'b', 'paper_code': 'JEE', 'exam_family': 'jee_main'},
        ],
        'flag_enabled': true,
      });
      expect(catalog.isLocked(catalog.papers[0]), isFalse);
    });
  });

  group('ExamStartResult (POST .../start)', () {
    test('decodes section + per-question marks and sorts by order', () {
      final result = ExamStartResult.fromJson(const {
        'attempt_id': 'att-1',
        'questions': [
          {
            'question_id': 'q2',
            'section': 'B',
            'marks': 2,
            'order': 2,
            'text': 'Second',
            'options': ['a', 'b', 'c', 'd'],
          },
          {
            'question_id': 'q1',
            'section': 'A',
            'marks': 1,
            'order': 1,
            'text': 'First',
            'text_hi': 'पहला',
            'options': ['a', 'b', 'c', 'd'],
          },
        ],
      });

      expect(result.attemptId, 'att-1');
      expect(result.contentInsufficient, isFalse);
      expect(result.questions.map((q) => q.questionId), ['q1', 'q2']);
      expect(result.questions[0].section, 'A');
      expect(result.questions[0].marks, 1);
      expect(result.questions[1].marks, 2);
      // P7 — Hindi used when present, English fallback when not.
      expect(result.questions[0].displayText(true), 'पहला');
      expect(result.questions[1].displayText(true), 'Second');
    });

    test('200 + empty questions is the content_insufficient contract', () {
      final result = ExamStartResult.fromJson(const {
        'attempt_id': 'att-empty',
        'questions': <dynamic>[],
      });
      expect(result.attemptId, 'att-empty');
      expect(result.contentInsufficient, isTrue);
    });
  });

  group('ExamAttemptQuestion static shape', () {
    test('decodes a GET /papers/{id} row with a text question_number', () {
      final q = ExamAttemptQuestion.fromStaticJson(
        const {
          'id': 'sq-1',
          'question_text': 'Static Q',
          'options': ['1', '2', '3', '4'],
          'marks_correct': 4,
          'question_number': '7',
        },
        fallbackOrder: 99,
      );
      expect(q.questionId, 'sq-1');
      expect(q.section, isNull);
      expect(q.marks, 4);
      expect(q.order, 7);
    });

    test('falls back to the array position when question_number is unusable', () {
      final q = ExamAttemptQuestion.fromStaticJson(
        const {'id': 'sq-2', 'question_text': 'Q', 'question_number': null},
        fallbackOrder: 3,
      );
      expect(q.order, 3);
    });

    test('parses JSON-encoded legacy options strings', () {
      final q = ExamAttemptQuestion.fromStaticJson(
        const {'id': 'sq-3', 'question_text': 'Q', 'options': '["a","b","c","d"]'},
        fallbackOrder: 1,
      );
      expect(q.options, ['a', 'b', 'c', 'd']);
    });
  });

  group('ExamSectionSummary (paper STRUCTURE, not score)', () {
    test('groups question counts and available marks by section', () {
      const questions = [
        ExamAttemptQuestion(questionId: 'a', section: 'A', marks: 1, text: ''),
        ExamAttemptQuestion(questionId: 'b', section: 'A', marks: 1, text: ''),
        ExamAttemptQuestion(questionId: 'c', section: 'E', marks: 4, text: ''),
      ];
      final sections = ExamSectionSummary.fromQuestions(questions);
      expect(sections.map((s) => s.key), ['A', 'E']);
      expect(sections[0].count, 2);
      expect(sections[0].marks, 2);
      expect(sections[1].marks, 4);
    });
  });

  group('ExamSubmitResult (POST .../submit)', () {
    const payload = {
      'attempt_id': 'att-9',
      'paper_id': 'p-9',
      'summary': {
        'total_questions': 39,
        'attempted_count': 30,
        'correct_count': 21,
        'wrong_count': 9,
        'skipped_count': 9,
        'raw_score': 43,
        'max_score': 80,
        // Deliberately NOT round(21/39*100)=54 and NOT round(43/80*100)=54 —
        // an arbitrary server value, so any client-side recomputation would
        // visibly disagree.
        'score_percent': 61,
        'xp_earned': 137,
        'time_taken_seconds': 5400,
        'submitted_at': '2026-07-22T10:00:00Z',
      },
      'review': [
        {
          'question_id': 'q1',
          'question_text': 'Q1',
          'options': ['a', 'b', 'c', 'd'],
          'response_index': 2,
          'correct_answer_index': 2,
          'is_correct': true,
          'marks_awarded': 3,
          'explanation': 'because',
          'chapter_title': 'Ch 1',
        },
        {
          'question_id': 'q2',
          'question_text': 'Q2',
          'options': ['a', 'b', 'c', 'd'],
          'response_index': null,
          'correct_answer_index': 1,
          'is_correct': false,
          'marks_awarded': 0,
          'explanation': null,
          'chapter_title': null,
        },
      ],
    };

    test('decodes the summary verbatim', () {
      final result = ExamSubmitResult.fromJson(Map<String, dynamic>.from(payload));
      final s = result.summary;
      expect(result.attemptId, 'att-9');
      expect(result.paperId, 'p-9');
      expect(s.scorePercent, 61);
      expect(s.rawScore, 43);
      expect(s.maxScore, 80);
      expect(s.correctCount, 21);
      expect(s.wrongCount, 9);
      expect(s.skippedCount, 9);
      expect(s.xpEarned, 137);
      expect(s.timeTakenSeconds, 5400);
    });

    test(
      'P1 — the decoded score is the SERVER value, not a re-derivation of '
      'correct/total or raw/max',
      () {
        final result = ExamSubmitResult.fromJson(Map<String, dynamic>.from(payload));
        final s = result.summary;

        // Both plausible local formulas produce 54; the server said 61.
        final fromCounts = ((s.correctCount / s.totalQuestions) * 100).round();
        final fromMarks = ((s.rawScore / s.maxScore) * 100).round();
        expect(fromCounts, isNot(s.scorePercent));
        expect(fromMarks, isNot(s.scorePercent));
        expect(s.scorePercent, 61);
      },
    );

    test('P1 — rawScore is not the sum of review marks_awarded', () {
      final result = ExamSubmitResult.fromJson(Map<String, dynamic>.from(payload));
      final summedFromReview =
          result.review.fold<int>(0, (acc, r) => acc + r.marksAwarded);
      expect(summedFromReview, 3);
      expect(result.summary.rawScore, 43);
      expect(result.summary.rawScore, isNot(summedFromReview));
    });

    test('decodes review rows including the skipped case', () {
      final result = ExamSubmitResult.fromJson(Map<String, dynamic>.from(payload));
      expect(result.review, hasLength(2));
      expect(result.review[0].isCorrect, isTrue);
      expect(result.review[0].isSkipped, isFalse);
      expect(result.review[1].isSkipped, isTrue);
      expect(result.review[1].correctAnswerIndex, 1);
      expect(result.review[1].marksAwarded, 0);
    });

    test('a malformed summary degrades to zeros rather than throwing', () {
      final result = ExamSubmitResult.fromJson(const {
        'attempt_id': 'a',
        'paper_id': 'p',
      });
      expect(result.summary.scorePercent, 0);
      expect(result.review, isEmpty);
    });
  });

  group('ExamResponseItem', () {
    test('serialises a null response_index (unattempted) without dropping it', () {
      const item = ExamResponseItem(questionId: 'q1', responseIndex: null);
      final json = item.toJson();
      expect(json.containsKey('response_index'), isTrue);
      expect(json['response_index'], isNull);
      expect(json['marked_for_review'], isFalse);
      expect(json.containsKey('time_taken_seconds'), isFalse);
    });

    test('includes time_taken_seconds only when supplied', () {
      const item = ExamResponseItem(
        questionId: 'q1',
        responseIndex: 2,
        timeTakenSeconds: 14,
        markedForReview: true,
      );
      expect(item.toJson(), {
        'question_id': 'q1',
        'response_index': 2,
        'time_taken_seconds': 14,
        'marked_for_review': true,
      });
    });
  });
}
