// Tests for notification_item.dart (Phase 6 mobile — Notifications feed).
//
// Mirrors the web `Notification` shape in
// apps/host/src/app/notifications/page.tsx and the
// `get_student_notifications` RPC envelope
// `{ unread_count, notifications: [...] }`.
library;

import 'package:flutter_test/flutter_test.dart';
import 'package:alfanumrik/data/models/notification_item.dart';

void main() {
  group('NotificationItem.fromJson', () {
    test('parses a complete row', () {
      final n = NotificationItem.fromJson(const {
        'id': 'n1',
        'type': 'streak_risk',
        'title': 'Your streak is at risk',
        'body': "You haven't practiced today",
        'data': {'action': '/quiz'},
        'is_read': false,
        'created_at': '2026-07-20T10:00:00.000Z',
      });

      expect(n.id, 'n1');
      expect(n.type, 'streak_risk');
      expect(n.title, 'Your streak is at risk');
      expect(n.isRead, isFalse);
      expect(n.createdAt, DateTime.parse('2026-07-20T10:00:00.000Z'));
      expect(n.action, '/quiz');
    });

    test('handles missing/malformed fields without throwing', () {
      final n = NotificationItem.fromJson(const {});
      expect(n.id, '');
      expect(n.type, '');
      expect(n.title, '');
      expect(n.body, '');
      expect(n.data, isEmpty);
      expect(n.isRead, isFalse);
      expect(n.action, isNull);
      expect(n.dataIcon, isNull);
      expect(n.isShareable, isFalse);
    });

    test('data that is not a Map degrades to empty map, never throws', () {
      final n = NotificationItem.fromJson(const {
        'id': 'n2',
        'type': 'quiz_result',
        'title': 't',
        'body': 'b',
        'data': 'not-a-map',
        'is_read': true,
        'created_at': '2026-07-20T10:00:00.000Z',
      });
      expect(n.data, isEmpty);
    });
  });

  group('NotificationItem bilingual display (P7 — data.title_hi/body_hi house convention)', () {
    test('English mode always uses top-level title/body', () {
      final n = NotificationItem.fromJson(const {
        'id': 'n1',
        'type': 'remediation_assigned',
        'title': 'Extra practice ready',
        'body': 'A quick set to help you catch up',
        'data': {'title_hi': 'अतिरिक्त अभ्यास तैयार', 'body_hi': 'आपकी मदद के लिए'},
        'is_read': false,
        'created_at': '2026-07-20T10:00:00.000Z',
      });
      expect(n.displayTitle(false), 'Extra practice ready');
      expect(n.displayBody(false), 'A quick set to help you catch up');
    });

    test('Hindi mode prefers data.title_hi / data.body_hi when present', () {
      final n = NotificationItem.fromJson(const {
        'id': 'n1',
        'type': 'remediation_assigned',
        'title': 'Extra practice ready',
        'body': 'A quick set to help you catch up',
        'data': {'title_hi': 'अतिरिक्त अभ्यास तैयार', 'body_hi': 'आपकी मदद के लिए'},
        'is_read': false,
        'created_at': '2026-07-20T10:00:00.000Z',
      });
      expect(n.displayTitle(true), 'अतिरिक्त अभ्यास तैयार');
      expect(n.displayBody(true), 'आपकी मदद के लिए');
    });

    test('Hindi mode falls back to English when data.*_hi is absent (older rows)', () {
      final n = NotificationItem.fromJson(const {
        'id': 'n1',
        'type': 'quiz_result',
        'title': 'Quiz complete',
        'body': 'You scored 80%',
        'data': <String, dynamic>{},
        'is_read': false,
        'created_at': '2026-07-20T10:00:00.000Z',
      });
      expect(n.displayTitle(true), 'Quiz complete');
      expect(n.displayBody(true), 'You scored 80%');
    });
  });

  group('NotificationItem.dataIcon / isShareable', () {
    test('dataIcon reads data.icon when a non-empty string', () {
      final n = NotificationItem.fromJson(const {
        'id': 'n1',
        'type': 'parent_cheer',
        'title': 't',
        'body': 'b',
        'data': {'icon': '🌟'},
        'is_read': false,
        'created_at': '2026-07-20T10:00:00.000Z',
      });
      expect(n.dataIcon, '🌟');
    });

    test('isShareable is true only when data.shareable === true', () {
      final shareable = NotificationItem.fromJson(const {
        'id': 'n1', 'type': 't', 'title': 't', 'body': 'b',
        'data': {'shareable': true}, 'is_read': false,
        'created_at': '2026-07-20T10:00:00.000Z',
      });
      final notShareable = NotificationItem.fromJson(const {
        'id': 'n2', 'type': 't', 'title': 't', 'body': 'b',
        'data': {'shareable': 'yes'}, 'is_read': false,
        'created_at': '2026-07-20T10:00:00.000Z',
      });
      expect(shareable.isShareable, isTrue);
      expect(notShareable.isShareable, isFalse);
    });
  });

  group('NotificationItem.copyWith', () {
    test('flips isRead without mutating other fields', () {
      final n = NotificationItem.fromJson(const {
        'id': 'n1', 'type': 'quiz_result', 'title': 't', 'body': 'b',
        'data': <String, dynamic>{}, 'is_read': false,
        'created_at': '2026-07-20T10:00:00.000Z',
      });
      final read = n.copyWith(isRead: true);
      expect(read.isRead, isTrue);
      expect(read.id, n.id);
      expect(read.type, n.type);
      expect(read.createdAt, n.createdAt);
    });
  });

  group('NotificationsFeed.fromJson', () {
    test('parses the full RPC envelope', () {
      final feed = NotificationsFeed.fromJson(const {
        'unread_count': 2,
        'notifications': [
          {
            'id': 'n1', 'type': 'streak_risk', 'title': 'a', 'body': 'b',
            'data': <String, dynamic>{}, 'is_read': false,
            'created_at': '2026-07-20T10:00:00.000Z',
          },
          {
            'id': 'n2', 'type': 'quiz_result', 'title': 'c', 'body': 'd',
            'data': <String, dynamic>{}, 'is_read': true,
            'created_at': '2026-07-19T10:00:00.000Z',
          },
        ],
      });
      expect(feed.unreadCount, 2);
      expect(feed.notifications, hasLength(2));
      expect(feed.notifications[0].id, 'n1');
    });

    test('degrades to empty feed for a non-Map payload (never throws)', () {
      expect(NotificationsFeed.fromJson(null).notifications, isEmpty);
      expect(NotificationsFeed.fromJson('oops').notifications, isEmpty);
      expect(NotificationsFeed.fromJson(const [1, 2, 3]).unreadCount, 0);
    });

    test('degrades to empty list when notifications is missing/wrong type', () {
      final feed = NotificationsFeed.fromJson(const {'unread_count': 5});
      expect(feed.unreadCount, 5);
      expect(feed.notifications, isEmpty);
    });

    test('skips malformed entries in the notifications array', () {
      final feed = NotificationsFeed.fromJson(const {
        'unread_count': 1,
        'notifications': [
          'not-a-map',
          {
            'id': 'n1', 'type': 't', 'title': 'a', 'body': 'b',
            'data': <String, dynamic>{}, 'is_read': false,
            'created_at': '2026-07-20T10:00:00.000Z',
          },
        ],
      });
      expect(feed.notifications, hasLength(1));
      expect(feed.notifications.first.id, 'n1');
    });
  });
}
