'use client';

/**
 * /exams/mock/[paperId] — Mock Test runner page.
 *
 * Static papers (JEE/NEET/Olympiad): fetches the paper + its fixed question
 * set via GET /api/exams/papers/[id] and hands off to <MockTestRunner />
 * directly, exactly as before.
 *
 * `cbse_board` dynamic papers: GET is still used for paper metadata (header,
 * timer duration, 401/402/404 gating) but the question set is NOT taken from
 * the GET response — those papers have no static exam_paper_id-linked rows,
 * so GET would (incorrectly) look empty. Instead, once the paper is confirmed
 * `cbse_board`, we call the new POST /api/exams/papers/[id]/start endpoint,
 * which snapshots a freshly-generated section-weighted question set into an
 * attempt row and returns `{ attempt_id, questions }`. The attempt_id then
 * rides along on submit so the backend scores against that stored snapshot.
 *
 * Response shapes handled from GET:
 *   200 → render runner (or, for cbse_board, kick off the start call)
 *   402 → render Competition-plan upsell card (paper requires the
 *         ff_competitive_exams_v1 flag, which is OFF for this student)
 *   404 → redirect back to /exams/mock
 *
 * Response shapes handled from POST .../start (cbse_board only):
 *   200 → show the "Exam Structure" confirm card, then the runner
 *   401 → redirect to login
 *   402 → same upsell card as GET (defense-in-depth re-check at start time)
 *   404 → redirect back to /exams/mock
 *   other → inline error card with retry
 *
 * P1 — score_percent / xp_earned are rendered by the results page exactly as
 *      returned by submit; nothing here recomputes them.
 * P5 — grade not used here for static papers; paper carries authoritative
 *      duration. For cbse_board, grade lives on the student profile and is
 *      resolved server-side by the start RPC — the client sends nothing.
 * P7 — bilingual via isHi.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import useSWR from 'swr';
import Link from 'next/link';
import { useAuth } from '@alfanumrik/lib/AuthContext';
import { LoadingFoxy } from '@alfanumrik/ui/ui';
import MockTestRunner, {
  type MockTestPaper,
  type MockTestQuestion,
} from '@alfanumrik/ui/exams/MockTestRunner';
import type { StartAttemptResponse, StartAttemptQuestion } from '@alfanumrik/ui/exams/mock-test-types';

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

// ─── cbse_board dynamic-attempt start flow ─────────────────────────────────

type StartOutcome =
  | { kind: 'ok'; data: StartAttemptResponse }
  | { kind: 'upgrade'; upgradeUrl: string }
  | { kind: 'not_found' }
  | { kind: 'unauthenticated' }
  | { kind: 'error' };

async function startAttempt(paperId: string): Promise<StartOutcome> {
  const res = await fetch(`/api/exams/papers/${paperId}/start`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
  });
  if (res.status === 401) return { kind: 'unauthenticated' };
  if (res.status === 402) {
    let upgradeUrl = '/upgrade';
    try {
      const body = await res.json();
      if (body?.upgrade_url) upgradeUrl = body.upgrade_url;
    } catch { /* ignore */ }
    return { kind: 'upgrade', upgradeUrl };
  }
  if (res.status === 404) return { kind: 'not_found' };
  if (!res.ok) return { kind: 'error' };
  try {
    const body = (await res.json()) as StartAttemptResponse;
    if (!body || !body.attempt_id || !Array.isArray(body.questions)) return { kind: 'error' };
    return { kind: 'ok', data: body };
  } catch {
    return { kind: 'error' };
  }
}

const SECTION_LABELS: Record<string, { en: string; hi: string }> = {
  A: { en: 'Section A', hi: 'खंड अ' },
  B: { en: 'Section B', hi: 'खंड ब' },
  C: { en: 'Section C', hi: 'खंड स' },
  D: { en: 'Section D', hi: 'खंड द' },
  E: { en: 'Section E (Case-based)', hi: 'खंड ई (केस-आधारित)' },
};

function sectionLabel(key: string, isHi: boolean): string {
  const found = SECTION_LABELS[key];
  if (found) return isHi ? found.hi : found.en;
  return isHi ? `खंड ${key}` : `Section ${key}`;
}

function buildSectionSummary(questions: StartAttemptQuestion[]) {
  const map = new Map<string, { count: number; marks: number }>();
  for (const q of questions) {
    const entry = map.get(q.section) ?? { count: 0, marks: 0 };
    entry.count += 1;
    entry.marks += q.marks;
    map.set(q.section, entry);
  }
  return Array.from(map.entries())
    .map(([key, v]) => ({ key, count: v.count, marks: v.marks }))
    .sort((a, b) => a.key.localeCompare(b.key));
}

function adaptStartQuestions(questions: StartAttemptQuestion[]): MockTestQuestion[] {
  return questions
    .slice()
    .sort((a, b) => a.order - b.order)
    .map((q) => ({
      id: q.question_id,
      question_number: q.order,
      question_text: q.text,
      question_hi: q.text_hi ?? null,
      question_type: 'mcq_single',
      options: q.options,
      marks_correct: q.marks,
      // CBSE-board dynamic papers carry no negative marking.
      marks_wrong: 0,
      chapter_title: null,
      section: q.section,
    }));
}

function UpgradeCard({ isHi, upgradeUrl }: { isHi: boolean; upgradeUrl: string }) {
  return (
    <div className="mesh-bg min-h-dvh flex items-center justify-center p-6">
      <div
        className="rounded-2xl p-6 max-w-md w-full text-center space-y-4"
        style={{ background: 'var(--surface-1)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-md)' }}
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
            style={{ background: 'linear-gradient(135deg, var(--purple, #7C3AED), var(--orange))', color: '#fff' }}
          >
            {isHi ? 'अपग्रेड करें' : 'Upgrade'}
          </Link>
          <Link
            href="/exams/mock"
            className="inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold"
            style={{ background: 'var(--surface-2)', color: 'var(--text-1)', border: '1px solid var(--border)' }}
          >
            {isHi ? 'अन्य पेपर देखें' : 'Browse free papers'}
          </Link>
        </div>
      </div>
    </div>
  );
}

function NotReadyCard({ isHi }: { isHi: boolean }) {
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
          style={{ background: 'linear-gradient(135deg, var(--orange), var(--orange-light, #FB923C))', color: '#fff' }}
        >
          {isHi ? 'वापस' : 'Back to catalog'}
        </Link>
      </div>
    </div>
  );
}

function StartErrorCard({ isHi, onRetry }: { isHi: boolean; onRetry: () => void }) {
  return (
    <div className="mesh-bg min-h-dvh flex items-center justify-center p-6">
      <div
        className="rounded-2xl p-6 max-w-md w-full text-center space-y-4"
        style={{ background: 'var(--surface-1)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-md)' }}
        data-testid="mock-test-start-error"
      >
        <div className="text-5xl" aria-hidden="true">⚠️</div>
        <h2 className="text-lg font-bold" style={{ fontFamily: 'var(--font-display)' }}>
          {isHi ? 'पेपर शुरू नहीं हो सका' : 'Could not start this paper'}
        </h2>
        <p className="text-sm text-[var(--text-3)]">
          {isHi
            ? 'कृपया पुनः प्रयास करें। आपका कोई उत्तर अभी सुरक्षित नहीं हुआ है।'
            : 'Please try again. No responses have been recorded yet.'}
        </p>
        <button
          type="button"
          onClick={onRetry}
          className="inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-bold"
          style={{ background: 'linear-gradient(135deg, var(--orange), var(--orange-light, #FB923C))', color: '#fff' }}
        >
          {isHi ? 'पुनः प्रयास करें' : 'Retry'}
        </button>
      </div>
    </div>
  );
}

/** Interstitial shown once per cbse_board attempt — mirrors the "Exam
 * Structure" info card pattern from the legacy /mock-exam page. */
function ExamStructureCard({
  isHi,
  paper,
  sections,
  totalMarks,
  onStart,
}: {
  isHi: boolean;
  paper: MockTestPaper;
  sections: { key: string; count: number; marks: number }[];
  totalMarks: number;
  onStart: () => void;
}) {
  return (
    <div className="mesh-bg min-h-dvh flex items-center justify-center p-6">
      <div
        className="rounded-2xl p-6 max-w-md w-full space-y-4"
        style={{ background: 'var(--surface-1)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-md)' }}
        data-testid="mock-test-exam-structure-card"
      >
        <div>
          <h2 className="text-lg font-bold" style={{ fontFamily: 'var(--font-display)', color: 'var(--text-1)' }}>
            {isHi ? 'परीक्षा संरचना' : 'Exam Structure'}
          </h2>
          <p className="text-xs text-[var(--text-3)] mt-1">{paper.paper_code}</p>
        </div>
        <div className="space-y-2">
          {sections.map((sec) => (
            <div key={sec.key} className="flex justify-between text-sm">
              <span style={{ color: 'var(--text-2, var(--text-3))' }}>{sectionLabel(sec.key, isHi)}</span>
              <span className="font-semibold" style={{ color: 'var(--text-1)' }}>
                {sec.count} × {sec.marks / sec.count} = {sec.marks} {isHi ? 'अंक' : 'marks'}
              </span>
            </div>
          ))}
          <div className="pt-2 border-t flex justify-between font-bold" style={{ borderColor: 'var(--border)', color: 'var(--text-1)' }}>
            <span>{isHi ? 'कुल' : 'Total'}</span>
            <span>{totalMarks} {isHi ? 'अंक' : 'marks'}</span>
          </div>
          <div className="flex justify-between text-xs pt-1" style={{ color: 'var(--text-3)' }}>
            <span>{isHi ? 'अवधि' : 'Duration'}</span>
            <span>{paper.duration_minutes} {isHi ? 'मिनट' : 'min'}</span>
          </div>
        </div>
        <button
          type="button"
          onClick={onStart}
          data-testid="mock-test-exam-structure-start"
          className="w-full rounded-xl px-4 py-3 text-sm font-bold"
          style={{ background: 'var(--purple, #7C3AED)', color: '#fff' }}
        >
          {isHi ? 'परीक्षा शुरू करें →' : 'Start Exam →'}
        </button>
      </div>
    </div>
  );
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

  // ── cbse_board dynamic-attempt start state ──────────────────────────────
  const [startOutcome, setStartOutcome] = useState<StartOutcome | null>(null);
  const [startLoading, setStartLoading] = useState(false);
  const [examConfirmed, setExamConfirmed] = useState(false);
  const startedForPaperRef = useRef<string | null>(null);
  const [startRetryTick, setStartRetryTick] = useState(0);

  const isCbseBoard = data?.kind === 'ok' && data.data.paper.exam_family === 'cbse_board';

  const runStart = useCallback(async (id: string) => {
    setStartLoading(true);
    const outcome = await startAttempt(id);
    setStartOutcome(outcome);
    setStartLoading(false);
  }, []);

  useEffect(() => {
    if (!isCbseBoard || !paperId) return;
    // Guard against double-invoke (React strict mode) and re-runs once an
    // attempt has already been started for this paper.
    if (startedForPaperRef.current === `${paperId}:${startRetryTick}`) return;
    startedForPaperRef.current = `${paperId}:${startRetryTick}`;
    void runStart(paperId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isCbseBoard, paperId, startRetryTick]);

  // Auth redirect.
  useEffect(() => {
    if (!isLoading && !isLoggedIn) router.replace('/login');
  }, [isLoading, isLoggedIn, router]);

  // 401 → login. 404 → catalog (GET-level).
  useEffect(() => {
    const err = error as (Error & { status?: number }) | undefined;
    if (err?.status === 401) router.replace('/login');
  }, [error, router]);

  useEffect(() => {
    if (data?.kind === 'not_found') {
      router.replace('/exams/mock');
    }
  }, [data, router]);

  // Start-call-level 401/404 redirects.
  useEffect(() => {
    if (startOutcome?.kind === 'unauthenticated') {
      router.replace(`/login?next=/exams/mock/${paperId}`);
    }
    if (startOutcome?.kind === 'not_found') {
      router.replace('/exams/mock');
    }
  }, [startOutcome, paperId, router]);

  const retryStart = useCallback(() => {
    setStartOutcome(null);
    setStartRetryTick((t) => t + 1);
  }, []);

  const sectionSummary = useMemo(() => {
    if (startOutcome?.kind !== 'ok') return [];
    return buildSectionSummary(startOutcome.data.questions);
  }, [startOutcome]);

  const adaptedQuestions = useMemo(() => {
    if (startOutcome?.kind !== 'ok') return [];
    return adaptStartQuestions(startOutcome.data.questions);
  }, [startOutcome]);

  if (isLoading || paperLoading || !data) return <LoadingFoxy />;

  if (data.kind === 'upgrade') {
    return <UpgradeCard isHi={isHi} upgradeUrl={data.data.upgrade_url || '/upgrade'} />;
  }

  if (data.kind === 'not_found') {
    // useEffect above already triggered router.replace(); keep showing the loader.
    return <LoadingFoxy />;
  }

  const { paper } = data.data;

  // ── cbse_board dynamic-attempt flow ─────────────────────────────────────
  if (isCbseBoard) {
    if (startOutcome?.kind === 'unauthenticated' || startOutcome?.kind === 'not_found') {
      return <LoadingFoxy />;
    }
    if (startLoading || !startOutcome) return <LoadingFoxy />;
    if (startOutcome.kind === 'upgrade') {
      return <UpgradeCard isHi={isHi} upgradeUrl={startOutcome.upgradeUrl} />;
    }
    if (startOutcome.kind === 'error') {
      return <StartErrorCard isHi={isHi} onRetry={retryStart} />;
    }

    if (adaptedQuestions.length === 0) {
      return <NotReadyCard isHi={isHi} />;
    }

    if (!examConfirmed) {
      const totalMarks = sectionSummary.reduce((s, sec) => s + sec.marks, 0);
      return (
        <ExamStructureCard
          isHi={isHi}
          paper={paper}
          sections={sectionSummary}
          totalMarks={totalMarks}
          onStart={() => setExamConfirmed(true)}
        />
      );
    }

    return (
      <MockTestRunner
        paper={paper}
        questions={adaptedQuestions}
        isHi={isHi}
        attemptId={startOutcome.data.attempt_id}
      />
    );
  }

  // ── Static paper flow (JEE/NEET/Olympiad) — unchanged ───────────────────
  const { questions } = data.data;

  if (!questions || questions.length === 0) {
    return <NotReadyCard isHi={isHi} />;
  }

  return <MockTestRunner paper={paper} questions={questions} isHi={isHi} />;
}
