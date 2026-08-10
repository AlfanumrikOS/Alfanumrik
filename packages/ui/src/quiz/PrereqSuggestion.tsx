'use client';

/**
 * Foxy North-Star Phase 3 (E5 / D12) — Prerequisite Warm-Up Suggestion.
 *
 * Soft, non-blocking banner shown above QuizSetup after the student picks
 * a chapter. Fetches GET /api/learn/prereq-check?subject=&grade=&chapter=
 * — the route is fail-open by design:
 *
 *   - `null` body ⇒ flag off / no gate / error ⇒ render nothing.
 *   - `{ suggestion: null }` ⇒ prereqs met ⇒ render nothing.
 *   - `{ suggestion: {...} }` ⇒ render banner with two CTAs:
 *       "Warm up"       → parent switches chapter + starts the prereq quiz.
 *       "Continue anyway" → dismiss (local); parent continues with the
 *                           originally-selected chapter as normal.
 *
 * This component never blocks quiz start. When the flag is OFF the API
 * returns null and nothing renders — fail-open UX per the route contract.
 */

import { useEffect, useState } from 'react';

export interface PrereqSuggestionData {
  prereqTopicId: string;
  prereqTitle: string;
  prereqTitleHi: string | null;
  chapterNumber: number | null;
  masteryProbability: number;
  reason: string;
  reasonHi: string;
}

export interface PrereqCheckResult {
  suggestion: PrereqSuggestionData | null;
}

export interface PrereqSuggestionProps {
  isHi: boolean;
  subject: string | null;
  /** P5: grade string "6".."12". Empty string ⇒ no fetch. */
  grade: string;
  /** null ⇒ no fetch. */
  chapter: number | null;
  /**
   * "Warm up" — parent switches the setup chapter to `suggestion.chapterNumber`
   * and kicks off the quiz. Never called with a null chapterNumber.
   */
  onWarmUp?: (prereqChapter: number, suggestion: PrereqSuggestionData) => void;
  /**
   * "Continue anyway" — parent proceeds with the originally-selected chapter.
   * The banner also dismisses locally (see internal `dismissed` state) so it
   * won't reappear for the same (subject, chapter) pair on re-render.
   */
  onDismiss?: () => void;
  /**
   * Test hook — inject a fetcher. Defaults to `fetch('/api/learn/prereq-check?…')`.
   * Return null to mimic flag-off / error.
   */
  fetchPrereq?: (params: {
    subject: string;
    grade: string;
    chapter: number;
  }) => Promise<PrereqCheckResult | null>;
}

const defaultFetchPrereq: NonNullable<PrereqSuggestionProps['fetchPrereq']> = async ({ subject, grade, chapter }) => {
  try {
    const qs = new URLSearchParams({ subject, grade, chapter: String(chapter) });
    const res = await fetch(`/api/learn/prereq-check?${qs.toString()}`, { credentials: 'same-origin' });
    if (!res.ok) return null;
    const body = await res.json().catch(() => null);
    // Contract: null body = flag off / error / no gate → fail-open (render nothing).
    if (body === null || typeof body !== 'object') return null;
    return body as PrereqCheckResult;
  } catch {
    return null;
  }
};

export default function PrereqSuggestion({
  isHi,
  subject,
  grade,
  chapter,
  onWarmUp,
  onDismiss,
  fetchPrereq = defaultFetchPrereq,
}: PrereqSuggestionProps) {
  const [suggestion, setSuggestion] = useState<PrereqSuggestionData | null>(null);
  const [dismissed, setDismissed] = useState(false);

  // Reset local dismiss when the selection changes.
  useEffect(() => {
    setDismissed(false);
    setSuggestion(null);
  }, [subject, chapter]);

  useEffect(() => {
    if (!subject || !grade || chapter === null || chapter < 1) return;
    let cancelled = false;
    (async () => {
      const result = await fetchPrereq({ subject, grade, chapter });
      if (cancelled) return;
      // Fail-open: null result → render nothing. `{ suggestion: null }` also renders nothing.
      setSuggestion(result?.suggestion ?? null);
    })();
    return () => { cancelled = true; };
  }, [subject, grade, chapter, fetchPrereq]);

  if (dismissed || !suggestion) return null;

  const title = isHi && suggestion.prereqTitleHi ? suggestion.prereqTitleHi : suggestion.prereqTitle;
  const warmUpEnabled = typeof suggestion.chapterNumber === 'number' && suggestion.chapterNumber > 0;

  return (
    <div
      className="rounded-2xl border p-4 mb-3"
      style={{
        background: 'rgba(245,166,35,0.06)',
        borderColor: 'rgba(245,166,35,0.25)',
      }}
      data-testid="prereq-suggestion"
      role="status"
      aria-live="polite"
    >
      <div className="flex items-start gap-3">
        <span aria-hidden="true" className="text-xl leading-none mt-0.5">🦊</span>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-[var(--text-1)] leading-snug">
            {isHi
              ? <>पहले <span className="font-bold">{title}</span> पर एक झट अभ्यास कर लो?</>
              : <>Foxy suggests a quick warm-up on <span className="font-bold">{title}</span> first.</>}
          </p>
          <p className="mt-1 text-xs text-[var(--text-3)]">
            {isHi ? suggestion.reasonHi : suggestion.reason}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {warmUpEnabled && (
              <button
                type="button"
                onClick={() => onWarmUp?.(suggestion.chapterNumber as number, suggestion)}
                className="px-3 py-2 rounded-xl text-xs font-bold text-foreground min-h-[44px] active:scale-95"
                style={{ background: '#F5A623' }}
                data-testid="prereq-suggestion-warmup"
              >
                {isHi ? 'वार्म-अप करो' : 'Warm up'}
              </button>
            )}
            <button
              type="button"
              onClick={() => { setDismissed(true); onDismiss?.(); }}
              className="px-3 py-2 rounded-xl text-xs font-semibold min-h-[44px] active:scale-95"
              style={{
                background: 'var(--surface-1)',
                color: 'var(--text-2)',
                border: '1px solid var(--border)',
              }}
              data-testid="prereq-suggestion-dismiss"
            >
              {isHi ? 'फिर भी जारी रखो' : 'Continue anyway'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
