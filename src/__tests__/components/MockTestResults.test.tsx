import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

/**
 * MockTestResults — PR-6 of the JEE/NEET/Olympiad roadmap.
 *
 * Covers:
 *  1. Renders score percent and X/Y correct
 *  2. Renders bilingual "Excellent" / "बहुत बढ़िया" copy when score >= 90
 *  3. Groups review items by chapter
 *  4. Flags chapters with <50% accuracy as weak
 *  5. Renders empty state when no result in sessionStorage / attempt missing
 *
 * P1 — we do not recalculate score_percent here; we feed canned values from
 *      the fake submit response and assert the page surfaces them verbatim.
 * P7 — Hindi/English parity for the headline + chapter labels.
 * P13 — no logging of correct_answer_index / question text in these tests.
 */

// ── next/link → plain <a> ────────────────────────────────────────────────────
vi.mock('next/link', () => ({
  default: ({
    children,
    href,
    ...rest
  }: {
    children: React.ReactNode;
    href: string;
    [key: string]: unknown;
  }) => React.createElement('a', { href, ...rest }, children),
}));

// ── next/navigation: useParams + useSearchParams stubs ───────────────────────
let _params: { paperId: string } = { paperId: 'paper-uuid-001' };
let _search: URLSearchParams = new URLSearchParams('attempt=attempt-uuid-001');

vi.mock('next/navigation', () => ({
  useParams: () => _params,
  useSearchParams: () => _search,
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

// ── useAuth → swappable isHi ────────────────────────────────────────────────
const _isHi = { current: false };
vi.mock('@/lib/AuthContext', () => ({
  useAuth: () => ({ isHi: _isHi.current }),
}));

// ── LoadingFoxy stub (avoid pulling the whole UI barrel) ─────────────────────
vi.mock('@/components/ui', () => ({
  LoadingFoxy: () => React.createElement('div', { 'data-testid': 'loading-foxy' }, 'loading'),
}));

import type { SubmitResult } from '@/components/exams/mock-test-types';
import { RESULT_STORAGE_PREFIX } from '@/components/exams/useMockTestState';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let MockTestResultsPage: any;

function buildResult(overrides: Partial<SubmitResult> = {}): SubmitResult {
  const base: SubmitResult = {
    attempt_id: 'attempt-uuid-001',
    paper_id: 'paper-uuid-001',
    summary: {
      total_questions: 10,
      attempted_count: 9,
      correct_count: 7,
      wrong_count: 2,
      skipped_count: 1,
      raw_score: 26,
      max_score: 40,
      score_percent: 70,
      xp_earned: 85,
      time_taken_seconds: 1830,
      submitted_at: '2026-05-19T10:30:00.000Z',
    },
    review: [
      {
        question_id: 'q1', question_number: 1,
        question_text: 'A particle moves...',
        options: ['A', 'B', 'C', 'D'],
        response_index: 0, correct_answer_index: 0, is_correct: true,
        marks_awarded: 4, explanation: 'Apply Newton II.',
        chapter_title: 'Mechanics',
      },
      {
        question_id: 'q2', question_number: 2,
        question_text: 'A spring stretches...',
        options: ['A', 'B', 'C', 'D'],
        response_index: 1, correct_answer_index: 2, is_correct: false,
        marks_awarded: -1, explanation: 'Hooke law.',
        chapter_title: 'Mechanics',
      },
      {
        question_id: 'q3', question_number: 3,
        question_text: 'Thermal conductivity...',
        options: ['A', 'B', 'C', 'D'],
        response_index: 2, correct_answer_index: 0, is_correct: false,
        marks_awarded: -1, explanation: 'Fourier law.',
        chapter_title: 'Thermodynamics',
      },
      {
        question_id: 'q4', question_number: 4,
        question_text: 'Entropy change...',
        options: ['A', 'B', 'C', 'D'],
        response_index: 1, correct_answer_index: 0, is_correct: false,
        marks_awarded: -1, explanation: 'ΔS = nR ln(V2/V1).',
        chapter_title: 'Thermodynamics',
      },
    ],
    ...overrides,
  };
  return base;
}

function stashResult(result: SubmitResult) {
  sessionStorage.setItem(`${RESULT_STORAGE_PREFIX}${result.attempt_id}`, JSON.stringify(result));
}

beforeEach(async () => {
  vi.clearAllMocks();
  _isHi.current = false;
  _params = { paperId: 'paper-uuid-001' };
  _search = new URLSearchParams('attempt=attempt-uuid-001');
  sessionStorage.clear();
  const mod = await import('@/app/exams/mock/[paperId]/results/page');
  MockTestResultsPage = mod.default;
});

describe('<MockTestResultsPage /> — score display', () => {
  it('renders score percent and X / Y correct', () => {
    stashResult(buildResult());
    render(<MockTestResultsPage />);
    // Score percent prominent.
    expect(screen.getByText('70%')).toBeTruthy();
    // X / Y correct line — pulled verbatim from server values.
    expect(screen.getByText(/7\s*\/\s*10/)).toBeTruthy();
    // XP chip.
    expect(screen.getByTestId('mock-results-xp').textContent).toMatch(/85\s*XP/);
  });

  it('renders English "Excellent" headline when score >= 90', () => {
    _isHi.current = false;
    stashResult(buildResult({
      summary: {
        ...buildResult().summary,
        score_percent: 95, correct_count: 19, total_questions: 20,
      },
    }));
    render(<MockTestResultsPage />);
    expect(screen.getByText(/Excellent/)).toBeTruthy();
  });

  it('renders Hindi "बहुत बढ़िया" headline when score >= 90 and isHi=true', () => {
    _isHi.current = true;
    stashResult(buildResult({
      summary: {
        ...buildResult().summary,
        score_percent: 92, correct_count: 23, total_questions: 25,
      },
    }));
    render(<MockTestResultsPage />);
    expect(screen.getByText(/बहुत बढ़िया/)).toBeTruthy();
    // Bilingual UI surface: at least one row uses the Hindi "सही" label.
    expect(screen.getAllByText(/सही/).length).toBeGreaterThan(0);
  });
});

describe('<MockTestResultsPage /> — chapter grouping', () => {
  it('groups review items by chapter_title', () => {
    stashResult(buildResult());
    render(<MockTestResultsPage />);
    // The fixture has Mechanics (1/2 = 50%) and Thermodynamics (0/2 = 0%).
    expect(screen.getByText(/Mechanics/)).toBeTruthy();
    expect(screen.getByText(/Thermodynamics/)).toBeTruthy();
  });

  it('flags chapters with <50% accuracy as weak', () => {
    stashResult(buildResult());
    render(<MockTestResultsPage />);
    // Thermodynamics is 0/2 → weak. Mechanics is 1/2 (50%) → NOT weak.
    const weakRows = screen.getAllByTestId('mock-results-chapter-weak');
    expect(weakRows.length).toBeGreaterThanOrEqual(1);
    // Sanity: at least one row carries the "weak" tag in the English locale.
    expect(screen.getByText(/· weak/)).toBeTruthy();
  });

  it('renders Hindi weak label when isHi=true', () => {
    _isHi.current = true;
    stashResult(buildResult());
    render(<MockTestResultsPage />);
    expect(screen.getByText(/· कमज़ोर/)).toBeTruthy();
  });
});

describe('<MockTestResultsPage /> — empty state', () => {
  it('renders empty state when sessionStorage has no entry for the attempt', () => {
    // No stashResult call.
    render(<MockTestResultsPage />);
    expect(screen.getByTestId('mock-results-empty')).toBeTruthy();
    expect(screen.getByText(/Results unavailable/)).toBeTruthy();
  });

  it('renders empty state when attempt query param is missing entirely', () => {
    _search = new URLSearchParams();
    render(<MockTestResultsPage />);
    expect(screen.getByTestId('mock-results-empty')).toBeTruthy();
  });

  it('renders Hindi empty state copy when isHi=true', () => {
    _isHi.current = true;
    _search = new URLSearchParams();
    render(<MockTestResultsPage />);
    expect(screen.getByText(/परिणाम उपलब्ध नहीं/)).toBeTruthy();
  });
});
