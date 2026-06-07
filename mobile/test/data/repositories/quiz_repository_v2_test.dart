// Unit tests for the `useV2`-ON quiz path's pure logic (Wave 2.3b):
//   * QuizRepository.buildV2SubmitItems — the per-question submit-item mapper
//     that forwards the REAL time_taken_seconds + tapped index to
//     POST /v2/quiz/submit (P3 anti-cheat needs untransformed timings).
//   * QuizQuestion.fromV2Question / .fromV2StartQuestion — map the generated
//     DTOs onto the mobile model, asserting the correct index is NEVER exposed
//     (P1+P6: server-authoritative correctness; -1 sentinel).
//   * QuizResult.fromV2 — maps the server submit result onto the mobile model
//     VERBATIM (score/XP/correct/total/flagged come straight from the server,
//     never computed on-device).
//
// These mirror the wire-shape philosophy of quiz_repository_test.dart: they
// exercise the static/pure transforms without a network. The Dio-backed
// branches are covered by the contract codegen + the web /v2 route tests.

import 'package:alfanumrik_api_v2/alfanumrik_api_v2.dart' as v2;
import 'package:built_collection/built_collection.dart';
import 'package:built_value/json_object.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:alfanumrik/data/models/quiz_question.dart';
import 'package:alfanumrik/data/repositories/quiz_repository.dart';

void main() {
  group('QuizRepository.buildV2SubmitItems (POST /v2/quiz/submit items)', () {
    test('forwards the tapped index + REAL time_spent without transform', () {
      // P3: the device must NOT clamp/transform per-question timings — the
      // server runs the 3s-average anti-cheat check on the true values.
      final items = QuizRepository.buildV2SubmitItems([
        {'question_id': 'q1', 'selected_displayed_index': 2, 'time_spent': 7},
        {'question_id': 'q2', 'selected_displayed_index': 0, 'time_spent': 41},
      ]);
      expect(items, hasLength(2));
      expect(items[0].questionId, 'q1');
      expect(items[0].selectedOption, 2);
      expect(items[0].timeTakenSeconds, 7);
      expect(items[1].questionId, 'q2');
      expect(items[1].selectedOption, 0);
      expect(items[1].timeTakenSeconds, 41,
          reason: 'real timings flow through verbatim (no clamp) for P3');
    });

    test('accepts the v1 field name selected_option as input', () {
      final items = QuizRepository.buildV2SubmitItems([
        {'question_id': 'q1', 'selected_option': 3, 'time_spent': 9},
      ]);
      expect(items.single.selectedOption, 3);
      expect(items.single.timeTakenSeconds, 9);
    });

    test('defaults a skipped question to -1 (unanswered sentinel)', () {
      // P3: response count must equal question count. A skipped question still
      // produces an item — with -1 so the server treats it as wrong.
      final items = QuizRepository.buildV2SubmitItems([
        {'question_id': 'q-skipped', 'time_spent': 0},
      ]);
      expect(items.single.selectedOption, -1);
      expect(items.single.timeTakenSeconds, 0);
    });
  });

  group('QuizQuestion.fromV2Question (GET /v2/quiz/questions DTO)', () {
    test('maps options and hides the correct index (-1 sentinel, P1+P6)', () {
      final dto = v2.QuizQuestion((b) => b
        ..questionId = 'qid-1'
        ..questionText = 'What is 2 + 2?'
        ..questionHi = '2 + 2 = ?'
        ..questionType = 'mcq'
        ..options.replace(const ['3', '4', '5', '6'])
        ..difficulty = 2
        ..bloomLevel = 'remember'
        ..explanation = 'Addition.');

      final q = QuizQuestion.fromV2Question(dto, subject: 'math', grade: '6');
      expect(q.id, 'qid-1');
      expect(q.questionText, 'What is 2 + 2?');
      expect(q.questionTextHi, '2 + 2 = ?');
      expect(q.options, ['3', '4', '5', '6']);
      expect(q.subject, 'math');
      expect(q.grade, '6');
      expect(q.difficulty, 2);
      // CRITICAL: the /v2 questions route never returns correct_answer_index.
      expect(q.correctIndex, -1,
          reason: 'P6: correct index is never revealed to the client');
    });

    test('falls back bloom_level to "remember" when absent', () {
      final dto = v2.QuizQuestion((b) => b
        ..questionId = 'qid-2'
        ..questionText = 'Q?'
        ..questionType = 'mcq'
        ..options.replace(const ['a', 'b', 'c', 'd'])
        ..difficulty = 1);
      final q = QuizQuestion.fromV2Question(dto, subject: 's', grade: '7');
      expect(q.bloomLevel, 'remember');
    });
  });

  group('QuizQuestion.fromV2StartQuestion (POST /v2/quiz/start DTO)', () {
    test('uses server-shuffled options_displayed; correct index stays -1', () {
      final dto = v2.QuizStartQuestion((b) => b
        ..questionId = 'qid-9'
        ..questionText = 'Q?'
        ..questionType = 'mcq'
        ..optionsDisplayed.replace(const ['o1', 'o2', 'o3', 'o4'])
        ..difficulty = 3);

      final q =
          QuizQuestion.fromV2StartQuestion(dto, subject: 'physics', grade: '11');
      expect(q.id, 'qid-9');
      expect(q.options, ['o1', 'o2', 'o3', 'o4']);
      expect(q.correctIndex, -1,
          reason: 'P1+P6: server owns the shuffle + correctness');
      expect(q.subject, 'physics');
      expect(q.grade, '11');
      expect(q.difficulty, 3);
    });
  });

  group('QuizResult.fromV2 (POST /v2/quiz/submit result — server-authoritative)',
      () {
    v2.QuizSubmitResult buildResult({
      required int correct,
      required int total,
      required num scorePercent,
      required num xpEarned,
      bool flagged = false,
      bool idempotentReplay = false,
      bool? xpCapped,
      List<Map<String, Object?>> questions = const [],
    }) {
      return v2.QuizSubmitResult((b) {
        b
          ..correct = correct
          ..total = total
          ..scorePercent = scorePercent
          ..xpEarned = xpEarned
          ..flagged = flagged
          ..idempotentReplay = idempotentReplay
          ..markingAuthenticityPath = 'v2'
          ..schemaVersion = v2.QuizSubmitResultSchemaVersionEnum.n1
          ..sessionId = 'sess-1';
        if (xpCapped != null) b.xpCapped = xpCapped;
        b.questions.replace(questions.map((row) {
          return BuiltMap<String, JsonObject?>({
            for (final e in row.entries)
              e.key: e.value == null ? null : JsonObject(e.value!),
          });
        }));
      });
    }

    test('reads score / xp / correct / total / flagged VERBATIM (P1+P2)', () {
      final res = buildResult(
        correct: 7,
        total: 10,
        scorePercent: 70,
        xpEarned: 90,
        flagged: false,
      );
      final result =
          QuizResult.fromV2(res, const Duration(seconds: 120));
      expect(result.correctAnswers, 7);
      expect(result.totalQuestions, 10);
      expect(result.scorePercent, 70);
      expect(result.xpEarned, 90);
      expect(result.flagged, isFalse);
      expect(result.sessionId, 'sess-1');
      expect(result.timeTaken, const Duration(seconds: 120));
    });

    test('maps the per-question review rows from the generic JSON map', () {
      final res = buildResult(
        correct: 1,
        total: 2,
        scorePercent: 50,
        xpEarned: 10,
        questions: [
          {
            'question_id': 'qid-1',
            'is_correct': true,
            'correct_option_text': 'Photosynthesis',
            'correct_original_index': 2,
            'selected_displayed_index': 1,
            'selected_original_index': 2,
          },
          {
            'question_id': 'qid-2',
            'is_correct': false,
            'correct_option_text': '42',
            'correct_original_index': 0,
            'selected_displayed_index': 3,
            'selected_original_index': 1,
          },
        ],
      );
      final result = QuizResult.fromV2(res, const Duration(seconds: 60));
      expect(result.review, hasLength(2));
      // P1+P6: the review rows are the AUTHORITATIVE source of
      // correct_option_text — displayed verbatim, never derived on-device.
      expect(result.review[0].questionId, 'qid-1');
      expect(result.review[0].isCorrect, isTrue);
      expect(result.review[0].correctOptionText, 'Photosynthesis');
      expect(result.review[1].isCorrect, isFalse);
      expect(result.review[1].correctOptionText, '42');
    });

    test('flagged + zero xp surfaces as-is (P3 server policy)', () {
      final res = buildResult(
        correct: 5,
        total: 5,
        scorePercent: 100,
        xpEarned: 0,
        flagged: true,
      );
      final result = QuizResult.fromV2(res, const Duration(seconds: 8));
      expect(result.flagged, isTrue);
      expect(result.xpEarned, 0,
          reason: 'P3: flagged sessions earn zero XP regardless of score');
    });

    test('surfaces idempotent_replay so the UI skips XP re-animation', () {
      final res = buildResult(
        correct: 3,
        total: 3,
        scorePercent: 100,
        xpEarned: 80,
        idempotentReplay: true,
      );
      final result = QuizResult.fromV2(res, const Duration(seconds: 12));
      expect(result.idempotentReplay, isTrue);
    });

    test('surfaces xp_capped when the daily cap fired', () {
      final res = buildResult(
        correct: 10,
        total: 10,
        scorePercent: 100,
        xpEarned: 200,
        xpCapped: true,
      );
      final result = QuizResult.fromV2(res, const Duration(seconds: 90));
      expect(result.xpCapped, isTrue);
    });
  });
}
