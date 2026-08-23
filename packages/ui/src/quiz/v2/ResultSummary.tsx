'use client';

/**
 * ResultSummary — screen 08 "Result" (`ff_quiz_result_v2`).
 *
 * PRESENTATIONAL. Fetches nothing — every value is a prop, every write is a
 * callback. This is an ADDITIVE alternative to `packages/ui/src/quiz/QuizResults.tsx`,
 * NOT a replacement: the flag branch lives in the quiz orchestrator
 * (`apps/host/src/app/(student)/quiz/page.tsx`), which renders this OR
 * QuizResults depending on `ff_quiz_result_v2` — the legacy path is
 * untouched in the `else` branch (SCREENS.md build rule 4).
 *
 * House design system only: CSS custom properties (--orange, --surface-*,
 * --text-*, --green, --red, --border, --font-display/--font-body), matching
 * packages/ui/src/today/v2/TodayHomeV2.tsx and
 * packages/ui/src/profile/v2/ProfileScreen.tsx. No third token system
 * (tokens/student-v2.ts and primitives/student-v2.tsx from the handoff are
 * deliberately NOT used — house system decision made earlier this session).
 *
 * ── P1/P2 — NOTHING is recomputed here ──────────────────────────────────
 * `results.score_percent` and `results.xp_earned` are consumed EXACTLY as
 * returned by `submitQuizResults()` / `atomic_quiz_profile_update()` — the
 * same values `QuizResults.tsx` displays. This component performs zero
 * `correct/total` or XP arithmetic of its own (quiz-integrity skill
 * Invariant 1/2/7).
 *
 * ── Mastery-band vocabulary — DELIBERATE CHOICE, flagged for assessment ──
 * SCREENS.md's illustrative copy ("Shaky → Getting it") textually matches
 * `packages/lib/src/exams/mastery-band.ts`'s `ExamReadinessBand` enum
 * (`shaky` / `getting_it` / `exam_ready` / `new`). That module is the WRONG
 * fit here on both counts its own header calls out:
 *   1. It classifies `concept_mastery.mastery_level` / `mastery_probability`
 *      PER TOPIC (keyed by `topic_id` uuid) — a signal this screen does not
 *      have. Quiz questions here carry `chapter_number` (int), not
 *      `topic_id`; joining to `concept_mastery` would need a NEW data read,
 *      which contradicts this being a pure presentation-layer pass over
 *      already-computed quiz-submission data.
 *   2. Its own docblock explicitly disclaims being "a replacement for...
 *      mastery-band-labels.ts (accuracy% dashboard ring)".
 * `packages/lib/src/dashboard/mastery-band-labels.ts` (`bandForValue` /
 * `bandLabel`), by contrast, operates on ACCURACY % — exactly
 * `results.score_percent`, already in hand — and its own docblock states
 * the value is read off accuracy specifically "so they reconcile with quiz
 * results (P1 trust)". That is the vocabulary used below: Strong / Building
 * it / Getting started (not the exam-readiness enum's wording). This choice
 * is called out prominently in the frontend agent's handoff for assessment
 * to confirm before `ff_quiz_result_v2` ramps past an internal cohort — see
 * the task report.
 *
 * ── Weak concepts / citations ────────────────────────────────────────────
 * "Weak concepts" are derived by grouping wrong responses by
 * `question.chapter_number` (the only concept-adjacent field the quiz
 * pipeline actually carries through to results) capped at 3, mirroring the
 * "three is actionable, twelve is a wall" philosophy from screen 12
 * (Progress). Each solution snippet is cited with its chapter number;
 * per the citation-integrity rule ("no citation, no render as
 * authoritative"), a wrong-answer group whose question has no valid
 * `chapter_number` is skipped from the Solutions list entirely (it may
 * still surface via the existing `MisconceptionExplainer` nudge, which is
 * intentionally framed as a non-authoritative "common slip-up" callout, not
 * a cited solution).
 *
 * ── Retry / Ask Foxy / Next task ─────────────────────────────────────────
 * - Retry reuses the EXISTING retry mechanism: the `onRetry` callback the
 *   quiz orchestrator already wires (`setScreen('select')` + state reset) —
 *   no new route.
 * - Ask Foxy reuses the EXISTING deep-link shape QuizResults.tsx already
 *   uses (`/foxy?mode=doubt&subject=<code>&bloom=<level>`).
 * - Next task is never absent (SCREENS.md: "Never a dead end") — its href
 *   comes from `useNextTask()` (packages/lib/src/quiz/v2/use-next-task.ts),
 *   which wraps the existing Today-queue mechanism and fails soft to
 *   `/today`.
 */

import { useMemo } from 'react';
import { SectionErrorBoundary } from '@alfanumrik/ui/SectionErrorBoundary';
import { Card, Button, StatCard } from '@alfanumrik/ui/ui';
import MathRenderer from '@alfanumrik/ui/math/MathRenderer';
import { bandForValue, bandLabel } from '@alfanumrik/lib/dashboard/mastery-band-labels';

export interface ResultSummaryResults {
  total: number;
  correct: number;
  score_percent: number;
  xp_earned: number;
  session_id: string;
  xp_capped?: boolean;
  xp_uncapped?: number;
  idempotent_replay?: boolean;
  /** Server-side anti-cheat verdict (SLC-5). When true, XP is 0 and the
   *  score shown is still the REAL recorded score — never overridden. */
  flagged?: boolean;
}

export interface ResultSummaryQuestion {
  id: string;
  question_text: string;
  question_hi: string | null;
  explanation: string | null;
  explanation_hi: string | null;
  /** `question_bank.bloom_level` VERBATIM — a NULLABLE column. The consumer
   *  below already applies `|| 'remember'`; the declaration simply used to
   *  disagree with runtime. */
  bloom_level: string | null;
  chapter_number: number | null;
}

export interface ResultSummaryResponse {
  question_id: string;
  selected_option: number;
  is_correct: boolean;
  time_spent: number;
}

export interface ResultSummarySubjectMeta {
  code: string;
  name: string;
  icon?: string;
  color?: string;
}

export interface ResultSummaryNextTask {
  href: string;
  labelEn: string;
  labelHi: string;
}

export interface ResultSummaryProps {
  isHi: boolean;
  results: ResultSummaryResults;
  questions: ResultSummaryQuestion[];
  responses: ResultSummaryResponse[];
  /** Wall-clock elapsed seconds for the whole session (same value
   *  QuizResults.tsx receives as `timer`). */
  timer: number;
  subject: ResultSummarySubjectMeta | null;
  nextTask: ResultSummaryNextTask;
  onRetry: () => void;
  /** Navigate to a Foxy deep link (e.g. `router.push(href)`). */
  onAskFoxy: (href: string) => void;
  /** Navigate to the "Next task" href. */
  onNextTask: (href: string) => void;
}

const BLOOM_LABELS: Record<string, { en: string; hi: string }> = {
  remember: { en: 'Recall & Memory', hi: 'याद करना' },
  understand: { en: 'Understanding', hi: 'समझना' },
  apply: { en: 'Application', hi: 'लागू करना' },
  analyze: { en: 'Analysis', hi: 'विश्लेषण' },
  evaluate: { en: 'Evaluation', hi: 'मूल्यांकन' },
  create: { en: 'Creative Thinking', hi: 'सृजन' },
};

interface WeakConcept {
  chapterNumber: number;
  wrongCount: number;
  worstBloom: string;
  /** First wrong question in this chapter — used for the Ask Foxy deep
   *  link and (when it carries an explanation) the cited solution. */
  sampleQuestion: ResultSummaryQuestion;
}

/** Group wrong responses by chapter_number, ranked by wrong-count desc, capped at 3. */
function deriveWeakConcepts(
  questions: ResultSummaryQuestion[],
  responses: ResultSummaryResponse[],
): WeakConcept[] {
  const byQid = new Map(questions.map((q) => [q.id, q]));
  const groups = new Map<number, { wrong: number; bloomCounts: Record<string, number>; sample: ResultSummaryQuestion }>();

  for (const r of responses) {
    if (r.is_correct) continue;
    const q = byQid.get(r.question_id);
    if (!q || typeof q.chapter_number !== 'number' || q.chapter_number <= 0) continue;
    const bloom = q.bloom_level || 'remember';
    const existing = groups.get(q.chapter_number);
    if (existing) {
      existing.wrong += 1;
      existing.bloomCounts[bloom] = (existing.bloomCounts[bloom] ?? 0) + 1;
    } else {
      groups.set(q.chapter_number, { wrong: 1, bloomCounts: { [bloom]: 1 }, sample: q });
    }
  }

  return Array.from(groups.entries())
    .map(([chapterNumber, g]) => {
      const worstBloom = Object.entries(g.bloomCounts).sort(([, a], [, b]) => b - a)[0]?.[0] ?? 'remember';
      return { chapterNumber, wrongCount: g.wrong, worstBloom, sampleQuestion: g.sample };
    })
    .sort((a, b) => b.wrongCount - a.wrongCount)
    .slice(0, 3);
}

function formatTime(s: number): string {
  const clamped = Math.max(0, Math.floor(s));
  return `${Math.floor(clamped / 60)}:${(clamped % 60).toString().padStart(2, '0')}`;
}

export default function ResultSummary({
  isHi,
  results,
  questions,
  responses,
  timer,
  subject,
  nextTask,
  onRetry,
  onAskFoxy,
  onNextTask,
}: ResultSummaryProps) {
  const pct = results.score_percent;
  const band = bandForValue(pct);
  const bandWord = bandLabel(band, isHi);

  const weakConcepts = useMemo(() => deriveWeakConcepts(questions, responses), [questions, responses]);

  const isReplay = results.idempotent_replay === true;

  return (
    <SectionErrorBoundary section="Quiz Result Summary">
      <div className="mesh-bg min-h-dvh pb-nav" data-testid="result-summary-v2">
        <header className="page-header">
          <div className="page-header-inner flex items-center gap-3">
            <button onClick={onRetry} className="text-[var(--text-3)] p-2 rounded-lg" aria-label={isHi ? 'वापस जाएं' : 'Go back'}>
              &larr;
            </button>
            <h1 className="text-lg font-bold" style={{ fontFamily: 'var(--font-display)' }}>
              {isHi ? 'नतीजा' : 'Result'}
            </h1>
          </div>
        </header>

        <main className="app-container py-6 space-y-5 max-w-lg mx-auto">
          {isReplay && (
            <div
              className="rounded-xl px-3 py-2 text-center"
              style={{
                background: 'color-mix(in srgb, var(--teal) 6%, transparent)',
                border: '1px solid color-mix(in srgb, var(--teal) 18%, transparent)',
                color: 'var(--teal)',
              }}
              data-testid="result-summary-replay-banner"
            >
              <p className="text-xs font-semibold">{isHi ? 'पिछला नतीजा दिखा रहे हैं' : 'Showing previous result'}</p>
            </div>
          )}

          {results.flagged === true && (
            <div
              className="rounded-xl p-3 text-center"
              style={{
                background: 'rgba(245,158,11,0.08)',
                border: '1px solid rgba(245,158,11,0.25)',
                color: '#B45309',
              }}
              data-testid="result-summary-flagged-banner"
            >
              <p className="text-xs font-semibold leading-relaxed">
                {isHi
                  ? 'इस प्रयास की समीक्षा के लिए चिह्नित किया गया, इसलिए कोई XP नहीं मिला। तुम्हारा स्कोर सहेज लिया गया है।'
                  : 'This attempt was flagged for review, so no XP was awarded. Your score is saved.'}
              </p>
            </div>
          )}

          {/* Score + band-as-words card — P1: score_percent is the exact
              server-returned value, never recomputed. The band word is a
              pure relabel of that same number via mastery-band-labels.ts. */}
          <Card accent={pct >= 60 ? 'var(--success)' : 'var(--danger)'}>
            <div className="text-center py-4" data-testid="result-summary-band">
              <div
                className="text-6xl font-bold mb-1"
                style={{ fontFamily: 'var(--font-display)', color: pct >= 60 ? 'var(--success)' : 'var(--danger)' }}
              >
                {pct}%
              </div>
              <div className="text-xl font-bold mb-2" style={{ fontFamily: 'var(--font-display)', color: 'var(--text-1)' }}>
                {bandWord}
              </div>
              {subject?.name && (
                <p className="text-sm text-[var(--text-3)]">{subject.name}</p>
              )}
            </div>
          </Card>

          <div className="grid-stats">
            <StatCard icon="✓" value={results.correct} label={isHi ? 'सही' : 'Correct'} color="var(--green)" />
            <StatCard icon="✗" value={results.total - results.correct} label={isHi ? 'गलत' : 'Wrong'} color="var(--red)" />
            <StatCard icon="✨" value={`+${results.xp_earned}`} label="XP" color="var(--accent-warm)" />
            {/* Time rendered as a formatted duration ("2:15"), never a bare
                raw-seconds integer — the words/no-float spirit for time. */}
            <StatCard icon="⏱" value={formatTime(timer)} label={isHi ? 'समय' : 'Time'} color="var(--teal)" />
          </div>

          {results.xp_capped === true && (
            <div
              className="rounded-xl p-3"
              style={{
                background: 'color-mix(in srgb, var(--accent-warm) 10%, white)',
                border: '1px solid color-mix(in srgb, var(--accent-warm) 30%, transparent)',
                color: 'var(--accent-warm-strong)',
              }}
              data-testid="result-summary-xp-cap-banner"
            >
              <p className="text-xs font-semibold leading-relaxed">
                {isHi
                  ? `🎯 आज की XP सीमा पूरी हो गई! आज आपने ${results.xp_earned} XP कमाए${
                      typeof results.xp_uncapped === 'number' && results.xp_uncapped > results.xp_earned
                        ? ` (${results.xp_uncapped} होते)`
                        : ''
                    }.`
                  : `🎯 Daily XP cap reached! You earned ${results.xp_earned} XP today${
                      typeof results.xp_uncapped === 'number' && results.xp_uncapped > results.xp_earned
                        ? ` (would have been ${results.xp_uncapped})`
                        : ''
                    }.`}
              </p>
            </div>
          )}

          {/* Weak concepts — one-line diagnosis + Ask Foxy / Retry, capped at 3 */}
          {weakConcepts.length > 0 && (
            <div data-testid="result-summary-weak-concepts">
              <p className="text-sm font-semibold text-[var(--text-2)] mb-3">
                {isHi ? 'कमज़ोर विषय' : 'Weak concepts'}
              </p>
              <div className="space-y-3">
                {weakConcepts.map((wc) => {
                  const bloomLabel = BLOOM_LABELS[wc.worstBloom] ?? { en: wc.worstBloom, hi: wc.worstBloom };
                  const diagnosisEn = `Chapter ${wc.chapterNumber} — ${wc.wrongCount} question${wc.wrongCount > 1 ? 's' : ''} missed, mostly at the ${bloomLabel.en} level.`;
                  const diagnosisHi = `अध्याय ${wc.chapterNumber} — ${wc.wrongCount} सवाल गलत, ज़्यादातर "${bloomLabel.hi}" स्तर पर।`;
                  const subjectParam = subject?.code ? `&subject=${encodeURIComponent(subject.code)}` : '';
                  const foxyHref = `/foxy?mode=doubt&bloom=${encodeURIComponent(wc.worstBloom)}${subjectParam}`;
                  const explanation = isHi && wc.sampleQuestion.explanation_hi
                    ? wc.sampleQuestion.explanation_hi
                    : wc.sampleQuestion.explanation;
                  // Citation-integrity: only render the explanation as a
                  // "solution" when it is non-empty AND we have a valid
                  // chapter number to cite it with (guaranteed here — every
                  // WeakConcept has chapterNumber > 0 by construction).
                  const hasCitedSolution = Boolean(explanation && explanation.trim().length > 0);

                  return (
                    <Card key={wc.chapterNumber} className="!p-4" data-testid={`result-summary-weak-concept-${wc.chapterNumber}`}>
                      <p className="text-sm font-semibold" style={{ color: 'var(--text-1)' }}>
                        {isHi ? diagnosisHi : diagnosisEn}
                      </p>

                      {hasCitedSolution && (
                        <div className="mt-2">
                          <span
                            className="inline-block text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full mb-1.5"
                            style={{ background: 'var(--surface-2)', color: 'var(--text-3)' }}
                          >
                            {isHi ? `NCERT · अध्याय ${wc.chapterNumber}` : `NCERT · Chapter ${wc.chapterNumber}`}
                          </span>
                          <p className="text-xs leading-relaxed" style={{ color: 'var(--text-2)' }}>
                            <MathRenderer inline content={explanation as string} />
                          </p>
                        </div>
                      )}

                      <div className="flex gap-2 mt-3">
                        <Button variant="soft" size="sm" onClick={() => onAskFoxy(foxyHref)}>
                          🦊 {isHi ? 'फॉक्सी से पूछो' : 'Ask Foxy'}
                        </Button>
                        <Button variant="ghost" size="sm" onClick={onRetry}>
                          🔄 {isHi ? 'फिर से करो' : 'Retry'}
                        </Button>
                      </div>
                    </Card>
                  );
                })}
              </div>
            </div>
          )}

          {/* Never a dead end — the last action is always Next task. */}
          <Button
            variant="primary"
            fullWidth
            onClick={() => onNextTask(nextTask.href)}
            data-testid="result-summary-next-task"
          >
            {isHi ? nextTask.labelHi : nextTask.labelEn} →
          </Button>
        </main>
      </div>
    </SectionErrorBoundary>
  );
}
