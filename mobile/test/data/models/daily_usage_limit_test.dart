import 'package:flutter_test/flutter_test.dart';

import 'package:alfanumrik/data/models/dashboard_data.dart';

/// Mobile twin of the web usage-limit display defect.
///
/// THE BUG: `dashboard_repository.dart` resolved daily caps from the plan code
/// alone (`_chatLimit()` / `_quizLimit()`), which is school-blind. Since
/// migration 20260729130400, `get_plan_limit()` — the single SQL limit
/// authority that `check_and_record_usage()` enforces against — returns
/// `GREATEST(personal_limit, school_derived_limit)`, so a student covered by a
/// paid/trial SCHOOL subscription is genuinely allowed unlimited Foxy while the
/// plan-code guess still reported the free cap of 5.
///
/// THE FIX: mobile no longer guesses. No surface reachable by an
/// `authenticated` client returns the resolved cap, so an unresolved limit is
/// UNKNOWN, not "free".
void main() {
  group('UsageLimit — unlimited sentinels (never show "999999 left")', () {
    test('999999 (get_plan_limit / TS UNLIMITED_USAGE_SENTINEL) => unlimited',
        () {
      final limit = UsageLimit.fromServer(999999);
      expect(limit.isUnlimited, isTrue);
      expect(limit.isKnown, isTrue);
      expect(limit.perDay, isNull, reason: 'must not leak a literal count');
      expect(limit.label(isHi: false), 'Unlimited');
    });

    test('-1 (get_student_usage DB display sentinel) => unlimited', () {
      final limit = UsageLimit.fromServer(-1);
      expect(limit.isUnlimited, isTrue);
      expect(limit.perDay, isNull);
    });

    test('a value above the sentinel still folds to unlimited', () {
      expect(UsageLimit.fromServer(1000000).isUnlimited, isTrue);
    });

    test('neither sentinel is ever rendered as a number', () {
      for (final raw in <int>[-1, 999999, 1000000]) {
        final label = UsageLimit.fromServer(raw).label(isHi: false);
        expect(label, isNot(contains('999999')));
        expect(label, isNot(contains('-1')));
      }
    });
  });

  group('UsageLimit — unknown is representable and neutral', () {
    test('absent/null does NOT silently become the free cap', () {
      final limit = UsageLimit.fromServer(null);
      expect(limit.isKnown, isFalse);
      expect(limit.perDay, isNull);
      expect(limit.perDay, isNot(5),
          reason: 'the school-blind free-tier default is the defect');
    });

    test('unknown renders as a neutral blank, not a number', () {
      expect(const UsageLimit.unknown().label(isHi: false), '');
      expect(const UsageLimit.unknown().label(isHi: true), '');
    });

    test('a finite authoritative cap passes through untouched', () {
      final limit = UsageLimit.fromServer(20);
      expect(limit.isKnown, isTrue);
      expect(limit.isUnlimited, isFalse);
      expect(limit.perDay, 20);
      expect(limit.label(isHi: false), '20');
    });
  });

  group('UsageLimit — P7 bilingual', () {
    test('unlimited has EN and Hindi labels', () {
      const limit = UsageLimit.unlimited();
      expect(limit.label(isHi: false), 'Unlimited');
      expect(limit.label(isHi: true), 'असीमित');
      expect(limit.label(isHi: true), isNot(limit.label(isHi: false)));
    });
  });

  group('DailyUsage — never locks out an entitled student', () {
    test('defaults to UNKNOWN limits, not the free tier', () {
      const usage = DailyUsage();
      expect(usage.foxyChats.isKnown, isFalse);
      expect(usage.quizzes.isKnown, isFalse);
    });

    test('unknown limit never reports "reached"', () {
      const usage = DailyUsage(foxyChatsUsed: 999, quizzesUsed: 999);
      expect(usage.foxyLimitReached, isFalse);
      expect(usage.quizLimitReached, isFalse);
    });

    test('unlimited limit never reports "reached"', () {
      const usage = DailyUsage(
        foxyChatsUsed: 5000,
        foxyChats: UsageLimit.unlimited(),
      );
      expect(usage.foxyLimitReached, isFalse);
    });

    test('a known finite cap still reports reached (display only)', () {
      const usage = DailyUsage(
        foxyChatsUsed: 5,
        foxyChats: UsageLimit.perDayCount(5),
      );
      expect(usage.foxyLimitReached, isTrue);
    });
  });

  group('DailyUsage.fromJson — repository contract', () {
    test('omitted *_limit keys parse to unknown, counts still parse', () {
      final usage = DailyUsage.fromJson(const {
        'foxy_chat_used': 3,
        'quiz_used': 2,
      });
      expect(usage.foxyChatsUsed, 3);
      expect(usage.quizzesUsed, 2);
      expect(usage.foxyChats.isKnown, isFalse);
      expect(usage.quizzes.isKnown, isFalse);
    });

    test('a server-supplied unlimited sentinel is honoured', () {
      final usage = DailyUsage.fromJson(const {
        'foxy_chat_used': 40,
        'foxy_chat_limit': -1,
        'quiz_used': 0,
        'quiz_limit': 999999,
      });
      expect(usage.foxyChats.isUnlimited, isTrue);
      expect(usage.quizzes.isUnlimited, isTrue);
      expect(usage.foxyLimitReached, isFalse,
          reason: 'school-covered student must not be told they are out');
    });
  });

  group('DashboardData — usage wiring', () {
    test('missing usage block yields unknown limits', () {
      final data = DashboardData.fromJson(const {'xp_total': 100});
      expect(data.usage.foxyChats.isKnown, isFalse);
      expect(data.usage.quizzes.isKnown, isFalse);
    });
  });
}
