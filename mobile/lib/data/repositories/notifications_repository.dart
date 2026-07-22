import 'package:supabase_flutter/supabase_flutter.dart';

import '../../core/network/api_result.dart';
import '../models/notification_item.dart';

/// Notifications repository — direct `_client.rpc(...)` calls, same pattern
/// as [DashboardRepository]/[QuizRepository]'s legacy Supabase surfaces.
///
/// RPC contracts (verified against `apps/host/src/types/database.types.ts`
/// and the web callers in `packages/lib/src/supabase.ts`):
///   * `get_student_notifications(p_student_id, p_limit)` → Json
///     `{ unread_count: number, notifications: [{ id, type, title, body,
///     data, is_read, created_at }] }`
///   * `mark_notification_read(p_notification_id)` → void
///   * `mark_all_notifications_read(p_student_id)` → void
///
/// P13: never logs notification payload contents (title/body/data may carry
/// student-context copy) — failures are message-text only.
class NotificationsRepository {
  final SupabaseClient _client;

  NotificationsRepository({SupabaseClient? client})
      : _client = client ?? Supabase.instance.client;

  /// Fetch the notification feed for [studentId]. Fails soft: on any RPC
  /// error this mirrors the web's `getStudentNotifications()` swallow-to-
  /// empty-envelope behaviour so a notifications hiccup never blocks the
  /// rest of the app — callers still get an [ApiFailure] to decide whether to
  /// show a retry banner, but the feed itself never throws unhandled.
  Future<ApiResult<NotificationsFeed>> getNotifications({
    required String studentId,
    int limit = 50,
  }) async {
    try {
      final dynamic raw =
          await _client.rpc('get_student_notifications', params: {
        'p_student_id': studentId,
        'p_limit': limit,
      });
      return ApiSuccess(NotificationsFeed.fromJson(raw));
    } catch (e) {
      return ApiFailure('Failed to load notifications: ${e.toString()}');
    }
  }

  /// Mark a single notification read.
  Future<ApiResult<void>> markRead(String notificationId) async {
    try {
      await _client.rpc('mark_notification_read', params: {
        'p_notification_id': notificationId,
      });
      return const ApiSuccess(null);
    } catch (e) {
      return ApiFailure('Failed to mark notification read: ${e.toString()}');
    }
  }

  /// Mark every notification for [studentId] read.
  Future<ApiResult<void>> markAllRead(String studentId) async {
    try {
      await _client.rpc('mark_all_notifications_read', params: {
        'p_student_id': studentId,
      });
      return const ApiSuccess(null);
    } catch (e) {
      return ApiFailure(
          'Failed to mark all notifications read: ${e.toString()}');
    }
  }
}
