/**
 * Command Center — Phase 2 Task 2.1 chart cards (MasteryDistributionCard,
 * ClassMasteryBarCard). Both are lazy (next/dynamic) panels that reuse the
 * SAME classes-at-risk rows as ClassesAtRiskRail (no new fetch), so they're
 * exercised directly here rather than through the dynamic-mocked
 * CommandCenter host (see command-center-setup-checklist.test.tsx for why
 * next/dynamic is stubbed to null there).
 *
 * Pins:
 *   - MasteryDistributionCard passes correctly-shaped DonutSlice[] (name +
 *     value) to DonutChart, summing the EXACT at_risk_count / student_count
 *     fields already returned by get_classes_at_risk (no new threshold).
 *   - ClassMasteryBarCard passes a correctly-shaped ChartSeries[] to
 *     BarChart, one point per class, y = round(avg_mastery * 100); rows with
 *     a null avg_mastery are excluded (never rendered as a fake 0%).
 *   - Both render their emptyLabel fallback when rows=[] (empty state).
 *   - Both render a Retry affordance on error=true and call onRetry on click.
 */

import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { vi, describe, it, expect, afterEach } from 'vitest';
import type { ClassAtRiskRow } from '@alfanumrik/lib/school-admin/command-center-types';

// Spy on the chart wrappers so we can assert on the EXACT props each card
// passes through, without depending on Recharts' SVG output under jsdom.
const donutSpy = vi.fn();
const barSpy = vi.fn();
vi.mock('@alfanumrik/ui/admin-ui/charts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@alfanumrik/ui/admin-ui/charts')>();
  return {
    ...actual,
    DonutChart: (props: Parameters<typeof actual.DonutChart>[0]) => {
      donutSpy(props);
      return <div data-testid="donut-chart">{props.emptyLabel}</div>;
    },
    BarChart: (props: Parameters<typeof actual.BarChart>[0]) => {
      barSpy(props);
      return <div data-testid="bar-chart">{props.emptyLabel}</div>;
    },
  };
});

import MasteryDistributionCard from '@/app/school-admin/command-center/MasteryDistributionCard';
import ClassMasteryBarCard from '@/app/school-admin/command-center/ClassMasteryBarCard';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const ROWS: ClassAtRiskRow[] = [
  { class_id: 'c1', class_name: '6A', grade: '6', student_count: 10, at_risk_count: 4, avg_mastery: 0.35 },
  { class_id: 'c2', class_name: '7B', grade: '7', student_count: 8, at_risk_count: 1, avg_mastery: 0.72 },
  { class_id: 'c3', class_name: '8C', grade: '8', student_count: 5, at_risk_count: 0, avg_mastery: null },
];

describe('MasteryDistributionCard', () => {
  it('passes correctly-shaped DonutSlice[] summing exact at_risk/on_track counts', () => {
    render(
      <MasteryDistributionCard rows={ROWS} loading={false} error={false} isHi={false} onRetry={vi.fn()} />,
    );
    expect(donutSpy).toHaveBeenCalledTimes(1);
    const props = donutSpy.mock.calls[0][0];
    expect(props.data).toEqual([
      { name: 'At risk', value: 5 }, // 4 + 1 + 0
      { name: 'On track', value: 18 }, // (10-4) + (8-1) + (5-0)
    ]);
  });

  it('renders the emptyLabel fallback when rows is empty', () => {
    render(<MasteryDistributionCard rows={[]} loading={false} error={false} isHi={false} onRetry={vi.fn()} />);
    expect(screen.getByText('No mastery data yet')).toBeDefined();
  });

  it('renders a Retry button on error and invokes onRetry', () => {
    const onRetry = vi.fn();
    render(<MasteryDistributionCard rows={[]} loading={false} error onRetry={onRetry} isHi={false} />);
    fireEvent.click(screen.getByText('Retry'));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('renders Hindi labels when isHi=true (P7)', () => {
    render(<MasteryDistributionCard rows={ROWS} loading={false} error={false} isHi onRetry={vi.fn()} />);
    const props = donutSpy.mock.calls[0][0];
    expect(props.data.map((d: { name: string }) => d.name)).toEqual(['जोखिम में', 'सही राह पर']);
  });
});

describe('ClassMasteryBarCard', () => {
  it('passes a correctly-shaped ChartSeries[] with one point per class, excluding null avg_mastery', () => {
    render(<ClassMasteryBarCard rows={ROWS} loading={false} error={false} isHi={false} onRetry={vi.fn()} />);
    expect(barSpy).toHaveBeenCalledTimes(1);
    const props = barSpy.mock.calls[0][0];
    expect(props.series).toEqual([
      {
        name: 'Avg mastery %',
        data: [
          { x: '6A', y: 35 },
          { x: '7B', y: 72 },
          // c3 (null avg_mastery) excluded — never rendered as a fake 0%.
        ],
      },
    ]);
  });

  it('renders the emptyLabel fallback when rows is empty', () => {
    render(<ClassMasteryBarCard rows={[]} loading={false} error={false} isHi={false} onRetry={vi.fn()} />);
    expect(screen.getByText('No class mastery data yet')).toBeDefined();
  });

  it('renders a Retry button on error and invokes onRetry', () => {
    const onRetry = vi.fn();
    render(<ClassMasteryBarCard rows={[]} loading={false} error onRetry={onRetry} isHi={false} />);
    fireEvent.click(screen.getByText('Retry'));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
