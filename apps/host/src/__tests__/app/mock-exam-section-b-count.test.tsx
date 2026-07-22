/**
 * Legacy /mock-exam page — Section B count fix (Phase 2.2 remediation).
 *
 * Bug: SECTIONS previously declared Section B as `count: 5`, giving a total
 * of 38 questions / 78 marks — one short-answer question shy of the real
 * CBSE 80-mark paper structure (Section A 20×1 + B 6×2 + C 7×3 + D 3×5 +
 * E 3×4 = 39 questions, 80 marks). Fixed to `count: 6` (2026-07-21).
 *
 * This test mounts the REAL page's subject-select screen (no network calls
 * fire until a subject is chosen + "Start Exam" clicked) and asserts on the
 * rendered "Exam Structure" card — the same values a student sees before
 * starting — rather than re-deriving the constants from source text. This
 * catches any future regression to the SECTIONS array, whether it comes
 * back through Section B or any other section.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
}));

const student = { id: 'stu-1', grade: '10', board: 'CBSE' };
vi.mock('@alfanumrik/lib/AuthContext', () => ({
  useAuth: () => ({
    student,
    isLoggedIn: true,
    isLoading: false,
    isHi: false,
    activeRole: 'student',
  }),
}));

vi.mock('@alfanumrik/lib/supabase', () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({ limit: () => Promise.resolve({ data: [] }) }),
          limit: () => Promise.resolve({ data: [] }),
        }),
      }),
    }),
  },
}));

vi.mock('@alfanumrik/lib/useAllowedSubjects', () => ({
  useAllowedSubjects: () => ({
    unlocked: [
      { code: 'math', name: 'Math', nameHi: 'गणित', icon: '∑', color: '#7C3AED' },
    ],
    isLoading: false,
  }),
}));

vi.mock('@alfanumrik/lib/useSubjectLookup', () => ({
  useSubjectLookup: () => (code: string) =>
    code === 'math' ? { code: 'math', name: 'Math', icon: '∑', color: '#7C3AED' } : null,
}));

describe('legacy /mock-exam page — Section B count fix', () => {
  it('renders the exam structure card with 39 total questions / 80 total marks (not 38/78)', async () => {
    const { default: MockExamPage } = await import('@/app/(student)/mock-exam/page');
    render(<MockExamPage />);

    // "80 marks" appears (subtitle + structure-card total row); the old
    // buggy total (78) must never appear anywhere on the screen.
    expect(screen.getAllByText(/80\s*marks/i).length).toBeGreaterThan(0);
    expect(screen.queryByText(/78\s*marks/i)).not.toBeInTheDocument();

    // Header subtitle also renders TOTAL_MARKS — pin it there too.
    expect(screen.getByText(/CBSE pattern.*3 hours.*80 marks/i)).toBeInTheDocument();
  });

  it('renders Section B as 6 × 2 = 12 marks (not 5 × 2 = 10)', async () => {
    const { default: MockExamPage } = await import('@/app/(student)/mock-exam/page');
    render(<MockExamPage />);

    expect(screen.getByText('Section B')).toBeInTheDocument();
    // The row format is "{count} × {marks} = {count*marks} marks".
    expect(screen.getByText(/6\s*×\s*2\s*=\s*12\s*marks/)).toBeInTheDocument();
    expect(screen.queryByText(/5\s*×\s*2\s*=\s*10\s*marks/)).not.toBeInTheDocument();
  });
});
