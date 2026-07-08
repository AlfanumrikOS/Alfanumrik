/**
 * Phase 3A Wave C — Student Mastery Report panel + gradebook-depth flag gate.
 *
 * Two invariants this surface must hold:
 *
 *   1. The report panel renders the mastery-by-concept block AND the full
 *      canonical 6-level Bloom's ladder (remember→understand→apply→analyze→
 *      evaluate→create), with the server-reported weakest level highlighted and
 *      the Bloom level NAMES left UNTRANSLATED even when isHi (P7 exception).
 *      Unattempted levels render a muted "—" rather than being dropped. The
 *      "Download report" action invokes the export callback.
 *
 *   2. `useTeacherGradebookDepth` DEFAULTS OFF: the synchronous first paint is
 *      OFF and stays OFF unless the flag explicitly resolves true. This is the
 *      cheapest proof that flag-OFF is byte-identical — the Command Center
 *      branches the heatmap cell handler on this one boolean (drill-through when
 *      ON, the legacy navigate-to-student when OFF), so OFF keeps the heatmap
 *      non-interactive (no report panel).
 */

import { render, screen, fireEvent, waitFor, within, renderHook } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

// getFeatureFlags is the only @alfanumrik/lib/supabase export this suite touches (via the
// depth hook). Mock it before the hook is imported. The report panel imports
// only from @alfanumrik/lib/types, so this mock does not affect its render tests.
const flagHolder: { flags: Record<string, boolean> } = { flags: {} };
vi.mock('@alfanumrik/lib/supabase', () => ({
  getFeatureFlags: vi.fn(async () => flagHolder.flags),
}));

import StudentMasteryReport from '@/app/teacher/StudentMasteryReport';
import { useTeacherGradebookDepth } from '@alfanumrik/lib/use-teacher-gradebook-depth';
import type { StudentMasteryReport as StudentMasteryReportData } from '@alfanumrik/lib/types';

// Canonical CBSE Bloom's order — these NAMES must appear verbatim, untranslated.
const CANONICAL_BLOOM = ['remember', 'understand', 'apply', 'analyze', 'evaluate', 'create'];

// A report where the student answered only 4 of the 6 Bloom levels; 'analyze'
// is the weakest answered level. 'evaluate' + 'create' are unattempted.
const REPORT: StudentMasteryReportData = {
  student_id: 'stu-1',
  student_name: 'Asha Kumari',
  grade: '7',
  mastery: {
    overall_pct: 58,
    by_concept: [
      { topic_id: 't1', concept: 'Motion', mastery_pct: 72, attempts: 14 },
      { topic_id: 't2', concept: 'Forces', mastery_pct: 41, attempts: 9 },
    ],
  },
  bloom: {
    by_level: [
      { bloom_level: 'remember', correct: 9, total: 10, accuracy_pct: 90 },
      { bloom_level: 'understand', correct: 7, total: 10, accuracy_pct: 70 },
      { bloom_level: 'apply', correct: 5, total: 10, accuracy_pct: 50 },
      { bloom_level: 'analyze', correct: 2, total: 10, accuracy_pct: 20 },
    ],
    weakest_level: 'analyze',
  },
  recent: { quizzes: 12, avg_score: 64, streak: 3 },
};

afterEach(() => {
  vi.clearAllMocks();
});

describe('StudentMasteryReport — render', () => {
  it('renders mastery-by-concept and all 6 canonical Bloom levels (untranslated), weakest highlighted', () => {
    render(
      <StudentMasteryReport
        report={REPORT}
        loading={false}
        error={false}
        exporting={false}
        isHi={false}
        onExport={() => {}}
        onRetry={() => {}}
        onClose={() => {}}
      />,
    );

    // Mastery section: both concepts present with their verbatim percents.
    const masterySection = screen.getByTestId('report-mastery-section');
    expect(masterySection).toHaveTextContent('Motion');
    expect(masterySection).toHaveTextContent('72%');
    expect(masterySection).toHaveTextContent('Forces');
    expect(masterySection).toHaveTextContent('41%');

    // Bloom section: ALL 6 canonical levels render, in order, by NAME.
    for (const level of CANONICAL_BLOOM) {
      const row = screen.getByTestId(`bloom-row-${level}`);
      expect(row).toBeInTheDocument();
      // The technical level name is present verbatim (capitalize is CSS only).
      expect(row).toHaveTextContent(new RegExp(level, 'i'));
    }

    // Answered levels show their accuracy; unattempted ones show a muted dash.
    expect(screen.getByTestId('bloom-row-remember')).toHaveTextContent('90%');
    expect(screen.getByTestId('bloom-row-analyze')).toHaveTextContent('20%');
    expect(screen.getByTestId('bloom-row-evaluate')).toHaveTextContent('—');
    expect(screen.getByTestId('bloom-row-create')).toHaveTextContent('—');

    // Weakest answered level is highlighted (badge present on that row only).
    const weakestRow = screen.getByTestId('bloom-row-analyze');
    expect(within(weakestRow).getByTestId('bloom-weakest-badge')).toBeInTheDocument();
    // No other row carries the weakest badge.
    expect(screen.getAllByTestId('bloom-weakest-badge')).toHaveLength(1);
  });

  it('keeps Bloom level names untranslated even when isHi (P7 exception)', () => {
    render(
      <StudentMasteryReport
        report={REPORT}
        loading={false}
        error={false}
        exporting={false}
        isHi={true}
        onExport={() => {}}
        onRetry={() => {}}
        onClose={() => {}}
      />,
    );
    // Even in Hindi, the 6 canonical English Bloom names must be present verbatim.
    for (const level of CANONICAL_BLOOM) {
      expect(screen.getByTestId(`bloom-row-${level}`)).toHaveTextContent(new RegExp(level, 'i'));
    }
  });

  it('invokes the export callback when "Download report" is clicked', () => {
    const onExport = vi.fn();
    render(
      <StudentMasteryReport
        report={REPORT}
        loading={false}
        error={false}
        exporting={false}
        isHi={false}
        onExport={onExport}
        onRetry={() => {}}
        onClose={() => {}}
      />,
    );
    fireEvent.click(screen.getByTestId('report-export-btn'));
    expect(onExport).toHaveBeenCalledTimes(1);
  });

  it('shows loading + error states without rendering the body', () => {
    const { rerender } = render(
      <StudentMasteryReport
        report={null}
        loading={true}
        error={false}
        exporting={false}
        isHi={false}
        onExport={() => {}}
        onRetry={() => {}}
        onClose={() => {}}
      />,
    );
    expect(screen.queryByTestId('report-bloom-section')).toBeNull();

    const onRetry = vi.fn();
    rerender(
      <StudentMasteryReport
        report={null}
        loading={false}
        error={true}
        exporting={false}
        isHi={false}
        onExport={() => {}}
        onRetry={onRetry}
        onClose={() => {}}
      />,
    );
    fireEvent.click(within(screen.getByTestId('report-error')).getByRole('button'));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});

// ── Flag gate: default OFF ⇒ heatmap stays non-interactive (byte-identical) ──
describe('useTeacherGradebookDepth — default OFF (byte-identical heatmap)', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('initialises OFF (sync) and stays OFF when the flag is absent', async () => {
    flagHolder.flags = {}; // unseeded
    const { result } = renderHook(() => useTeacherGradebookDepth());
    // First synchronous paint must be OFF → the heatmap cell remains the legacy
    // navigate-to-student link (no drill-through panel).
    expect(result.current).toBe(false);
    await waitFor(() => expect(result.current).toBe(false));
  });

  it('stays OFF when the flag is explicitly false', async () => {
    flagHolder.flags = { ff_teacher_gradebook_depth: false };
    const { result } = renderHook(() => useTeacherGradebookDepth());
    expect(result.current).toBe(false);
    await waitFor(() => expect(result.current).toBe(false));
  });

  it('flips ON when the flag resolves true', async () => {
    flagHolder.flags = { ff_teacher_gradebook_depth: true };
    const { result } = renderHook(() => useTeacherGradebookDepth());
    await waitFor(() => expect(result.current).toBe(true));
  });
});
