// Unit tests for QuizRepository's pure logic — start_quiz_session response
// parsing and v1↔v2 response-shape dispatch (P1+P6 fix, migration
// 20260428160000_quiz_session_shuffles.sql).
//
// These tests intentionally exercise only the static helpers + pure data
// transformations. The full network path requires Supabase mocks (mocktail/
// mockito), which aren't currently in pubspec — those will be added in a
// follow-up if/when integration coverage is expanded.
//
// Web parity reference: src/__tests__/api/quiz-server-shuffle-authority.test.ts
// and src/__tests__/quiz-server-shuffle-integration.test.ts. Mobile must
// agree on the wire shape with the web client because both call the same
// RPC. If a test here fails, ensure the equivalent web test still passes.

import 'package:flutter_test/flutter_test.dart';

import 'package:alfanumrik/data/models/quiz_question.dart';
import 'package:alfanumrik/data/repositories/quiz_repository.dart';

void main() {
  group('QuizRepository.parseStartSessionResponse (start_quiz_session shape)',
      () {
    test('parses a typical { session_id, questions:[...] } success body', () {
      final session = QuizRepository.parseStartSessionResponse(
        {
          'session_id': '11111111-1111-1111-1111-111111111111',
          'questions': [
            {
              'question_id': 'qid-1',
              'question_text': 'What is 2 + 2?',
              'question_hi': '2 + 2 = ?',
              'question_type': 'mcq',
              'options_displayed': ['3', '4', '5', '6'],
              'explanation': 'Addition.',
              'explanation_hi': 'जोड़।',
              'hint': null,
              'difficulty': 1,
              'bloom_level': 'remember',
              'chapter_number': 1,
            },
          ],
        },
        subject: 'mathematics',
        grade: '6',
      );

      expect(session, isNotNull);
      expect(session!.sessionId, '11111111-1111-1111-1111-111111111111');
      expect(session.questions, hasLength(1));
      final q = session.questions.first;
      expect(q.id, 'qid-1');
      expect(q.options, ['3', '4', '5', '6']);
      // CRITICAL P1+P6 invariant: server never reveals correct_answer_index.
      // The model uses -1 as a sentinel meaning "server-owned, do not consult".
      expect(q.correctIndex, -1);
      expect(q.subject, 'mathematics');
      expect(q.grade, '6');
    });

    test('returns null when raw payload is not a Map', () {
      expect(
        QuizRepository.parseStartSessionResponse(
          'not-a-map',
          subject: 'science',
          grade: '7',
        ),
        isNull,
      );
      expect(
        QuizRepository.parseStartSessionResponse(
          null,
          subject: 'science',
          grade: '7',
        ),
        isNull,
      );
      expect(
        QuizRepository.parseStartSessionResponse(
          [1, 2, 3],
          subject: 'science',
          grade: '7',
        ),
        isNull,
      );
    });

    test('returns null when session_id is missing or empty', () {
      expect(
        QuizRepository.parseStartSessionResponse(
          {'questions': []},
          subject: 'science',
          grade: '7',
        ),
        isNull,
      );
      expect(
        QuizRepository.parseStartSessionResponse(
          {'session_id': '', 'questions': []},
          subject: 'science',
          grade: '7',
        ),
        isNull,
      );
    });

    test('returns null when questions field is not a list', () {
      expect(
        QuizRepository.parseStartSessionResponse(
          {
            'session_id': 'abc',
            'questions': 'not-a-list',
          },
          subject: 'science',
          grade: '7',
        ),
        isNull,
      );
    });

    test('skips malformed question entries silently', () {
      final session = QuizRepository.parseStartSessionResponse(
        {
          'session_id': 'sess-x',
          'questions': [
            'not-a-map',
            null,
            {
              'question_id': 'qid-good',
              'question_text': 'Real question',
              'options_displayed': ['a', 'b', 'c', 'd'],
            },
          ],
        },
        subject: 'science',
        grade: '8',
      );

      expect(session, isNotNull);
      expect(session!.questions, hasLength(1));
      expect(session.questions.first.id, 'qid-good');
    });
  });

  group('QuizRepository.mapResponsesForV2 (v2 wire shape)', () {
    test('rewrites selected_option → selected_displayed_index', () {
      // Caller may have built responses using the v1 field name; the v2 mapper
      // must rewrite to the v2 wire field. This is the single most important
      // contract: the v2 RPC reads `selected_displayed_index`.
      final out = QuizRepository.mapResponsesForV2([
        {
          'question_id': 'q1',
          'selected_option': 2,
          'time_spent': 7,
        }
      ]);
      expect(out, hasLength(1));
      expect(out.first['question_id'], 'q1');
      expect(out.first['selected_displayed_index'], 2);
      expect(out.first.containsKey('selected_option'), isFalse,
          reason:
              'v2 path must NEVER send selected_option — the field name encodes '
              'the contract.');
      expect(out.first['time_spent'], 7);
    });

    test('passes through selected_displayed_index when already present', () {
      final out = QuizRepository.mapResponsesForV2([
        {
          'question_id': 'q1',
          'selected_displayed_index': 0,
          'time_spent': 12,
        }
      ]);
      expect(out.first['selected_displayed_index'], 0);
    });

    test('defaults missing index to -1 (unanswered sentinel)', () {
      // Anti-cheat P3: response count must equal question count. If the
      // student skips a question, we must still send a row — with the
      // sentinel -1 so the server treats it as wrong without filtering.
      final out = QuizRepository.mapResponsesForV2([
        {'question_id': 'q-skipped', 'time_spent': 0}
      ]);
      expect(out.first['selected_displayed_index'], -1);
    });

    test('preserves optional written-answer companion fields', () {
      // Forward-compat for SA/MA/LA flow on mobile. These pass through
      // because the v2 server reads them on the ncert-question-engine path.
      final out = QuizRepository.mapResponsesForV2([
        {
          'question_id': 'q1',
          'selected_displayed_index': 1,
          'time_spent': 5,
          'error_type': 'concept_misunderstanding',
          'student_answer_text': 'photosynthesis',
          'marks_awarded': 2,
          'marks_possible': 3,
          'rubric_feedback': 'partial credit',
        }
      ]);
      expect(out.first['error_type'], 'concept_misunderstanding');
      expect(out.first['student_answer_text'], 'photosynthesis');
      expect(out.first['marks_awarded'], 2);
      expect(out.first['marks_possible'], 3);
      expect(out.first['rubric_feedback'], 'partial credit');
    });
  });

  group('QuizRepository.mapResponsesForV1 (legacy fallback wire shape)', () {
    test('rewrites selected_displayed_index → selected_option', () {
      // The v1 RPC reads `selected_option`. When we fall back to v1 from a
      // v2-shaped local payload (older Supabase deployment), this rewrite
      // is what makes the fallback keep working.
      final out = QuizRepository.mapResponsesForV1([
        {
          'question_id': 'q1',
          'selected_displayed_index': 3,
          'time_spent': 8,
        }
      ]);
      expect(out, hasLength(1));
      expect(out.first['selected_option'], 3);
      expect(out.first.containsKey('selected_displayed_index'), isFalse,
          reason: 'v1 path must NEVER send selected_displayed_index.');
    });

    test('passes through selected_option when already present', () {
      final out = QuizRepository.mapResponsesForV1([
        {
          'question_id': 'q1',
          'selected_option': 0,
          'time_spent': 12,
        }
      ]);
      expect(out.first['selected_option'], 0);
    });

    test('defaults missing index to -1 (unanswered sentinel, matches v2)', () {
      final out = QuizRepository.mapResponsesForV1([
        {'question_id': 'q-skipped', 'time_spent': 0}
      ]);
      expect(out.first['selected_option'], -1);
    });
  });

  group('QuizResult.fromRpc (v1/v2 dispatch on response payload shape)', () {
    test('parses a v1 response (no questions array) → empty review', () {
      // v1 returns: { total, correct, score_percent, xp_earned, session_id,
      //               flagged }
      // No `questions` array — review[] should be empty.
      final result = QuizResult.fromRpc(
        {
          'total': 10,
          'correct': 7,
          'score_percent': 70,
          'xp_earned': 90,
          'session_id': 'qs-v1-uuid',
          'flagged': false,
        },
        const Duration(seconds: 120),
      );
      expect(result.totalQuestions, 10);
      expect(result.correctAnswers, 7);
      expect(result.scorePercent, 70);
      expect(result.xpEarned, 90);
      expect(result.review, isEmpty);
    });

    test('parses a v2 response (with questions array) → populated review', () {
      // v2 adds `questions: [{question_id, is_correct, correct_option_text,
      //                       correct_original_index, selected_displayed_index,
      //                       selected_original_index, shuffle_map}]`
      final result = QuizResult.fromRpc(
        {
          'total': 2,
          'correct': 1,
          'score_percent': 50,
          'xp_earned': 10,
          'session_id': 'qs-v2-uuid',
          'flagged': false,
          'questions': [
            {
              'question_id': 'qid-1',
              'is_correct': true,
              'correct_option_text': 'Photosynthesis',
              'correct_original_index': 2,
              'selected_displayed_index': 1,
              'selected_original_index': 2,
              'shuffle_map': [3, 2, 0, 1],
            },
            {
              'question_id': 'qid-2',
              'is_correct': false,
              'correct_option_text': '42',
              'correct_original_index': 0,
              'selected_displayed_index': 3,
              'selected_original_index': 1,
              'shuffle_map': [1, 2, 3, 0],
            },
          ],
        },
        const Duration(seconds: 60),
      );
      expect(result.totalQuestions, 2);
      expect(result.correctAnswers, 1);
      expect(result.review, hasLength(2));

      // P1+P6 contract: review rows are the AUTHORITATIVE source of
      // correct_option_text. UI MUST display these verbatim, never derive
      // from the local options array (which could be stale).
      expect(result.review[0].questionId, 'qid-1');
      expect(result.review[0].isCorrect, isTrue);
      expect(result.review[0].correctOptionText, 'Photosynthesis');
      expect(result.review[0].selectedDisplayedIndex, 1);

      expect(result.review[1].questionId, 'qid-2');
      expect(result.review[1].isCorrect, isFalse);
      expect(result.review[1].correctOptionText, '42');
    });

    test('tolerates Map<dynamic, dynamic> review rows from supabase_flutter',
        () {
      // supabase_flutter sometimes returns nested JSONB arrays as
      // List<Map<dynamic, dynamic>>. The defensive cast in QuizResult.fromRpc
      // must accept these.
      final dynamicMap = <dynamic, dynamic>{
        'question_id': 'qid-x',
        'is_correct': true,
        'correct_option_text': 'Right',
        'correct_original_index': 0,
        'selected_displayed_index': 2,
        'selected_original_index': 0,
      };
      final result = QuizResult.fromRpc(
        {
          'total': 1,
          'correct': 1,
          'score_percent': 100,
          'xp_earned': 80,
          'session_id': 'qs-uuid',
          'flagged': false,
          'questions': [dynamicMap],
        },
        const Duration(seconds: 10),
      );
      expect(result.review, hasLength(1));
      expect(result.review.first.questionId, 'qid-x');
      expect(result.review.first.isCorrect, isTrue);
    });

    test('flagged + zero xp on cheat detection (mirrors P3 server policy)',
        () {
      // The server returns flagged=true and xp_earned=0 when anti-cheat
      // fires. The mobile model must surface flagged as-is so the result
      // screen can show a hint message.
      final result = QuizResult.fromRpc(
        {
          'total': 5,
          'correct': 5,
          'score_percent': 100,
          'xp_earned': 0,
          'session_id': 'qs-cheat',
          'flagged': true,
        },
        const Duration(seconds: 8),
      );
      expect(result.flagged, isTrue);
      expect(result.xpEarned, 0,
          reason:
              'P3: flagged sessions earn zero XP, regardless of score percent.');
    });
  });

  group('QuizQuestion.fromServerSession', () {
    test('exposes server-shuffled options without the correct index', () {
      // P1+P6 invariant: the v2 path must never expose
      // correct_answer_index to the client. The sentinel -1 enforces
      // this at the model level — any code that tries to use it as an
      // index would crash visibly.
      final q = QuizQuestion.fromServerSession(
        {
          'question_id': 'qid-9',
          'question_text': 'Q?',
          'options_displayed': ['o1', 'o2', 'o3', 'o4'],
        },
        subject: 'physics',
        grade: '11',
      );
      expect(q.id, 'qid-9');
      expect(q.options, ['o1', 'o2', 'o3', 'o4']);
      expect(q.correctIndex, -1,
          reason:
              'Server never returns correct_answer_index in start_quiz_session. '
              'Sentinel -1 prevents the client from accidentally using a stale '
              'value.');
    });

    test('handles malformed options_displayed by yielding an empty list', () {
      final q = QuizQuestion.fromServerSession(
        {
          'question_id': 'qid-bad',
          'question_text': 'Q?',
          'options_displayed': 'not-a-list',
        },
        subject: 'physics',
        grade: '11',
      );
      expect(q.options, isEmpty);
    });
  });
}
