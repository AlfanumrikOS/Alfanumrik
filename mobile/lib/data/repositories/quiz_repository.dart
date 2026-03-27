import 'package:supabase_flutter/supabase_flutter.dart';

import '../../core/network/api_result.dart';
import '../models/quiz_question.dart';

class QuizRepository {
  final SupabaseClient _client;

  QuizRepository({
    SupabaseClient? client,
  })  : _client = client ?? Supabase.instance.client;

  /// Fetch quiz questions for a subject + grade
  Future<ApiResult<List<QuizQuestion>>> getQuestions({
    required String subject,
    required String grade,
    int count = 10,
    String? chapterTitle,
  }) async {
    try {
      var query = _client
          .from('question_bank')
          .select()
          .eq('subject', subject)
          .eq('grade', grade)
          .eq('is_active', true);

      if (chapterTitle != null) {
        query = query.eq('chapter_title', chapterTitle);
      }

      // Random selection via Supabase — order by random()
      final res = await query.limit(count * 3); // over-fetch for randomization

      final allQuestions = (res as List<dynamic>)
          .map((e) => QuizQuestion.fromJson(e as Map<String, dynamic>))
          .toList();

      // Shuffle and take `count`
      allQuestions.shuffle();
      final selected = allQuestions.take(count).toList(growable: false);

      return ApiSuccess(selected);
    } catch (e) {
      return ApiFailure('Failed to load questions: ${e.toString()}');
    }
  }

  /// Submit quiz attempt and award XP
  Future<ApiResult<QuizResult>> submitAttempt({
    required String studentId,
    required String subject,
    required String grade,
    required int totalQuestions,
    required int correctAnswers,
    required int timeTakenSeconds,
  }) async {
    try {
      final score =
          totalQuestions > 0 ? (correctAnswers / totalQuestions * 100) : 0.0;

      await _client.from('quiz_attempts').insert({
        'student_id': studentId,
        'subject': subject,
        'grade': grade,
        'total_questions': totalQuestions,
        'correct_answers': correctAnswers,
        'score': score,
        'time_taken_seconds': timeTakenSeconds,
      });

      // Calculate XP
      int xp = correctAnswers * 5;
      if (score >= 80) xp += 10; // Bonus for high score
      if (score == 100) xp += 20; // Perfect bonus

      // Award XP
      try {
        await _client.rpc('add_xp', params: {
          'p_student_id': studentId,
          'p_amount': xp,
          'p_source': 'quiz_$subject',
        });
      } catch (_) {
        // XP is best-effort
      }

      // Increment daily usage
      try {
        await _client.rpc('increment_daily_usage', params: {
          'p_student_id': studentId,
          'p_feature': 'quiz',
        });
      } catch (_) {}

      return ApiSuccess(QuizResult(
        totalQuestions: totalQuestions,
        correctAnswers: correctAnswers,
        xpEarned: xp,
        timeTaken: Duration(seconds: timeTakenSeconds),
      ));
    } catch (e) {
      return ApiFailure('Failed to submit quiz: ${e.toString()}');
    }
  }
}
