/**
 * Unit tests for the extracted UserDrawer component.
 *
 * Locks down the behaviour preserved from the original inline UserDrawer
 * in src/app/internal/admin/page.tsx (Plan 5 Task 5):
 *
 *  - Renders nothing when `student === null`
 *  - Renders the student name as the DetailDrawer title and shows email
 *  - Hits GET /api/internal/admin/users/:id on mount with x-admin-secret header
 *  - Shows action buttons for an active student (Suspend, Reset Streak, Reset XP)
 *  - Shows the Restore button instead of Suspend for an inactive student
 *  - Renders the Entitlement Inspector with plan override controls
 *
 * Pure unit-level: every fetch is mocked. The companion page-snapshot test
 * still covers the integrated behaviour.
 */

import { render, screen, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import UserDrawer from '@/app/internal/admin/_components/UserDrawer';
import type { Student } from '@/app/internal/admin/_lib/internal-admin-types';

const fakeStudent: Student = {
  id: 's-1',
  name: 'Test Student',
  email: 'test@example.com',
  grade: '7',
  board: 'CBSE',
  subscription_plan: 'free',
  xp_total: 1234,
  streak_days: 5,
  is_active: true,
  account_status: 'active',
  created_at: '2026-01-01T00:00:00Z',
};

const inactiveStudent: Student = {
  ...fakeStudent,
  id: 's-2',
  name: 'Suspended Student',
  is_active: false,
  account_status: 'suspended',
};

beforeEach(() => {
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ recent_quizzes: [], top_mastery: [] }),
    text: async () => '',
  } as unknown as Response);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('UserDrawer', () => {
  it('returns null when student is null', () => {
    const { container } = render(
      <UserDrawer student={null} secret="s" onClose={() => {}} onRefresh={() => {}} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders student name as the drawer title', () => {
    render(
      <UserDrawer
        student={fakeStudent}
        secret="s"
        onClose={() => {}}
        onRefresh={() => {}}
      />,
    );
    // DetailDrawer renders the title in an h3 and exposes a dialog role.
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: /test student/i }),
    ).toBeInTheDocument();
    expect(screen.getByText('test@example.com')).toBeInTheDocument();
  });

  it('hits the user detail endpoint on mount with the admin secret header', async () => {
    render(
      <UserDrawer
        student={fakeStudent}
        secret="abc-secret"
        onClose={() => {}}
        onRefresh={() => {}}
      />,
    );
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/internal/admin/users/s-1',
        expect.objectContaining({
          headers: expect.objectContaining({ 'x-admin-secret': 'abc-secret' }),
        }),
      );
    });
  });

  it('shows Suspend / Reset Streak / Reset XP buttons for an active student', () => {
    render(
      <UserDrawer
        student={fakeStudent}
        secret="s"
        onClose={() => {}}
        onRefresh={() => {}}
      />,
    );
    expect(screen.getByRole('button', { name: /suspend/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /reset streak/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /reset xp/i })).toBeInTheDocument();
    // Should NOT show Restore for an active user
    expect(screen.queryByRole('button', { name: /restore/i })).not.toBeInTheDocument();
  });

  it('shows Restore button instead of Suspend for an inactive student', () => {
    render(
      <UserDrawer
        student={inactiveStudent}
        secret="s"
        onClose={() => {}}
        onRefresh={() => {}}
      />,
    );
    expect(screen.getByRole('button', { name: /restore/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /suspend/i })).not.toBeInTheDocument();
  });

  it('renders the Entitlement Inspector with plan override select', () => {
    render(
      <UserDrawer
        student={fakeStudent}
        secret="s"
        onClose={() => {}}
        onRefresh={() => {}}
      />,
    );
    expect(screen.getByText(/entitlement inspector/i)).toBeInTheDocument();
    // The override select aria-label matches "Override plan"
    const planSelect = screen.getByLabelText(/override plan/i) as HTMLSelectElement;
    expect(planSelect).toBeInTheDocument();
    // All three plans should be options
    expect(planSelect.querySelector('option[value="free"]')).toBeTruthy();
    expect(planSelect.querySelector('option[value="basic"]')).toBeTruthy();
    expect(planSelect.querySelector('option[value="premium"]')).toBeTruthy();
  });
});
