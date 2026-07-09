export interface ProgressRowMinimal {
  id: string;
  is_completed: boolean | null;
  completed_at: string | null;
}

export function shouldPublishLessonCompleted(
  before: ProgressRowMinimal | null,
  after: ProgressRowMinimal | null,
): boolean {
  if (!after) return false;
  if (after.is_completed !== true) return false;
  if (before === null) return true;
  return before.is_completed !== true;
}

export function computeDurationSec(
  startedAtIso: string | undefined,
  now: Date,
): number {
  if (!startedAtIso) return 0;
  const parsed = Date.parse(startedAtIso);
  if (!Number.isFinite(parsed)) return 0;
  const deltaMs = now.getTime() - parsed;
  if (deltaMs <= 0) return 0;
  const sec = Math.round(deltaMs / 1000);
  return Math.min(sec, 6 * 60 * 60);
}
