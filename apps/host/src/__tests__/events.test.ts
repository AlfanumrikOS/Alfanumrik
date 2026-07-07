import { describe, it, expect, vi, beforeEach } from 'vitest';

const isFeatureEnabled = vi.fn();
vi.mock('@alfanumrik/lib/feature-flags', () => ({
  isFeatureEnabled: (...args: unknown[]) => isFeatureEnabled(...args),
}));

import {
  emit,
  subscribe,
  listenerCount,
  makeEvent,
  _resetForTests,
  type StudentCreatedEvent,
} from '@alfanumrik/lib/events';

beforeEach(() => {
  _resetForTests();
  isFeatureEnabled.mockReset();
});

const studentCreatedTemplate: Omit<StudentCreatedEvent, 'occurredAt'> = {
  type: 'student.created',
  tenantId: 'school-1',
  idempotencyKey: 'sess:abc',
  payload: { studentId: 's1', source: 'self_signup', grade: '8' },
};

describe('subscribe / listenerCount', () => {
  it('round-trips: subscribe → listenerCount=1 → unsubscribe → listenerCount=0', () => {
    const off = subscribe('student.created', () => {});
    expect(listenerCount('student.created')).toBe(1);
    off();
    expect(listenerCount('student.created')).toBe(0);
  });
});

describe('emit gating by ff_event_bus_v1', () => {
  it('does NOT call subscribers when flag is OFF', async () => {
    isFeatureEnabled.mockResolvedValueOnce(false);
    const handler = vi.fn();
    subscribe('student.created', handler);
    await emit(makeEvent<'student.created'>(studentCreatedTemplate));
    expect(handler).not.toHaveBeenCalled();
  });

  it('DOES call subscribers when flag is ON', async () => {
    isFeatureEnabled.mockResolvedValueOnce(true);
    const handler = vi.fn();
    subscribe('student.created', handler);
    await emit(makeEvent<'student.created'>(studentCreatedTemplate));
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][0].payload.studentId).toBe('s1');
  });
});

describe('error isolation', () => {
  it('a synchronous throw in one subscriber does not affect others', async () => {
    isFeatureEnabled.mockResolvedValueOnce(true);
    const a = vi.fn(() => { throw new Error('a is broken'); });
    const b = vi.fn();
    subscribe('student.created', a);
    subscribe('student.created', b);
    await emit(makeEvent<'student.created'>(studentCreatedTemplate));
    expect(a).toHaveBeenCalled();
    expect(b).toHaveBeenCalled(); // b still fired despite a throwing
  });

  it('a rejected promise in one subscriber does not affect others (awaitAsync=true)', async () => {
    isFeatureEnabled.mockResolvedValueOnce(true);
    const a = vi.fn(async () => { throw new Error('a async'); });
    const b = vi.fn(async () => { /* succeeds */ });
    subscribe('student.created', a);
    subscribe('student.created', b);
    await emit(makeEvent<'student.created'>(studentCreatedTemplate), { awaitAsync: true });
    expect(a).toHaveBeenCalled();
    expect(b).toHaveBeenCalled();
  });
});

describe('makeEvent', () => {
  it('attaches occurredAt as ISO timestamp', () => {
    const e = makeEvent<'student.created'>(studentCreatedTemplate);
    expect(e.occurredAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    expect(e.tenantId).toBe('school-1');
    expect(e.idempotencyKey).toBe('sess:abc');
  });
});

describe('_resetForTests', () => {
  it('clears every subscriber across all event types', () => {
    subscribe('student.created', () => {});
    subscribe('payment.received', () => {});
    expect(listenerCount('student.created')).toBe(1);
    _resetForTests();
    expect(listenerCount('student.created')).toBe(0);
    expect(listenerCount('payment.received')).toBe(0);
  });
});
