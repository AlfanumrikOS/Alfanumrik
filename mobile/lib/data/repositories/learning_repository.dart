import 'package:supabase_flutter/supabase_flutter.dart';

import '../../core/cache/cache_manager.dart';
import '../../core/network/api_result.dart';
import '../models/chapter.dart';

class LearningRepository {
  final SupabaseClient _client;
  final CacheManager _cache;

  LearningRepository({
    SupabaseClient? client,
    CacheManager? cache,
  })  : _client = client ?? Supabase.instance.client,
        _cache = cache ?? CacheManager();

  /// Fetch chapters for a subject + grade
  Future<ApiResult<List<Chapter>>> getChapters({
    required String subjectCode,
    required String grade,
  }) async {
    try {
      final cacheKey = 'chapters_${subjectCode}_$grade';
      final cached = _cache.getList<Chapter>(cacheKey, Chapter.fromJson);
      if (cached != null) return ApiSuccess(cached);

      final res = await _client
          .from('chapters')
          .select('id, title, title_hi, chapter_number, subject_code, grade, description')
          .eq('subject_code', subjectCode)
          .eq('grade', grade)
          .eq('is_active', true)
          .order('chapter_number');

      final chapters = (res as List<dynamic>)
          .map((e) => Chapter.fromJson(e as Map<String, dynamic>))
          .toList(growable: false);

      await _cache.put(cacheKey, res);
      return ApiSuccess(chapters);
    } catch (e) {
      return ApiFailure('Failed to load chapters: ${e.toString()}');
    }
  }

  /// Fetch topics for a chapter
  Future<ApiResult<List<Topic>>> getTopics(String chapterId) async {
    try {
      final cacheKey = 'topics_$chapterId';
      final cached = _cache.getList<Topic>(cacheKey, Topic.fromJson);
      if (cached != null) return ApiSuccess(cached);

      final res = await _client
          .from('topics')
          .select('id, chapter_id, title, title_hi, topic_order, concept_text, concept_text_hi')
          .eq('chapter_id', chapterId)
          .eq('is_active', true)
          .order('topic_order');

      final topics = (res as List<dynamic>)
          .map((e) => Topic.fromJson(e as Map<String, dynamic>))
          .toList(growable: false);

      await _cache.put(cacheKey, res);
      return ApiSuccess(topics);
    } catch (e) {
      return ApiFailure('Failed to load topics: ${e.toString()}');
    }
  }

  /// Get concept content for a specific topic
  Future<ApiResult<Topic>> getTopicContent(String topicId) async {
    try {
      final cacheKey = 'topic_$topicId';
      final cached = _cache.get<Topic>(cacheKey, Topic.fromJson);
      if (cached != null) return ApiSuccess(cached);

      final res = await _client
          .from('topics')
          .select()
          .eq('id', topicId)
          .single();

      final topic = Topic.fromJson(res);
      await _cache.put(cacheKey, res);
      return ApiSuccess(topic);
    } catch (e) {
      return ApiFailure('Failed to load content: ${e.toString()}');
    }
  }

  /// Mark topic as completed + earn XP
  Future<ApiResult<void>> markCompleted({
    required String studentId,
    required String topicId,
  }) async {
    try {
      await _client.from('student_topic_progress').upsert({
        'student_id': studentId,
        'topic_id': topicId,
        'is_completed': true,
        'completed_at': DateTime.now().toIso8601String(),
      });

      // Award XP
      try {
        await _client.rpc('add_xp', params: {
          'p_student_id': studentId,
          'p_amount': 10,
          'p_source': 'topic_mastered',
        });
      } catch (_) {
        // XP is best-effort
      }

      return const ApiSuccess(null);
    } catch (e) {
      return ApiFailure('Failed to save progress: ${e.toString()}');
    }
  }
}
