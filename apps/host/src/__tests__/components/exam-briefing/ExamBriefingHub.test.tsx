import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';

/**
 * ExamBriefingHub — Alfa OS pre-test Exam Briefing container (ff_test_os_v1,
 * presentation-only). Launch prerequisite coverage (Master Action Plan 2.5):
 * the four render states + bilingual copy on the statically-shipped sections
 * (the inline hub header + UpcomingExamsList).
 *
 * Seams: `swr` drives useUpcomingExams' underlying SWR ({ data, isLoading,
 * error }) directly (the existing RLS-scoped exam_configs read); the
 * supabase-client the hook imports, the cosmic-light surface hook, and
 * next/dynamic (the lazy per-exam briefing sections) are all stubbed inert so
 * no network or child fetch enters this unit.
 */

let mockSwr: { data: unknown; isLoading: boolean; error: unknown } = {
  data: undefined,
  isLoading: false,
  error: undefined,
};
vi.mock('swr', () => ({
  default: () => mockSwr,
}));

vi.mock('@alfanumrik/lib/supabase-client', () => ({
  supabase: {},
}));

vi.mock('@alfanumrik/lib/use-cosmic-light-surface', () => ({
  useCosmicLightSurface: () => {},
}));

vi.mock('next/dynamic', () => ({
  default: () =>
    function LazySectionStub() {
      return React.createElement('div', { 'data-testid': 'lazy-section' });
    },
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

function futureDateISO(daysAhead: number) {
  const d = new Date(Date.now() + daysAhead * 24 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 10);
}

function exam() {
  return {
    id: 'exam-1',
    student_id: 'stu-1',
    exam_name: 'Math Unit Test 1',
    exam_type: 'unit_test',
    subject: 'MATH',
    exam_date: futureDateISO(10),
    total_marks: 80,
    duration_minutes: 180,
    is_active: true,
    created_at: '2026-07-01T00:00:00Z',
    exam_chapters: [],
  };
}

async function renderHub(isHi = false) {
  const { default: ExamBriefingHub } = await import('@alfanumrik/ui/exam-briefing/os/ExamBriefingHub');
  return render(
    React.createElement(ExamBriefingHub, { studentId: 'stu-1', grade: '8', isHi }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockSwr = { data: undefined, isLoading: false, error: undefined };
});

describe('ExamBriefingHub — Alfa OS Exam Briefing container', () => {
  it('LOADING: exam list announces an aria-busy loading state', async () => {
    mockSwr = { data: undefined, isLoading: true, error: undefined };
    await renderHub(false);
    expect(screen.getByLabelText(/Loading exams/i)).toBeInTheDocument();
  });

  it('ERROR: shows the distinct exams error copy (not empty)', async () => {
    mockSwr = { data: undefined, isLoading: false, error: new Error('500') };
    await renderHub(false);
    expect(screen.getByText(/Couldn't load your exams right now/i)).toBeInTheDocument();
  });

  it('EMPTY: no-exams zero-state points back to /exams, never an error', async () => {
    mockSwr = { data: [], isLoading: false, error: undefined };
    await renderHub(false);
    expect(screen.getByText(/No exams yet/i)).toBeInTheDocument();
    expect(screen.queryByText(/Couldn't load/i)).not.toBeInTheDocument();
  });

  it('POPULATED: renders the hub header and the exam card', async () => {
    mockSwr = { data: [exam()], isLoading: false, error: undefined };
    await renderHub(false);
    expect(screen.getByText('Exam Briefing')).toBeInTheDocument();
    expect(screen.getByText('Math Unit Test 1')).toBeInTheDocument();
  });

  it('BILINGUAL (Hindi): the hub header renders Devanagari copy', async () => {
    mockSwr = { data: [exam()], isLoading: false, error: undefined };
    await renderHub(true);
    expect(screen.getByText('परीक्षा ब्रीफ़िंग')).toBeInTheDocument();
  });
});
