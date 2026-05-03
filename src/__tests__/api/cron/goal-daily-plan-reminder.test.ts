/**
 * Tests for src/app/api/cron/goal-daily-plan-reminder/route.ts (Phase 5).
 * Pins auth gate + flag-off short-circuit + happy path + idempotency.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockIsFeatureEnabled = vi.fn();
const mockNotIs = vi.fn();
const mockEqIsActive = vi.fn(() => ({
  is: vi.fn(() => ({ not: mockNotIs })),
}));
const mockSelectStudents = vi.fn(() => ({ eq: mockEqIsActive }));

const mockGteNotif = vi.fn();
const mockEqNotifType = vi.fn(() => ({ gte: mockGteNotif }));
const mockInNotif = vi.fn(() => ({ eq: mockEqNotifType }));
const mockSelectNotif = vi.fn(() => ({ in: mockInNotif }));
const mockInsertNotif = vi.fn();

const mockFrom = vi.fn((table: string) => {
  if (table === 'students') return { select: mockSelectStudents };
  if (table === 'notifications') return { select: mockSelectNotif, insert: mockInsertNotif };
  return {};
});

const mockLoggerInfo = vi.fn();
const mockLoggerWarn = vi.fn();
const mockLoggerError = vi.fn();

vi.mock('@/lib/feature-flags', () => ({
  isFeatureEnabled: mockIsFeatureEnabled,
}));

vi.mock('@/lib/supabase-admin', () => ({
  supabaseAdmin: { from: mockFrom },
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    info: mockLoggerInfo,
    warn: mockLoggerWarn,
    error: mockLoggerError,
    debug: vi.fn(),
  },
}));

const ENV_SECRET = 'cron-secret-fixture';

function buildRequest(headers: Record<string, string>): Request {
  return new Request('http://localhost/api/cron/goal-daily-plan-reminder', {
    method: 'POST',
    headers,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.CRON_SECRET = ENV_SECRET;
  mockIsFeatureEnabled.mockResolvedValue(false);
  mockNotIs.mockResolvedValue({ data: [], error: null });
  mockGteNotif.mockResolvedValue({ data: [], error: null });
  mockInsertNotif.mockResolvedValue({ data: null, error: null });
});

describe('POST /api/cron/goal-daily-plan-reminder: auth', () => {
  it('returns 401 when secret is missing', async () => {
    const { POST } = await import('@/app/api/cron/goal-daily-plan-reminder/route');
    const res = await POST(buildRequest({}) as never);
    expect(res.status).toBe(401);
  });

  it('returns 401 when secret is wrong', async () => {
    const { POST } = await import('@/app/api/cron/goal-daily-plan-reminder/route');
    const res = await POST(buildRequest({ 'x-cron-secret': 'wrong' }) as never);
    expect(res.status).toBe(401);
  });

  it('accepts the secret via Authorization Bearer too', async () => {
    const { POST } = await import('@/app/api/cron/goal-daily-plan-reminder/route');
    mockIsFeatureEnabled.mockResolvedValueOnce(false);
    const res = await POST(buildRequest({ authorization: 'Bearer ' + ENV_SECRET }) as never);
    expect(res.status).toBe(200);
  });
});

describe('POST /api/cron/goal-daily-plan-reminder: flag OFF', () => {
  it('returns sent=0 with reason=flag_off when flag is off', async () => {
    mockIsFeatureEnabled.mockResolvedValueOnce(false);
    const { POST } = await import('@/app/api/cron/goal-daily-plan-reminder/route');
    const res = await POST(buildRequest({ 'x-cron-secret': ENV_SECRET }) as never);
    const body = await res.json();
    expect(body.sent).toBe(0);
    expect(body.reason).toBe('flag_off');
    expect(mockNotIs).not.toHaveBeenCalled();
  });
});

describe('POST /api/cron/goal-daily-plan-reminder: happy path', () => {
  it('inserts one notification per eligible student (with goal)', async () => {
    mockIsFeatureEnabled.mockResolvedValueOnce(true);
    mockNotIs.mockResolvedValueOnce({
      data: [
        { id: 'student-1', academic_goal: 'board_topper' },
        { id: 'student-2', academic_goal: 'olympiad' },
        { id: 'student-3', academic_goal: null }, // SHOULD NOT happen due to .not('academic_goal','is',null) but defensively skipped
      ],
      error: null,
    });
    mockGteNotif.mockResolvedValueOnce({ data: [], error: null });
    const { POST } = await import('@/app/api/cron/goal-daily-plan-reminder/route');
    const res = await POST(buildRequest({ 'x-cron-secret': ENV_SECRET }) as never);
    const body = await res.json();
    expect(body.sent).toBe(2);
    expect(mockInsertNotif).toHaveBeenCalledTimes(1);
    const inserted = mockInsertNotif.mock.calls[0][0];
    expect(inserted).toHaveLength(2);
    expect(inserted[0].type).toBe('daily_plan_reminder');
    expect(inserted[0].recipient_type).toBe('student');
  });

  it('does not insert when the student already has a reminder today (idempotency)', async () => {
    mockIsFeatureEnabled.mockResolvedValueOnce(true);
    mockNotIs.mockResolvedValueOnce({
      data: [{ id: 'student-1', academic_goal: 'board_topper' }],
      error: null,
    });
    mockGteNotif.mockResolvedValueOnce({
      data: [{ recipient_id: 'student-1' }],
      error: null,
    });
    const { POST } = await import('@/app/api/cron/goal-daily-plan-reminder/route');
    const res = await POST(buildRequest({ 'x-cron-secret': ENV_SECRET }) as never);
    const body = await res.json();
    expect(body.sent).toBe(0);
    expect(body.reason).toBe('all_already_sent_today');
    expect(mockInsertNotif).not.toHaveBeenCalled();
  });

  it('returns 500 when fetching students fails', async () => {
    mockIsFeatureEnabled.mockResolvedValueOnce(true);
    mockNotIs.mockResolvedValueOnce({ data: null, error: { message: 'db down' } });
    const { POST } = await import('@/app/api/cron/goal-daily-plan-reminder/route');
    const res = await POST(buildRequest({ 'x-cron-secret': ENV_SECRET }) as never);
    expect(res.status).toBe(500);
  });
});

describe('POST /api/cron/goal-daily-plan-reminder: P13 logging', () => {
  it('logger.info payload contains aggregate counts only (no studentId UUIDs)', async () => {
    mockIsFeatureEnabled.mockResolvedValueOnce(true);
    mockNotIs.mockResolvedValueOnce({
      data: [{ id: 'student-1', academic_goal: 'olympiad' }],
      error: null,
    });
    mockGteNotif.mockResolvedValueOnce({ data: [], error: null });
    const { POST } = await import('@/app/api/cron/goal-daily-plan-reminder/route');
    await POST(buildRequest({ 'x-cron-secret': ENV_SECRET }) as never);
    const successCall = mockLoggerInfo.mock.calls.find(
      (c) => c[0] === 'cron.goal-daily-plan-reminder.success',
    );
    expect(successCall).toBeDefined();
    const payload = successCall![1];
    expect(payload).toMatchObject({ sent: 1, total: 1 });
    const json = JSON.stringify(payload);
    expect(json).not.toContain('student-1');
  });
});
