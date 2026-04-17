/// Performance Score configuration for the Alfanumrik mobile app.
///
/// Replaces the inflationary XP-level system with a bounded 0-100
/// Performance Score per subject. The score is a weighted composite:
///
///   Subject Score = (Performance x 0.80) + (Behavior x 0.20)
///
/// This file MUST stay in sync with web `src/lib/score-config.ts`.
///
/// Design principles:
/// - Bounded 0-100: students always know where they stand
/// - Bloom's ceiling rewards deeper understanding, not just recall
/// - Retention decay encourages regular revision
/// - Behavior component rewards consistency and challenge-seeking
/// - Grade-specific retention floors prevent unfair decay for younger students
///
/// IMPORTANT: Grades are STRINGS "6" through "12" (Product Invariant P5).
library;

/// Weight applied to the Performance (mastery) component of Subject Score.
const double performanceWeight = 0.80;

/// Weight applied to the Behavior (engagement) component of Subject Score.
const double behaviorWeight = 0.20;

// ─── Bloom's Ceiling Multipliers ─────────────────────────
//
// Each Bloom's level imposes a ceiling on the maximum score a student
// can achieve from questions at that level.  A student who only answers
// "remember" questions can reach at most 45% mastery on a topic.
// To break through, they must succeed at higher cognitive levels.

/// Maximum score multiplier per Bloom's taxonomy level.
const Map<String, double> bloomCeiling = {
  'remember': 0.45,
  'understand': 0.60,
  'apply': 0.75,
  'analyze': 0.85,
  'evaluate': 0.95,
  'create': 1.00,
};

/// Ordered Bloom's levels from lowest to highest cognitive demand.
const List<String> bloomLevelsOrdered = [
  'remember',
  'understand',
  'apply',
  'analyze',
  'evaluate',
  'create',
];

// ─── Grade Retention Floor ───────────────────────────────
//
// Retention decays over time when a student does not revise a topic.
// Younger students get a higher floor so their scores don't crater
// during breaks.  Older students (board exam prep) decay more
// aggressively to motivate consistent revision.
//
// Grades are STRINGS per P5.

/// Minimum retention value per grade — scores cannot decay below this floor.
///
/// Keys are grade strings ("6" through "12"), never integers (P5).
const Map<String, double> gradeRetentionFloor = {
  '6': 0.30,
  '7': 0.30,
  '8': 0.20,
  '9': 0.20,
  '10': 0.15,
  '11': 0.10,
  '12': 0.10,
};

/// Returns the retention floor for the given grade string.
/// Falls back to 0.10 (strictest) for unknown grades.
///
/// [grade] must be a String ("6" through "12"). Never an integer (P5).
double getGradeRetentionFloor(String grade) {
  return gradeRetentionFloor[grade] ?? 0.10;
}

// ─── Behavior Sub-Scores ─────────────────────────────────
//
// Six behavioral signals, each measured over a rolling window.
// Weights sum to 20 for easy mental math (each point = 1% of the
// behavior component, which itself is 20% of the total score).

/// Weights for each behavior signal.  Sum = 20.
///
/// - consistency: days active in window / window length
/// - challenge:   fraction of questions attempted above current Bloom level
/// - revision:    fraction of decaying topics revisited in window
/// - persistence: sessions completed despite low early scores
/// - breadth:     fraction of enrolled subjects with activity in window
/// - velocity:    questions answered per day in window
const Map<String, int> behaviorWeights = {
  'consistency': 4,
  'challenge': 3,
  'revision': 4,
  'persistence': 3,
  'breadth': 3,
  'velocity': 3,
};

/// Rolling window (in days) over which each behavior signal is measured.
const Map<String, int> behaviorWindows = {
  'consistency': 14,
  'challenge': 30,
  'revision': 14,
  'persistence': 30,
  'breadth': 30,
  'velocity': 7,
};

// ─── Level Thresholds ────────────────────────────────────
//
// Maps score ranges to human-readable level names.
// Same names as the old XP system for continuity, but driven by
// a bounded 0-100 score instead of unbounded XP.

/// A score-to-level mapping entry.
class LevelThreshold {
  /// Minimum score (inclusive) for this level.
  final int min;

  /// Maximum score (inclusive) for this level.
  final int max;

  /// Human-readable level name.
  final String name;

  const LevelThreshold({
    required this.min,
    required this.max,
    required this.name,
  });
}

/// Score-to-level mapping. Ranges are inclusive on both ends.
const List<LevelThreshold> levelThresholds = [
  LevelThreshold(min: 0, max: 19, name: 'Curious Cub'),
  LevelThreshold(min: 20, max: 34, name: 'Quick Learner'),
  LevelThreshold(min: 35, max: 49, name: 'Rising Star'),
  LevelThreshold(min: 50, max: 64, name: 'Knowledge Seeker'),
  LevelThreshold(min: 65, max: 74, name: 'Smart Fox'),
  LevelThreshold(min: 75, max: 84, name: 'Quiz Champion'),
  LevelThreshold(min: 85, max: 89, name: 'Study Master'),
  LevelThreshold(min: 90, max: 94, name: 'Brain Ninja'),
  LevelThreshold(min: 95, max: 97, name: 'Scholar Fox'),
  LevelThreshold(min: 98, max: 100, name: 'Grand Master'),
];

/// Returns the level name for a given Performance Score (0-100).
/// Clamps the score to [0, 100] before lookup.
///
/// [score] is the Subject Performance Score, 0-100.
String getLevelFromScore(double score) {
  final clamped = score.round().clamp(0, 100);
  for (final threshold in levelThresholds) {
    if (clamped >= threshold.min && clamped <= threshold.max) {
      return threshold.name;
    }
  }
  return 'Curious Cub';
}
