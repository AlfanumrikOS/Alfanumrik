// Daily Challenge streak logic — pure Dart port of
// `packages/lib/src/challenge-streak.ts`. Mirrors that file's logic
// EXACTLY (streak progression, grade-dependent weekly mercy days,
// milestone detection at 7/30/100 days, visibility threshold).
//
// All functions are pure (no side effects, no DB calls). Configuration
// constants come from `challenge_config.dart`. Grades are always strings
// per P5.
library;

import '../../data/models/challenge_models.dart';
import 'challenge_config.dart';

// ---- Internal Helpers ----

/// Format a [DateTime] as a local YYYY-MM-DD string (timezone-safe).
String _formatLocalDate(DateTime d) {
  final y = d.year.toString().padLeft(4, '0');
  final m = d.month.toString().padLeft(2, '0');
  final day = d.day.toString().padLeft(2, '0');
  return '$y-$m-$day';
}

/// Calculate the number of calendar days between two "YYYY-MM-DD" date
/// strings. Returns positive if [todayStr] is after [lastDateStr]. Uses UTC
/// parsing to avoid timezone drift (mirrors the web's `Date.UTC` approach).
int _dayDifference(String lastDateStr, String todayStr) {
  final last = DateTime.utc(
    int.parse(lastDateStr.substring(0, 4)),
    int.parse(lastDateStr.substring(5, 7)),
    int.parse(lastDateStr.substring(8, 10)),
  );
  final today = DateTime.utc(
    int.parse(todayStr.substring(0, 4)),
    int.parse(todayStr.substring(5, 7)),
    int.parse(todayStr.substring(8, 10)),
  );
  return today.difference(last).inDays;
}

/// Get the Monday of the week containing the given "YYYY-MM-DD" date
/// string. Uses ISO week (Monday = start of week). Returns a local
/// YYYY-MM-DD string (timezone-safe; noon anchor avoids DST edge cases,
/// mirrored from the web implementation even though Dart has no DST bugs
/// in practice for date-only math).
String _getMondayOfWeek(String dateStr) {
  final d = DateTime.parse('${dateStr}T12:00:00');
  final day = d.weekday; // Dart: 1=Mon .. 7=Sun
  final diff = day - 1; // days since Monday
  final monday = d.subtract(Duration(days: diff));
  return _formatLocalDate(monday);
}

// ---- Streak Processing ----

/// Processes a daily challenge completion and returns the updated streak
/// state.
///
/// Rules:
/// - Same day: no change
/// - Consecutive day (diff=1): increment streak
/// - Missed 1 day (diff=2): use mercy if available, otherwise break streak
/// - Missed 2+ days (diff>=3): break streak (reset to 1)
/// - First ever challenge: set streak to 1
/// - Updates bestStreak if currentStreak exceeds it
/// - Resets mercy counter on new week (Monday-based)
///
/// [todayStr] is an ISO date string ("YYYY-MM-DD"). [grade] is a string
/// ("6" through "12") per P5.
StreakState processStreakDay(StreakState state, String todayStr, String grade) {
  // First ever challenge.
  if (state.lastChallengeDate == null) {
    return state.copyWith(
      currentStreak: 1,
      bestStreak: state.bestStreak < 1 ? 1 : state.bestStreak,
      lastChallengeDate: todayStr,
      mercyWeekStart: _getMondayOfWeek(todayStr),
    );
  }

  final diff = _dayDifference(state.lastChallengeDate!, todayStr);

  // Same day — no change.
  if (diff == 0) return state;

  // Reset mercy counter if we're in a new week.
  final currentMonday = _getMondayOfWeek(todayStr);
  var mercyUsed = state.mercyDaysUsedThisWeek;
  var mercyWeekStart = state.mercyWeekStart;
  if (state.mercyWeekStart != currentMonday) {
    mercyUsed = 0;
    mercyWeekStart = currentMonday;
  }

  int newStreak;
  if (diff == 1) {
    // Consecutive day — simple increment.
    newStreak = state.currentStreak + 1;
  } else if (diff == 2) {
    // Missed exactly 1 day — check mercy eligibility.
    if (checkMercyEligibility(mercyUsed, 1, grade)) {
      newStreak = state.currentStreak + 1;
      mercyUsed += 1;
    } else {
      newStreak = 1;
    }
  } else {
    // Missed 2+ days (diff >= 3) — streak breaks.
    newStreak = 1;
  }

  return state.copyWith(
    currentStreak: newStreak,
    bestStreak: newStreak > state.bestStreak ? newStreak : state.bestStreak,
    lastChallengeDate: todayStr,
    mercyDaysUsedThisWeek: mercyUsed,
    mercyWeekStart: mercyWeekStart,
  );
}

// ---- Mercy Eligibility ----

/// Checks whether a mercy day can be used. Mercy only applies to exactly 1
/// missed day. [grade] is a string per P5.
bool checkMercyEligibility(int mercyUsedThisWeek, int daysMissed, String grade) {
  if (daysMissed != 1) return false;
  final allowedMercyDays = getMercyDaysForGrade(grade);
  return mercyUsedThisWeek < allowedMercyDays;
}

// ---- Milestone Detection ----

/// Detects newly crossed streak milestones. Returns milestones that were
/// crossed (previousStreak < threshold <= newStreak) and are not already
/// in the student's badge list.
List<StreakMilestone> detectMilestones(
  int previousStreak,
  int newStreak,
  List<String> existingBadges,
) {
  final existingSet = existingBadges.toSet();

  return kStreakMilestones.where((milestone) {
    final wasBelowBefore = previousStreak < milestone.days;
    final isAtOrAboveNow = newStreak >= milestone.days;
    final notAlreadyEarned = !existingSet.contains(milestone.badgeId);
    return wasBelowBefore && isAtOrAboveNow && notAlreadyEarned;
  }).toList(growable: false);
}

// ---- Streak Visibility ----

/// Returns whether the streak should be displayed to the student. Streaks
/// below the threshold are not shown (avoids "1-day streak" clutter).
bool shouldShowStreak(int streak) => streak >= kStreakVisibilityThreshold;
