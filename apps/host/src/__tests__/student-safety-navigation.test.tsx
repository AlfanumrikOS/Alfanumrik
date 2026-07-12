import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ROLE_CONFIG } from '@alfanumrik/lib/constants';
import { studyPlanRoute } from '@alfanumrik/lib/routes/study-menu-routes';
import ExamModeToggle from '@alfanumrik/ui/ExamModeToggle';

vi.mock('@alfanumrik/lib/AuthContext', () => ({
  useAuth: () => ({
    student: { id: 'student-1', grade: '10' },
    isHi: false,
  }),
}));

describe('student safety navigation', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    window.localStorage.clear();
  });

  it('routes retired Study Plan actions to the working Exam Prep page', () => {
    expect(studyPlanRoute()).toBe('/exam-prep');
  });

  it('exposes Exam Plan through the role navigation contract', () => {
    const planItem = ROLE_CONFIG.student.nav.find((item) => item.label === 'Exam Plan');
    expect(planItem?.href).toBe('/exam-prep');
  });

  it('does not present an approximate or expired board-exam countdown', async () => {
    window.localStorage.setItem('alfanumrik_exam_mode', 'true');

    render(
      <ExamModeToggle readinessPct={72} daysActive={18} streak={4} level={5} />,
    );

    expect(await screen.findByText('Board Readiness')).toBeInTheDocument();
    expect(screen.getByText('Days Active')).toBeInTheDocument();
    expect(screen.queryByText('Class 10 Board')).not.toBeInTheDocument();
  });
});
