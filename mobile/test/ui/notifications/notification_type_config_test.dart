// Tests for notification_type_config.dart — the Dart port of the web's
// TYPE_CONFIG map (apps/host/src/app/notifications/page.tsx). The critical
// invariant under test is graceful degradation: any `type` NOT in the map
// (including one added to the web registry after this build shipped) must
// resolve to the fallback rather than throw, since old installed APKs will
// encounter new types over time.
library;

import 'package:flutter_test/flutter_test.dart';
import 'package:alfanumrik/ui/screens/notifications/notification_type_config.dart';

void main() {
  group('typeConfigFor — known types', () {
    const knownTypes = [
      'streak_risk',
      'streak_milestone',
      'review_due',
      'rank_update',
      'competition_live',
      'daily_progress',
      'plan_reminder',
      'foxy_motivation',
      'xp_milestone',
      'parent_daily_report',
      'parent_cheer',
      'achievement',
      'quiz_result',
      'remediation_assigned',
      'remediation_recovered',
      'remediation_escalated',
      'reengagement_nudge',
      'reengagement_returned',
      'reengagement_escalated',
      'concentration_escalated',
      'concentration_resolved',
      'concentration_reescalated',
      'first_quiz_nudge',
      'streak_at_risk',
      'prerequisite_blocked',
      'prerequisite_resolved',
    ];

    test('every documented web TYPE_CONFIG key resolves to a non-fallback config', () {
      for (final type in knownTypes) {
        final cfg = typeConfigFor(type);
        expect(cfg.label, isNot(kNotificationTypeFallback.label), reason: type);
        expect(cfg.icon.isNotEmpty, isTrue, reason: type);
        expect(cfg.labelHi.isNotEmpty, isTrue, reason: type);
      }
    });

    test('exactly the documented 26 types are ported', () {
      expect(kNotificationTypeConfig.keys.toSet(), knownTypes.toSet());
    });
  });

  group('typeConfigFor — graceful degradation (never throws)', () {
    test('unrecognized type falls back to the generic Update config', () {
      final cfg = typeConfigFor('some_brand_new_type_added_after_this_build');
      expect(cfg.label, 'Update');
      expect(cfg.labelHi, 'अपडेट');
      expect(cfg.icon, '📌');
    });

    test('empty-string type falls back too', () {
      expect(typeConfigFor(''), same(kNotificationTypeFallback));
    });
  });
}
