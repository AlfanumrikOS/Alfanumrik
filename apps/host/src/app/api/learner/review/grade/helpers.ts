// SM-2 moved to the canonical module (Foxy North-Star Phase 3, E4/F10).
// These two lines are the whole SM-2 surface here — route glue below is NOT SM-2.
export { applySm2 } from '@alfanumrik/lib/learn/sm2';
export type { Sm2Input, Sm2Output } from '@alfanumrik/lib/learn/sm2';

// ── Route glue (grade-endpoint specific; deliberately NOT in packages/lib) ──

export function coerceSource(
  raw: string | null,
): 'quiz_wrong_answer' | 'foxy_chat' | 'study_plan' {
  if (raw === 'quiz_wrong_answer' || raw === 'foxy_chat' || raw === 'study_plan') {
    return raw;
  }
  return 'study_plan';
}

export function parseChapterNumber(title: string | null): number | null {
  if (!title) return null;
  const match = title.match(/(?:chapter\s+)?(\d{1,3})\b/i);
  if (!match) return null;
  const n = parseInt(match[1], 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}
