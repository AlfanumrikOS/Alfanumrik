import 'package:supabase_flutter/supabase_flutter.dart';

import '../../core/network/api_result.dart';
import '../models/pyq_models.dart';

/// PYQ (Previous Year Questions) repository.
///
/// Confirmed against `apps/host/src/app/(student)/pyq/page.tsx`: PYQ reads
/// directly from `question_bank` — it does NOT go through the exam_papers /
/// `start_mock_test_attempt` dynamic-assembly system that Phase 2.2 rebuilt.
/// Two-step lookup mirrors the web exactly:
///   1. Try questions tagged with the selected year (`tags` contains the
///      year as a string) for the subject+grade.
///   2. If none found, fall back to ANY question_bank rows for the
///      subject+grade (flagged `isFallback: true` so the UI can show the
///      same "From question bank" banner the web shows).
class PyqRepository {
  final SupabaseClient _client;

  static const _selectColumns =
      'id, question_text, question_hi, options, correct_answer_index, '
      'explanation, explanation_hi, difficulty, bloom_level, tags';

  PyqRepository({SupabaseClient? client})
      : _client = client ?? Supabase.instance.client;

  Future<ApiResult<PyqFetchResult>> fetchQuestions({
    required String subject,
    required String grade,
    required int year,
  }) async {
    try {
      final tagged = await _client
          .from('question_bank')
          .select(_selectColumns)
          .eq('subject', subject)
          .eq('grade', grade)
          .contains('tags', [year.toString()])
          .limit(30);

      final taggedList = (tagged as List<dynamic>)
          .map((e) => PyqQuestion.fromJson(Map<String, dynamic>.from(e as Map)))
          .toList(growable: false);

      if (taggedList.isNotEmpty) {
        return ApiSuccess(PyqFetchResult(questions: taggedList, isFallback: false));
      }

      final fallback = await _client
          .from('question_bank')
          .select(_selectColumns)
          .eq('subject', subject)
          .eq('grade', grade)
          .limit(25);

      final fallbackList = (fallback as List<dynamic>)
          .map((e) => PyqQuestion.fromJson(Map<String, dynamic>.from(e as Map)))
          .toList(growable: false);

      return ApiSuccess(
        PyqFetchResult(questions: fallbackList, isFallback: fallbackList.isNotEmpty),
      );
    } catch (e) {
      return ApiFailure('Failed to load PYQ questions: ${e.toString()}');
    }
  }
}
