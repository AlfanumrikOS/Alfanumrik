import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const insertMock = vi.fn();
vi.mock('@/lib/supabase-admin', () => ({
  supabaseAdmin: {
    from: vi.fn(() => ({ insert: insertMock })),
  },
}));

const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

let logOpsEvent: typeof import('@/lib/ops-events').logOpsEvent;

describe('logOpsEvent', () => {
  beforeEach(async () => {
    insertMock.mockReset();
    insertMock.mockResolvedValue({ error: null });
    vi.resetModules();
    logOpsEvent = (await import('@/lib/ops-events')).logOpsEvent;
  });

  afterEach(() => { warnSpy.mockClear(); });

  it('builds the expected row shape for a minimal input', async () => {
    await logOpsEvent({ category: 'ai', source: 'claude.ts', severity: 'info', message: 'claude call ok' });
    expect(insertMock).toHaveBeenCalledTimes(1);
    const row = insertMock.mock.calls[0][0];
    expect(row).toMatchObject({ category: 'ai', source: 'claude.ts', severity: 'info', message: 'claude call ok', subject_type: null, subject_id: null, request_id: null });
    expect(row.context).toEqual({});
    expect(typeof row.occurred_at).toBe('string');
    expect(row.environment).toBeDefined();
  });

  it('redacts PII in the context field before insert', async () => {
    await logOpsEvent({ category: 'ai', source: 'claude.ts', severity: 'error', message: 'test', context: { password: 'hunter2', model: 'haiku' } });
    const row = insertMock.mock.calls[0][0];
    expect(row.context.password).toBe('[REDACTED]');
    expect(row.context.model).toBe('haiku');
  });

  it('awaits the insert for severity=error', async () => {
    let resolved = false;
    insertMock.mockImplementation(() => new Promise((resolve) => setTimeout(() => { resolved = true; resolve({ error: null }); }, 20)));
    await logOpsEvent({ category: 'ai', source: 'claude.ts', severity: 'error', message: 'fail' });
    expect(resolved).toBe(true);
  });

  it('awaits the insert for severity=critical', async () => {
    let resolved = false;
    insertMock.mockImplementation(() => new Promise((resolve) => setTimeout(() => { resolved = true; resolve({ error: null }); }, 20)));
    await logOpsEvent({ category: 'payment', source: 'razorpay-webhook', severity: 'critical', message: 'sig invalid' });
    expect(resolved).toBe(true);
  });

  it('does NOT await the insert for severity=info (fire-and-forget)', async () => {
    let resolved = false;
    insertMock.mockImplementation(() => new Promise((resolve) => setTimeout(() => { resolved = true; resolve({ error: null }); }, 30)));
    await logOpsEvent({ category: 'ai', source: 'claude.ts', severity: 'info', message: 'ok' });
    expect(resolved).toBe(false);
  });

  it('never throws on DB error — logs console.warn instead', async () => {
    insertMock.mockResolvedValue({ error: { message: 'connection refused' } });
    await expect(logOpsEvent({ category: 'ai', source: 'claude.ts', severity: 'error', message: 'fail' })).resolves.toBeUndefined();
    expect(warnSpy).toHaveBeenCalledWith('[ops-events] insert failed', expect.objectContaining({ error: 'connection refused' }));
  });

  it('never throws on writer exception', async () => {
    insertMock.mockImplementation(() => { throw new Error('boom'); });
    await expect(logOpsEvent({ category: 'ai', source: 'claude.ts', severity: 'error', message: 'fail' })).resolves.toBeUndefined();
    expect(warnSpy).toHaveBeenCalled();
  });

  it('uses provided occurredAt when given', async () => {
    const when = new Date('2026-01-01T12:00:00Z');
    await logOpsEvent({ category: 'ai', source: 'claude.ts', severity: 'info', message: 'ok', occurredAt: when });
    const row = insertMock.mock.calls[0][0];
    expect(row.occurred_at).toBe('2026-01-01T12:00:00.000Z');
  });
});