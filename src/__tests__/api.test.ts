import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('API helpers', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('supabase exports essential functions', async () => {
    const api = await import('@/lib/supabase');

    // Core functions exist
    expect(typeof api.getStudentProfiles).toBe('function');
    expect(typeof api.getSubjects).toBe('function');
    expect(typeof api.getFeatureFlags).toBe('function');
    expect(typeof api.chatWithFoxy).toBe('function');
    expect(typeof api.submitQuizResults).toBe('function');
    expect(typeof api.getLeaderboard).toBe('function');
    expect(typeof api.getStudyPlan).toBe('function');
    expect(typeof api.getReviewCards).toBe('function');

    // Role-based functions exist
    expect(typeof api.getUserRole).toBe('function');
    expect(typeof api.getTeacherDashboard).toBe('function');
    expect(typeof api.getGuardianDashboard).toBe('function');
    expect(typeof api.linkGuardianToStudent).toBe('function');

    // Competition functions exist
    expect(typeof api.getCompetitions).toBe('function');
    expect(typeof api.joinCompetition).toBe('function');
    expect(typeof api.getHallOfFame).toBe('function');
  });

  it('supabase URL and key are exported', async () => {
    const { supabaseUrl, supabaseAnonKey } = await import('@/lib/supabase');
    expect(typeof supabaseUrl).toBe('string');
    expect(typeof supabaseAnonKey).toBe('string');
  });

  it('chatWithFoxy handles timeout gracefully', async () => {
    const { chatWithFoxy } = await import('@/lib/supabase');

    // Mock fetch to simulate timeout
    const originalFetch = global.fetch;
    global.fetch = vi.fn().mockRejectedValue(new DOMException('Aborted', 'AbortError'));

    const result = await chatWithFoxy({
      message: 'Hello',
      student_id: 'test-id',
      grade: '9',
      language: 'en',
      mode: 'learn',
    });

    expect(result.reply).toContain('timed out');
    global.fetch = originalFetch;
  });

  it('chatWithFoxy handles network error gracefully', async () => {
    const { chatWithFoxy } = await import('@/lib/supabase');

    const originalFetch = global.fetch;
    global.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

    const result = await chatWithFoxy({
      message: 'Hello',
      student_id: 'test-id',
      grade: '9',
      language: 'en',
      mode: 'learn',
    });

    expect(result.reply).toContain('Connection issue');
    global.fetch = originalFetch;
  });
});

describe('Types', () => {
  it('all type exports are accessible', async () => {
    const types = await import('@/lib/types');

    // Verify the module has all expected type exports
    // (TypeScript types are erased at runtime, but interfaces used as values aren't)
    expect(types).toBeDefined();
  });
});

describe('Constants', () => {
  it('SUBJECT_META has essential subjects', async () => {
    const { SUBJECT_META } = await import('@/lib/constants');

    const codes = SUBJECT_META.map(s => s.code);
    expect(codes).toContain('math');
    expect(codes).toContain('science');
    expect(codes).toContain('english');
    expect(codes).toContain('hindi');
    expect(codes).toContain('physics');
    expect(codes).toContain('chemistry');
    expect(codes).toContain('biology');
  });

  it('GRADES covers 6-12', async () => {
    const { GRADES } = await import('@/lib/constants');
    expect(GRADES).toContain('6');
    expect(GRADES).toContain('12');
    expect(GRADES.length).toBe(7);
  });

  it('LANGUAGES includes Hindi and English', async () => {
    const { LANGUAGES } = await import('@/lib/constants');
    const codes = LANGUAGES.map(l => l.code);
    expect(codes).toContain('en');
    expect(codes).toContain('hi');
  });
});
