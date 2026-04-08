import 'package:supabase_flutter/supabase_flutter.dart';

import '../../core/cache/cache_manager.dart';
import '../../core/network/api_result.dart';
import '../models/quiz_question.dart';

class QuizRepository {
  final SupabaseClient _client;
  final CacheManager _cache;

  QuizRepository({
    SupabaseClient? client,
    CacheManager? cache,
  })  : _client = client ?? Supabase.instance.client,
        _cache = cache ?? CacheManager();

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

  /// Submit quiz attempt via submit_quiz_results RPC.
  ///
  /// Score (P1), XP (P2), anti-cheat (P3), and atomicity (P4) are all
  /// enforced server-side by atomic_quiz_profile_update inside the RPC.
  /// Do NOT compute score or XP here — use the values the server returns.
  ///
  /// [grade] must be a String ('6'..'12') — never an int (P5).
  /// [responses] is a list of per-question answer objects:
  ///   { 'question_id': String, 'selected_option': int, 'time_spent': int }
  Future<ApiResult<QuizResult>> submitAttempt({
    required String studentId,
    required String subject,
    required String grade,
    required List<Map<String, dynamic>> responses,
    required int timeTakenSeconds,
    String? topicTitle,
    int? chapterNumber,
  }) async {
    try {
      final dynamic raw = await _client.rpc('submit_quiz_results', params: {
        'p_student_id': studentId,
        'p_subject': subject,
        'p_grade': grade,
        'p_topic': topicTitle,
        'p_chapter': chapterNumber,
        'p_responses': responses,
        'p_time': timeTakenSeconds,
      });

      // The RPC returns a JSONB object; Supabase Flutter deserialises it as
      // Map<String, dynamic>.
      final rpc = (raw as Map<String, dynamic>);

      return ApiSuccess(
        QuizResult.fromRpc(rpc, Duration(seconds: timeTakenSeconds)),
      );
    } catch (e) {
      return ApiFailure('Failed to submit quiz: ${e.toString()}');
    }
  }
}
