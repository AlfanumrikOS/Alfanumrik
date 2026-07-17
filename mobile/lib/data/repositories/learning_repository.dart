import 'package:alfanumrik_api_v2/alfanumrik_api_v2.dart';
import 'package:dio/dio.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import '../../core/cache/cache_manager.dart';
import '../../core/constants/api_constants.dart';
import '../../core/constants/coin_rules.dart';
import '../../core/network/api_result.dart';
import '../../core/network/v2_api_client.dart';
import '../models/chapter.dart';
import 'curriculum_version_repository.dart';

/// How a Learn content payload was served, so the UI can render the correct
/// state (live vs a non-blocking "content as of {date}" offline chip).
enum LearnServe {
  /// Fresh from network, or cache confirmed current by the version poll.
  live,

  /// Served from cache while offline (or the version poll failed) and still
  /// inside the STALE_TTL grace window. The UI shows the "as of {date}" chip.
  staleOffline,
}

/// Envelope for version-anchored Learn content. Carries the payload plus how it
/// was served so the screen can pick the right state without recomputing
/// anything.
class LearnData<T> {
  final T data;
  final LearnServe serve;

  /// When [staleOffline], the timestamp the cached content was fetched.
  final DateTime? asOf;

  const LearnData(this.data, {this.serve = LearnServe.live, this.asOf});

  bool get isStaleOffline => serve == LearnServe.staleOffline;
}

/// Thrown when the app is offline (or the version poll failed) AND there is no
/// cached content within the STALE_TTL grace window. The Learn screens catch
/// this to render the dedicated Offline state — NEVER a silent stale serve and
/// NEVER a static fallback.
class LearnOfflineException implements Exception {
  const LearnOfflineException();
  @override
  String toString() => 'offline';
}

/// Thrown by a network fetch with an already-cleaned, user-facing message
/// (message text only — never PII, P13). Rendered directly in the Error state.
class LearnFetchException implements Exception {
  final String message;
  const LearnFetchException(this.message);
  @override
  String toString() => message;
}

/// Learning repository — chapters / topics / concept content + topic
/// completion.
///
/// Gated by server-assigned generated-client injection:
///   * OFF (default) — legacy path: reads the `chapters` / `topics` tables
///     directly and awards completion via the `add_xp` RPC. The generated `/v2`
///     client is never constructed or called.
///   * ON — chapters come from `GET /v2/learn/curriculum` and concept prose
///     from `GET /v2/learn/concept` via the generated [LearnApi]. Completion
///     still flows through the same legacy write path.
///
/// ── Version-anchored content cache ──────────────────────────────────────────
/// The near-static Learn content (chapters / concept prose) is cached with a
/// per-scope version stamp instead of a blind 5-minute TTL. On each read the
/// repository polls [CurriculumVersionRepository] for the `<subject>-<grade>`
/// scope version and:
///   * version matches stored  → serve cache instantly (no network),
///   * server newer / no cache → refetch, then ATOMICALLY purge+replace the
///     scope so a partial purge can never resurface old syllabus,
///   * offline / poll failed   → serve cache within [ApiConstants.learnCacheStaleTtl]
///     (with the "as of {date}" chip) else REFUSE via [LearnOfflineException].
/// Set `--dart-define=VERSION_ANCHORED_LEARN_CACHE=false` to revert to the
/// previous blind-TTL behaviour.
class LearningRepository {
  final SupabaseClient _client;
  final CacheManager _cache;
  final CurriculumVersionRepository _versions;

  /// Generated `/v2` client. Null on the flag-OFF path so the legacy build
  /// never constructs the dart-dio client.
  final V2ApiClient? _v2;

  LearningRepository({
    SupabaseClient? client,
    CacheManager? cache,
    CurriculumVersionRepository? versions,
    V2ApiClient? v2Client,
  })  : _client = client ?? Supabase.instance.client,
        _cache = cache ?? CacheManager(),
        _versions = versions ?? CurriculumVersionRepository(),
        _v2 = v2Client;

  /// `<subject_code>-<grade>` scope key — matches the server's curriculum-version
  /// scope keying. Every cached content entry for a subject+grade is tagged with
  /// this so purge-by-scope removes them together.
  static String _scopeKey(String subjectCode, String grade) =>
      '$subjectCode-$grade';

  /// Cache key for a single concept/topic content payload.
  ///
  /// The subject+grade MUST be in the key. [getConceptV2] identifies a chapter by
  /// its NUMBER (the v2 curriculum tree carries no row id, so `_fetchChaptersV2`
  /// sets `id: number.toString()`), and chapter numbers restart at 1 for every
  /// subject and grade. A bare `topic_<id>` key therefore collides across scopes:
  /// math-8 ch3 and science-8 ch3 both map to `topic_3`, so one subject would
  /// serve the other subject's prose.
  ///
  /// This is the first of two independent guards. The second — the
  /// `cached.scope == scope` check in [_serveVersioned] — catches the same class
  /// of bug even if an entry is somehow written under a colliding key, because
  /// the version stamp ALONE cannot distinguish scopes: after a bulk content
  /// operation the watermark stamps the same `now()` across every scope, so
  /// equal versions across subjects is the NORMAL case, not a rare one.
  static String _contentCacheKey(
    String subjectCode,
    String grade,
    String id,
  ) =>
      'topic_${subjectCode}_${grade}_$id';

  /// Test-visible view of [_contentCacheKey]. The invariant worth pinning is
  /// format-independent: two different scopes must never produce the same key
  /// for the same chapter id.
  static String contentCacheKeyForTest(
    String subjectCode,
    String grade,
    String id,
  ) =>
      _contentCacheKey(subjectCode, grade, id);

  // ── Chapters ───────────────────────────────────────────────────────────────

  /// Fetch chapters for a subject + grade (version-anchored).
  ///
  /// Source depends on the generated-client flag (v2 curriculum tree vs the
  /// `chapters` table), but both flow through the same version-anchored cache
  /// decision.
  Future<LearnData<List<Chapter>>> getChapters({
    required String subjectCode,
    required String grade,
  }) async {
    final cacheKey = 'chapters_${subjectCode}_$grade';

    Future<(List<Chapter>, dynamic)> fetchFresh() async {
      final chapters = _v2 != null
          ? await _fetchChaptersV2(subjectCode: subjectCode, grade: grade)
          : await _fetchChaptersLegacy(subjectCode: subjectCode, grade: grade);
      return (chapters, chapters.map(_chapterToCacheJson).toList());
    }

    List<Chapter> decode(dynamic d) => (d as List)
        .cast<Map<String, dynamic>>()
        .map(Chapter.fromJson)
        .toList(growable: false);

    if (!ApiConstants.versionAnchoredLearnCache) {
      return _blindTtl<List<Chapter>>(
        cacheKey: cacheKey,
        decodeCache: decode,
        fetchFresh: fetchFresh,
      );
    }
    return _serveVersioned<List<Chapter>>(
      scope: _scopeKey(subjectCode, grade),
      cacheKey: cacheKey,
      decodeCache: decode,
      fetchFresh: fetchFresh,
    );
  }

  /// Legacy `chapters`-table read (flag OFF, or v2 client absent). Throws
  /// [LearnFetchException] on failure so the Error state renders a clean message.
  Future<List<Chapter>> _fetchChaptersLegacy({
    required String subjectCode,
    required String grade,
  }) async {
    try {
      final res = await _client
          .from('chapters')
          .select(
              'id, title, title_hi, chapter_number, subject_code, grade, description')
          .eq('subject_code', subjectCode)
          .eq('grade', grade)
          .eq('is_active', true)
          .order('chapter_number');

      return (res as List<dynamic>)
          .map((e) => Chapter.fromJson(e as Map<String, dynamic>))
          .toList(growable: false);
    } catch (e) {
      throw LearnFetchException('Failed to load chapters: ${_describe(e)}');
    }
  }

  /// `useV2`-ON chapters via `GET /v2/learn/curriculum`.
  ///
  /// The route returns the plan-gated subjects→chapters→topics tree. We pick the
  /// requested subject and map its chapters onto the [Chapter] model. The
  /// curriculum chapter carries no row id, so the navigation `id` is the chapter
  /// NUMBER as a string — the concept screen parses it back to fetch
  /// `GET /v2/learn/concept?chapter=<n>`.
  Future<List<Chapter>> _fetchChaptersV2({
    required String subjectCode,
    required String grade,
  }) async {
    try {
      final resp = await _v2!.learnApi.getLearnCurriculum(subject: subjectCode);
      final body = resp.data;
      if (body == null) {
        throw const LearnFetchException(
            'Failed to load chapters: empty response');
      }

      // Find the matching subject (the route may echo the whole tree). Match on
      // code; fall back to the first subject if only one was returned.
      CurriculumSubject? subj;
      for (final s in body.subjects) {
        if (s.code == subjectCode) {
          subj = s;
          break;
        }
      }
      subj ??= body.subjects.isNotEmpty ? body.subjects.first : null;
      if (subj == null) return const <Chapter>[];

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
      return chapters;
    } on LearnFetchException {
      rethrow;
    } catch (e) {
      throw LearnFetchException('Failed to load chapters: ${_describe(e)}');
    }
  }

  // ── Concept content (v2 + legacy) ────────────────────────────────────────────

  /// `useV2`-ON concept content via `GET /v2/learn/concept` (version-anchored).
  ///
  /// Maps the NCERT chapter markdown onto a [Topic] so the existing concept
  /// screen renders unchanged. [chapterId] is the chapter NUMBER string the
  /// curriculum mapping produced.
  Future<LearnData<Topic?>> getConceptV2({
    required String subjectCode,
    required String grade,
    required String chapterId,
  }) async {
    // Scope-namespaced: `chapterId` is a chapter NUMBER, which repeats across
    // every subject+grade (see [_contentCacheKey]).
    final cacheKey = _contentCacheKey(subjectCode, grade, chapterId);

    Future<(Topic?, dynamic)> fetchFresh() async {
      final topic = await _fetchConceptV2(
        subjectCode: subjectCode,
        grade: grade,
        chapterId: chapterId,
      );
      return (topic, _topicToCacheJson(topic));
    }

    Topic? decode(dynamic d) => Topic.fromJson(d as Map<String, dynamic>);

    if (!ApiConstants.versionAnchoredLearnCache) {
      return _blindTtl<Topic?>(
        cacheKey: cacheKey,
        decodeCache: decode,
        fetchFresh: fetchFresh,
      );
    }
    return _serveVersioned<Topic?>(
      scope: _scopeKey(subjectCode, grade),
      cacheKey: cacheKey,
      decodeCache: decode,
      fetchFresh: fetchFresh,
    );
  }

  Future<Topic> _fetchConceptV2({
    required String subjectCode,
    required String grade,
    required String chapterId,
  }) async {
    if (_v2 == null) {
      throw const LearnFetchException('Concept v2 client unavailable');
    }
    final chapterNum = int.tryParse(chapterId.trim());
    if (chapterNum == null) {
      throw const LearnFetchException('Invalid chapter reference');
    }
    try {
      final resp = await _v2.learnApi.getLearnConcept(
        subject: subjectCode,
        grade: grade,
        chapter: chapterNum,
      );
      final body = resp.data;
      if (body == null) {
        throw const LearnFetchException(
            'Failed to load content: empty response');
      }
      return Topic(
        id: chapterId,
        chapterId: chapterId,
        title: body.subject,
        titleHi: null,
        topicOrder: body.chapterNumber,
        conceptText: body.markdown,
        conceptTextHi: null,
      );
    } on LearnFetchException {
      rethrow;
    } catch (e) {
      throw LearnFetchException('Failed to load content: ${_describe(e)}');
    }
  }

  /// Get concept content for a specific topic (legacy `topics`-table path,
  /// version-anchored). [subjectCode] + [grade] scope the cache/version check.
  Future<LearnData<Topic?>> getTopicContent({
    required String topicId,
    required String subjectCode,
    required String grade,
  }) async {
    // `topicId` is a row UUID here, so it is already globally unique and cannot
    // collide the way [getConceptV2]'s chapter number does. Namespaced anyway:
    // both paths share the `topic_` prefix, and keeping the key scope-shaped
    // keeps it consistent with the `cached.scope == scope` guard in
    // [_serveVersioned].
    final cacheKey = _contentCacheKey(subjectCode, grade, topicId);

    Future<(Topic?, dynamic)> fetchFresh() async {
      final topic = await _fetchTopicContentLegacy(topicId);
      return (topic, _topicToCacheJson(topic));
    }

    Topic? decode(dynamic d) => Topic.fromJson(d as Map<String, dynamic>);

    if (!ApiConstants.versionAnchoredLearnCache) {
      return _blindTtl<Topic?>(
        cacheKey: cacheKey,
        decodeCache: decode,
        fetchFresh: fetchFresh,
      );
    }
    return _serveVersioned<Topic?>(
      scope: _scopeKey(subjectCode, grade),
      cacheKey: cacheKey,
      decodeCache: decode,
      fetchFresh: fetchFresh,
    );
  }

  Future<Topic> _fetchTopicContentLegacy(String topicId) async {
    try {
      final res =
          await _client.from('topics').select().eq('id', topicId).single();
      return Topic.fromJson(res);
    } catch (e) {
      throw LearnFetchException('Failed to load content: ${_describe(e)}');
    }
  }

  // ── Topics list (legacy blind-TTL; not wired to any screen) ──────────────────

  /// Fetch topics for a chapter. This path is not currently rendered by any
  /// screen and lacks a subject+grade scope, so it retains the legacy blind
  /// 5-minute TTL via the volatile cache surface. If a topics-list screen is
  /// added, thread subject+grade through and route it via [_serveVersioned] like
  /// chapters/concept.
  ///
  /// CACHE-KEY COLLISION (audit finding — latent, not live). `topics_$chapterId`
  /// has the same defect [_contentCacheKey] fixes: if [chapterId] is ever a
  /// chapter NUMBER (as `_fetchChaptersV2` produces) rather than a row UUID, then
  /// math-8 ch3 and science-8 ch3 both key `topics_3` and cross-serve for up to
  /// 5 minutes. It is only latent because no screen calls this. Do NOT wire a
  /// topics-list screen to this method without scope-namespacing the key first.
  Future<ApiResult<List<Topic>>> getTopics(String chapterId) async {
    try {
      final cacheKey = 'topics_$chapterId';
      final cached = _cache.getList<Topic>(cacheKey, Topic.fromJson);
      if (cached != null) return ApiSuccess(cached);

      final res = await _client
          .from('topics')
          .select(
              'id, chapter_id, title, title_hi, topic_order, concept_text, concept_text_hi')
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

  // ── Version-anchored decision core ───────────────────────────────────────────

  /// The version-anchored serve/refetch/refuse decision for one content key.
  ///
  ///   * server version KNOWN and == stored AND the entry belongs to this scope
  ///     → serve cache instantly (no fetch).
  ///   * server version KNOWN and newer / no cache / wrong scope → fetch fresh,
  ///     then ATOMICALLY replace the scope (purge stale siblings + write the new
  ///     version).
  ///   * server version UNKNOWN (offline / poll failed) → serve cache while
  ///     within [ApiConstants.learnCacheStaleTtl] (staleOffline), else refuse
  ///     with [LearnOfflineException].
  Future<LearnData<T>> _serveVersioned<T>({
    required String scope,
    required String cacheKey,
    required T Function(dynamic decoded) decodeCache,
    required Future<(T, dynamic)> Function() fetchFresh,
  }) async {
    final serverVersion = await _versions.versionForScope(scope);
    final cached = await _cache.getContent<T>(cacheKey, decodeCache);

    if (serverVersion != null) {
      // Online with a known version.
      //
      // The scope check is NOT redundant with the version check. Versions are
      // not unique per scope: the watermark stamps the transaction's `now()`
      // across every scope a bulk content operation touched, so two subjects
      // sharing a version is the NORMAL post-bulk-op state. Matching on version
      // alone would let any entry that lands on this key — a colliding key, or a
      // `_blindTtl` entry written with the overloaded `scope: ''` / `version: 0`
      // sentinel against a server `0` ("scope never had content") — be served as
      // live content for the WRONG subject. Requiring the scope to match makes
      // the identity of the entry, not just its age, part of the decision.
      if (cached != null &&
          cached.version == serverVersion &&
          cached.scope == scope) {
        // Cache confirmed current AND known to belong to this scope — serve
        // instantly, spend zero data.
        return LearnData<T>(cached.data);
      }
      // No cache, or the server has newer content. Fetch fresh, THEN atomically
      // purge+replace the whole scope so a partial purge can never leave a mix
      // of old + new syllabus. If the fetch fails we do NOT purge and do NOT
      // serve the known-stale cache (that would be a silent stale serve) — the
      // error propagates to the Error state.
      final (value, cacheJson) = await fetchFresh();
      await _cache.replaceScope(
        scopeKey: scope,
        key: cacheKey,
        data: cacheJson,
        version: serverVersion,
      );
      return LearnData<T>(value);
    }

    // Version unknown → offline or the poll failed.
    if (cached != null &&
        DateTime.now().difference(cached.fetchedAt) <=
            ApiConstants.learnCacheStaleTtl) {
      return LearnData<T>(
        cached.data,
        serve: LearnServe.staleOffline,
        asOf: cached.fetchedAt,
      );
    }
    // No cache, or the cache is older than STALE_TTL → refuse.
    throw const LearnOfflineException();
  }

  /// Blind 5-minute TTL fallback (flag OFF / revert path). No version poll, no
  /// scope purge — mirrors the pre-change caching behaviour.
  Future<LearnData<T>> _blindTtl<T>({
    required String cacheKey,
    required T Function(dynamic decoded) decodeCache,
    required Future<(T, dynamic)> Function() fetchFresh,
  }) async {
    final cached = await _cache.getContent<T>(cacheKey, decodeCache);
    if (cached != null &&
        DateTime.now().difference(cached.fetchedAt) <=
            ApiConstants.cacheMaxAge) {
      return LearnData<T>(cached.data);
    }
    final (value, cacheJson) = await fetchFresh();
    await _cache.putContent(
      key: cacheKey,
      scopeKey: '',
      data: cacheJson,
      version: 0,
    );
    return LearnData<T>(value);
  }

  // ── Completion ───────────────────────────────────────────────────────────────

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

  // ── Cache serialization ──────────────────────────────────────────────────────

  /// Chapter → cache JSON (keys mirror [Chapter.fromJson]).
  static Map<String, dynamic> _chapterToCacheJson(Chapter c) => {
        'id': c.id,
        'title': c.title,
        'title_hi': c.titleHi,
        'chapter_number': c.chapterNumber,
        'subject_code': c.subjectCode,
        'grade': c.grade,
        'topic_count': c.topicCount,
        'completed_topics': c.completedTopics,
        'description': c.description,
      };

  /// Topic → cache JSON (keys mirror [Topic.fromJson]).
  static Map<String, dynamic> _topicToCacheJson(Topic t) => {
        'id': t.id,
        'chapter_id': t.chapterId,
        'title': t.title,
        'title_hi': t.titleHi,
        'topic_order': t.topicOrder,
        'concept_text': t.conceptText,
        'concept_text_hi': t.conceptTextHi,
        'is_completed': t.isCompleted,
      };

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
