/**
 * DailyPlanCard tests (Phase 3).
 *
 * Pins:
 *  - skeleton when loading
 *  - error state when fetch fails
 *  - null render when flag off / goal null / items empty
 *  - filled card with N items when flag on + valid goal
 *  - en/hi label switch
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

const mockUseSWR = vi.fn();
vi.mock('swr', () => ({
  default: (...args: unknown[]) => mockUseSWR(...args),
}));

import DailyPlanCard from '@/components/dashboard/DailyPlanCard';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('DailyPlanCard', () => {
  it('renders skeleton while loading', () => {
    mockUseSWR.mockReturnValue({ data: undefined, error: undefined, isLoading: true });
    const { getByTestId } = render(<DailyPlanCard isHi={false} />);
    expect(getByTestId('daily-plan-card-skeleton')).toBeTruthy();
  });

  it('renders error message when fetch fails', () => {
    mockUseSWR.mockReturnValue({
      data: undefined,
      error: new Error('boom'),
      isLoading: false,
    });
    const { getByTestId } = render(<DailyPlanCard isHi={false} />);
    const el = getByTestId('daily-plan-card-error');
    expect(el.textContent).toMatch(/load/i);
  });

  it('renders nothing when API returns flagEnabled=false', () => {
    mockUseSWR.mockReturnValue({
      data: {
        success: true,
        flagEnabled: false,
        data: { goal: null, totalMinutes: 0, items: [], generatedAt: '2026-05-03T00:00:00Z' },
      },
      error: undefined,
      isLoading: false,
    });
    const { container } = render(<DailyPlanCard isHi={false} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing when goal is null', () => {
    mockUseSWR.mockReturnValue({
      data: {
        success: true,
        flagEnabled: true,
        data: { goal: null, totalMinutes: 0, items: [], generatedAt: '2026-05-03T00:00:00Z' },
      },
      error: undefined,
      isLoading: false,
    });
    const { container } = render(<DailyPlanCard isHi={false} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing when items array is empty even with flag on + goal set', () => {
    mockUseSWR.mockReturnValue({
      data: {
        success: true,
        flagEnabled: true,
        data: { goal: 'board_topper', totalMinutes: 0, items: [], generatedAt: '2026-05-03T00:00:00Z' },
      },
      error: undefined,
      isLoading: false,
    });
    const { container } = render(<DailyPlanCard isHi={false} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders 4 items for board_topper plan when flag on', () => {
    mockUseSWR.mockReturnValue({
      data: {
        success: true,
        flagEnabled: true,
        data: {
          goal: 'board_topper',
          totalMinutes: 45,
          generatedAt: '2026-05-03T00:00:00Z',
          items: [
            { kind: 'pyq', titleEn: 'PYQ daily streak', titleHi: 'PYQ', estimatedMinutes: 20, rationale: 'goal=board_topper, kind=pyq' },
            { kind: 'practice', titleEn: 'HOTS set', titleHi: 'HOTS', estimatedMinutes: 15, rationale: 'goal=board_topper, kind=practice' },
            { kind: 'review', titleEn: 'Marking-scheme check', titleHi: 'चेक', estimatedMinutes: 5, rationale: 'goal=board_topper, kind=review' },
            { kind: 'reflection', titleEn: 'Examiner mindset', titleHi: 'चिंतन', estimatedMinutes: 5, rationale: 'goal=board_topper, kind=reflection' },
          ],
        },
      },
      error: undefined,
      isLoading: false,
    });
    const { getByTestId, getAllByTestId } = render(<DailyPlanCard isHi={false} />);
    expect(getByTestId('daily-plan-card')).toBeTruthy();
    expect(getAllByTestId('daily-plan-item').length).toBe(4);
    // The badge for board_topper goal should also render inside the card.
    expect(getByTestId('student-goal-badge')).toBeTruthy();
  });

  it('renders Hindi labels when isHi=true', () => {
    mockUseSWR.mockReturnValue({
      data: {
        success: true,
        flagEnabled: true,
        data: {
          goal: 'improve_basics',
          totalMinutes: 10,
          generatedAt: '2026-05-03T00:00:00Z',
          items: [
            { kind: 'concept', titleEn: 'Easy concept', titleHi: 'आसान अवधारणा', estimatedMinutes: 8, rationale: 'goal=improve_basics' },
            { kind: 'review', titleEn: 'Recap', titleHi: 'पुनरावृत्ति', estimatedMinutes: 2, rationale: 'goal=improve_basics' },
          ],
        },
      },
      error: undefined,
      isLoading: false,
    });
    const { getByTestId } = render(<DailyPlanCard isHi={true} />);
    const card = getByTestId('daily-plan-card');
    expect(card.textContent).toMatch(/आज की योजना/);
    expect(card.textContent).toMatch(/आसान अवधारणा/);
  });
});
