import 'package:supabase_flutter/supabase_flutter.dart';

import '../../core/cache/cache_manager.dart';
import '../../core/network/api_result.dart';
import '../models/dashboard_data.dart';

class DashboardRepository {
  final SupabaseClient _client;
  final CacheManager _cache;

  DashboardRepository({
    SupabaseClient? client,
    CacheManager? cache,
  })  : _client = client ?? Supabase.instance.client,
        _cache = cache ?? CacheManager();

  /// Fetch all dashboard data in a single RPC call.
  /// Falls back to parallel queries if RPC not available.
  Future<ApiResult<DashboardData>> getDashboardData(String studentId) async {
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

  /// Invalidate dashboard cache (e.g., after XP earned)
  Future<void> invalidate(String studentId) async {
    await _cache.remove('dashboard_$studentId');
  }

  // Must match web src/lib/usage.ts PLAN_LIMITS
  // Plan codes: web uses 'starter'/'pro'/'unlimited'
  // Mobile may receive 'starter_monthly'/'starter_yearly' etc from DB
  int _chatLimit(String? plan) {
    if (plan == null) return 5;
    if (plan.startsWith('starter')) return 30; // web: 30
    if (plan.startsWith('pro')) return 100;
    if (plan.startsWith('unlimited') || plan.startsWith('ultimate')) return 999;
    return 5; // free
  }

  int _quizLimit(String? plan) {
    if (plan == null) return 5;
    if (plan.startsWith('starter')) return 20;
    if (plan.startsWith('pro') || plan.startsWith('unlimited') || plan.startsWith('ultimate')) return 999;
    return 5; // free: web uses 5, not 3
  }
}
