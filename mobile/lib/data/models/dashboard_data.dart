import 'package:equatable/equatable.dart';

class DashboardData extends Equatable {
  final int xpTotal;
  final int level;
  final int streakDays;
  final int topicsCompleted;
  final int quizzesTaken;
  final int chatSessionsToday;
  final double avgQuizScore;
  final List<RecentActivity> recentActivity;
  final DailyUsage usage;

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
    );
  }

  String get levelName {
    const names = [
      '', 'Curious Cub', 'Explorer', 'Scholar', 'Thinker',
      'Achiever', 'Innovator', 'Mastermind', 'Genius', 'Legend', 'Prodigy',
    ];
    return level < names.length ? names[level] : 'Level $level';
  }

  int get xpForNextLevel => level * 500;
  double get levelProgress => xpTotal > 0
      ? (xpTotal % xpForNextLevel) / xpForNextLevel
      : 0;

  @override
  List<Object?> get props => [xpTotal, level, streakDays, topicsCompleted];
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
    this.quizzesLimit = 3,
  });

  factory DailyUsage.fromJson(Map<String, dynamic> json) {
    return DailyUsage(
      foxyChatsUsed: json['foxy_chat_used'] as int? ?? 0,
      foxyChatsLimit: json['foxy_chat_limit'] as int? ?? 5,
      quizzesUsed: json['quiz_used'] as int? ?? 0,
      quizzesLimit: json['quiz_limit'] as int? ?? 3,
    );
  }

  bool get foxyLimitReached => foxyChatsUsed >= foxyChatsLimit;
  bool get quizLimitReached => quizzesUsed >= quizzesLimit;

  @override
  List<Object?> get props => [foxyChatsUsed, foxyChatsLimit];
}
