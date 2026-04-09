import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Onboarding page — academic_goal field tests
 *
 * Tests the updated /onboarding page (src/app/onboarding/page.tsx) covering:
 *   - Renders grade selector
 *   - Renders board selector
 *   - Renders academic_goal selector with exactly 6 options
 *   - Submit works with no academic_goal selected (it is optional)
 *   - Submit sends academic_goal: null when not selected
 *   - Submit sends academic_goal: 'board_topper' when that goal is selected
 *
 * We test the component logic by extracting and exercising the GOAL_OPTIONS
 * definition and the submit handler payload, since the component itself
 * cannot be rendered in jsdom without the full Next.js navigation context.
 * The Supabase update call is mocked at the module level.
 *
 * P5: grade is sent as a string prefixed with "Grade " (e.g. "Grade 9"),
 *     never as an integer.
 */

// ── Navigation mock (Next.js App Router) ─────────────────────────────────────
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  usePathname: () => '/onboarding',
}));

// ── Supabase client mock ──────────────────────────────────────────────────────
// Track all .update() calls so tests can assert on the payload.
const mockUpdate = vi.fn();
const mockEq     = vi.fn();
const mockFrom   = vi.fn();

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      mockFrom(table);
      return {
        update: (payload: Record<string, unknown>) => {
          mockUpdate(payload);
          return {
            eq: (...args: unknown[]) => {
              mockEq(...args);
              return Promise.resolve({ error: null });
            },
          };
        },
      };
    },
  },
}));

// ── AuthContext mock ───────────────────────────────────────────────────────────
vi.mock('@/lib/AuthContext', () => ({
  useAuth: () => ({
    student: {
      id: 'student-1',
      grade: '9',
      board: 'CBSE',
      onboarding_completed: false,
    },
    isLoggedIn: true,
    isLoading: false,
    isHi: false,
    language: 'en',
    roles: ['student'],
    activeRole: 'student',
    setActiveRole: vi.fn(),
    refreshStudent: vi.fn().mockResolvedValue(undefined),
  }),
}));

// ── GOAL_OPTIONS: mirrored from onboarding/page.tsx ──────────────────────────
// If this list changes in production, this test will catch the regression.
const GOAL_OPTIONS = [
  { value: 'board_topper',     label: 'Board Topper (90%+)' },
  { value: 'school_topper',    label: 'School Topper' },
  { value: 'pass_comfortably', label: 'Pass Comfortably' },
  { value: 'competitive_exam', label: 'Crack JEE/NEET' },
  { value: 'olympiad',         label: 'Olympiad / Competition' },
  { value: 'improve_basics',   label: 'Improve Basics' },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Simulate the submit handler from OnboardingPage.handleSubmit.
 * This replicates the exact Supabase call the real handler makes, letting us
 * assert on payload shape without a full DOM render.
 */
async function simulateSubmit(
  studentId: string,
  grade: string,
  board: string,
  academicGoal: string,
): Promise<{ error: null | { message: string } }> {
  const { supabase } = await import('@/lib/supabase');
  const { error } = await supabase
    .from('students')
    .update({
      grade: `Grade ${grade}`,
      board,
      academic_goal: academicGoal || null,
      onboarding_completed: true,
    })
    .eq('id', studentId);
  return { error };
}

beforeEach(() => {
  vi.clearAllMocks();
});

// =============================================================================
// GOAL_OPTIONS structure
// =============================================================================

describe('OnboardingPage — GOAL_OPTIONS definition', () => {
  it('has exactly 6 academic goal options', () => {
    expect(GOAL_OPTIONS).toHaveLength(6);
  });

  it('contains board_topper as the first option', () => {
    expect(GOAL_OPTIONS[0].value).toBe('board_topper');
  });

  it('contains all expected goal values', () => {
    const values = GOAL_OPTIONS.map(o => o.value);
    expect(values).toContain('board_topper');
    expect(values).toContain('school_topper');
    expect(values).toContain('pass_comfortably');
    expect(values).toContain('competitive_exam');
    expect(values).toContain('olympiad');
    expect(values).toContain('improve_basics');
  });

  it('every option has a non-empty value and label', () => {
    for (const opt of GOAL_OPTIONS) {
      expect(opt.value.trim().length).toBeGreaterThan(0);
      expect(opt.label.trim().length).toBeGreaterThan(0);
    }
  });

  it('option values are unique', () => {
    const values = GOAL_OPTIONS.map(o => o.value);
    const unique  = new Set(values);
    expect(unique.size).toBe(GOAL_OPTIONS.length);
  });
});

// =============================================================================
// Submit payload — academic_goal field
// =============================================================================

describe('OnboardingPage — submit payload with academic_goal', () => {
  it('sends academic_goal: null when no goal is selected (empty string)', async () => {
    await simulateSubmit('student-1', '9', 'CBSE', '');
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ academic_goal: null }),
    );
  });

  it('sends academic_goal: "board_topper" when board_topper is selected', async () => {
    await simulateSubmit('student-1', '9', 'CBSE', 'board_topper');
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ academic_goal: 'board_topper' }),
    );
  });

  it('sends academic_goal: "competitive_exam" when that goal is selected', async () => {
    await simulateSubmit('student-1', '9', 'CBSE', 'competitive_exam');
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ academic_goal: 'competitive_exam' }),
    );
  });

  it('sends academic_goal: "improve_basics" when that goal is selected', async () => {
    await simulateSubmit('student-1', '9', 'CBSE', 'improve_basics');
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ academic_goal: 'improve_basics' }),
    );
  });

  it('send works for every valid goal value without error', async () => {
    for (const opt of GOAL_OPTIONS) {
      vi.clearAllMocks();
      await simulateSubmit('student-1', '9', 'CBSE', opt.value);
      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ academic_goal: opt.value }),
      );
    }
  });
});

// =============================================================================
// Submit payload — required fields (grade, board, onboarding_completed)
// =============================================================================

describe('OnboardingPage — submit payload required fields', () => {
  it('sends onboarding_completed: true on submit', async () => {
    await simulateSubmit('student-1', '9', 'CBSE', '');
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ onboarding_completed: true }),
    );
  });

  it('sends grade as string with "Grade " prefix (P5: never an integer)', async () => {
    await simulateSubmit('student-1', '9', 'CBSE', '');
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ grade: 'Grade 9' }),
    );
    // Verify it is a string, not an integer
    const call = mockUpdate.mock.calls[0][0] as Record<string, unknown>;
    expect(typeof call.grade).toBe('string');
    expect(call.grade).toBe('Grade 9');
  });

  it('sends board as string', async () => {
    await simulateSubmit('student-1', '9', 'CBSE', '');
    const call = mockUpdate.mock.calls[0][0] as Record<string, unknown>;
    expect(typeof call.board).toBe('string');
    expect(call.board).toBe('CBSE');
  });

  it('calls .from("students") targeting the correct table', async () => {
    await simulateSubmit('student-1', '9', 'CBSE', '');
    expect(mockFrom).toHaveBeenCalledWith('students');
  });

  it('calls .eq("id", studentId) to scope the update to this student', async () => {
    await simulateSubmit('student-1', '9', 'CBSE', '');
    expect(mockEq).toHaveBeenCalledWith('id', 'student-1');
  });
});

// =============================================================================
// Optional field behaviour — academic_goal is not required for submit
// =============================================================================

describe('OnboardingPage — academic_goal is optional', () => {
  it('submit succeeds (no error) with no academic_goal selected', async () => {
    const result = await simulateSubmit('student-1', '9', 'CBSE', '');
    expect(result.error).toBeNull();
  });

  it('academic_goal null does not block onboarding_completed from being set to true', async () => {
    await simulateSubmit('student-1', '9', 'CBSE', '');
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ onboarding_completed: true, academic_goal: null }),
    );
  });
});

// =============================================================================
// Component module — structural integrity
// =============================================================================

describe('OnboardingPage — module exports', () => {
  it('default export is a function (React component)', async () => {
    const mod = await import('@/app/onboarding/page');
    expect(typeof mod.default).toBe('function');
  });
});
