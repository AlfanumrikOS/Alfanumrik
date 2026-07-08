'use client';

/**
 * /exams/mock/[paperId] — Mock Test runner page.
 *
 * Fetches the paper via GET /api/exams/papers/[id] and hands off to
 * <MockTestRunner /> for the actual one-question-at-a-time UI. Handles
 * three response shapes from the backend:
 *
 *   200 → render runner
 *   402 → render Competition-plan upsell card (paper requires the
 *         ff_competitive_exams_v1 flag, which is OFF for this student)
 *   404 → redirect back to /exams/mock
 *
 * P5 — grade not used here; paper carries authoritative duration.
 * P7 — bilingual via isHi.
 */

import { useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import useSWR from 'swr';
import Link from 'next/link';
import { useAuth } from '@alfanumrik/lib/AuthContext';
import { LoadingFoxy } from '@alfanumrik/ui/ui';
import MockTestRunner, {
  type MockTestPaper,
  type MockTestQuestion,
} from '@alfanumrik/ui/exams/MockTestRunner';

interface PaperResponseSuccess {
  paper: MockTestPaper;
  questions: MockTestQuestion[];
  served_count: number;
  viewer_role: 'student' | 'admin' | 'teacher' | string;
}

interface PaperResponseUpgrade {
  error: 'competition_plan_required';
  upgrade_url: string;
}

type FetchResult =
  | { kind: 'ok'; data: PaperResponseSuccess }
  | { kind: 'upgrade'; data: PaperResponseUpgrade }
  | { kind: 'not_found' };

async function fetchPaper(url: string): Promise<FetchResult> {
  const res = await fetch(url, { credentials: 'same-origin' });
  if (res.status === 401) {
    const err = new Error('unauthenticated') as Error & { status: number };
    err.status = 401;
    throw err;
  }
  if (res.status === 402) {
    const body = (await res.json()) as PaperResponseUpgrade;
    return { kind: 'upgrade', data: body };
  }
  if (res.status === 404) {
    return { kind: 'not_found' };
  }
  if (!res.ok) {
    const err = new Error('paper fetch failed') as Error & { status: number };
    err.status = res.status;
    throw err;
  }
  const body = (await res.json()) as PaperResponseSuccess;
  return { kind: 'ok', data: body };
}

export default function MockTestRunnerPage() {
  const { isHi, isLoggedIn, isLoading } = useAuth();
  const router = useRouter();
  const params = useParams<{ paperId: string }>();
  const paperId = params?.paperId;

  const { data, error, isLoading: paperLoading } = useSWR<FetchResult>(
    isLoggedIn && paperId ? `/api/exams/papers/${paperId}` : null,
    fetchPaper,
    { revalidateOnFocus: false, dedupingInterval: 10000 },
  );

  // Auth redirect.
  useEffect(() => {
    if (!isLoading && !isLoggedIn) router.replace('/login');
  }, [isLoading, isLoggedIn, router]);

  // 401 → login. 404 → catalog.
  useEffect(() => {
    const err = error as (Error & { status?: number }) | undefined;
    if (err?.status === 401) router.replace('/login');
  }, [error, router]);

  useEffect(() => {
    if (data?.kind === 'not_found') {
      router.replace('/exams/mock');
    }
  }, [data, router]);

  if (isLoading || paperLoading || !data) return <LoadingFoxy />;

  if (data.kind === 'upgrade') {
    const upgradeUrl = data.data.upgrade_url || '/upgrade';
    return (
      <div className="mesh-bg min-h-dvh flex items-center justify-center p-6">
        <div
          className="rounded-2xl p-6 max-w-md w-full text-center space-y-4"
          style={{
            background: 'var(--surface-1)',
            border: '1px solid var(--border)',
            boxShadow: 'var(--shadow-md)',
          }}
          data-testid="mock-test-upgrade-card"
        >
          <div className="text-5xl" aria-hidden="true">🔒</div>
          <h2 className="text-lg font-bold" style={{ fontFamily: 'var(--font-display)' }}>
            {isHi ? 'प्रतियोगिता प्लान आवश्यक' : 'Competition plan required'}
          </h2>
          <p className="text-sm text-[var(--text-3)] leading-relaxed">
            {isHi
              ? 'JEE, NEET और ओलंपियाड पेपर्स प्रतियोगिता प्लान के साथ अनलॉक होते हैं।'
              : 'JEE, NEET, and Olympiad papers unlock with the Competition plan.'}
          </p>
          <div className="flex flex-col gap-2 pt-2">
            <Link
              href={upgradeUrl}
              className="inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-bold"
              style={{
                background: 'linear-gradient(135deg, var(--purple, #7C3AED), var(--orange))',
                color: '#fff',
              }}
            >
              {isHi ? 'अपग्रेड करें' : 'Upgrade'}
            </Link>
            <Link
              href="/exams/mock"
              className="inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold"
              style={{
                background: 'var(--surface-2)',
                color: 'var(--text-1)',
                border: '1px solid var(--border)',
              }}
            >
              {isHi ? 'अन्य पेपर देखें' : 'Browse free papers'}
            </Link>
          </div>
        </div>
      </div>
    );
  }

  if (data.kind === 'not_found') {
    // useEffect above already triggered router.replace(); keep showing the loader.
    return <LoadingFoxy />;
  }

  const { paper, questions } = data.data;

  if (!questions || questions.length === 0) {
    return (
      <div className="mesh-bg min-h-dvh flex items-center justify-center p-6">
        <div
          className="rounded-2xl p-6 max-w-md w-full text-center space-y-3"
          style={{ background: 'var(--surface-1)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-md)' }}
        >
          <div className="text-5xl" aria-hidden="true">📭</div>
          <h2 className="text-lg font-bold" style={{ fontFamily: 'var(--font-display)' }}>
            {isHi ? 'पेपर अभी तैयार नहीं' : 'Paper not ready yet'}
          </h2>
          <p className="text-sm text-[var(--text-3)]">
            {isHi
              ? 'इस पेपर में अभी प्रश्न नहीं हैं। जल्द ही उपलब्ध होंगे।'
              : 'This paper has no questions yet. Check back soon.'}
          </p>
          <Link
            href="/exams/mock"
            className="inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-bold"
            style={{
              background: 'linear-gradient(135deg, var(--orange), var(--orange-light, #FB923C))',
              color: '#fff',
            }}
          >
            {isHi ? 'वापस' : 'Back to catalog'}
          </Link>
        </div>
      </div>
    );
  }

  return <MockTestRunner paper={paper} questions={questions} isHi={isHi} />;
}
