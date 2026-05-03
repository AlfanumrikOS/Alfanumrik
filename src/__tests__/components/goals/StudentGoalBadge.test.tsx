/**
 * StudentGoalBadge tests (Phase 3).
 * Renders nothing for null/empty/unknown goals; tone class differs by goal.
 */
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import StudentGoalBadge from '@/components/goals/StudentGoalBadge';

describe('StudentGoalBadge', () => {
  it('renders null when goal is null', () => {
    const { container } = render(<StudentGoalBadge goal={null} isHi={false} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders null when goal is empty string', () => {
    const { container } = render(<StudentGoalBadge goal="" isHi={false} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders null when goal is unknown', () => {
    const { container } = render(
      <StudentGoalBadge goal="not_a_real_goal" isHi={false} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders English label for board_topper when isHi=false', () => {
    const { getByTestId } = render(
      <StudentGoalBadge goal="board_topper" isHi={false} />,
    );
    const el = getByTestId('student-goal-badge');
    expect(el.textContent).toMatch(/Board Topper/i);
    expect(el.dataset.goalCode).toBe('board_topper');
  });

  it('renders Hindi label for board_topper when isHi=true', () => {
    const { getByTestId } = render(
      <StudentGoalBadge goal="board_topper" isHi={true} />,
    );
    const el = getByTestId('student-goal-badge');
    expect(el.textContent).toMatch(/बोर्ड टॉपर/);
  });

  it('tone differs by goal (analytical=blue, examiner=amber, encouraging=green)', () => {
    const { getByTestId: g1, unmount: u1 } = render(
      <StudentGoalBadge goal="board_topper" isHi={false} />,
    );
    expect(g1('student-goal-badge').dataset.tone).toBe('examiner');
    u1();

    const { getByTestId: g2, unmount: u2 } = render(
      <StudentGoalBadge goal="improve_basics" isHi={false} />,
    );
    expect(g2('student-goal-badge').dataset.tone).toBe('encouraging');
    u2();

    const { getByTestId: g3 } = render(
      <StudentGoalBadge goal="olympiad" isHi={false} />,
    );
    expect(g3('student-goal-badge').dataset.tone).toBe('analytical');
  });

  it('size prop changes the visual class', () => {
    const { getByTestId, unmount } = render(
      <StudentGoalBadge goal="school_topper" isHi={false} size="sm" />,
    );
    expect(getByTestId('student-goal-badge').className).toContain('text-xs');
    unmount();

    const { getByTestId: g } = render(
      <StudentGoalBadge goal="school_topper" isHi={false} size="md" />,
    );
    expect(g('student-goal-badge').className).toContain('text-sm');
  });
});
