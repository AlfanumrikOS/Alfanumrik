// Tests for the Today bilingual copy + icon resolvers (Wave 2.3 mobile).
//
// These cover the PURE helpers (`todayCopy`, `todayIcon`) which carry the P7
// bilingual contract for the /v2 Today home. They do not touch the network or
// the generated client, so they run without build_runner output.
//
// NOTE: `resolveItemCopy` and `resolveMobileRoute` reference generated
// built_value types (TodayQueueItem / TodayDeepLink) and therefore require
// `dart run build_runner build` in lib/api/v2 before they compile — they are
// exercised in the Flutter CI env, not here.
import 'package:flutter_test/flutter_test.dart';
import 'package:alfanumrik/ui/screens/today/today_copy.dart';

void main() {
  group('todayCopy — shared chrome', () {
    test('heading is bilingual', () {
      expect(todayCopy('today.heading', false), 'Today');
      expect(todayCopy('today.heading', true), 'आज');
    });

    test('focus is bilingual', () {
      expect(todayCopy('today.focus', false), "Today's focus");
      expect(todayCopy('today.focus', true), 'आज का फोकस');
    });

    test('minutes badge interpolates {n} in both languages', () {
      expect(todayCopy('today.minutesBadge', false, {'n': 7}), '~7 min');
      expect(todayCopy('today.minutesBadge', true, {'n': 7}), '~7 मिनट');
    });

    test('empty state is bilingual', () {
      expect(todayCopy('today.empty', false),
          "You're all caught up. Start a free practice?");
      expect(todayCopy('today.empty', true),
          'आप पूरी तरह तैयार हैं। एक मुफ़्त अभ्यास शुरू करें?');
    });
  });

  group('todayCopy — all 9 item types have label + subtitle in both languages',
      () {
    const types = [
      'resume_in_progress',
      'cold_start_diagnostic',
      'srs_due',
      'revise_decayed_topic',
      'weak_topic_zpd',
      'continue_lesson',
      'weekly_dive_due',
      'monthly_synthesis_due',
      'practice_weakest',
    ];

    for (final type in types) {
      test('$type label/subtitle resolve (not the raw key) in en + hi', () {
        final labelKey = 'today.item.$type.label';
        final subtitleKey = 'today.item.$type.subtitle';
        // A resolved key must differ from the key itself (loud-failure guard).
        expect(todayCopy(labelKey, false), isNot(labelKey));
        expect(todayCopy(labelKey, true), isNot(labelKey));
        expect(todayCopy(subtitleKey, false), isNot(subtitleKey));
        expect(todayCopy(subtitleKey, true), isNot(subtitleKey));
        // en and hi must differ (real translation, not a passthrough).
        expect(todayCopy(labelKey, false), isNot(todayCopy(labelKey, true)));
      });
    }
  });

  group('todayCopy — interpolation', () {
    test('substitutes {subject}', () {
      expect(
        todayCopy('today.item.resume_in_progress.subtitle', false,
            {'subject': 'Science'}),
        'Continue your Science session',
      );
    });

    test('substitutes {dueCount} including zero', () {
      expect(
        todayCopy('today.item.srs_due.subtitle', false, {'dueCount': 0}),
        '0 cards ready to review',
      );
    });

    test('leaves unsupplied tokens untouched', () {
      // No {subject} provided → token stays literal (graceful, matches web).
      expect(
        todayCopy('today.item.practice_weakest.subtitle', false),
        'Strengthen {subject}',
      );
    });

    test('unknown key returns the key itself (visible failure)', () {
      expect(todayCopy('today.item.nope.label', false), 'today.item.nope.label');
    });
  });

  group('todayIcon', () {
    test('maps known hints to glyphs', () {
      expect(todayIcon('play-resume'), '▶️');
      expect(todayIcon('compass'), '🧭');
      expect(todayIcon('target'), '🎯');
      expect(todayIcon('telescope'), '🔭');
    });

    test('unknown hint falls back to spark glyph', () {
      expect(todayIcon('does-not-exist'), '✨');
    });
  });
}
