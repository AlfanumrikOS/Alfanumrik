'use client';

/**
 * MomentumRail — forward momentum strip for the Alfa OS Subjects hub
 * (ff_subjects_os_v1, Tier 1 / presentation-only).
 *
 * Reuses the EXISTING getLearningVelocity (predicted mastery date + weekly
 * rate) and the EXISTING ScoreCard for the current subject score. No mastery /
 * score is computed here — ScoreCard renders the accuracy the engine already
 * produced; the velocity numbers are read straight from `learning_velocity`.
 *
 * States: loading (skeleton), error (distinct), empty (no velocity / score yet).
 */

import { useEffect, useState } from 'react';
import { Skeleton } from '@alfanumrik/ui/ui';
import ScoreCard from '@alfanumrik/ui/score/ScoreCard';
import { getLearningVelocity, getStudentProfiles } from '@alfanumrik/lib/supabase';
import type { LearningVelocity, StudentLearningProfile } from '@alfanumrik/lib/types';

interface MomentumRailProps {
  studentId: string;
  subjectCode: string;
  subjectName: string;
  subjectNameHi: string;
  isHi: boolean;
}

interface State {
  status: 'loading' | 'error' | 'ready';
  velocity: LearningVelocity | undefined;
  scorePct: number | null;
}

function formatDate(iso: string | null, isHi: boolean): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  try {
    return d.toLocaleDateString(isHi ? 'hi-IN' : 'en-IN', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  } catch {
    return d.toISOString().slice(0, 10);
  }
}

export default function MomentumRail({
  studentId,
  subjectCode,
  subjectName,
  subjectNameHi,
  isHi,
}: MomentumRailProps) {
  const [state, setState] = useState<State>({ status: 'loading', velocity: undefined, scorePct: null });

  useEffect(() => {
    let cancelled = false;
    setState((s) => ({ ...s, status: 'loading' }));
    (async () => {
      try {
        const [velocity, profiles] = await Promise.all([
          getLearningVelocity(studentId, subjectCode),
          getStudentProfiles(studentId),
        ]);
        if (cancelled) return;
        const profile = (profiles as StudentLearningProfile[]).find((p) => p.subject === subjectCode);
        const scorePct =
          profile && profile.total_questions_asked > 0
            ? Math.round(
                (profile.total_questions_answered_correctly / profile.total_questions_asked) * 100,
              )
            : null;
        setState({
          status: 'ready',
          velocity: (velocity as LearningVelocity[])?.[0],
          scorePct,
        });
      } catch {
        if (!cancelled) setState((s) => ({ ...s, status: 'error' }));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [studentId, subjectCode]);

  const predicted = formatDate(state.velocity?.predicted_mastery_date ?? null, isHi);
  const weeklyRate =
    state.velocity?.weekly_mastery_rate != null
      ? Math.round((state.velocity.weekly_mastery_rate ?? 0) * 100)
      : null;

  return (
    <section aria-label={isHi ? 'गति' : 'Momentum'}>
      <h2 className="text-sm font-bold uppercase tracking-wider mb-3" style={{ color: 'var(--text-3)' }}>
        {isHi ? 'गति' : 'Momentum'}
      </h2>

      {state.status === 'loading' ? (
        <div className="space-y-2">
          <Skeleton height={120} rounded="rounded-2xl" />
          <Skeleton height={56} rounded="rounded-2xl" />
        </div>
      ) : state.status === 'error' ? (
        <div
          className="rounded-2xl p-4 text-center text-sm"
          style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--orange)' }}
          role="status"
        >
          {isHi ? 'गति डेटा अभी लोड नहीं हो पाया।' : "Couldn't load momentum data right now."}
        </div>
      ) : state.scorePct == null && !predicted ? (
        <div
          className="rounded-2xl p-4 text-center text-sm"
          style={{ background: 'var(--surface-2)', border: '1px dashed var(--border)', color: 'var(--text-3)' }}
        >
          {isHi
            ? 'कुछ क्विज़ देने के बाद यहाँ तुम्हारी गति दिखेगी।'
            : 'Take a few quizzes and your momentum shows here.'}
        </div>
      ) : (
        <div className="space-y-2">
          {state.scorePct != null && (
            <ScoreCard
              subject={subjectName}
              subjectHi={subjectNameHi}
              score={state.scorePct}
              isHi={isHi}
            />
          )}
          {(predicted || weeklyRate != null) && (
            <div
              className="rounded-2xl p-3 flex items-center gap-3"
              style={{ background: 'var(--surface-1)', border: '1px solid var(--border)' }}
            >
              <span className="text-lg" aria-hidden="true">🎯</span>
              <div className="text-xs" style={{ color: 'var(--text-2)' }}>
                {predicted ? (
                  <span>
                    {isHi ? 'अनुमानित महारत: ' : 'On track to master by '}
                    <strong style={{ color: 'var(--text-1)' }}>{predicted}</strong>
                  </span>
                ) : (
                  <span>
                    {isHi ? 'साप्ताहिक प्रगति: ' : 'Weekly progress: '}
                    <strong style={{ color: 'var(--teal)' }}>{weeklyRate}%</strong>
                  </span>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
