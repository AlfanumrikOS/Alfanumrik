import 'package:supabase_flutter/supabase_flutter.dart';

import '../../core/network/api_result.dart';
import '../models/challenge_models.dart';

/// Daily Challenge repository — direct `_client.rpc()`/`_client.from()`
/// Supabase calls, same pattern as [NotificationsRepository] /
/// [QuizRepository]'s legacy surfaces.
///
/// Table/RPC contracts (verified against `apps/host/src/app/challenge/page.tsx`
/// and `apps/host/src/types/database.types.ts`):
///   * `daily_challenges` — `grade`, `challenge_date`, `status`, `subject`,
///     `subject_hi`, `topic`, `explanation`, `explanation_hi`, `challenge_data`
///   * `challenge_streaks` — `student_id`, `current_streak`, `best_streak`,
///     `last_challenge_date`, `mercy_days_used_this_week`, `mercy_week_start`,
///     `badges`
///   * `challenge_attempts` — `student_id`, `challenge_id`, `challenge_date`,
///     `solved`, `moves`, `hints_used`, `distractors_excluded`, `time_spent`,
///     `coins_earned`
///   * `quiz_sessions` — used ONLY for the unlock gate (>= 5 questions,
///     status = completed, today)
///   * `concept_mastery` — `mastery_probability`, used to pick ZPD difficulty
///   * RPC `submit_challenge_attempt(p_student_id, p_challenge_id, p_solved,
///     p_moves, p_hints_used, p_distractors_excluded, p_time_spent,
///     p_coins_earned)` — falls back to a direct `challenge_attempts` insert
///     on failure, mirroring the web's non-fatal fallback.
///
/// P13: never logs challenge payload contents — failures are message-text
/// only.
class ChallengeRepository {
  final SupabaseClient _client;

  ChallengeRepository({SupabaseClient? client})
      : _client = client ?? Supabase.instance.client;

  /// Fetch today's challenge for [grade]. Mirrors the web's
  /// `.in('status', ['approved', 'live', 'auto_generated'])` filter.
  /// Returns `ApiSuccess(null)` (not a failure) when no challenge exists yet
  /// — that is a valid, expected state ("no-challenge" screen), not an error.
  Future<ApiResult<DailyChallenge?>> getTodayChallenge({
    required String grade,
    required String todayIso,
  }) async {
    try {
      final res = await _client
          .from('daily_challenges')
          .select()
          .eq('grade', grade)
          .eq('challenge_date', todayIso)
          .inFilter('status', const ['approved', 'live', 'auto_generated'])
          .limit(1);

      final list = res as List<dynamic>;
      if (list.isEmpty) return const ApiSuccess(null);
      return ApiSuccess(
        DailyChallenge.fromJson(Map<String, dynamic>.from(list.first as Map)),
      );
    } catch (e) {
      return ApiFailure("Failed to load today's challenge: ${e.toString()}");
    }
  }

  /// Fetch the student's streak row. Fails soft to a zeroed [StreakState]
  /// (mirrors the web's `streakRes.data ? {...} : {defaults}` handling) so a
  /// streak-fetch hiccup never blocks the rest of the challenge flow.
  Future<ApiResult<StreakState>> getStreak({required String studentId}) async {
    try {
      final res = await _client
          .from('challenge_streaks')
          .select()
          .eq('student_id', studentId)
          .limit(1)
          .maybeSingle();
      return ApiSuccess(StreakState.fromJson(res));
    } catch (e) {
      return const ApiSuccess(StreakState());
    }
  }

  /// Fetch today's attempt row, if any (`null` when the student hasn't
  /// attempted today yet — not an error).
  Future<ApiResult<ChallengeAttemptRecord?>> getTodayAttempt({
    required String studentId,
    required String todayIso,
  }) async {
    try {
      final res = await _client
          .from('challenge_attempts')
          .select()
          .eq('student_id', studentId)
          .eq('challenge_date', todayIso)
          .limit(1)
          .maybeSingle();
      if (res == null) return const ApiSuccess(null);
      return ApiSuccess(ChallengeAttemptRecord.fromJson(res));
    } catch (e) {
      return const ApiSuccess(null);
    }
  }

  /// True when the student has a completed quiz session (>= 5 questions)
  /// starting at or after [todayStartUtc] — one half of the unlock gate
  /// (the other half is the grace-period check against `students.created_at`,
  /// done by the caller since it needs no network call).
  Future<bool> hasCompletedQuizToday({
    required String studentId,
    required DateTime todayStartUtc,
  }) async {
    try {
      final res = await _client
          .from('quiz_sessions')
          .select('id, total_questions')
          .eq('student_id', studentId)
          .gte('created_at', todayStartUtc.toIso8601String())
          .eq('status', 'completed')
          .gte('total_questions', 5)
          .limit(1);
      return (res as List).isNotEmpty;
    } catch (_) {
      return false;
    }
  }

  /// Average `mastery_probability` across the student's `concept_mastery`
  /// rows with a nonzero probability. Falls back to `0.5` (matches the
  /// web's default) on failure or when there are no rows yet.
  Future<double> getAverageMastery({required String studentId}) async {
    try {
      final res = await _client
          .from('concept_mastery')
          .select('mastery_probability')
          .eq('student_id', studentId)
          .gt('mastery_probability', 0);
      final list = res as List<dynamic>;
      if (list.isEmpty) return 0.5;
      double sum = 0;
      for (final row in list) {
        final map = row as Map;
        sum += (map['mastery_probability'] as num?)?.toDouble() ?? 0;
      }
      return sum / list.length;
    } catch (_) {
      return 0.5;
    }
  }

  /// Submit a solved challenge attempt. Mirrors the web exactly: try the
  /// `submit_challenge_attempt` RPC first; on failure, fall back to a direct
  /// insert into `challenge_attempts`. Both paths are non-fatal — a failure
  /// here never blocks the student from seeing the solved screen (the
  /// attempt is recorded on next visit at worst), matching the web's
  /// try/catch-and-continue behaviour.
  Future<void> submitAttempt({
    required String studentId,
    required String challengeId,
    required String challengeDateIso,
    required bool solved,
    required int moves,
    required int hintsUsed,
    required int distractorsExcluded,
    required int timeSpent,
    required int coinsEarned,
  }) async {
    try {
      await _client.rpc('submit_challenge_attempt', params: {
        'p_student_id': studentId,
        'p_challenge_id': challengeId,
        'p_solved': solved,
        'p_moves': moves,
        'p_hints_used': hintsUsed,
        'p_distractors_excluded': distractorsExcluded,
        'p_time_spent': timeSpent,
        'p_coins_earned': coinsEarned,
      });
      return;
    } catch (_) {
      try {
        await _client.from('challenge_attempts').insert({
          'student_id': studentId,
          'challenge_id': challengeId,
          'challenge_date': challengeDateIso,
          'solved': solved,
          'moves': moves,
          'hints_used': hintsUsed,
          'distractors_excluded': distractorsExcluded,
          'time_spent': timeSpent,
          'coins_earned': coinsEarned,
        });
      } catch (_) {
        // Non-fatal: attempt recorded on next visit (mirrors web comment).
      }
    }
  }
}
