import 'package:equatable/equatable.dart';

import '../../core/constants/score_config.dart' as score_config;

class DashboardData extends Equatable {
  /// @deprecated Legacy unbounded XP total. Use [performanceScore] once
  /// the backend migrates to Performance Score (0-100 per subject).
  final int xpTotal;

  /// @deprecated Legacy XP-based level. Use [performanceScoreLevelName]
  /// once the backend migrates.
  final int level;

  final int streakDays;
  final int topicsCompleted;
  final int quizzesTaken;
  final int chatSessionsToday;
  final double avgQuizScore;
  final List<RecentActivity> recentActivity;
  final DailyUsage usage;

  /// Foxy Coins balance. 0 until the backend starts returning `foxy_coins`.
  final int foxyCoins;

  /// Performance Score (0-100) for the student's primary/average subject.
  /// 0.0 until the backend starts returning `performance_score`.
  final double performanceScore;

  const DashboardData({
    this.xpTotal = 0,
    this.level = 1,
    this.streakDays = 0,
    this.topicsCompleted = 0,
    this.quizzesTaken = 0,
    this.chatSessionsToday = 0,
    this.avgQuizScore = 0,
    this.recentActivity = const [],
    this.usage = const DailyUsage(),
    this.foxyCoins = 0,
    this.performanceScore = 0,
  });

  factory DashboardData.fromJson(Map<String, dynamic> json) {
    return DashboardData(
      xpTotal: json['xp_total'] as int? ?? 0,
      level: json['level'] as int? ?? 1,
      streakDays: json['streak_days'] as int? ?? 0,
      topicsCompleted: json['topics_completed'] as int? ?? 0,
      quizzesTaken: json['quizzes_taken'] as int? ?? 0,
      chatSessionsToday: json['chat_sessions_today'] as int? ?? 0,
      avgQuizScore: (json['avg_quiz_score'] as num?)?.toDouble() ?? 0,
      recentActivity: (json['recent_activity'] as List<dynamic>?)
              ?.map((e) =>
                  RecentActivity.fromJson(e as Map<String, dynamic>))
              .toList(growable: false) ??
          [],
      usage: json['usage'] != null
          ? DailyUsage.fromJson(json['usage'] as Map<String, dynamic>)
          : const DailyUsage(),
      foxyCoins: json['foxy_coins'] as int? ?? 0,
      performanceScore:
          (json['performance_score'] as num?)?.toDouble() ?? 0,
    );
  }

  /// Level name from Performance Score (0-100), matching web
  /// `score-config.ts` LEVEL_THRESHOLDS.
  ///
  /// Falls back to XP-based level name when [performanceScore] is 0
  /// (i.e. before the backend migration).
  String get levelName {
    if (performanceScore > 0) {
      return score_config.getLevelFromScore(performanceScore);
    }
    // Legacy: XP-based level names (must match web xp-rules.ts LEVEL_NAMES)
    const names = [
      '', 'Curious Cub', 'Quick Learner', 'Rising Star', 'Knowledge Seeker',
      'Smart Fox', 'Quiz Champion', 'Study Master', 'Brain Ninja', 'Scholar Fox', 'Grand Master',
    ];
    return level < names.length ? names[level] : 'Level $level';
  }

  /// Performance Score level name. Always uses the bounded 0-100 thresholds
  /// from `score-config.ts`.
  String get performanceScoreLevelName =>
      score_config.getLevelFromScore(performanceScore);

  /// @deprecated Legacy XP level progress. Use Performance Score (0-100)
  /// directly instead -- progress is inherent in the bounded score.
  int get xpForNextLevel => 500;

  /// @deprecated Level progress fraction for the XP progress bar.
  /// Once Performance Score is live, the dashboard should show
  /// [performanceScore] / 100 instead.
  double get levelProgress {
    if (performanceScore > 0) {
      return performanceScore / 100.0;
    }
    return xpTotal > 0 ? (xpTotal % xpForNextLevel) / xpForNextLevel : 0;
  }

  @override
  List<Object?> get props => [
        xpTotal,
        level,
        streakDays,
        topicsCompleted,
        foxyCoins,
        performanceScore,
      ];
}

class RecentActivity extends Equatable {
  final String type; // 'quiz' | 'chat' | 'concept'
  final String title;
  final String? subject;
  final DateTime timestamp;

  const RecentActivity({
    required this.type,
    required this.title,
    this.subject,
    required this.timestamp,
  });

  factory RecentActivity.fromJson(Map<String, dynamic> json) {
    return RecentActivity(
      type: json['type'] as String? ?? 'concept',
      title: json['title'] as String? ?? '',
      subject: json['subject'] as String?,
      timestamp: DateTime.tryParse(json['timestamp'] as String? ?? '') ??
          DateTime.now(),
    );
  }

  String get emoji {
    switch (type) {
      case 'quiz': return '📝';
      case 'chat': return '🦊';
      case 'concept': return '📖';
      default: return '📚';
    }
  }

  @override
  List<Object?> get props => [type, title, timestamp];
}

/// A daily cap with THREE states: unknown, unlimited, or a finite per-day count.
///
/// WHY TRI-STATE (this is the whole point — do not collapse it back to `int`):
/// mobile has NO reachable server-authoritative limit today. `get_plan_limit()`
/// and `get_student_usage()` — the single SQL limit authority — both have
/// EXECUTE REVOKEd from `anon, authenticated` (migrations 20260516040000 /
/// 20260516050000, re-asserted by 20260729130100 §3), and the one usage RPC
/// mobile CAN call, `get_dashboard_data`, returns no usage/limit key at all.
///
/// The previous code papered over that by defaulting to the FREE cap whenever
/// it could not resolve one. That is school-blind: since migration
/// 20260729130000, `get_plan_limit()` returns
/// `GREATEST(personal_limit, school_derived_limit)`, so a student covered by a
/// paid or trial school subscription is genuinely ALLOWED unlimited Foxy while
/// a plan-code-only guess still reported "5". Guessing a cap from the plan code
/// alone would make mobile a FIFTH disagreeing limit authority, so this type
/// deliberately makes "I do not know" representable instead.
///
/// UNKNOWN renders as nothing — never a number, never "0 left", never a lock.
class UsageLimit extends Equatable {
  const UsageLimit._(this.perDay, this.isUnlimited, this.isKnown);

  /// No authoritative cap could be resolved. Render neutral; never gate on it.
  const UsageLimit.unknown() : this._(null, false, false);

  /// Authoritatively uncapped.
  const UsageLimit.unlimited() : this._(null, true, true);

  /// An authoritative finite per-day cap.
  const UsageLimit.perDayCount(int count) : this._(count, false, true);

  /// The finite cap, or null when unknown OR unlimited.
  final int? perDay;
  final bool isUnlimited;

  /// False when no authority produced this value.
  final bool isKnown;

  /// Parse a server-supplied cap, handling BOTH unlimited sentinels explicitly.
  ///
  /// Two sentinels exist in the system by design and mobile must honour both,
  /// or a student will one day be shown "999999 chats left":
  ///   * `-1`     — the DB DISPLAY sentinel, what `get_student_usage()` returns
  ///                and what `subscription_plans.foxy_chats_per_day` stores for
  ///                paid plans (migration 20260714120000).
  ///   * `999999` — the ENFORCEMENT/TS sentinel returned by `get_plan_limit()`,
  ///                mirrored by `UNLIMITED_USAGE_SENTINEL` in
  ///                packages/lib/src/usage-sentinel.ts.
  /// `null`/absent/garbage → unknown, NOT a guessed free-tier number.
  factory UsageLimit.fromServer(Object? raw) {
    final n = raw is int ? raw : (raw is num ? raw.toInt() : null);
    if (n == null) return const UsageLimit.unknown();
    // `<= 0` (not `== -1`) so any negative sentinel folds to unlimited, and
    // `>=` (not `==`) so a future "very large means unlimited" value cannot
    // leak onto a screen as a literal count.
    if (n <= 0 || n >= unlimitedTsSentinel) return const UsageLimit.unlimited();
    return UsageLimit.perDayCount(n);
  }

  /// `UNLIMITED_USAGE_SENTINEL` in packages/lib/src/usage-sentinel.ts, and what
  /// `get_plan_limit()` returns for an uncapped tier.
  static const int unlimitedTsSentinel = 999999;

  /// Bilingual display label (P7). Empty string when unknown, so the caller
  /// renders a neutral/blank state rather than over- or under-promising.
  String label({required bool isHi}) {
    if (!isKnown) return '';
    if (isUnlimited) return isHi ? 'असीमित' : 'Unlimited';
    return '$perDay';
  }

  @override
  List<Object?> get props => [perDay, isUnlimited, isKnown];
}

/// Pure parser for ONE `GET /api/usage/daily?feature=…` response body.
///
/// Lives here, beside [UsageLimit], rather than in `dashboard_repository.dart`
/// so it is unit-testable without dragging in the generated `/v2` API package.
///
/// Returns ONLY the keys it could positively resolve, under the same names
/// [DailyUsage.fromJson] reads (`<prefix>_limit`, `<prefix>_used`). Anything
/// missing, unsuccessful or malformed yields NO key at all, which downstream
/// becomes [UsageLimit.unknown] — never a guessed cap. That fail-soft rule is
/// the point: mobile's old local default was the school-blind bug.
Map<String, dynamic> parseUsageDailyBody(String keyPrefix, Object? body) {
  final out = <String, dynamic>{};
  if (body is! Map) return out;
  // A `{ success: false, error }` envelope (e.g. the route's 503 "Limit
  // unavailable") must resolve NOTHING.
  if (body['success'] != true) return out;

  final data = body['data'];
  if (data is! Map) return out;

  // `limit` carries get_plan_limit()'s 999999 unlimited sentinel;
  // UsageLimit.fromServer maps it so no student ever sees "999999 left".
  final limit = data['limit'];
  if (limit is num) out['${keyPrefix}_limit'] = limit.toInt();

  // `count` comes from the NARROW student_daily_usage shape that
  // check_and_record_usage actually writes — unlike the wide
  // `foxy_chat_count`/`quiz_count` columns the legacy fallback reads, which no
  // writer in the migration chain populates.
  final count = data['count'];
  if (count is num) out['${keyPrefix}_used'] = count.toInt();

  return out;
}

class DailyUsage extends Equatable {
  final int foxyChatsUsed;
  final int quizzesUsed;

  /// Daily caps. Default to UNKNOWN — deliberately NOT the free tier. A wrong
  /// generous number over-promises; a wrong stingy number tells an entitled
  /// school student they are out of chats. Unknown says neither.
  final UsageLimit foxyChats;
  final UsageLimit quizzes;

  const DailyUsage({
    this.foxyChatsUsed = 0,
    this.quizzesUsed = 0,
    this.foxyChats = const UsageLimit.unknown(),
    this.quizzes = const UsageLimit.unknown(),
  });

  factory DailyUsage.fromJson(Map<String, dynamic> json) {
    return DailyUsage(
      foxyChatsUsed: json['foxy_chat_used'] as int? ?? 0,
      quizzesUsed: json['quiz_used'] as int? ?? 0,
      foxyChats: UsageLimit.fromServer(json['foxy_chat_limit']),
      quizzes: UsageLimit.fromServer(json['quiz_limit']),
    );
  }

  /// TRUE only when an authoritative FINITE cap is known and has been reached.
  ///
  /// Unknown or unlimited => false. This is display/UX only and must never be
  /// the thing that stops a request: enforcement is server-side
  /// (`check_and_record_usage` → HTTP 429 → `UsageLimitException`), which is
  /// where P12 actually lives. Failing open here cannot grant a student extra
  /// quota — the server still refuses — but failing CLOSED here would lock out
  /// a genuinely entitled school-covered student.
  bool get foxyLimitReached => _reached(foxyChats, foxyChatsUsed);
  bool get quizLimitReached => _reached(quizzes, quizzesUsed);

  static bool _reached(UsageLimit limit, int used) {
    if (!limit.isKnown || limit.isUnlimited) return false;
    final cap = limit.perDay;
    return cap != null && used >= cap;
  }

  @override
  List<Object?> get props =>
      [foxyChatsUsed, quizzesUsed, foxyChats, quizzes];
}
