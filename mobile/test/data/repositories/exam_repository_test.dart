// Tests for ExamRepository's pure response classifiers — the part that has
// to distinguish 402 (upgrade), 404 (gone), 200-with-empty-questions
// (content_insufficient) and generic failure. No network involved.
library;

import 'package:flutter_test/flutter_test.dart';

import 'package:alfanumrik/data/models/exam_models.dart';
import 'package:alfanumrik/data/repositories/exam_repository.dart';

void main() {
  group('classifyDetailResponse', () {
    test('200 → success with paper + adapted static questions', () {
      final outcome = ExamRepository.classifyDetailResponse(200, const {
        'paper': {
          'id': 'p1',
          'paper_code': 'JEE-2024',
          'exam_family': 'jee_main',
          'duration_minutes': 180,
        },
        'questions': [
          {
            'id': 'q2',
            'question_text': 'B',
            'options': ['a', 'b', 'c', 'd'],
            'marks_correct': 4,
            'question_number': '2',
          },
          {
            'id': 'q1',
            'question_text': 'A',
            'options': ['a', 'b', 'c', 'd'],
            'marks_correct': 4,
            'question_number': '1',
          },
        ],
      });

      expect(outcome, isA<ExamPaperDetailSuccess>());
      final s = outcome as ExamPaperDetailSuccess;
      expect(s.paper.durationMinutes, 180);
      expect(s.questions.map((q) => q.questionId), ['q1', 'q2']);
    });

    test('200 for a cbse_board paper carries metadata with zero questions', () {
      final outcome = ExamRepository.classifyDetailResponse(200, const {
        'paper': {
          'id': 'p1',
          'paper_code': 'CBSE-10-SCI',
          'exam_family': 'cbse_board',
          'duration_minutes': 180,
        },
        'questions': <dynamic>[],
      });
      final s = outcome as ExamPaperDetailSuccess;
      expect(s.paper.isCbseBoard, isTrue);
      expect(s.questions, isEmpty);
    });

    test('402 → upgrade required, carrying the server upgrade_url', () {
      final outcome = ExamRepository.classifyDetailResponse(402, const {
        'error': 'competition_plan_required',
        'upgrade_url': '/upgrade?from=mock',
      });
      expect(outcome, isA<ExamPaperDetailUpgradeRequired>());
      expect((outcome as ExamPaperDetailUpgradeRequired).upgradeUrl, '/upgrade?from=mock');
    });

    test('404 → not found', () {
      expect(
        ExamRepository.classifyDetailResponse(404, const {'error': 'paper_not_found'}),
        isA<ExamPaperDetailNotFound>(),
      );
    });

    test('500 → failure carrying the status code', () {
      final outcome = ExamRepository.classifyDetailResponse(
        500,
        const {'error': 'Failed to load paper'},
      );
      expect(outcome, isA<ExamPaperDetailFailure>());
      expect((outcome as ExamPaperDetailFailure).statusCode, 500);
    });

    test('200 with no paper object → failure, not a bogus empty paper', () {
      expect(
        ExamRepository.classifyDetailResponse(200, const {'questions': <dynamic>[]}),
        isA<ExamPaperDetailFailure>(),
      );
    });
  });

  group('classifyStartResponse', () {
    test('200 with questions → success', () {
      final outcome = ExamRepository.classifyStartResponse(200, const {
        'attempt_id': 'att-1',
        'questions': [
          {
            'question_id': 'q1',
            'section': 'A',
            'marks': 1,
            'order': 1,
            'text': 'Q',
            'options': ['a', 'b', 'c', 'd'],
          },
        ],
      });
      expect(outcome, isA<ExamStartSuccess>());
      expect((outcome as ExamStartSuccess).result.attemptId, 'att-1');
    });

    test('200 with an EMPTY questions array → contentInsufficient, not failure', () {
      final outcome = ExamRepository.classifyStartResponse(200, const {
        'attempt_id': 'att-unpersisted',
        'questions': <dynamic>[],
      });
      expect(outcome, isA<ExamStartContentInsufficient>());
      expect(outcome, isNot(isA<ExamStartFailure>()));
    });

    test('200 with no attempt_id → failure', () {
      expect(
        ExamRepository.classifyStartResponse(200, const {'questions': <dynamic>[]}),
        isA<ExamStartFailure>(),
      );
    });

    test('400 paper_not_cbse_board → failure with the server error string', () {
      final outcome = ExamRepository.classifyStartResponse(
        400,
        const {'success': false, 'error': 'paper_not_cbse_board'},
      );
      expect((outcome as ExamStartFailure).message, 'paper_not_cbse_board');
    });

    test('402 → upgrade required', () {
      expect(
        ExamRepository.classifyStartResponse(402, const {'upgrade_url': '/upgrade'}),
        isA<ExamStartUpgradeRequired>(),
      );
    });

    test('404 → not found', () {
      expect(
        ExamRepository.classifyStartResponse(404, const {}),
        isA<ExamStartNotFound>(),
      );
    });
  });

  group('classifySubmitResponse', () {
    const okBody = {
      'attempt_id': 'att-1',
      'paper_id': 'p-1',
      'summary': {
        'total_questions': 39,
        'correct_count': 20,
        'raw_score': 41,
        'max_score': 80,
        'score_percent': 63,
        'xp_earned': 90,
      },
      'review': <dynamic>[],
    };

    test('200 → success with the server summary untouched', () {
      final outcome = ExamRepository.classifySubmitResponse(200, okBody);
      expect(outcome, isA<ExamSubmitSuccess>());
      final s = (outcome as ExamSubmitSuccess).result.summary;
      expect(s.scorePercent, 63);
      expect(s.rawScore, 41);
      expect(s.xpEarned, 90);
    });

    test('402 → upgrade required (plan downgraded mid-attempt)', () {
      expect(
        ExamRepository.classifySubmitResponse(
          402,
          const {'error': 'competition_plan_required', 'upgrade_url': '/upgrade'},
        ),
        isA<ExamSubmitUpgradeRequired>(),
      );
    });

    test('500 → failure so the runner can offer retry without losing answers', () {
      final outcome = ExamRepository.classifySubmitResponse(
        500,
        const {'success': false, 'error': 'submission_failed'},
      );
      expect(outcome, isA<ExamSubmitFailure>());
      expect((outcome as ExamSubmitFailure).statusCode, 500);
    });

    test('200 with a missing summary → failure rather than a zeroed scorecard', () {
      expect(
        ExamRepository.classifySubmitResponse(200, const {'attempt_id': 'a'}),
        isA<ExamSubmitFailure>(),
      );
    });
  });
}
