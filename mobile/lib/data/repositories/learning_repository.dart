import 'package:alfanumrik_api_v2/alfanumrik_api_v2.dart';
import 'package:dio/dio.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import '../../core/cache/cache_manager.dart';
import '../../core/constants/coin_rules.dart';
import '../../core/network/api_result.dart';
import '../../core/network/v2_api_client.dart';
import '../models/chapter.dart';

/// Learning repository — chapters / topics / concept content + topic
/// completion.
///
/// Gated by server-assigned generated-client injection:
///   * OFF (default) — BYTE-IDENTICAL legacy path: reads the `chapters` /
///     `topics` tables directly and awards completion via the `add_xp` RPC.
///     The generated `/v2` client is never constructed or called.
///   * ON — chapters come from `GET /v2/learn/curriculum` and concept prose
///     from `GET /v2/learn/concept` via the generated [LearnApi]. Completion
///     still flows through the same legacy write path (no `/v2` write surface
///     exists yet for topic progress).
class LearningRepository {
  final SupabaseClient _client;
  final CacheManager _cache;

  /// Generated `/v2` client. Null on the flag-OFF path so the legacy build
  /// never constructs the dart-dio client.
  final V2ApiClient? _v2;

  LearningRepository({
    SupabaseClient? client,
    CacheManager? cache,
    V2ApiClient? v2Client,
  })  : _client = client ?? Supabase.instance.client,
        _cache = cache ?? CacheManager(),
        _v2 = v2Client;

  /// Fetch chapters for a subject + grade.
  ///
  /// When a generated client is present this maps `GET /v2/learn/curriculum`
  /// tree onto the [Chapter] model (synthesising the navigation `id` from the
  /// chapter number so the concept route can resolve it). When OFF it reads
  /// the `chapters` table verbatim (legacy path).
  Future<ApiResult<List<Chapter>>> getChapters({
    required String subjectCode,
    required String grade,
  }) async {
    if (_v2 != null) {
      return _getChaptersV2(subjectCode: subjectCode, grade: grade);
    }

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

  /// `useV2`-ON chapters via `GET /v2/learn/curriculum`.
  ///
  /// The route returns the plan-gated subjects→chapters→topics tree. We pick
  /// the requested subject and map its chapters onto the [Chapter] model. The
  /// curriculum chapter carries no row id, so the navigation `id` is the
  /// chapter NUMBER as a string — the concept screen parses it back to fetch
  /// `GET /v2/learn/concept?chapter=<n>`.
  Future<ApiResult<List<Chapter>>> _getChaptersV2({
    required String subjectCode,
    required String grade,
  }) async {
    try {
      final resp = await _v2!.learnApi.getLearnCurriculum(subject: subjectCode);
      final body = resp.data;
      if (body == null) {
        return const ApiFailure('Failed to load chapters: empty response');
      }

      // Find the matching subject (the route may echo the whole tree). Match
      // on code; fall back to the first subject if only one was returned.
      CurriculumSubject? subj;
      for (final s in body.subjects) {
        if (s.code == subjectCode) {
          subj = s;
          break;
        }
      }
      subj ??= body.subjects.isNotEmpty ? body.subjects.first : null;
      if (subj == null) return const ApiSuccess(<Chapter>[]);

      final chapters = <Chapter>[];
      for (final c in subj.chapters) {
        final number = c.chapterNumber ?? 0;
        chapters.add(Chapter(
          // Navigation key the concept route resolves (chapter number string).
          id: number.toString(),
          title: c.title ?? '',
          titleHi: c.titleHi,
          chapterNumber: number,
          subjectCode: subjectCode,
          grade: body.grade ?? grade,
          topicCount: c.topics.length,
        ));
      }
      return ApiSuccess(chapters);
    } catch (e) {
      return ApiFailure('Failed to load chapters: ${_describe(e)}');
    }
  }

  /// `useV2`-ON concept content via `GET /v2/learn/concept`.
  ///
  /// Maps the NCERT chapter markdown onto a [Topic] so the existing concept
  /// screen renders unchanged. [chapterId] is the chapter NUMBER string the
  /// curriculum mapping produced; on the legacy path concept content comes
  /// from [getTopicContent] instead (gated by the provider).
  Future<ApiResult<Topic>> getConceptV2({
    required String subjectCode,
    required String grade,
    required String chapterId,
  }) async {
    if (_v2 == null) {
      return const ApiFailure('Concept v2 client unavailable');
    }
    final chapterNum = int.tryParse(chapterId.trim());
    if (chapterNum == null) {
      return const ApiFailure('Invalid chapter reference');
    }
    try {
      final resp = await _v2.learnApi.getLearnConcept(
        subject: subjectCode,
        grade: grade,
        chapter: chapterNum,
      );
      final body = resp.data;
      if (body == null) {
        return const ApiFailure('Failed to load content: empty response');
      }

      final topic = Topic(
        id: chapterId,
        chapterId: chapterId,
        title: body.subject,
        titleHi: null,
        topicOrder: body.chapterNumber,
        conceptText: body.markdown,
        conceptTextHi: null,
      );
      return ApiSuccess(topic);
    } catch (e) {
      return ApiFailure('Failed to load content: ${_describe(e)}');
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

  /// Mark topic as completed and award Foxy Coins.
  ///
  /// Awards [CoinRewards.studyTaskComplete] coins via the `add_xp` RPC.
  /// The RPC name is legacy — it handles both XP and Foxy Coins depending
  /// on the server version. The amount matches web `coin-rules.ts`
  /// `study_task_complete = 5`.
  ///
  /// Legacy RPC name: keep using `add_xp` until the backend migrates the
  /// route to `award_coins`.
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

      // Award Foxy Coins (CoinRewards.studyTaskComplete = 5)
      // Using add_xp RPC for backward compatibility — server routes this
      // to the appropriate reward system.
      try {
        await _client.rpc('add_xp', params: {
          'p_student_id': studentId,
          'p_amount': CoinRewards.studyTaskComplete,
          'p_source': 'topic_mastered',
        });
      } catch (_) {
        // Coin award is best-effort
      }

      return const ApiSuccess(null);
    } catch (e) {
      return ApiFailure('Failed to save progress: ${e.toString()}');
    }
  }

  /// Extract a useful message from a thrown error. DioException server bodies
  /// carry a structured `{ error: ... }` payload; everything else falls back
  /// to `toString`. Message text only — never PII (P13).
  static String _describe(Object e) {
    if (e is DioException) {
      final data = e.response?.data;
      if (data is Map && data['error'] != null) {
        return data['error'].toString();
      }
      if (data is String && data.isNotEmpty) return data;
      return e.message ?? e.toString();
    }
    return e.toString();
  }
}
