import 'package:dio/dio.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import '../../core/cache/cache_manager.dart';
import '../../core/network/api_client.dart';
import '../../core/network/api_result.dart';
import '../../core/network/v2_api_client.dart';
import '../models/dashboard_data.dart';

class DashboardRepository {
  final SupabaseClient _client;
  final CacheManager _cache;
  final ApiClient _api;

  /// Generated `/v2` client. Null on the flag-OFF path so the legacy build
  /// never constructs the dart-dio client.
  final V2ApiClient? _v2;

  DashboardRepository({
    SupabaseClient? client,
    CacheManager? cache,
    V2ApiClient? v2Client,
    ApiClient? api,
  })  : _client = client ?? Supabase.instance.client,
        _cache = cache ?? CacheManager(),
        _api = api ?? ApiClient(),
        _v2 = v2Client;

  /// Fetch all dashboard data in a single RPC call.
  /// Falls back to parallel queries if RPC not available.
  ///
  /// When a server-assigned generated client is present, the profile is sourced from
  /// `GET /v2/student/profile` and the daily queue from
  /// `GET /v2/today`; see [_getDashboardDataV2]. When OFF this is the
  /// byte-identical legacy RPC/table path.
  ///
  /// Neither path resolves daily usage LIMITS any more — no surface reachable
  /// by an `authenticated` mobile client returns the server's resolved cap.
  /// See the note at the bottom of this file.
  ///
  /// Future backend migration: when `get_dashboard_data` returns
  /// Performance Score (0-100) instead of unbounded XP, update
  /// [DashboardData.fromJson] to parse `performance_score` and
  /// `foxy_coins` fields. See web `score-config.ts` and `coin-rules.ts`.
  Future<ApiResult<DashboardData>> getDashboardData(String studentId) async {
    if (_v2 != null) {
      return _getDashboardDataV2(studentId);
    }

    try {
      // Try cache first
      final cached =
          _cache.get<DashboardData>('dashboard_$studentId', DashboardData.fromJson);
      if (cached != null) return ApiSuccess(cached);

      // The authoritative caps, fetched alongside the rest. `get_dashboard_data`
      // returns no usage/limit key at all, so without this the RPC path would
      // render UNKNOWN caps forever.
      final serverUsageFuture = _fetchServerUsage();

      // Try batch RPC
      try {
        final rpcRes = await _client.rpc('get_dashboard_data', params: {
          'p_student_id': studentId,
        });

        if (rpcRes != null) {
          final merged = Map<String, dynamic>.from(rpcRes as Map<String, dynamic>);
          final serverUsage = await serverUsageFuture;
          if (serverUsage.isNotEmpty) {
            merged['usage'] = {
              ...?(merged['usage'] as Map<String, dynamic>?),
              ...serverUsage,
            };
          }
          await _cache.put('dashboard_$studentId', merged);
          return ApiSuccess(DashboardData.fromJson(merged));
        }
      } catch (_) {
        // RPC might not exist — fall back to parallel queries
      }

      // Fallback: parallel queries
      // Future backend migration: query `student_subject_scores` for
      // per-subject scores and `students.foxy_coins` for coin balance.
      final results = await Future.wait([
        // `plan_code` is deliberately NOT selected any more: it was read only to
        // guess usage caps, and a plan code cannot express school (B2B)
        // coverage. See the note at the bottom of this file.
        _client
            .from('students')
            .select('xp_total, level, streak_days')
            .eq('id', studentId)
            .single(),
        _client
            .from('student_daily_usage')
            .select('foxy_chat_count, quiz_count')
            .eq('student_id', studentId)
            .eq('usage_date', DateTime.now().toIso8601String().substring(0, 10))
            .maybeSingle(),
        _client
            .from('quiz_sessions')
            .select('score_percent, created_at')
            .eq('student_id', studentId)
            .eq('is_completed', true)
            .order('created_at', ascending: false)
            .limit(20),
      ]);

      final studentData = results[0] as Map<String, dynamic>;
      final usageData = results[1] as Map<String, dynamic>?;
      final quizData = results[2] as List<dynamic>;

      final avgScore = quizData.isNotEmpty
          ? quizData
                  .map((q) => (q['score_percent'] as num?)?.toDouble() ?? 0)
                  .reduce((a, b) => a + b) /
              quizData.length
          : 0.0;

      final dashData = {
        'xp_total': studentData['xp_total'] ?? 0,
        'level': studentData['level'] ?? 1,
        'streak_days': studentData['streak_days'] ?? 0,
        'quizzes_taken': quizData.length,
        'avg_quiz_score': avgScore,
        'chat_sessions_today': usageData?['foxy_chat_count'] ?? 0,
        // Caps come ONLY from the server (`_fetchServerUsage`). Any key it
        // could not resolve is OMITTED, not guessed — absent parses to
        // `UsageLimit.unknown()` and renders neutral. See the note at the
        // bottom of this file for why a plan-code-derived cap was wrong.
        'usage': {
          'foxy_chat_used': usageData?['foxy_chat_count'] ?? 0,
          'quiz_used': usageData?['quiz_count'] ?? 0,
          // Authoritative values win over the wide-column reads above, which
          // no writer in the migration chain populates.
          ...await serverUsageFuture,
        },
      };

      await _cache.put('dashboard_$studentId', dashData);
      return ApiSuccess(DashboardData.fromJson(dashData));
    } catch (e) {
      return ApiFailure('Failed to load dashboard: ${e.toString()}');
    }
  }

  /// Invalidate dashboard cache (e.g., after earning coins or completing quiz)
  Future<void> invalidate(String studentId) async {
    await _cache.remove('dashboard_$studentId');
  }

  /// `useV2`-ON dashboard assembly.
  ///
  /// Probes `GET /v2/student/profile` and `GET /v2/today` (connectivity/scope —
  /// the adaptive Today home, not this legacy dashboard, is the real consumer
  /// of the queue under `useV2`, so the items aren't re-rendered here).
  /// Counters the `/v2` profile + today surfaces don't expose (XP total,
  /// quizzes taken, usage USED counts) stay at their model defaults, and daily
  /// usage LIMITS stay [UsageLimit.unknown] — neither surface returns the
  /// server's resolved, school-aware cap.
  Future<ApiResult<DashboardData>> _getDashboardDataV2(String studentId) async {
    try {
      final cached =
          _cache.get<DashboardData>('dashboard_$studentId', DashboardData.fromJson);
      if (cached != null) return ApiSuccess(cached);

      // Connectivity/auth probe. NOTE: `plan` is intentionally NOT read for
      // limits — 20260729130500 documents that key as "the PERSONAL (B2C) plan
      // code only ... a label, not a limit source", and it cannot express
      // school (B2B) coverage.
      await _v2!.studentApi.getStudentProfile();

      // Daily queue (best-effort). Fetched so the dashboard reflects the same
      // server-driven session as the Today home; a hiccup must not break the
      // profile-driven dashboard, so it's swallowed.
      try {
        await _v2.todayApi.getToday();
      } catch (_) {
        // Today is best-effort here.
      }

      // Caps + counts from the server's single authority. Anything unresolved
      // is omitted and stays UNKNOWN rather than falling back to a guess.
      final dashData = <String, dynamic>{
        'usage': {
          'foxy_chat_used': 0,
          'quiz_used': 0,
          ...await _fetchServerUsage(),
        },
      };

      await _cache.put('dashboard_$studentId', dashData);
      return ApiSuccess(DashboardData.fromJson(dashData));
    } catch (e) {
      return ApiFailure('Failed to load dashboard: ${_describe(e)}');
    }
  }

  /// Read the SERVER'S authoritative daily caps from
  /// `GET /api/usage/daily?feature=…`.
  ///
  /// That route is a thin read-through to `get_plan_limit()` — the SAME RPC
  /// `check_and_record_usage()` derives the ENFORCED cap from — so what mobile
  /// displays cannot drift from what the server allows. Critically,
  /// `get_plan_limit()` has folded in school (B2B) coverage since migration
  /// 20260729130400, which is the whole reason a plan-code guess was wrong.
  ///
  /// Returns the `usage` sub-map keys that could be resolved. Keys are OMITTED
  /// rather than guessed, so anything unresolved parses to
  /// [UsageLimit.unknown] and renders neutral.
  ///
  /// FAIL-SOFT BY DESIGN: every failure mode (503 "Limit unavailable", 401,
  /// offline, timeout, malformed body, an old APK hitting a server without this
  /// route → 404) leaves the caps UNKNOWN. It never falls back to a local
  /// default, because mobile's local default WAS the school-blind bug. This
  /// method must never throw — a usage-badge hiccup cannot break the dashboard.
  ///
  /// P12: read-only. It cannot increment, record or grant anything; the hard
  /// gate stays server-side (`check_and_record_usage` → HTTP 429).
  /// P13: sends no student identifier — the route resolves the caller's own
  /// student row from the bearer token — and logs nothing.
  Future<Map<String, dynamic>> _fetchServerUsage() async {
    // ('response key prefix', 'server feature name')
    const features = <List<String>>[
      ['foxy_chat', 'foxy_chat'],
      ['quiz', 'quiz'],
    ];

    final resolved = <String, dynamic>{};

    await Future.wait(features.map((f) async {
      final keyPrefix = f[0];
      try {
        final res = await _api.get<Map<String, dynamic>>(
          '/usage/daily',
          queryParameters: {'feature': f[1]},
        );
        resolved.addAll(parseUsageDailyBody(keyPrefix, res.data));
      } catch (_) {
        // Unresolved => stays UNKNOWN. Never guess, never throw.
      }
    }));

    return resolved;
  }

  /// Extract a useful message from a thrown error. DioException server bodies
  /// carry `{ error: ... }`; everything else falls back to `toString`. Message
  /// text only — never PII (P13).
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

  // ───────────────────────────────────────────────────────────────────────────
  // REMOVED (2026-07-29): `_chatLimit()` / `_quizLimit()` / `_normalizePlan()`.
  //
  // They resolved a student's daily caps from the PLAN CODE ALONE, which is
  // school-blind. Since migration 20260729130400, `get_plan_limit()` — the
  // single SQL limit authority, and the function `check_and_record_usage()`
  // enforces against — returns `GREATEST(personal_limit, school_derived_limit)`,
  // mapping a `trial` or paid SCHOOL subscription onto the `pro` consumer tier.
  // A student covered by a school is therefore genuinely ALLOWED unlimited Foxy
  // while the plan-code guess still reported the FREE cap of 5. Migration
  // 20260729130500 collapsed the equivalent SQL duplicate for the same reason;
  // this was the same defect's mobile twin, and re-adding a Dart mapping of
  // school plans to consumer tiers would make mobile a FIFTH disagreeing
  // authority. So the guess is deleted rather than corrected.
  //
  // WHERE THE NUMBER COMES FROM NOW: `GET /api/usage/daily?feature=…` via
  // [_fetchServerUsage] — a thin read-through to `get_plan_limit()`, the same
  // RPC enforcement uses. Mobile holds NO limit policy of its own.
  //
  // Why a direct RPC call is NOT an option (verified, don't retry it):
  //   * `get_plan_limit(uuid,text)` and `get_student_usage(uuid)` both have
  //     EXECUTE REVOKEd from `anon, authenticated` (20260516040000 /
  //     20260516050000, re-asserted 20260729130500 §3). Mobile authenticates as
  //     `authenticated`, so it cannot call either — hence the service-role hop.
  //   * `get_dashboard_data(uuid)` IS granted to `authenticated` (20260623000800)
  //     but its returned object carries no usage/limit/plan key whatsoever.
  //   * `GET /v2/student/profile` returns `plan` only — and per 20260729130500
  //     that key is explicitly "the PERSONAL (B2C) plan code only ... a label,
  //     not a limit source".
  //
  // When the route can't answer, limits stay UNKNOWN and the UI renders
  // neutral. Unknown is correct; a guess is not.
  //
  // This weakens NO enforcement (P12): mobile never used these numbers to block
  // a request. Quota is enforced server-side by `check_and_record_usage()` and
  // surfaces as HTTP 429 → `UsageLimitException` in `chat_repository`.
  // ───────────────────────────────────────────────────────────────────────────
}
