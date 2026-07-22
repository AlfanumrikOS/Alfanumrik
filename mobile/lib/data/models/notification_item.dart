import 'package:equatable/equatable.dart';

/// One row from `get_student_notifications`'s `notifications` array.
///
/// Mirrors the `Notification` interface in
/// `apps/host/src/app/notifications/page.tsx`. The RPC
/// (`get_student_notifications(p_student_id, p_limit)` — verified against
/// `apps/host/src/types/database.types.ts` and the web caller in
/// `packages/lib/src/supabase.ts`) returns a JSONB envelope:
/// `{ unread_count: number, notifications: [{ id, type, title, body, data,
/// is_read, created_at }] }`.
class NotificationItem extends Equatable {
  final String id;
  final String type;
  final String title;
  final String body;
  final Map<String, dynamic> data;
  final bool isRead;
  final DateTime createdAt;

  const NotificationItem({
    required this.id,
    required this.type,
    required this.title,
    required this.body,
    required this.data,
    required this.isRead,
    required this.createdAt,
  });

  factory NotificationItem.fromJson(Map<String, dynamic> json) {
    return NotificationItem(
      id: json['id'] as String? ?? '',
      type: json['type'] as String? ?? '',
      title: json['title'] as String? ?? '',
      body: json['body'] as String? ?? '',
      data: (json['data'] is Map)
          ? Map<String, dynamic>.from(json['data'] as Map)
          : const <String, dynamic>{},
      isRead: json['is_read'] as bool? ?? false,
      createdAt: DateTime.tryParse(json['created_at'] as String? ?? '') ??
          DateTime.fromMillisecondsSinceEpoch(0, isUtc: true),
    );
  }

  NotificationItem copyWith({bool? isRead}) => NotificationItem(
        id: id,
        type: type,
        title: title,
        body: body,
        data: data,
        isRead: isRead ?? this.isRead,
        createdAt: createdAt,
      );

  /// P7: Hindi copy rides `data.title_hi` — the house convention (the
  /// notifications table has no top-level `*_hi` column). Falls back to the
  /// English `title` when absent (older rows, or a type that predates
  /// bilingual `data` fields).
  String displayTitle(bool isHi) {
    if (isHi) {
      final hi = data['title_hi'];
      if (hi is String && hi.isNotEmpty) return hi;
    }
    return title;
  }

  /// See [displayTitle] — same house convention, `data.body_hi`.
  String displayBody(bool isHi) {
    if (isHi) {
      final hi = data['body_hi'];
      if (hi is String && hi.isNotEmpty) return hi;
    }
    return body;
  }

  /// Per-notification emoji override (e.g. `parent_cheer` carries the
  /// sender's chosen cheer-catalog icon). Falls back to the type's default
  /// icon at the call site — see `notification_type_config.dart`.
  String? get dataIcon {
    final icon = data['icon'];
    return (icon is String && icon.isNotEmpty) ? icon : null;
  }

  /// Deep-link path (e.g. `/quiz`), if present. Mobile navigates via
  /// GoRouter's `context.push` — server-issued web paths (e.g. `/dashboard`,
  /// `/quiz`, `/dive`) resolve to the same route names on mobile for the
  /// surfaces that exist; unrecognised paths simply fail to match a route
  /// (GoRouter's own not-found handling), never a crash.
  String? get action {
    final a = data['action'];
    return (a is String && a.isNotEmpty) ? a : null;
  }

  bool get isShareable => data['shareable'] == true;

  @override
  List<Object?> get props => [id, type, title, body, isRead, createdAt];
}

/// Parsed response envelope from `get_student_notifications`.
class NotificationsFeed extends Equatable {
  final int unreadCount;
  final List<NotificationItem> notifications;

  const NotificationsFeed({
    this.unreadCount = 0,
    this.notifications = const <NotificationItem>[],
  });

  /// Parses the raw RPC payload. Degrades to an empty feed (never throws) on
  /// any unexpected shape — mirrors the web's `getStudentNotifications()`
  /// fail-soft behaviour so a hiccup here never blocks the rest of the app.
  factory NotificationsFeed.fromJson(dynamic raw) {
    if (raw is! Map) return const NotificationsFeed();
    final map = Map<String, dynamic>.from(raw);
    final rawList = map['notifications'];
    final items = rawList is List
        ? rawList
            .whereType<Map>()
            .map(
                (e) => NotificationItem.fromJson(Map<String, dynamic>.from(e)))
            .toList(growable: false)
        : const <NotificationItem>[];
    final unread = (map['unread_count'] as num?)?.toInt() ?? 0;
    return NotificationsFeed(unreadCount: unread, notifications: items);
  }

  @override
  List<Object?> get props => [unreadCount, notifications];
}
