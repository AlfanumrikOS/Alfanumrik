'use client';

import useSWR from 'swr';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/AuthContext';

/**
 * Phase 2.D — Spaced-repetition CTA on the student dashboard.
 *
 * Pedagogy moat: research shows spaced-repetition retention improves
 * dramatically when the system PROMPTS the learner at the right moment.
 * concept_mastery.next_review_date is already populated nightly by the
 * SM-2 cron; this card is the visible hook that drives the student to
 * /review?due_only=1.
 *
 * Render rules:
 *  - dueCount === 0 → render NOTHING (return null). No empty card noise.
 *  - error          → silently fail (return null). Never crash the dashboard.
 *  - loading        → shimmer skeleton matching other dashboard cards.
 *  - data           → orange brand-token card with bilingual title + CTA.
 *
 * P7: bilingual via useAuth().isHi. The word "review" is treated as a
 * loanword and stays English in the Hindi string ("रिव्यू बाकी") to match
 * the existing dashboard copy (see /dashboard/page.tsx priority-2 block).
 */

interface ReviewsDueResponse {
  success: boolean;
  data?: {
    dueCount: number;
    oldestDueDate: string | null;
    estimatedMinutes: number;
  };
  error?: string;
}

const fetcher = async (url: string): Promise<ReviewsDueResponse> => {
  const res = await fetch(url);
  if (!res.ok) {
    const err = new Error(`Failed: ${res.status}`) as Error & { status: number };
    err.status = res.status;
    throw err;
  }
  return res.json();
};

function Skeleton() {
  return (
    <div
      className="rounded-2xl p-4 flex items-center gap-3"
      style={{
        background: 'rgba(232,88,28,0.05)',
        border: '1px solid rgba(232,88,28,0.12)',
      }}
      aria-busy="true"
      aria-label="Loading reviews"
    >
      <div
        className="w-10 h-10 rounded-xl animate-shimmer flex-shrink-0"
        style={{
          background:
            'linear-gradient(90deg, var(--surface-2) 25%, var(--surface-3) 50%, var(--surface-2) 75%)',
          backgroundSize: '200% 100%',
        }}
      />
      <div className="flex-1 space-y-1.5">
        <div
          className="h-4 rounded animate-shimmer"
          style={{
            width: '70%',
            background:
              'linear-gradient(90deg, var(--surface-2) 25%, var(--surface-3) 50%, var(--surface-2) 75%)',
            backgroundSize: '200% 100%',
          }}
        />
        <div
          className="h-3 rounded animate-shimmer"
          style={{
            width: '40%',
            background:
              'linear-gradient(90deg, var(--surface-2) 25%, var(--surface-3) 50%, var(--surface-2) 75%)',
            backgroundSize: '200% 100%',
          }}
        />
      </div>
    </div>
  );
}

export default function ReviewsDueCard() {
  const { isHi } = useAuth();
  const router = useRouter();

  const { data, error, isLoading } = useSWR<ReviewsDueResponse>(
    '/api/dashboard/reviews-due',
    fetcher,
    {
      refreshInterval: 60_000,        // 1 min — student-visible nudge stays fresh
      revalidateOnFocus: true,         // Refresh when student returns to tab
      dedupingInterval: 30_000,
      shouldRetryOnError: false,       // Silent failure: don't retry storms
      keepPreviousData: true,
    }
  );

  // Loading state — shimmer matches dashboard cards
  if (isLoading && !data) return <Skeleton />;

  // Silent failure on error — return nothing rather than break the dashboard
  if (error) return null;

  const payload = data?.data;
  if (!payload) return null;
  const { dueCount, estimatedMinutes } = payload;

  // Empty state: render NOTHING (zero pending = no card)
  if (dueCount <= 0) return null;

  const titleEn = `${dueCount} review${dueCount === 1 ? '' : 's'} due — ${estimatedMinutes} min`;
  // Hinglish: keep "review" as loanword to match existing dashboard copy
  // ("रिव्यू बाकी") that students already recognize.
  const titleHi = `${dueCount} रिव्यू बाकी — ${estimatedMinutes} मिनट`;

  const subtitleEn = 'Quick review locks in what you learnt last week';
  const subtitleHi = 'पिछले हफ्ते का याद ताज़ा करें';

  const ctaEn = 'Start review';
  const ctaHi = 'रिव्यू शुरू करो';

  const ariaLabel = isHi
    ? `${titleHi}. ${subtitleHi}. ${ctaHi}.`
    : `${titleEn}. ${subtitleEn}. ${ctaEn}.`;

  return (
    <button
      type="button"
      onClick={() => router.push('/review?due_only=1')}
      aria-label={ariaLabel}
      className="w-full rounded-2xl p-4 flex items-center gap-3 transition-all active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
      style={{
        background: 'linear-gradient(135deg, rgba(232,88,28,0.08), rgba(245,166,35,0.06))',
        border: '1.5px solid rgba(232,88,28,0.22)',
        // focus-ring color: orange brand token
        // Tailwind 'focus-visible:ring-[var(--orange)]' isn't supported with
        // arbitrary CSS vars at our config — use inline focus style fallback.
      }}
    >
      <div
        className="w-11 h-11 rounded-xl flex items-center justify-center text-2xl flex-shrink-0"
        style={{ background: 'rgba(232,88,28,0.12)' }}
        aria-hidden="true"
      >
        🦊
      </div>
      <div className="flex-1 text-left min-w-0">
        <p
          className="font-bold text-sm md:text-base"
          style={{
            color: 'var(--orange, #E8581C)',
            fontFamily: 'var(--font-display)',
          }}
        >
          {isHi ? titleHi : titleEn}
        </p>
        <p
          className="text-xs mt-0.5"
          style={{ color: 'var(--text-3, #6B7280)' }}
        >
          {isHi ? subtitleHi : subtitleEn}
        </p>
      </div>
      <span
        className="text-sm font-bold flex-shrink-0 ml-1"
        style={{ color: 'var(--orange, #E8581C)' }}
        aria-hidden="true"
      >
        →
      </span>
    </button>
  );
}
