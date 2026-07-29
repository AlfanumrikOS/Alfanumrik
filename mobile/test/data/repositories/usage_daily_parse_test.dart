import 'package:flutter_test/flutter_test.dart';

import 'package:alfanumrik/data/models/dashboard_data.dart';

/// Pins the mobile side of the school-coverage usage-limit fix.
///
/// Mobile now READS the server's authoritative cap from
/// `GET /api/usage/daily?feature=…` (a thin read-through to `get_plan_limit()`,
/// the same RPC `check_and_record_usage()` enforces against) instead of
/// deriving one from the plan code. The plan-code guess was school-blind: since
/// migration 20260729130000 `get_plan_limit()` returns
/// `GREATEST(personal, school_derived)`, so a school-covered student is allowed
/// unlimited Foxy while the guess still said 5.
///
/// These tests pin the fail-soft contract: mobile resolves a key ONLY when the
/// server positively supplied it, and never substitutes a local default.
void main() {
  const parse = parseUsageDailyBody;

  group('parseUsageDailyBody — happy path', () {
    test('extracts limit and count under the feature key prefix', () {
      final out = parse('foxy_chat', const {
        'success': true,
        'data': {
          'feature': 'foxy_chat',
          'limit': 5,
          'count': 2,
          'remaining': 3,
          'allowed': true,
        },
      });
      expect(out, {'foxy_chat_limit': 5, 'foxy_chat_used': 2});
    });

    test('quiz prefix maps to the keys DailyUsage.fromJson reads', () {
      final out = parse('quiz', const {
        'success': true,
        'data': {'limit': 20, 'count': 1},
      });
      final usage = DailyUsage.fromJson({...out});
      expect(usage.quizzes.perDay, 20);
      expect(usage.quizzesUsed, 1);
    });
  });

  group('parseUsageDailyBody — the school-coverage case', () {
    test('999999 sentinel becomes unlimited, never a literal count', () {
      final out = parse('foxy_chat', const {
        'success': true,
        'data': {'limit': 999999, 'count': 137},
      });
      final usage = DailyUsage.fromJson({...out});

      expect(usage.foxyChats.isUnlimited, isTrue);
      expect(usage.foxyChats.label(isHi: false), 'Unlimited');
      expect(usage.foxyChats.label(isHi: true), 'असीमित');
      expect(usage.foxyChats.label(isHi: false), isNot(contains('999999')));
      expect(usage.foxyLimitReached, isFalse,
          reason: 'a school-covered student is entitled and must not be gated');
    });
  });

  group('parseUsageDailyBody — fail soft, never guess', () {
    test('the 503 "Limit unavailable" envelope resolves nothing', () {
      expect(parse('foxy_chat', const {
        'success': false,
        'error': 'Limit unavailable',
      }), isEmpty);
    });

    test('null body (offline / 404 on an old server) resolves nothing', () {
      expect(parse('foxy_chat', null), isEmpty);
    });

    test('malformed data resolves nothing', () {
      expect(parse('foxy_chat', const {'success': true}), isEmpty);
      expect(parse('foxy_chat', const {'success': true, 'data': 'nope'}),
          isEmpty);
    });

    test('non-numeric limit is dropped rather than coerced', () {
      final out = parse('foxy_chat', const {
        'success': true,
        'data': {'limit': 'unlimited', 'count': 3},
      });
      expect(out.containsKey('foxy_chat_limit'), isFalse);
      expect(out['foxy_chat_used'], 3);
    });

    test('an unresolved limit yields UNKNOWN, not the free cap of 5', () {
      final usage = DailyUsage.fromJson({
        ...parse('foxy_chat', const {'success': false, 'error': 'x'}),
      });
      expect(usage.foxyChats.isKnown, isFalse);
      expect(usage.foxyChats.perDay, isNull);
      expect(usage.foxyChats.label(isHi: false), '',
          reason: 'neutral state — never over- or under-promise');
      expect(usage.foxyLimitReached, isFalse,
          reason: 'an unknown cap must never lock a student out');
    });
  });
}
