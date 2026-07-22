// Data models for the Daily Challenge (Concept Chain game) — mobile parity
// for `apps/host/src/app/challenge/page.tsx` and the pure logic in
// `packages/lib/src/challenge-engine.ts` / `challenge-config.ts` /
// `challenge-streak.ts`.
//
// Kept as plain, JSON-serialisable data classes (mirroring the TS
// interfaces) so `challenge_engine.dart` / `challenge_streak.dart` can stay
// pure functions over these types, exactly like the web split between
// `challenge-engine.ts` (pure) and `page.tsx` (I/O).
library;

import 'package:equatable/equatable.dart';

/// A single card in the concept chain.
/// `position` = 0-based index in the correct chain; -1 for distractors.
/// Port of `ChainCard` in `challenge-engine.ts`.
class ChainCard extends Equatable {
  final String id;
  final String text;
  final String textHi;
  final int position;

  const ChainCard({
    required this.id,
    required this.text,
    required this.textHi,
    required this.position,
  });

  factory ChainCard.fromJson(Map<String, dynamic> json) => ChainCard(
        id: json['id'] as String? ?? '',
        text: json['text'] as String? ?? '',
        textHi: json['textHi'] as String? ?? '',
        position: (json['position'] as num?)?.toInt() ?? -1,
      );

  @override
  List<Object?> get props => [id, text, textHi, position];
}

/// Raw challenge data containing the full chain and available distractors.
/// Port of `ChallengeData` in `challenge-engine.ts`.
class ChallengeData extends Equatable {
  final List<ChainCard> baseChain;
  final List<ChainCard> distractors;

  const ChallengeData({
    required this.baseChain,
    required this.distractors,
  });

  factory ChallengeData.fromJson(dynamic raw) {
    if (raw is! Map) return const ChallengeData(baseChain: [], distractors: []);
    final map = Map<String, dynamic>.from(raw);
    List<ChainCard> parseList(dynamic v) {
      if (v is! List) return const [];
      return v
          .whereType<Map>()
          .map((e) => ChainCard.fromJson(Map<String, dynamic>.from(e)))
          .toList(growable: false);
    }

    return ChallengeData(
      baseChain: parseList(map['baseChain']),
      distractors: parseList(map['distractors']),
    );
  }

  @override
  List<Object?> get props => [baseChain, distractors];
}

/// The challenge as presented to a student after card selection + shuffling.
/// Port of `StudentChallenge` in `challenge-engine.ts`.
class StudentChallenge extends Equatable {
  final List<ChainCard> cards;
  final List<String> correctOrder;
  final List<String> distractorIds;

  const StudentChallenge({
    required this.cards,
    required this.correctOrder,
    required this.distractorIds,
  });

  @override
  List<Object?> get props => [cards, correctOrder, distractorIds];
}

/// Result of applying a hint — one more card locked into correct position.
/// Port of `HintResult` in `challenge-engine.ts`.
class HintResult extends Equatable {
  final List<String> newOrder;
  final List<String> lockedIds;

  const HintResult({required this.newOrder, required this.lockedIds});

  @override
  List<Object?> get props => [newOrder, lockedIds];
}

/// Difficulty configuration for a ZPD range. Port of `ChallengeDifficulty`
/// in `challenge-config.ts`.
class ChallengeDifficulty extends Equatable {
  final int cardCount;
  final int distractorCount;
  final String band; // 'low' | 'medium' | 'high' | 'expert'

  const ChallengeDifficulty({
    required this.cardCount,
    required this.distractorCount,
    required this.band,
  });

  @override
  List<Object?> get props => [cardCount, distractorCount, band];
}

/// Streak milestone badge definition. Port of `StreakMilestone` in
/// `challenge-config.ts`.
class StreakMilestone extends Equatable {
  final int days;
  final String badgeId;
  final String badgeLabel;
  final String badgeLabelHi;
  final String badgeIcon;
  final int coins;

  const StreakMilestone({
    required this.days,
    required this.badgeId,
    required this.badgeLabel,
    required this.badgeLabelHi,
    required this.badgeIcon,
    required this.coins,
  });

  @override
  List<Object?> get props => [days, badgeId, badgeLabel, badgeLabelHi, badgeIcon, coins];
}

/// Complete streak state for a student. Port of `StreakState` in
/// `challenge-streak.ts`.
class StreakState extends Equatable {
  final int currentStreak;
  final int bestStreak;
  final String? lastChallengeDate; // ISO date string "YYYY-MM-DD"
  final int mercyDaysUsedThisWeek;
  final String? mercyWeekStart; // ISO date string "YYYY-MM-DD" (Monday)
  final List<String> badges;

  const StreakState({
    this.currentStreak = 0,
    this.bestStreak = 0,
    this.lastChallengeDate,
    this.mercyDaysUsedThisWeek = 0,
    this.mercyWeekStart,
    this.badges = const [],
  });

  factory StreakState.fromJson(Map<String, dynamic>? json) {
    if (json == null) return const StreakState();
    final badgesRaw = json['badges'];
    return StreakState(
      currentStreak: (json['current_streak'] as num?)?.toInt() ?? 0,
      bestStreak: (json['best_streak'] as num?)?.toInt() ?? 0,
      lastChallengeDate: json['last_challenge_date'] as String?,
      mercyDaysUsedThisWeek:
          (json['mercy_days_used_this_week'] as num?)?.toInt() ?? 0,
      mercyWeekStart: json['mercy_week_start'] as String?,
      badges: badgesRaw is List
          ? badgesRaw.map((e) => e.toString()).toList(growable: false)
          : const [],
    );
  }

  StreakState copyWith({
    int? currentStreak,
    int? bestStreak,
    String? lastChallengeDate,
    int? mercyDaysUsedThisWeek,
    String? mercyWeekStart,
    List<String>? badges,
  }) {
    return StreakState(
      currentStreak: currentStreak ?? this.currentStreak,
      bestStreak: bestStreak ?? this.bestStreak,
      lastChallengeDate: lastChallengeDate ?? this.lastChallengeDate,
      mercyDaysUsedThisWeek:
          mercyDaysUsedThisWeek ?? this.mercyDaysUsedThisWeek,
      mercyWeekStart: mercyWeekStart ?? this.mercyWeekStart,
      badges: badges ?? this.badges,
    );
  }

  @override
  List<Object?> get props => [
        currentStreak,
        bestStreak,
        lastChallengeDate,
        mercyDaysUsedThisWeek,
        mercyWeekStart,
        badges,
      ];
}

/// One row from `daily_challenges` (mirrors the fields the web page reads
/// off the Supabase row: `id`, `subject`, `subject_hi`, `topic`,
/// `explanation`, `explanation_hi`, `challenge_data`).
class DailyChallenge extends Equatable {
  final String id;
  final String subject;
  final String? subjectHi;
  final String? topic;
  final String? explanation;
  final String? explanationHi;
  final ChallengeData challengeData;

  const DailyChallenge({
    required this.id,
    required this.subject,
    this.subjectHi,
    this.topic,
    this.explanation,
    this.explanationHi,
    required this.challengeData,
  });

  factory DailyChallenge.fromJson(Map<String, dynamic> json) {
    return DailyChallenge(
      id: json['id'] as String? ?? '',
      subject: json['subject'] as String? ?? '',
      subjectHi: json['subject_hi'] as String?,
      topic: json['topic'] as String?,
      explanation: json['explanation'] as String?,
      explanationHi: json['explanation_hi'] as String?,
      challengeData: ChallengeData.fromJson(json['challenge_data']),
    );
  }

  @override
  List<Object?> get props =>
      [id, subject, subjectHi, topic, explanation, explanationHi, challengeData];
}

/// One row from `challenge_attempts` — today's attempt, if any.
class ChallengeAttemptRecord extends Equatable {
  final bool solved;
  final int moves;
  final int hintsUsed;
  final int distractorsExcluded;
  final int timeSpent;
  final int coinsEarned;

  const ChallengeAttemptRecord({
    this.solved = false,
    this.moves = 0,
    this.hintsUsed = 0,
    this.distractorsExcluded = 0,
    this.timeSpent = 0,
    this.coinsEarned = 0,
  });

  factory ChallengeAttemptRecord.fromJson(Map<String, dynamic> json) {
    return ChallengeAttemptRecord(
      solved: json['solved'] as bool? ?? false,
      moves: (json['moves'] as num?)?.toInt() ?? 0,
      hintsUsed: (json['hints_used'] as num?)?.toInt() ?? 0,
      distractorsExcluded: (json['distractors_excluded'] as num?)?.toInt() ?? 0,
      timeSpent: (json['time_spent'] as num?)?.toInt() ?? 0,
      coinsEarned: (json['coins_earned'] as num?)?.toInt() ?? 0,
    );
  }

  @override
  List<Object?> get props =>
      [solved, moves, hintsUsed, distractorsExcluded, timeSpent, coinsEarned];
}
