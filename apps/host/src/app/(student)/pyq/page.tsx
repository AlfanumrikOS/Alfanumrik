'use client';

/**
 * /pyq — Previous-Year-Question LAUNCHER.
 *
 * WHAT THIS USED TO BE, AND WHY IT CHANGED
 * ----------------------------------------
 * Until 2026-08-11 this page was a SECOND, independent quiz runtime (~466 LOC):
 * its own question renderer, its own option grid, its own inline explanation,
 * its own "session complete" screen — and its own grading, done in the browser
 * by comparing the student's tap against a `correct_answer_index` it had just
 * SELECTed out of `question_bank`.
 *
 * Two defects, both invisible to the student:
 *
 *   1. DATA LOSS. A student answered 25-30 board questions and the product
 *      recorded nothing. No quiz_session row, no responses, no XP, no mastery,
 *      no streak. The score existed only in React state and died with the tab.
 *      /progress, /leaderboard and every parent/teacher report were blind to it.
 *
 *   2. THE ANSWER KEY WAS IN THE BROWSER. Shipping `correct_answer_index` to
 *      the client is precisely what the server-owned shuffle snapshot
 *      (`start_quiz_session` → `quiz_session_shuffles`) exists to prevent. The
 *      canonical path never sends it; this page did, for every question.
 *
 * WHAT IT IS NOW
 * --------------
 * A subject + year picker that hands off to the canonical engine:
 *
 *     /quiz?subject=<code>&year=<board year>&mode=practice
 *
 * The year is a question-SELECTION hint. `assembleQuiz` prefers rows tagged
 * with it in `question_bank.tags` and tops up from the normal pool when that
 * year is thin — the same fallback this page used to do, now with the shortfall
 * logged rather than relabelled. Everything that makes an attempt count (server
 * shuffle, P3 anti-cheat, P1 scoring, P2 XP, the P4 atomic submit) is the
 * standard `/quiz` path. Nothing about scoring is decided here.
 *
 * CONTRACT: no `correct_answer_index` is read, fetched or compared in this file.
 * `apps/host/src/__tests__/app/pyq-launcher-persistence.test.tsx` asserts that
 * statically — if a future edit reintroduces client-side grading, it fails.
 *
 * P7 bilingual throughout. P13: no student data logged.
 */

import { useCallback, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useRequireAuth } from '@alfanumrik/lib/useRequireAuth';
import { useAllowedSubjects } from '@alfanumrik/lib/useAllowedSubjects';
import { pyqYears } from '@alfanumrik/lib/quiz/pyq-years';
import { Skeleton } from '@alfanumrik/ui/ui/primitives/Skeleton';
import { SubjectsUnavailable } from '@alfanumrik/ui/learn/SubjectsUnavailable';
import { Touchable } from '@alfanumrik/ui/responsive/Touchable';

/** Questions per PYQ practice run. A valid `/quiz` count (5/10/15/20); the
 *  quiz page rejects anything else and would silently fall back to 10. */
const PYQ_QUESTION_COUNT = 15;

export default function PYQLauncherPage() {
  // Route protection is client-side in this product (see the Layer 0.9 note in
  // apps/host/src/proxy.ts): not-logged-in → /login, wrong role → /dashboard.
  const { isReady, isHi } = useRequireAuth('student');
  const router = useRouter();

  const [subject, setSubject] = useState<string | null>(null);
  const [year, setYear] = useState<number | null>(null);

  const { unlocked, locked, isLoading, degraded, refresh } = useAllowedSubjects();
  // Derived once per mount: the window must not shift mid-session if the clock
  // ticks over midnight on 31 December while the picker is open.
  const years = useMemo(() => pyqYears(), []);

  const start = useCallback(() => {
    if (!subject || year == null) return;
    router.push(
      `/quiz?subject=${encodeURIComponent(subject)}&year=${year}` +
        `&mode=practice&count=${PYQ_QUESTION_COUNT}`,
    );
  }, [subject, year, router]);

  /* ── Subject picker: loading / failure / empty / locked / ready ────────── */
  let subjectPicker: React.ReactNode;
  if (!isReady || (isLoading && unlocked.length === 0)) {
    subjectPicker = (
      <div className="grid grid-cols-2 gap-3" aria-busy="true" aria-label={isHi ? 'विषय लोड हो रहे हैं' : 'Loading subjects'}>
        {[0, 1, 2, 3].map(i => <Skeleton key={i} radius="lg" className="h-[60px]" />)}
      </div>
    );
  } else if (degraded) {
    subjectPicker = <SubjectsUnavailable isHi={isHi} variant="failure" onRetry={refresh} compact />;
  } else if (unlocked.length === 0) {
    subjectPicker = (
      <SubjectsUnavailable isHi={isHi} variant={locked.length > 0 ? 'locked' : 'empty'} compact />
    );
  } else {
    subjectPicker = (
      <div className="grid grid-cols-2 gap-3">
        {unlocked.map(s => {
          const active = subject === s.code;
          return (
            <Touchable
              key={s.code}
              onClick={() => setSubject(s.code)}
              aria-pressed={active}
              className="justify-start gap-2 rounded-2xl p-3 text-left text-base font-medium"
              style={{
                background: active ? `${s.color}20` : 'var(--surface-1)',
                border: `2px solid ${active ? s.color : 'var(--border)'}`,
                color: 'var(--text-1)',
              }}
            >
              <span aria-hidden="true" className="text-2xl" style={{ color: s.color }}>{s.icon}</span>
              <span>{isHi ? s.nameHi || s.name : s.name}</span>
            </Touchable>
          );
        })}
      </div>
    );
  }

  return (
    <div className="mesh-bg min-h-dvh pb-nav">
      <header className="page-header" style={{ background: 'var(--warm-cream, #FFF9F0)', borderBottom: '1px solid var(--border)' }}>
        <div className="app-container flex items-center gap-3 py-3">
          <Touchable onClick={() => router.back()} aria-label={isHi ? 'वापस' : 'Go back'} className="text-xl">&larr;</Touchable>
          <div>
            <h1 className="text-lg font-bold" style={{ fontFamily: 'var(--font-display)', color: 'var(--text-1)' }}>
              {isHi ? 'पिछले साल के प्रश्न' : 'PYQ Practice'}
            </h1>
            <p className="text-sm" style={{ color: 'var(--text-3)' }}>
              {isHi ? 'CBSE बोर्ड प्रश्नपत्र अभ्यास' : 'CBSE Board Paper Practice'}
            </p>
          </div>
        </div>
      </header>

      <main className="app-container space-y-8 py-6">
        <section>
          <h2 className="mb-3 text-base font-semibold" style={{ color: 'var(--text-1)' }}>
            {isHi ? '1. विषय चुनें' : '1. Choose Subject'}
          </h2>
          {subjectPicker}
        </section>

        {subject && (
          <section>
            <h2 className="mb-3 text-base font-semibold" style={{ color: 'var(--text-1)' }}>
              {isHi ? '2. वर्ष चुनें' : '2. Choose Year'}
            </h2>
            <div className="flex flex-wrap gap-2">
              {years.map(yr => {
                const active = year === yr;
                return (
                  <Touchable
                    key={yr}
                    onClick={() => setYear(yr)}
                    aria-pressed={active}
                    className="rounded-xl px-4 text-base font-semibold"
                    style={{
                      background: active ? 'var(--accent-warm-strong)' : 'var(--surface-1)',
                      color: active ? 'var(--on-accent)' : 'var(--text-1)',
                      border: `1px solid ${active ? 'var(--accent-warm-strong)' : 'var(--border)'}`,
                    }}
                  >
                    {yr}
                  </Touchable>
                );
              })}
            </div>
          </section>
        )}

        {subject && year != null && (
          <section className="space-y-3">
            <Touchable
              onClick={start}
              data-testid="pyq-start"
              className="w-full justify-center rounded-2xl px-4 text-base font-bold"
              style={{ background: 'var(--accent-warm-strong)', color: 'var(--on-accent)' }}
            >
              {isHi ? `${PYQ_QUESTION_COUNT} प्रश्नों का अभ्यास शुरू करें →` : `Start ${PYQ_QUESTION_COUNT}-question practice →`}
            </Touchable>
            {/* Said up front rather than as a badge mid-quiz: the retired runtime
                labelled a generic question-bank pull with the year the student
                picked and explained it only in a small banner. */}
            <p className="text-base leading-relaxed" style={{ color: 'var(--text-2, var(--text-3))' }}>
              {isHi
                ? `यह अभ्यास सामान्य क्विज़ की तरह चलता है, इसलिए तुम्हारा स्कोर, XP और प्रगति सेव होती है। ${year} के पेपर अभी जोड़े जा रहे हैं — अगर उस वर्ष के पर्याप्त प्रश्न नहीं हैं, तो उसी विषय और कक्षा के बोर्ड-पैटर्न प्रश्न मिलेंगे।`
                : `This runs through the normal quiz engine, so your score, XP and progress are saved. We are still adding ${year} papers — if that year is short, you will get board-pattern questions from the same subject and class.`}
            </p>
          </section>
        )}
      </main>
    </div>
  );
}
