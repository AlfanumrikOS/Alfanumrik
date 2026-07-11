import type { StudentSnapshot } from './types';

type ProfileRow = {
  xp?: number | null;
  streak_days?: number | null;
  total_questions_answered_correctly?: number | null;
  total_questions_asked?: number | null;
};

type DataResult<T> = { data: T | null; error?: unknown };
type CountResult = { count: number | null; error?: unknown };

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function normalizeStudentSnapshot(value: unknown): StudentSnapshot {
  const snapshot = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  return {
    total_xp: finiteNumber(snapshot.total_xp),
    current_streak: finiteNumber(snapshot.current_streak),
    topics_mastered: finiteNumber(snapshot.topics_mastered),
    topics_in_progress: finiteNumber(snapshot.topics_in_progress),
    quizzes_taken: finiteNumber(snapshot.quizzes_taken),
    avg_score: finiteNumber(snapshot.avg_score),
  };
}

export function buildFallbackStudentSnapshot({
  profilesResult,
  masteredResult,
  inProgressResult,
  quizzesResult,
}: {
  profilesResult: DataResult<ProfileRow[]>;
  masteredResult: CountResult;
  inProgressResult: CountResult;
  quizzesResult: CountResult;
}): StudentSnapshot {
  const profilesAvailable = !profilesResult.error && Array.isArray(profilesResult.data);
  const profiles = profilesAvailable ? profilesResult.data! : [];
  const totalCorrect = profiles.reduce((sum, row) => sum + (finiteNumber(row.total_questions_answered_correctly) ?? 0), 0);
  const totalAsked = profiles.reduce((sum, row) => sum + (finiteNumber(row.total_questions_asked) ?? 0), 0);

  return {
    total_xp: profilesAvailable ? profiles.reduce((sum, row) => sum + (finiteNumber(row.xp) ?? 0), 0) : null,
    current_streak: profilesAvailable ? Math.max(...profiles.map((row) => finiteNumber(row.streak_days) ?? 0), 0) : null,
    topics_mastered: masteredResult.error ? null : finiteNumber(masteredResult.count),
    topics_in_progress: inProgressResult.error ? null : finiteNumber(inProgressResult.count),
    quizzes_taken: quizzesResult.error ? null : finiteNumber(quizzesResult.count),
    avg_score: profilesAvailable && totalAsked > 0 ? Math.round((totalCorrect / totalAsked) * 100) : null,
  };
}
