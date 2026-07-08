'use client';

/**
 * /exams/mock — Mock Test catalog.
 *
 * PR-5 of the JEE/NEET/Olympiad roadmap. Hero + filter row + paper grid.
 * Talks to GET /api/exams/papers (built in parallel) which returns:
 *   { papers: PaperSummary[], flag_enabled: boolean, total: number }
 *
 * When `flag_enabled === false`, non-CBSE-board papers are visually
 * locked and routed through /upgrade instead of /exams/mock/[id]. CBSE
 * Board papers remain selectable so free-tier students can still
 * practise board patterns.
 */

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import useSWR from 'swr';
import Link from 'next/link';
import { useAuth } from '@alfanumrik/lib/AuthContext';
import { SectionErrorBoundary } from '@alfanumrik/ui/SectionErrorBoundary';
import PaperCard, { type PaperSummary } from '@alfanumrik/ui/exams/PaperCard';

interface CatalogResponse {
  papers: PaperSummary[];
  flag_enabled: boolean;
  total: number;
}

const EXAM_FAMILY_OPTIONS = [
  { value: '', label_en: 'All Exams', label_hi: 'सभी परीक्षाएँ' },
  { value: 'jee_main', label_en: 'JEE Main', label_hi: 'JEE Main' },
  { value: 'jee_advanced', label_en: 'JEE Advanced', label_hi: 'JEE Advanced' },
  { value: 'neet', label_en: 'NEET', label_hi: 'NEET' },
  { value: 'olympiad_math', label_en: 'Olympiad Math', label_hi: 'ओलंपियाड गणित' },
  { value: 'olympiad_physics', label_en: 'Olympiad Physics', label_hi: 'ओलंपियाड भौतिकी' },
  { value: 'cbse_board', label_en: 'CBSE Board', label_hi: 'CBSE बोर्ड' },
];

const SUBJECT_OPTIONS = [
  { value: '', label_en: 'All Subjects', label_hi: 'सभी विषय' },
  { value: 'physics', label_en: 'Physics', label_hi: 'भौतिकी' },
  { value: 'chemistry', label_en: 'Chemistry', label_hi: 'रसायन' },
  { value: 'math', label_en: 'Math', label_hi: 'गणित' },
  { value: 'biology', label_en: 'Biology', label_hi: 'जीव विज्ञान' },
];

async function fetchPapers(url: string): Promise<CatalogResponse> {
  const res = await fetch(url, { credentials: 'same-origin' });
  if (res.status === 401) {
    const err = new Error('unauthenticated') as Error & { status: number };
    err.status = 401;
    throw err;
  }
  if (!res.ok) {
    const err = new Error('papers fetch failed') as Error & { status: number };
    err.status = res.status;
    throw err;
  }
  return (await res.json()) as CatalogResponse;
}

export default function MockTestCatalog() {
  const { isHi, isLoggedIn, isLoading, student } = useAuth();
  const router = useRouter();

  const [examFamily, setExamFamily] = useState<string>('');
  const [subject, setSubject] = useState<string>('');

  // Build query string from filters + student grade (when known).
  const params = new URLSearchParams();
  if (examFamily) params.set('exam_family', examFamily);
  if (subject) params.set('subject', subject);
  if (student?.grade) params.set('grade', student.grade);
  params.set('limit', '40');
  const swrKey = isLoggedIn ? `/api/exams/papers?${params.toString()}` : null;

  const { data, error, isLoading: papersLoading } = useSWR<CatalogResponse>(
    swrKey,
    fetchPapers,
    { revalidateOnFocus: false, dedupingInterval: 10000, keepPreviousData: true },
  );

  // Auth redirect — same pattern as /exams/page.tsx.
  useEffect(() => {
    if (!isLoading && !isLoggedIn) router.replace('/login');
  }, [isLoading, isLoggedIn, router]);

  // 401 from API → bounce to login.
  useEffect(() => {
    const err = error as (Error & { status?: number }) | undefined;
    if (err?.status === 401) router.replace('/login');
  }, [error, router]);

  const flagEnabled = data?.flag_enabled ?? false;
  const papers = data?.papers ?? [];

  // A paper is locked when it's NOT CBSE Board AND the competition flag is off.
  function isPaperLocked(p: PaperSummary): boolean {
    return p.exam_family !== 'cbse_board' && !flagEnabled;
  }

  function handlePaperStart(paperId: string) {
    router.push(`/exams/mock/${paperId}`);
  }

  return (
    <div className="mesh-bg min-h-dvh pb-nav">
      <header
        className="page-header"
        style={{ background: 'rgba(251,248,244,0.88)', backdropFilter: 'blur(20px)', borderColor: 'var(--border)' }}
      >
        <div className="app-container py-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <button
              onClick={() => router.push('/exams')}
              className="text-[var(--text-3)] flex-shrink-0"
              aria-label={isHi ? 'वापस' : 'Back'}
            >
              &larr;
            </button>
            <h1
              className="text-lg font-bold truncate"
              style={{ fontFamily: 'var(--font-display)' }}
            >
              {isHi ? 'मॉक टेस्ट' : 'Mock Tests'}
            </h1>
          </div>
        </div>
      </header>

      <main className="app-container py-5 space-y-5">
        <SectionErrorBoundary section="MockTests">
          {/* Hero */}
          <section className="space-y-1">
            <h2 className="text-xl font-bold" style={{ fontFamily: 'var(--font-display)' }}>
              {isHi ? 'मॉक टेस्ट' : 'Mock Tests'}
            </h2>
            <p className="text-sm text-[var(--text-3)] max-w-xl leading-relaxed">
              {isHi
                ? 'JEE / NEET / ओलंपियाड शैली के पेपर के साथ अभ्यास करें।'
                : 'Practice with JEE / NEET / Olympiad-style papers.'}
            </p>
          </section>

          {/* Upgrade banner — only when flag is off */}
          {data && !flagEnabled && (
            <div
              className="rounded-2xl p-4 flex items-start gap-3"
              style={{
                background: 'linear-gradient(135deg, rgba(124,58,237,0.08), rgba(232,88,28,0.06))',
                border: '1px solid rgba(124,58,237,0.25)',
              }}
              data-testid="mock-catalog-upgrade-banner"
            >
              <span className="text-2xl flex-shrink-0" aria-hidden="true">🔒</span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-[var(--text-1)]">
                  {isHi
                    ? 'प्रीमियम पेपर लॉक हैं — JEE / NEET / ओलंपियाड पेपर अनलॉक करने के लिए प्रतियोगिता प्लान में अपग्रेड करें।'
                    : 'Premium papers locked — upgrade to Competition plan to unlock JEE / NEET / Olympiad papers.'}
                </p>
                <Link
                  href="/upgrade"
                  className="inline-flex items-center gap-1 text-xs font-bold mt-1.5"
                  style={{ color: '#7C3AED' }}
                >
                  {isHi ? 'अपग्रेड करें' : 'Upgrade'} →
                </Link>
              </div>
            </div>
          )}

          {/* Filter row */}
          <section className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label
                htmlFor="exam-family-filter"
                className="text-xs text-[var(--text-3)] mb-1.5 block ml-1 font-medium"
              >
                {isHi ? 'परीक्षा' : 'Exam'}
              </label>
              <select
                id="exam-family-filter"
                value={examFamily}
                onChange={e => setExamFamily(e.target.value)}
                className="input-base w-full"
              >
                {EXAM_FAMILY_OPTIONS.map(o => (
                  <option key={o.value || 'all'} value={o.value}>
                    {isHi ? o.label_hi : o.label_en}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label
                htmlFor="subject-filter"
                className="text-xs text-[var(--text-3)] mb-1.5 block ml-1 font-medium"
              >
                {isHi ? 'विषय' : 'Subject'}
              </label>
              <select
                id="subject-filter"
                value={subject}
                onChange={e => setSubject(e.target.value)}
                className="input-base w-full"
              >
                {SUBJECT_OPTIONS.map(o => (
                  <option key={o.value || 'all'} value={o.value}>
                    {isHi ? o.label_hi : o.label_en}
                  </option>
                ))}
              </select>
            </div>
          </section>

          {/* Paper grid / loading / empty / error */}
          {papersLoading && !data ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {[1, 2, 3, 4].map(i => (
                <div
                  key={i}
                  className="rounded-2xl p-5 animate-pulse h-44"
                  style={{ background: 'var(--surface-2)', border: '1px solid var(--border)' }}
                />
              ))}
            </div>
          ) : error ? (
            <div className="rounded-2xl p-6 text-center" style={{ background: 'var(--surface-1)', border: '1px solid var(--border)' }}>
              <p className="text-sm text-[var(--text-3)]">
                {isHi
                  ? 'पेपर लोड नहीं हो सके। कृपया पुनः प्रयास करें।'
                  : 'Could not load papers. Please try again.'}
              </p>
            </div>
          ) : papers.length === 0 ? (
            <div className="text-center py-12">
              <div className="text-5xl mb-4" aria-hidden="true">📄</div>
              <h3 className="text-lg font-bold mb-1" style={{ fontFamily: 'var(--font-display)' }}>
                {isHi ? 'कोई पेपर नहीं मिला' : 'No papers found'}
              </h3>
              <p className="text-sm text-[var(--text-3)] max-w-xs mx-auto">
                {isHi
                  ? 'फ़िल्टर बदलकर देखें या जल्द ही और पेपर जोड़े जाएँगे।'
                  : 'Try a different filter — more papers are being added regularly.'}
              </p>
            </div>
          ) : (
            <section className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {papers.map(p => {
                const locked = isPaperLocked(p);
                return (
                  <PaperCard
                    key={p.id}
                    paper={p}
                    isLocked={locked}
                    isHi={isHi}
                    onStart={locked ? () => router.push('/upgrade') : handlePaperStart}
                  />
                );
              })}
            </section>
          )}
        </SectionErrorBoundary>
      </main>
    </div>
  );
}
