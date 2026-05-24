import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

/**
 * ChapterReadinessCard — Phase 2 of Exam-Ready 360°.
 *
 * Covers:
 *  - Hides while loading
 *  - Hides when API returns null
 *  - Renders all 4 levels (not_yet/building/almost/ready) with correct chrome
 *  - Bilingual chrome resolves through useAuth().isHi
 *  - Score bar reflects composite score
 *  - Stats row hides empty signals (recent_quiz_count=0, spaced_reviews=0)
 *  - "Foxy learning" badge appears when rag_ready=false
 *  - CTA button hidden for next_action='introduce_concept'
 *  - CTA routes correctly for each next_action
 *  - onReviewWeakConcept callback fires for next_action='review_concept'
 */

// ── useAuth mock ─────────────────────────────────────────────────────────────
const _isHi = { current: false };
vi.mock('@/lib/AuthContext', () => ({
  useAuth: () => ({ isHi: _isHi.current }),
}));

function setLanguage(hi: boolean) {
  _isHi.current = hi;
}

// ── useChapterReadiness mock ─────────────────────────────────────────────────
let _readinessResult: {
  readiness: unknown;
  isLoading: boolean;
  error: unknown;
  refresh: () => void;
} = { readiness: null, isLoading: false, error: null, refresh: vi.fn() };

vi.mock('@/lib/useChapterReadiness', () => ({
  useChapterReadiness: () => _readinessResult,
}));

function setReadiness(readiness: unknown, isLoading = false) {
  _readinessResult = { readiness, isLoading, error: null, refresh: vi.fn() };
}

// ── Router mock ──────────────────────────────────────────────────────────────
const pushSpy = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushSpy }),
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let ChapterReadinessCard: any;

beforeEach(async () => {
  vi.clearAllMocks();
  setLanguage(false);
  setReadiness(null);
  const mod = await import('@/components/learn/ChapterReadinessCard');
  ChapterReadinessCard = mod.ChapterReadinessCard;
});

const baseReady = {
  level: 'ready' as const,
  score: 92,
  mastery_avg: 88,
  concepts_total: 8,
  concepts_mastered: 7,
  recent_quiz_avg: 84,
  recent_quiz_count: 5,
  spaced_reviews: 4,
  rag_ready: true,
  next_action: 'mock_exam',
  message_en: 'Chapter mastered.',
  message_hi: 'अध्याय पूरी तरह तैयार।',
  grade: '9',
  subject: 'science',
  chapter: 4,
};

describe('<ChapterReadinessCard />', () => {
  it('hides itself while loading (no skeleton)', () => {
    setReadiness(null, true);
    const { container } = render(
      <ChapterReadinessCard subjectCode="science" chapterNumber={4} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('hides itself when readiness data is null', () => {
    setReadiness(null);
    const { container } = render(
      <ChapterReadinessCard subjectCode="science" chapterNumber={4} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders ready state with EN chrome', () => {
    setReadiness(baseReady);
    render(<ChapterReadinessCard subjectCode="science" chapterNumber={4} />);
    expect(screen.getByText('Exam Ready')).toBeTruthy();
    expect(screen.getByText('92/100')).toBeTruthy();
    expect(screen.getByText('Chapter mastered.')).toBeTruthy();
    expect(screen.getByText(/Take Mock Exam/)).toBeTruthy();
  });

  it('renders HI chrome when language is hi', () => {
    setLanguage(true);
    setReadiness(baseReady);
    render(<ChapterReadinessCard subjectCode="science" chapterNumber={4} />);
    expect(screen.getByText('परीक्षा-तैयार')).toBeTruthy();
    expect(screen.getByText('अध्याय पूरी तरह तैयार।')).toBeTruthy();
    expect(screen.getByText(/Mock परीक्षा/)).toBeTruthy();
  });

  it('renders not_yet level with correct chrome', () => {
    setReadiness({
      ...baseReady,
      level: 'not_yet',
      score: 5,
      next_action: 'introduce_concept',
      recent_quiz_count: 0,
      spaced_reviews: 0,
    });
    render(<ChapterReadinessCard subjectCode="science" chapterNumber={4} />);
    expect(screen.getByText('Not Yet Ready')).toBeTruthy();
    // CTA button hidden for introduce_concept (student is already on the page)
    expect(screen.queryByTestId('chapter-readiness-cta')).toBeNull();
  });

  it('renders building level', () => {
    setReadiness({ ...baseReady, level: 'building', score: 45, next_action: 'take_quiz' });
    render(<ChapterReadinessCard subjectCode="science" chapterNumber={4} />);
    expect(screen.getByText('Building')).toBeTruthy();
    expect(screen.getByText(/Take Chapter Quiz/)).toBeTruthy();
  });

  it('renders almost level', () => {
    setReadiness({ ...baseReady, level: 'almost', score: 75, next_action: 'spaced_review' });
    render(<ChapterReadinessCard subjectCode="science" chapterNumber={4} />);
    expect(screen.getByText('Almost Ready')).toBeTruthy();
    expect(screen.getByText(/Review Now/)).toBeTruthy();
  });

  it('shows "Foxy learning" badge when rag_ready=false', () => {
    setReadiness({ ...baseReady, rag_ready: false });
    render(<ChapterReadinessCard subjectCode="science" chapterNumber={4} />);
    expect(screen.getByText('Foxy learning')).toBeTruthy();
  });

  it('hides empty stats (no recent quiz, no spaced reviews)', () => {
    setReadiness({
      ...baseReady,
      level: 'not_yet',
      next_action: 'take_quiz',
      recent_quiz_count: 0,
      spaced_reviews: 0,
    });
    render(<ChapterReadinessCard subjectCode="science" chapterNumber={4} />);
    expect(screen.queryByText(/✍️/)).toBeNull();
    expect(screen.queryByText(/🔁/)).toBeNull();
    // Concepts mastered always shows
    expect(screen.getByText(/🎯/)).toBeTruthy();
  });

  it('routes to /exams on mock_exam CTA click', () => {
    setReadiness(baseReady);
    render(<ChapterReadinessCard subjectCode="science" chapterNumber={4} />);
    fireEvent.click(screen.getByTestId('chapter-readiness-cta'));
    expect(pushSpy).toHaveBeenCalledWith('/exams?subject=science&chapter=4');
  });

  it('routes to /quiz on take_quiz CTA click', () => {
    setReadiness({ ...baseReady, level: 'building', next_action: 'take_quiz' });
    render(<ChapterReadinessCard subjectCode="science" chapterNumber={4} />);
    fireEvent.click(screen.getByTestId('chapter-readiness-cta'));
    expect(pushSpy).toHaveBeenCalledWith('/quiz?subject=science&chapter=4');
  });

  it('routes to /refresh on spaced_review CTA click', () => {
    // reviewRoute() now always returns /refresh (ff_study_menu_v2 retired in
    // migration 20260603120100; Study Menu v2 is permanent).
    setReadiness({ ...baseReady, level: 'almost', next_action: 'spaced_review' });
    render(<ChapterReadinessCard subjectCode="science" chapterNumber={4} />);
    fireEvent.click(screen.getByTestId('chapter-readiness-cta'));
    expect(pushSpy).toHaveBeenCalledWith('/refresh');
  });

  it('fires onReviewWeakConcept callback for review_concept next_action', () => {
    const cb = vi.fn();
    setReadiness({ ...baseReady, level: 'not_yet', next_action: 'review_concept' });
    render(
      <ChapterReadinessCard
        subjectCode="science"
        chapterNumber={4}
        onReviewWeakConcept={cb}
      />,
    );
    fireEvent.click(screen.getByTestId('chapter-readiness-cta'));
    expect(cb).toHaveBeenCalledTimes(1);
    expect(pushSpy).not.toHaveBeenCalled();
  });

  it('uses subjectColor for the score bar when provided', () => {
    setReadiness(baseReady);
    const { container } = render(
      <ChapterReadinessCard subjectCode="science" chapterNumber={4} subjectColor="#7C3AED" />,
    );
    // JSDOM normalizes hex colors to rgb() in computed style. We assert on
    // either form so the test stays robust if the renderer changes.
    const html = container.innerHTML;
    const hasColor = html.includes('#7C3AED') || html.includes('rgb(124, 58, 237)');
    expect(hasColor).toBe(true);
  });
});
