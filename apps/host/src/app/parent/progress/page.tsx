'use client';

/**
 * Parent progress page (K8). Replaces the 15-line legacy redirect stub with a
 * real weekly-highlights + monthly-synthesis surface. Reuses:
 *   - useParentChildScope (shared hook — same authenticated child scoping as
 *     parent/reports/page.tsx)
 *   - parent-portal `get_child_dashboard` (weekly viewMode)
 *   - /api/synthesis/parent-share + existing ParentShareCard
 *   - ConversationPromptsCard for the "Ask your child" surface
 *
 * P7 bilingual. P13 no PII in logs. Dynamic-imported chunks so the base page
 * stays under CAP_PAGE_KB.
 */

import { Suspense, useEffect, useState, useCallback } from 'react';
import dynamic from 'next/dynamic';
import { useSearchParams } from 'next/navigation';
import { useAuth } from '@alfanumrik/lib/AuthContext';
import { usePortalAction } from '@alfanumrik/lib/usePortalFetch';
import { useParentChildScope } from '@alfanumrik/lib/parent/use-parent-child-scope';
import { SectionErrorBoundary } from '@alfanumrik/ui/SectionErrorBoundary';
import { ConversationPromptsCard } from '@alfanumrik/ui/parent/ConversationPromptsCard';
import {
  readParentChildId,
} from '../_components/parent-child-scope';

const ParentShareCard = dynamic(
  () => import('@alfanumrik/ui/synthesis/ParentShareCard').then((m) => m.default ?? m),
  { ssr: false },
);

const t = (isHi: boolean, en: string, hi: string) => (isHi ? hi : en);

interface WeeklyReport {
  highlights?: string[];
  concerns?: string[];
  suggestion?: string;
  conversation_prompts?: string[];
}

interface MonthlySynthesisShare {
  synthesis_run_id: string;
  summary_text_en: string;
  summary_text_hi: string;
  parent_share_status: 'pending' | 'sent' | 'opted_out' | 'failed' | 'suppressed' | 'flagged';
  parent_share_sent_at: string | null;
}

function ParentProgressInner() {
  const auth = useAuth();
  const isHi = auth.isHi ?? false;
  const searchParams = useSearchParams();
  const requestedChildId = readParentChildId(searchParams);
  const { guardian, student, checking, scopeError, retry } = useParentChildScope({
    isHi,
    requestedChildId,
  });
  const api = usePortalAction('/functions/v1/parent-portal', isHi, 20_000);

  const [weekly, setWeekly] = useState<WeeklyReport | null>(null);
  const [weeklyErr, setWeeklyErr] = useState('');
  const [weeklyLoading, setWeeklyLoading] = useState(false);
  const [synthesis, setSynthesis] = useState<MonthlySynthesisShare | null>(null);
  const [synthesisErr, setSynthesisErr] = useState('');

  const loadWeekly = useCallback(async () => {
    if (!guardian || !student) return;
    setWeeklyLoading(true);
    setWeeklyErr('');
    try {
      const res = await api('get_child_dashboard', {
        guardian_id: guardian.id,
        student_id: student.id,
        date_range: 'week',
        view_mode: 'weekly',
      });
      if (res?.error) {
        setWeeklyErr(String(res.error));
      } else {
        setWeekly(res as WeeklyReport);
      }
    } catch {
      setWeeklyErr(
        t(isHi, "Couldn't load this week's report.", 'इस सप्ताह की रिपोर्ट लोड नहीं हो सकी।'),
      );
    } finally {
      setWeeklyLoading(false);
    }
  }, [api, guardian, student, isHi]);

  const loadSynthesis = useCallback(async () => {
    if (!student) return;
    try {
      const res = await fetch(
        `/api/synthesis/parent-share?student_id=${encodeURIComponent(student.id)}`,
        { credentials: 'same-origin' },
      );
      if (!res.ok) {
        setSynthesis(null);
        return;
      }
      const body = await res.json();
      setSynthesis(body?.share ?? body ?? null);
    } catch {
      setSynthesisErr(t(isHi, "Couldn't load monthly summary.", 'मासिक सारांश लोड नहीं हो सका।'));
    }
  }, [student, isHi]);

  useEffect(() => {
    void loadWeekly();
    void loadSynthesis();
  }, [loadWeekly, loadSynthesis]);

  if (checking || auth.isLoading) {
    return (
      <main className="max-w-3xl mx-auto p-4">
        <div
          className="h-32 rounded-2xl animate-pulse"
          style={{ background: 'var(--surface-2)' }}
          aria-hidden="true"
        />
      </main>
    );
  }

  if (scopeError || !student) {
    return (
      <main className="max-w-3xl mx-auto p-4 text-center">
        <p className="text-sm" style={{ color: 'var(--danger, #DC2626)' }}>
          {scopeError || t(isHi, 'No child selected.', 'कोई बच्चा चयनित नहीं।')}
        </p>
        <button
          type="button"
          onClick={retry}
          className="mt-2 py-2 px-4 rounded-lg text-sm font-semibold border-none cursor-pointer"
          style={{ background: 'var(--orange)', color: 'white' }}
        >
          {t(isHi, 'Retry', 'पुनः प्रयास')}
        </button>
      </main>
    );
  }

  return (
    <main className="max-w-3xl mx-auto p-4 flex flex-col gap-4">
      <header>
        <h1
          className="text-2xl font-extrabold m-0 font-heading"
          style={{ color: 'var(--text-1)' }}
        >
          {t(isHi, `${student.name}'s progress`, `${student.name} की प्रगति`)}
        </h1>
        <p className="text-sm mt-1 m-0" style={{ color: 'var(--text-3)' }}>
          {t(isHi, 'This week and this month, at a glance.', 'इस सप्ताह और इस महीने का सारांश।')}
        </p>
      </header>

      <SectionErrorBoundary section="Weekly Highlights">
        <section
          className="rounded-2xl p-4"
          style={{
            background: 'var(--surface-1)',
            border: '1px solid var(--border)',
            boxShadow: 'var(--shadow-sm)',
          }}
        >
          <h2
            className="text-base font-bold m-0 mb-2 font-heading"
            style={{ color: 'var(--text-1)' }}
          >
            {t(isHi, 'This week', 'इस सप्ताह')}
          </h2>
          {weeklyLoading ? (
            <div
              className="h-20 rounded-lg animate-pulse"
              style={{ background: 'var(--surface-2)' }}
              aria-hidden="true"
            />
          ) : weeklyErr ? (
            <p className="text-[13px]" style={{ color: 'var(--danger, #DC2626)' }}>
              {weeklyErr}
            </p>
          ) : weekly ? (
            <div className="flex flex-col gap-2 text-[13px]">
              {weekly.highlights && weekly.highlights.length > 0 && (
                <div>
                  <p
                    className="text-[11px] uppercase tracking-wide font-bold m-0 mb-1"
                    style={{ color: 'var(--success, #059669)' }}
                  >
                    {t(isHi, 'Highlights', 'मुख्य बातें')}
                  </p>
                  <ul className="list-disc pl-5 m-0" style={{ color: 'var(--text-1)' }}>
                    {weekly.highlights.map((h, i) => (
                      <li key={i}>{h}</li>
                    ))}
                  </ul>
                </div>
              )}
              {weekly.concerns && weekly.concerns.length > 0 && (
                <div>
                  <p
                    className="text-[11px] uppercase tracking-wide font-bold m-0 mb-1"
                    style={{ color: 'var(--warning, #F5A623)' }}
                  >
                    {t(isHi, 'Concerns', 'ध्यान देने योग्य')}
                  </p>
                  <ul className="list-disc pl-5 m-0" style={{ color: 'var(--text-1)' }}>
                    {weekly.concerns.map((c, i) => (
                      <li key={i}>{c}</li>
                    ))}
                  </ul>
                </div>
              )}
              {weekly.suggestion && (
                <p
                  className="rounded-md p-2 text-[13px] m-0"
                  style={{
                    background: 'color-mix(in srgb, var(--purple) 10%, transparent)',
                    color: 'var(--text-1)',
                  }}
                >
                  {weekly.suggestion}
                </p>
              )}
            </div>
          ) : (
            <p className="text-[13px]" style={{ color: 'var(--text-3)' }}>
              {t(isHi, 'No data yet for this week.', 'इस सप्ताह के लिए अभी डेटा नहीं।')}
            </p>
          )}
        </section>
      </SectionErrorBoundary>

      {weekly?.conversation_prompts && (
        <ConversationPromptsCard prompts={weekly.conversation_prompts} isHi={isHi} />
      )}

      {synthesis && synthesis.synthesis_run_id && (
        <SectionErrorBoundary section="Monthly Synthesis">
          <ParentShareCard
            synthesisRunId={synthesis.synthesis_run_id}
            summaryTextEn={synthesis.summary_text_en ?? ''}
            summaryTextHi={synthesis.summary_text_hi ?? ''}
            parentShareStatus={synthesis.parent_share_status ?? 'pending'}
            parentShareSentAt={synthesis.parent_share_sent_at ?? null}
          />
        </SectionErrorBoundary>
      )}
      {synthesisErr && (
        <p className="text-[12px]" style={{ color: 'var(--text-3)' }}>
          {synthesisErr}
        </p>
      )}
    </main>
  );
}

export default function ParentProgressPage() {
  return (
    <Suspense fallback={null}>
      <ParentProgressInner />
    </Suspense>
  );
}
