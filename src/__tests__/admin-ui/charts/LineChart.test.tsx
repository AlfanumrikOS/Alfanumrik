import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { LineChart, CHART_PALETTE, type ChartSeries } from '@/components/admin-ui/charts';

// jsdom doesn't lay out — ResponsiveContainer measures parent via
// getBoundingClientRect() and gets 0×0, which makes Recharts skip rendering
// the inner svg. Mocking ResponsiveContainer with a fixed-size div + cloning
// the inner chart with explicit width/height lets the children compute paths
// normally. Real width comes from the parent element in the browser; this
// only changes what jsdom sees.
vi.mock('recharts', async () => {
  const actual = await vi.importActual<typeof import('recharts')>('recharts');
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: React.ReactElement }) => (
      <div style={{ width: 600, height: 300 }}>
        {React.cloneElement(children, { width: 600, height: 300 })}
      </div>
    ),
  };
});

describe('LineChart', () => {
  it('renders empty-state fallback when series is empty', () => {
    render(<LineChart series={[]} />);
    const status = screen.getByRole('status');
    expect(status.textContent).toContain('No data to display');
  });

  it('renders empty-state fallback when all series have empty data', () => {
    render(<LineChart series={[{ name: 'A', data: [] }]} />);
    expect(screen.getByRole('status').textContent).toContain('No data to display');
  });

  it('honours custom emptyLabel', () => {
    render(<LineChart series={[]} emptyLabel="Nothing to chart yet" />);
    expect(screen.getByRole('status').textContent).toContain('Nothing to chart yet');
  });

  it('renders one Line per series with token-driven palette colors', () => {
    const series: ChartSeries[] = [
      {
        name: 'Active',
        data: [
          { x: 'Mon', y: 10 },
          { x: 'Tue', y: 20 },
          { x: 'Wed', y: 15 },
        ],
      },
      {
        name: 'Trial',
        data: [
          { x: 'Mon', y: 4 },
          { x: 'Tue', y: 6 },
          { x: 'Wed', y: 8 },
        ],
      },
    ];

    const { container } = render(
      <div style={{ width: 600, height: 300 }}>
        <LineChart series={series} height={300} />
      </div>
    );

    // One <path class="recharts-line-curve"> per series.
    const curves = container.querySelectorAll('.recharts-line-curve');
    expect(curves.length).toBe(2);

    // Stroke colors come from CHART_PALETTE — token-driven (CSS vars).
    expect(curves[0].getAttribute('stroke')).toBe(CHART_PALETTE[0]);
    expect(curves[1].getAttribute('stroke')).toBe(CHART_PALETTE[1]);
  });

  it('does not render the empty-state status node when data is present', () => {
    const series: ChartSeries[] = [
      {
        name: 'A',
        data: [
          { x: 1, y: 1 },
          { x: 2, y: 2 },
        ],
      },
    ];
    render(
      <div style={{ width: 600, height: 300 }}>
        <LineChart series={series} height={300} />
      </div>
    );
    expect(screen.queryByRole('status')).toBeNull();
  });
});
