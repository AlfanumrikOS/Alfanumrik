/// Goal-Adaptive Daily Plan Repository (Phase 6).
///
/// Fetches the daily plan for the authenticated student via
/// GET /api/student/daily-plan. Handles the empty-plan case (returned
/// by the server when ff_goal_daily_plan is OFF or the student has
/// no academic_goal set).
///
/// Owner: mobile
/// P-invariants: P9 server enforces auth; this client just attaches
/// the existing Supabase JWT via the auth interceptor in api_client.dart.

library;

import '../../core/errors/app_exception.dart';
import '../../core/network/api_client.dart';
import '../../core/network/api_result.dart';
import '../models/daily_plan.dart';

class DailyPlanRepository {
  final ApiClient _client;

  DailyPlanRepository({ApiClient? client}) : _client = client ?? ApiClient();

  /// Fetches the daily plan for the current student. Returns an empty
  /// plan (items=[], goal=null) when the server reports flag-off or
  /// the student has no goal. Returns ApiFailure on transport error.
  Future<ApiResult<DailyPlanResponse>> fetch() async {
    try {
      final res = await _client.get<Map<String, dynamic>>('/api/student/daily-plan');
      final body = res.data;
      if (body == null) {
        return const ApiFailure('Empty response from /api/student/daily-plan');
      }
      final parsed = DailyPlanResponse.fromJson(body);
      return ApiSuccess(parsed);
    } on AppException catch (e) {
      return ApiFailure(e.message);
    } catch (e) {
      return ApiFailure('Daily plan fetch failed: ' + e.toString());
    }
  }
}
