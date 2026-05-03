/// Goal-Adaptive Learning Layers — GoalProfile Dart twin.
///
/// Phase 6 of the Goal-Adaptive Learning Layers feature. Pure data + types.
/// Mirrors the contract in `src/lib/goals/goal-profile.ts` (web).
///
/// Authored: 2026-05-03
/// Owner: mobile (Dart twin) + assessment (rules)
///
/// Founder constraint: this file ships dormant. No mobile screen reads it
/// yet. The web-side feature flags (ff_goal_profiles, ff_goal_aware_foxy,
/// ff_goal_aware_selection, ff_goal_daily_plan, ff_goal_aware_rag,
/// ff_goal_daily_plan_reminder) are server-side and not consumed here;
/// the mobile UI surfaces this data lazily when the consumer widgets
/// are wired into the existing dashboard / parent / teacher screens.
///
/// Pure: zero Flutter imports, zero IO, zero side effects. All strings
/// are author-written literals. Web ↔ mobile string equivalence is
/// pinned by the test suite (test/data/models/goal_profile_test.dart).

library;

/// All 6 academic goals a student can choose. Strings match the
/// web-side TypeScript GoalCode union exactly.
enum GoalCode {
  improveBasics('improve_basics'),
  passComfortably('pass_comfortably'),
  schoolTopper('school_topper'),
  boardTopper('board_topper'),
  competitiveExam('competitive_exam'),
  olympiad('olympiad');

  final String code;
  const GoalCode(this.code);

  /// Resolve a raw string code (e.g. 'board_topper') to the enum value,
  /// or return null for unknown / null / empty input.
  static GoalCode? fromCode(String? code) {
    if (code == null || code.isEmpty) return null;
    for (final g in GoalCode.values) {
      if (g.code == code) return g;
    }
    return null;
  }
}

/// Difficulty distribution: easy + medium + hard sums to 1.0 (± 1e-9).
class DifficultyMix {
  final double easy;
  final double medium;
  final double hard;
  const DifficultyMix({required this.easy, required this.medium, required this.hard});
}

/// Bloom's taxonomy band: 1=remember, 2=understand, 3=apply, 4=analyze,
/// 5=evaluate, 6=create. min ≤ max.
class BloomBand {
  final int min;
  final int max;
  const BloomBand({required this.min, required this.max});
}

enum SourceTag {
  ncert('ncert'),
  pyq('pyq'),
  jeeArchive('jee_archive'),
  neetArchive('neet_archive'),
  olympiad('olympiad'),
  curated('curated');

  final String tag;
  const SourceTag(this.tag);
}

enum PacePolicy {
  patient('patient'),
  steady('steady'),
  push('push'),
  campaign('campaign'),
  selective('selective');

  final String value;
  const PacePolicy(this.value);
}

enum ScorecardTone {
  encouraging('encouraging'),
  analytical('analytical'),
  examiner('examiner');

  final String value;
  const ScorecardTone(this.value);
}

class GoalProfile {
  final GoalCode code;
  final String labelEn;
  final String labelHi;
  final DifficultyMix difficultyMix;
  final BloomBand bloomBand;
  final List<SourceTag> sourcePriority;
  final double masteryThreshold;
  final int dailyTargetMinutes;
  final PacePolicy pacePolicy;
  final ScorecardTone scorecardTone;
  final String dashboardCalloutEn;
  final String dashboardCalloutHi;

  const GoalProfile({
    required this.code,
    required this.labelEn,
    required this.labelHi,
    required this.difficultyMix,
    required this.bloomBand,
    required this.sourcePriority,
    required this.masteryThreshold,
    required this.dailyTargetMinutes,
    required this.pacePolicy,
    required this.scorecardTone,
    required this.dashboardCalloutEn,
    required this.dashboardCalloutHi,
  });
}

/// All 6 GoalProfiles. Values MUST stay in lockstep with
/// src/lib/goals/goal-profile.ts on the web side. Drift is detected
/// by integration tests that pull both sides.
const Map<GoalCode, GoalProfile> goalProfiles = {
  GoalCode.improveBasics: GoalProfile(
    code: GoalCode.improveBasics,
    labelEn: 'Improve Basics',
    labelHi: 'बेसिक्स सुधारें',
    difficultyMix: DifficultyMix(easy: 0.60, medium: 0.35, hard: 0.05),
    bloomBand: BloomBand(min: 1, max: 3),
    sourcePriority: [SourceTag.ncert, SourceTag.curated],
    masteryThreshold: 0.60,
    dailyTargetMinutes: 10,
    pacePolicy: PacePolicy.patient,
    scorecardTone: ScorecardTone.encouraging,
    dashboardCalloutEn: 'Today: one concept at a time',
    dashboardCalloutHi: 'आज: एक-एक अवधारणा पर ध्यान',
  ),
  GoalCode.passComfortably: GoalProfile(
    code: GoalCode.passComfortably,
    labelEn: 'Pass Comfortably',
    labelHi: 'आराम से पास',
    difficultyMix: DifficultyMix(easy: 0.40, medium: 0.45, hard: 0.15),
    bloomBand: BloomBand(min: 1, max: 4),
    sourcePriority: [SourceTag.ncert, SourceTag.pyq],
    masteryThreshold: 0.70,
    dailyTargetMinutes: 20,
    pacePolicy: PacePolicy.steady,
    scorecardTone: ScorecardTone.encouraging,
    dashboardCalloutEn: 'Top board-frequency topics today',
    dashboardCalloutHi: 'बोर्ड में सबसे अधिक पूछे जाने वाले विषय आज',
  ),
  GoalCode.schoolTopper: GoalProfile(
    code: GoalCode.schoolTopper,
    labelEn: 'School Topper',
    labelHi: 'स्कूल टॉपर',
    difficultyMix: DifficultyMix(easy: 0.30, medium: 0.50, hard: 0.20),
    bloomBand: BloomBand(min: 1, max: 5),
    sourcePriority: [SourceTag.ncert, SourceTag.pyq, SourceTag.curated],
    masteryThreshold: 0.80,
    dailyTargetMinutes: 30,
    pacePolicy: PacePolicy.push,
    scorecardTone: ScorecardTone.analytical,
    dashboardCalloutEn: 'Today: depth + application',
    dashboardCalloutHi: 'आज: गहराई और अनुप्रयोग',
  ),
  GoalCode.boardTopper: GoalProfile(
    code: GoalCode.boardTopper,
    labelEn: 'Board Topper (90%+)',
    labelHi: 'बोर्ड टॉपर (90%+)',
    difficultyMix: DifficultyMix(easy: 0.20, medium: 0.45, hard: 0.35),
    bloomBand: BloomBand(min: 2, max: 6),
    sourcePriority: [SourceTag.pyq, SourceTag.ncert, SourceTag.curated],
    masteryThreshold: 0.85,
    dailyTargetMinutes: 45,
    pacePolicy: PacePolicy.campaign,
    scorecardTone: ScorecardTone.examiner,
    dashboardCalloutEn: "Today's PYQ streak: 5 board questions",
    dashboardCalloutHi: 'आज की PYQ श्रृंखला: 5 बोर्ड प्रश्न',
  ),
  GoalCode.competitiveExam: GoalProfile(
    code: GoalCode.competitiveExam,
    labelEn: 'JEE/NEET Prep',
    labelHi: 'JEE/NEET तैयारी',
    difficultyMix: DifficultyMix(easy: 0.10, medium: 0.40, hard: 0.50),
    bloomBand: BloomBand(min: 3, max: 6),
    sourcePriority: [SourceTag.jeeArchive, SourceTag.neetArchive, SourceTag.ncert, SourceTag.curated],
    masteryThreshold: 0.85,
    dailyTargetMinutes: 60,
    pacePolicy: PacePolicy.campaign,
    scorecardTone: ScorecardTone.analytical,
    dashboardCalloutEn: 'JEE/NEET targeted set today',
    dashboardCalloutHi: 'आज JEE/NEET लक्षित अभ्यास',
  ),
  GoalCode.olympiad: GoalProfile(
    code: GoalCode.olympiad,
    labelEn: 'Olympiad Prep',
    labelHi: 'ओलंपियाड',
    difficultyMix: DifficultyMix(easy: 0.05, medium: 0.25, hard: 0.70),
    bloomBand: BloomBand(min: 4, max: 6),
    sourcePriority: [SourceTag.olympiad, SourceTag.ncert, SourceTag.curated],
    masteryThreshold: 0.90,
    dailyTargetMinutes: 60,
    pacePolicy: PacePolicy.selective,
    scorecardTone: ScorecardTone.analytical,
    dashboardCalloutEn: '1 olympiad challenge today',
    dashboardCalloutHi: 'आज 1 ओलंपियाड चुनौती',
  ),
};

/// Resolve a goal profile from a raw string code. Returns null for
/// null / empty / unknown values.
GoalProfile? resolveGoalProfile(String? code) {
  final goal = GoalCode.fromCode(code);
  if (goal == null) return null;
  return goalProfiles[goal];
}
