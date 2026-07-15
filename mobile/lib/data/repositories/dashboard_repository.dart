import 'package:dio/dio.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import '../../core/cache/cache_manager.dart';
import '../../core/network/api_result.dart';
import '../../core/network/v2_api_client.dart';
import '../models/dashboard_data.dart';

class DashboardRepository {
  final SupabaseClient _client;
  final CacheManager _cache;

  /// Generated `/v2` client. Null on the flag-OFF path so the legacy build
  /// never constructs the dart-dio client.
  final V2ApiClient? _v2;

  DashboardRepository({
    SupabaseClient? client,
    CacheManager? cache,
    V2ApiClient? v2Client,
  })  : _client = client ?? Supabase.instance.client,
        _cache = cache ?? CacheManager(),
        _v2 = v2Client;

  /// Fetch all dashboard data in a single RPC call.
  /// Falls back to parallel queries if RPC not available.
  ///
  /// When a server-assigned generated client is present, the profile is sourced from
  /// `GET /v2/student/profile` (plan → usage limits) and the daily queue from
  /// `GET /v2/today`; see [_getDashboardDataV2]. When OFF this is the
  /// byte-identical legacy RPC/table path.
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

      // Try batch RPC
      try {
        final rpcRes = await _client.rpc('get_dashboard_data', params: {
          'p_student_id': studentId,
        });

        if (rpcRes != null) {
          final data = DashboardData.fromJson(rpcRes as Map<String, dynamic>);
          await _cache.put('dashboard_$studentId', rpcRes);
          return ApiSuccess(data);
        }
      } catch (_) {
        // RPC might not exist — fall back to parallel queries
      }

      // Fallback: parallel queries
      // Future backend migration: query `student_subject_scores` for
      // per-subject scores and `students.foxy_coins` for coin balance.
      final results = await Future.wait([
        _client
            .from('students')
            .select('xp_total, level, streak_days, plan_code')
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
        'usage': {
          'foxy_chat_used': usageData?['foxy_chat_count'] ?? 0,
          'foxy_chat_limit': _chatLimit(studentData['plan_code'] as String?),
          'quiz_used': usageData?['quiz_count'] ?? 0,
          'quiz_limit': _quizLimit(studentData['plan_code'] as String?),
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
  /// Sources the student profile from `GET /v2/student/profile` (the `plan`
  /// drives the per-plan usage LIMITS, kept in sync with web `usage.ts`) and
  /// the daily queue from `GET /v2/today` (a connectivity/scope probe — the
  /// adaptive Today home, not this legacy dashboard, is the real consumer of
  /// the queue under `useV2`, so the items aren't re-rendered here). Counters
  /// the `/v2` profile + today surfaces don't expose (XP total, quizzes taken,
  /// usage USED counts) stay at their model defaults.
  Future<ApiResult<DashboardData>> _getDashboardDataV2(String studentId) async {
    try {
      final cached =
          _cache.get<DashboardData>('dashboard_$studentId', DashboardData.fromJson);
      if (cached != null) return ApiSuccess(cached);

      // Profile drives plan-based usage limits (P-parity with web usage.ts).
      final profileResp = await _v2!.studentApi.getStudentProfile();
      final profile = profileResp.data;
      final plan = profile?.plan;

      // Daily queue (best-effort). Fetched so the dashboard reflects the same
      // server-driven session as the Today home; a hiccup must not break the
      // profile-driven dashboard, so it's swallowed.
      try {
        await _v2.todayApi.getToday();
      } catch (_) {
        // Today is best-effort here.
      }

      final dashData = <String, dynamic>{
        'usage': {
          'foxy_chat_used': 0,
          'foxy_chat_limit': _chatLimit(plan),
          'quiz_used': 0,
          'quiz_limit': _quizLimit(plan),
        },
      };

      await _cache.put('dashboard_$studentId', dashData);
      return ApiSuccess(DashboardData.fromJson(dashData));
    } catch (e) {
      return ApiFailure('Failed to load dashboard: ${_describe(e)}');
    }
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

  // Must match web src/lib/usage.ts PLAN_LIMITS + PLAN_ALIAS.
  // Canonical tiers: free / starter / pro / unlimited.
  // Aliases: basic→starter, premium→pro, ultimate→unlimited.
  // DB plan_code may include billing-cycle suffix (e.g. 'starter_monthly').
  static String _normalizePlan(String? plan) {
    if (plan == null || plan.isEmpty) return 'free';
    // Strip billing-cycle suffix
    final base = plan.replaceAll(RegExp(r'_(monthly|yearly)$'), '');
    // Apply legacy aliases
    switch (base) {
      case 'basic': return 'starter';
      case 'premium': return 'pro';
      case 'ultimate': return 'unlimited';
      default: return base;
    }
  }

  // Foxy chat daily cap. ALL paid plans are now UNLIMITED: migration
  // 20260714120000_foxy_unlimited_for_paid_plans.sql sets
  // subscription_plans.foxy_chats_per_day = -1 for starter/pro/unlimited, and
  // get_plan_limit() maps -1 → 999999. This mirrors web usage.ts PLAN_LIMITS
  // (starter/pro foxy_chat = UNLIMITED_USAGE_SENTINEL = 999999). The stale
  // finite caps (starter 30, pro 100) were the "30 left / 100 left" bug the
  // server no longer enforces — do NOT re-introduce them. Only free stays finite.
  int _chatLimit(String? plan) {
    switch (_normalizePlan(plan)) {
      case 'starter':   return 999999; // unlimited (was 30)
      case 'pro':       return 999999; // unlimited (was 100)
      case 'unlimited': return 999999;
      default:          return 5; // free
    }
  }

  int _quizLimit(String? plan) {
    switch (_normalizePlan(plan)) {
      case 'starter':   return 20;
      case 'pro':       return 999999;
      case 'unlimited': return 999999;
      default:          return 5; // free
    }
  }
}
