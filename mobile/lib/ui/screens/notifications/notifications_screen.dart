import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/constants/app_colors.dart';
import '../../../data/models/notification_item.dart';
import '../../../providers/notifications_provider.dart';
import '../../widgets/error_widget.dart';
import '../../widgets/loading_widget.dart';
import 'notification_feed_logic.dart';
import 'notification_type_config.dart';

/// Notifications feed — mobile parity for `apps/host/src/app/notifications/page.tsx`.
///
/// Reads via [notificationsProvider] (RPC: `get_student_notifications`),
/// groups by Today/Yesterday/Earlier, and renders each item with the same
/// [kNotificationTypeConfig] bilingual icon/color/label the web uses. Tapping
/// an unread item marks it read and follows `data.action` if present; "Mark
/// all read" clears the whole feed. Both actions are optimistic (see
/// [NotificationsNotifier]).
class NotificationsScreen extends ConsumerWidget {
  const NotificationsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final isHi = Localizations.localeOf(context).languageCode == 'hi';
    final feedAsync = ref.watch(notificationsProvider);
    final unreadCount = feedAsync.valueOrNull?.unreadCount ?? 0;

    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(
        backgroundColor: AppColors.surface,
        foregroundColor: AppColors.textPrimary,
        elevation: 0,
        titleSpacing: 0,
        title: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(
              isHi ? '🔔 सूचनाएँ' : '🔔 Notifications',
              style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w700),
            ),
            if (unreadCount > 0) ...[
              const SizedBox(width: 8),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                decoration: BoxDecoration(
                  color: const Color(0xFFDC2626),
                  borderRadius: BorderRadius.circular(20),
                ),
                child: Text(
                  '$unreadCount',
                  style: const TextStyle(
                    color: Colors.white,
                    fontSize: 11,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ),
            ],
          ],
        ),
        actions: [
          if (unreadCount > 0)
            TextButton(
              onPressed: () => ref.read(notificationsProvider.notifier).markAllRead(),
              child: Text(
                isHi ? 'सब पढ़ा' : 'Mark all read',
                style: const TextStyle(
                  color: AppColors.primary,
                  fontWeight: FontWeight.w700,
                  fontSize: 12,
                ),
              ),
            ),
        ],
      ),
      body: SafeArea(
        child: feedAsync.when(
          loading: () => LoadingScreen(
            message: isHi ? 'लोड हो रहा है...' : 'Loading notifications...',
          ),
          error: (e, _) => AppErrorWidget(
            message: isHi ? 'सूचनाएं लोड नहीं हो सकीं' : 'Failed to load notifications',
            onRetry: () => ref.read(notificationsProvider.notifier).refresh(),
          ),
          data: (feed) {
            if (feed.notifications.isEmpty) {
              return _EmptyNotifications(isHi: isHi);
            }

            final groups = groupNotificationsByDay(feed.notifications);
            return RefreshIndicator(
              color: AppColors.primary,
              onRefresh: () => ref.read(notificationsProvider.notifier).refresh(),
              child: ListView.builder(
                padding: const EdgeInsets.fromLTRB(16, 12, 16, 24),
                itemCount: groups.length,
                itemBuilder: (context, gi) {
                  final group = groups[gi];
                  return Padding(
                    padding: const EdgeInsets.only(bottom: 14),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Padding(
                          padding: const EdgeInsets.only(left: 4, bottom: 8),
                          child: Text(
                            (isHi ? group.labelHi : group.label).toUpperCase(),
                            style: const TextStyle(
                              fontSize: 11,
                              fontWeight: FontWeight.w700,
                              color: AppColors.textTertiary,
                              letterSpacing: 0.5,
                            ),
                          ),
                        ),
                        ...group.items.map(
                          (n) => _NotificationTile(
                            notification: n,
                            isHi: isHi,
                            onTap: () => _handleTap(context, ref, n),
                          ),
                        ),
                      ],
                    ),
                  );
                },
              ),
            );
          },
        ),
      ),
    );
  }

  void _handleTap(BuildContext context, WidgetRef ref, NotificationItem n) {
    if (!n.isRead) {
      ref.read(notificationsProvider.notifier).markRead(n.id);
    }
    final action = n.action;
    if (action != null && action.isNotEmpty) {
      context.push(action);
    }
  }
}

class _EmptyNotifications extends StatelessWidget {
  final bool isHi;
  const _EmptyNotifications({required this.isHi});

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Text('🔔', style: TextStyle(fontSize: 40)),
            const SizedBox(height: 12),
            Text(
              isHi ? 'अभी तक कोई सूचना नहीं' : 'No notifications yet',
              style: const TextStyle(
                fontSize: 15,
                fontWeight: FontWeight.w700,
                color: AppColors.textPrimary,
              ),
            ),
            const SizedBox(height: 6),
            Text(
              isHi
                  ? 'क्विज़ लो और हम तुम्हें अपडेट करते रहेंगे'
                  : "Start quizzing and we'll keep you updated",
              textAlign: TextAlign.center,
              style: const TextStyle(fontSize: 12, color: AppColors.textTertiary),
            ),
            const SizedBox(height: 20),
            ElevatedButton(
              onPressed: () => context.go('/quiz'),
              style: ElevatedButton.styleFrom(
                backgroundColor: AppColors.primary,
                foregroundColor: Colors.white,
              ),
              child: Text(isHi ? '⚡ क्विज़ शुरू करो' : '⚡ Start a Quiz'),
            ),
          ],
        ),
      ),
    );
  }
}

class _NotificationTile extends StatelessWidget {
  final NotificationItem notification;
  final bool isHi;
  final VoidCallback onTap;

  const _NotificationTile({
    required this.notification,
    required this.isHi,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final cfg = typeConfigFor(notification.type);
    final icon = notification.dataIcon ?? cfg.icon;
    final title = notification.displayTitle(isHi);
    final body = notification.displayBody(isHi);
    final isRead = notification.isRead;

    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Material(
        color: Colors.transparent,
        borderRadius: BorderRadius.circular(16),
        child: InkWell(
          borderRadius: BorderRadius.circular(16),
          onTap: onTap,
          child: Container(
            padding: const EdgeInsets.all(14),
            decoration: BoxDecoration(
              color: isRead ? AppColors.surface : cfg.color.withValues(alpha: 0.04),
              borderRadius: BorderRadius.circular(16),
              border: Border.all(
                color: isRead
                    ? AppColors.borderLight
                    : cfg.color.withValues(alpha: 0.25),
              ),
            ),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                if (!isRead)
                  Container(
                    width: 3,
                    height: 40,
                    margin: const EdgeInsets.only(right: 8, top: 2),
                    decoration: BoxDecoration(
                      color: cfg.color,
                      borderRadius: BorderRadius.circular(2),
                    ),
                  ),
                Container(
                  width: 36,
                  height: 36,
                  decoration: BoxDecoration(
                    color: cfg.color.withValues(alpha: 0.12),
                    borderRadius: BorderRadius.circular(10),
                  ),
                  alignment: Alignment.center,
                  child: Text(icon, style: const TextStyle(fontSize: 16)),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        mainAxisAlignment: MainAxisAlignment.spaceBetween,
                        children: [
                          Expanded(
                            child: Text(
                              isHi ? cfg.labelHi : cfg.label,
                              style: TextStyle(
                                fontSize: 10,
                                fontWeight: FontWeight.w700,
                                color: cfg.color,
                                letterSpacing: 0.4,
                              ),
                            ),
                          ),
                          Text(
                            notificationTimeAgo(notification.createdAt, isHi),
                            style: const TextStyle(
                              fontSize: 10,
                              color: AppColors.textTertiary,
                            ),
                          ),
                        ],
                      ),
                      const SizedBox(height: 3),
                      Text(
                        title,
                        style: TextStyle(
                          fontSize: 13,
                          fontWeight: FontWeight.w600,
                          color: AppColors.textPrimary.withValues(
                            alpha: isRead ? 0.7 : 1.0,
                          ),
                        ),
                      ),
                      const SizedBox(height: 2),
                      Text(
                        body,
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(
                          fontSize: 11.5,
                          color: AppColors.textTertiary.withValues(
                            alpha: isRead ? 0.6 : 0.85,
                          ),
                          height: 1.3,
                        ),
                      ),
                      if (notification.action != null || notification.isShareable) ...[
                        const SizedBox(height: 6),
                        Row(
                          children: [
                            if (notification.action != null)
                              Text(
                                isHi ? 'टैप करो →' : 'Tap to open →',
                                style: TextStyle(
                                  fontSize: 10,
                                  fontWeight: FontWeight.w700,
                                  color: cfg.color,
                                ),
                              ),
                            if (notification.action != null && notification.isShareable)
                              const SizedBox(width: 8),
                            if (notification.isShareable)
                              Container(
                                padding: const EdgeInsets.symmetric(
                                    horizontal: 8, vertical: 2),
                                decoration: BoxDecoration(
                                  color: cfg.color.withValues(alpha: 0.12),
                                  borderRadius: BorderRadius.circular(20),
                                ),
                                child: Text(
                                  isHi ? '📱 शेयर करो' : '📱 Shareable',
                                  style: TextStyle(
                                    fontSize: 9,
                                    color: cfg.color,
                                    fontWeight: FontWeight.w700,
                                  ),
                                ),
                              ),
                          ],
                        ),
                      ],
                    ],
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
