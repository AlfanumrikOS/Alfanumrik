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

class DailyUsage extends Equatable {
  final int foxyChatsUsed;
  final int foxyChatsLimit;
  final int quizzesUsed;
  final int quizzesLimit;

  const DailyUsage({
    this.foxyChatsUsed = 0,
    this.foxyChatsLimit = 5,
    this.quizzesUsed = 0,
    this.quizzesLimit = 5, // Must match web free plan: 5/day (was wrongly 3)
  });

  factory DailyUsage.fromJson(Map<String, dynamic> json) {
    return DailyUsage(
      foxyChatsUsed: json['foxy_chat_used'] as int? ?? 0,
      foxyChatsLimit: json['foxy_chat_limit'] as int? ?? 5,
      quizzesUsed: json['quiz_used'] as int? ?? 0,
      quizzesLimit: json['quiz_limit'] as int? ?? 5, // web free = 5/day
    );
  }

  bool get foxyLimitReached => foxyChatsUsed >= foxyChatsLimit;
  bool get quizLimitReached => quizzesUsed >= quizzesLimit;

  @override
  List<Object?> get props => [foxyChatsUsed, foxyChatsLimit];
}
