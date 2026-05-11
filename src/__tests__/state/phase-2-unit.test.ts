/**
 * Phase 2 unit tests for the unified state architecture.
 *
 * Covers the four pieces wired in this PR:
 *   1. StudentStateBuilder — DB rows → StudentState shape
 *   2. Service registry — picking + duplicate detection
 *   3. Mastery state writer subscriber — upsert payload + dryRun
 *   4. Subscriber dispatcher — kind-routing + error-isolation
 *   5. Event listener tick — fetch / dispatch / cursor advance
 *
 * The Supabase client is mocked with a small `FakeSupabase` helper.
 * No network. No real DB. Fast unit tests by design.
 */

import { describe, expect, it, vi } from 'vitest';
import { createStudentStateBuilder } from '@/lib/state/student-state-builder';
import { StudentStateSchema } from '@/lib/state/student-state';
import { STANDARD_SERVICES, pickServices } from '@/lib/state/services/registry';
import { masteryStateWriter } from '@/lib/state/subscribers/mastery-state-writer';
import {
  createDispatcher,
  standardDispatcher,
  STANDARD_SUBSCRIBERS,
} from '@/lib/state/subscribers/dispatcher';
import { toAnySubscriber, type Subscriber, type SubscriberContext } from '@/lib/state/subscribers/subscriber';
import type { DomainEvent } from '@/lib/state/events/registry';
import { tick } from '@/lib/state/runtime/event-listener';

// ── Fake Supabase ─────────────────────────────────────────────────────

type Row = Record<string, unknown>;
type TableState = { rows: Row[]; upserts: Row[][]; selectError?: string };

function makeFakeSb(tables: Record<string, TableState>) {
  const sb = {
    _calls: [] as Array<{ table: string; op: string; payload?: unknown }>,
    from(table: string) {
      const state = tables[table] ?? { rows: [], upserts: [] };
      sb._calls.push({ table, op: 'from' });
      return makeQuery(table, state, sb);
    },
  };
  return sb;
}

function makeQuery(
  table: string,
  state: TableState,
  sb: { _calls: Array<{ table: string; op: string; payload?: unknown }> },
) {
  const filters: Array<{ col: string; val: unknown }> = [];
  let _limit = Infinity;
  let _orderCol: string | null = null;
  let _orderAsc = true;
  const q: Record<string, unknown> = {
    select(_cols: string) {
      return q;
    },
    eq(col: string, val: unknown) {
      filters.push({ col, val });
      return q;
    },
    gt(col: string, val: unknown) {
      filters.push({ col, val: `>${val}` });
      return q;
    },
    order(col: string, opts: { ascending?: boolean } = {}) {
      _orderCol = col;
      _orderAsc = opts.ascending ?? true;
      return q;
    },
    limit(n: number) {
      _limit = n;
      return q;
    },
    async maybeSingle() {
      const filtered = applyFilters(state.rows, filters);
      if (state.selectError) return { data: null, error: { message: state.selectError } };
      return { data: filtered[0] ?? null, error: null };
    },
    async then(resolve: (v: { data: Row[]; error: null }) => unknown) {
      let filtered = applyFilters(state.rows, filters);
      if (_orderCol) {
        const col = _orderCol;
        filtered = filtered
          .slice()
          .sort((a, b) =>
            String(a[col] ?? '').localeCompare(String(b[col] ?? '')) * (_orderAsc ? 1 : -1),
          );
      }
      filtered = filtered.slice(0, _limit);
      return resolve({ data: filtered, error: null });
    },
    async upsert(payload: Row | Row[]) {
      const arr = Array.isArray(payload) ? payload : [payload];
      state.upserts.push(arr);
      sb._calls.push({ table, op: 'upsert', payload: arr });
      return { error: null };
    },
  };
  return q;
}

function applyFilters(rows: Row[], filters: Array<{ col: string; val: unknown }>): Row[] {
  return rows.filter(r => filters.every(f => {
    const v = r[f.col];
    if (typeof f.val === 'string' && f.val.startsWith('>')) {
      const cmp = f.val.slice(1);
      return String(v) > cmp;
    }
    return v === f.val;
  }));
}

// ── Test fixtures ────────────────────────────────────────────────────

const AUTH_USER_ID = '11111111-1111-1111-1111-111111111111';
const STUDENT_ID = '22222222-2222-2222-2222-222222222222';
const PARENT_ID = '33333333-3333-3333-3333-333333333333';
const SCHOOL_ID = '44444444-4444-4444-4444-444444444444';

function studentRow(overrides: Record<string, unknown> = {}) {
  return {
    id: STUDENT_ID,
    auth_user_id: AUTH_USER_ID,
    name: 'Test Learner',
    grade: '8',
    board: 'CBSE',
    preferred_language: 'en',
    school_id: null,
    subscription_plan: 'free',
    xp_total: 120,
    streak_days: 3,
    last_active: '2026-05-11T08:00:00Z',
    date_of_birth: '2014-01-01',
    created_at: '2026-04-01T00:00:00Z',
    ...overrides,
  };
}

// ── 1. StudentStateBuilder ────────────────────────────────────────────

describe('StudentStateBuilder', () => {
  it('builds a B2C state from a minimal students row', async () => {
    const sb = makeFakeSb({
      students: { rows: [studentRow()], upserts: [] },
      learner_mastery: { rows: [], upserts: [] },
      quiz_sessions: { rows: [], upserts: [] },
      foxy_sessions: { rows: [], upserts: [] },
      guardian_student_links: { rows: [], upserts: [] },
    }) as unknown as Parameters<typeof createStudentStateBuilder>[0]['sb'];
    const build = createStudentStateBuilder({ sb });
    const state = await build(AUTH_USER_ID);

    // Zod-parse to validate the shape — pins the contract.
    const parsed = StudentStateSchema.parse(state);
    expect(parsed.tenant.tenantType).toBe('b2c');
    expect(parsed.tenant.enabledModules).toContain('foxy_tutor');
    expect(parsed.access.planSlug).toBe('free');
    expect(parsed.engagement.currentStreakDays).toBe(3);
    expect(parsed.engagement.xpBalance).toBe(120);
    expect(parsed.live.kind).toBe('idle');
    expect(parsed.mastery).toEqual([]);
    expect(parsed.consent.isMinor).toBe(true); // 2014-born is a minor
    expect(parsed.parentIds).toEqual([]);
  });

  it('rolls up multi-subject mastery sorted by subject then chapter', async () => {
    const sb = makeFakeSb({
      students: { rows: [studentRow()], upserts: [] },
      learner_mastery: {
        rows: [
          { auth_user_id: AUTH_USER_ID, subject_code: 'science', chapter_number: 2, mastery: 0.7, attempts: 3, last_updated_at: '2026-05-10T00:00:00Z' },
          { auth_user_id: AUTH_USER_ID, subject_code: 'mathematics', chapter_number: 1, mastery: 0.5, attempts: 1, last_updated_at: '2026-05-09T00:00:00Z' },
          { auth_user_id: AUTH_USER_ID, subject_code: 'mathematics', chapter_number: 3, mastery: 0.9, attempts: 5, last_updated_at: '2026-05-11T00:00:00Z' },
        ],
        upserts: [],
      },
      quiz_sessions: { rows: [], upserts: [] },
      foxy_sessions: { rows: [], upserts: [] },
      guardian_student_links: { rows: [], upserts: [] },
    }) as unknown as Parameters<typeof createStudentStateBuilder>[0]['sb'];
    const build = createStudentStateBuilder({ sb });
    const state = await build(AUTH_USER_ID);
    expect(state.mastery.map(m => m.subjectCode)).toEqual(['mathematics', 'science']);
    expect(state.mastery[0].chapters.map(c => c.chapterNumber)).toEqual([1, 3]);
    expect(state.mastery[0].meanMastery).toBeCloseTo(0.7, 5);
  });

  it('detects mid-quiz live state', async () => {
    const sb = makeFakeSb({
      students: { rows: [studentRow()], upserts: [] },
      learner_mastery: { rows: [], upserts: [] },
      quiz_sessions: {
        rows: [
          {
            id: '55555555-5555-5555-5555-555555555555',
            student_id: STUDENT_ID,
            subject: 'Mathematics',
            chapter_number: 4,
            total_questions: 10,
            total_answered: 3,
            started_at: '2026-05-11T07:55:00Z',
            is_completed: false,
          },
        ],
        upserts: [],
      },
      foxy_sessions: { rows: [], upserts: [] },
      guardian_student_links: { rows: [], upserts: [] },
    }) as unknown as Parameters<typeof createStudentStateBuilder>[0]['sb'];
    const build = createStudentStateBuilder({ sb });
    const state = await build(AUTH_USER_ID);
    expect(state.live.kind).toBe('in_quiz');
    if (state.live.kind === 'in_quiz') {
      expect(state.live.subjectCode).toBe('mathematics');
      expect(state.live.chapterNumber).toBe(4);
      expect(state.live.questionsAnswered).toBe(3);
    }
  });

  it('surfaces verified parents into parentIds', async () => {
    const sb = makeFakeSb({
      students: { rows: [studentRow()], upserts: [] },
      learner_mastery: { rows: [], upserts: [] },
      quiz_sessions: { rows: [], upserts: [] },
      foxy_sessions: { rows: [], upserts: [] },
      guardian_student_links: {
        rows: [
          { student_id: STUDENT_ID, parent_auth_user_id: PARENT_ID, verified_at: '2026-05-01T00:00:00Z' },
          { student_id: STUDENT_ID, parent_auth_user_id: '66666666-6666-6666-6666-666666666666', verified_at: null }, // unverified — ignored
        ],
        upserts: [],
      },
    }) as unknown as Parameters<typeof createStudentStateBuilder>[0]['sb'];
    const build = createStudentStateBuilder({ sb });
    const state = await build(AUTH_USER_ID);
    expect(state.parentIds).toEqual([PARENT_ID]);
    expect(state.consent.parentLinkVerified).toBe(true);
  });

  it('throws when no students row matches', async () => {
    const sb = makeFakeSb({
      students: { rows: [], upserts: [] },
    }) as unknown as Parameters<typeof createStudentStateBuilder>[0]['sb'];
    const build = createStudentStateBuilder({ sb });
    await expect(build(AUTH_USER_ID)).rejects.toThrow(/no students row/);
  });
});

// ── 2. Service registry ───────────────────────────────────────────────

describe('Service registry', () => {
  it('contains quiz-completion service', () => {
    expect(STANDARD_SERVICES.has('quiz-completion')).toBe(true);
  });

  it('pickServices returns a subset', () => {
    const picked = pickServices(['quiz-completion']);
    expect(picked.size).toBe(1);
    expect(picked.get('quiz-completion')?.name).toBe('quiz-completion');
  });

  it('pickServices throws on unknown name', () => {
    expect(() => pickServices(['totally-fake'])).toThrow(/unknown service/);
  });
});

// ── 3. mastery-state-writer subscriber ────────────────────────────────

describe('masteryStateWriter', () => {
  it('upserts learner_mastery with clamped values + incremented attempts', async () => {
    const sb = makeFakeSb({
      learner_mastery: {
        rows: [
          {
            auth_user_id: AUTH_USER_ID,
            subject_code: 'mathematics',
            chapter_number: 2,
            attempts: 4,
          },
        ],
        upserts: [],
      },
    });
    const ctx: SubscriberContext = {
      sb: sb as unknown as SubscriberContext['sb'],
      dryRun: false,
      now: () => new Date('2026-05-11T09:00:00Z'),
      log: () => {},
    };
    const event = makeMasteryEvent({ toMastery: 0.6, chapter: 2 });
    await masteryStateWriter.handle(event, ctx);
    const writes = (sb as unknown as { from: (t: string) => unknown })
      ? sb._calls.filter(c => c.op === 'upsert')
      : [];
    expect(writes).toHaveLength(1);
    const upserted = writes[0].payload as Array<Record<string, unknown>>;
    expect(upserted[0]).toMatchObject({
      auth_user_id: AUTH_USER_ID,
      subject_code: 'mathematics',
      chapter_number: 2,
      mastery: 0.6,
      attempts: 5,
    });
  });

  it('lowercases subject_code on write', async () => {
    const sb = makeFakeSb({ learner_mastery: { rows: [], upserts: [] } });
    const ctx: SubscriberContext = {
      sb: sb as unknown as SubscriberContext['sb'],
      dryRun: false,
      now: () => new Date(),
      log: () => {},
    };
    const event = makeMasteryEvent({ toMastery: 0.5, chapter: 1, subjectCode: 'MATHEMATICS' });
    await masteryStateWriter.handle(event, ctx);
    const writes = sb._calls.filter(c => c.op === 'upsert');
    expect((writes[0].payload as Record<string, unknown>[])[0].subject_code).toBe('mathematics');
  });

  it('respects dryRun (no upsert)', async () => {
    const sb = makeFakeSb({ learner_mastery: { rows: [], upserts: [] } });
    const lines: unknown[] = [];
    const ctx: SubscriberContext = {
      sb: sb as unknown as SubscriberContext['sb'],
      dryRun: true,
      now: () => new Date(),
      log: l => lines.push(l),
    };
    const event = makeMasteryEvent({ toMastery: 0.42, chapter: 1 });
    await masteryStateWriter.handle(event, ctx);
    expect(sb._calls.filter(c => c.op === 'upsert')).toHaveLength(0);
    expect(lines).toHaveLength(1);
    expect((lines[0] as { outcome: string }).outcome).toBe('dryrun');
  });

  it('clamps mastery to [0,1]', async () => {
    const sb = makeFakeSb({ learner_mastery: { rows: [], upserts: [] } });
    const ctx: SubscriberContext = {
      sb: sb as unknown as SubscriberContext['sb'],
      dryRun: false,
      now: () => new Date(),
      log: () => {},
    };
    // Build an event with mastery > 1 — schema will reject at publish, but
    // the subscriber's defensive clamp should still apply.
    const event = {
      ...makeMasteryEvent({ toMastery: 0.99, chapter: 1 }),
      payload: {
        subjectCode: 'mathematics',
        chapterNumber: 1,
        fromMastery: null,
        toMastery: 1.5 as number, // forced past the schema clamp
        trigger: 'quiz' as const,
      },
    };
    await masteryStateWriter.handle(event as unknown as Parameters<typeof masteryStateWriter.handle>[0], ctx);
    const upsert = (sb._calls.find(c => c.op === 'upsert')!.payload as Record<string, unknown>[])[0];
    expect(upsert.mastery).toBe(1);
  });
});

// ── 4. Dispatcher ────────────────────────────────────────────────────

describe('dispatcher', () => {
  it('routes to the registered subscriber for the kind', async () => {
    const handled: string[] = [];
    const sub: Subscriber<'learner.quiz_completed'> = {
      name: 'fake',
      kind: 'learner.quiz_completed',
      async handle(e) {
        handled.push(e.eventId);
      },
    };
    const d = createDispatcher([toAnySubscriber(sub)]);
    const event = makeQuizCompletedEvent();
    const out = await d.handleEvent(event, {
      sb: {} as never,
      dryRun: false,
      now: () => new Date(),
      log: () => {},
    });
    expect(out).toEqual([{ subscriber: 'fake', status: 'ok' }]);
    expect(handled).toEqual([event.eventId]);
  });

  it('isolates a failing subscriber from the rest', async () => {
    const goodOk: string[] = [];
    const bad: Subscriber<'learner.quiz_completed'> = {
      name: 'broken',
      kind: 'learner.quiz_completed',
      async handle() {
        throw new Error('boom');
      },
    };
    const good: Subscriber<'learner.quiz_completed'> = {
      name: 'good',
      kind: 'learner.quiz_completed',
      async handle(e) {
        goodOk.push(e.eventId);
      },
    };
    const d = createDispatcher([toAnySubscriber(bad), toAnySubscriber(good)]);
    const event = makeQuizCompletedEvent();
    const out = await d.handleEvent(event, {
      sb: {} as never,
      dryRun: false,
      now: () => new Date(),
      log: () => {},
    });
    expect(out[0]).toEqual({ subscriber: 'broken', status: 'error', message: 'boom' });
    expect(out[1]).toEqual({ subscriber: 'good', status: 'ok' });
    expect(goodOk).toEqual([event.eventId]);
  });

  it('returns skipped when no subscriber is registered', async () => {
    const d = createDispatcher([]);
    const event = makeQuizCompletedEvent();
    const out = await d.handleEvent(event, {
      sb: {} as never,
      dryRun: false,
      now: () => new Date(),
      log: () => {},
    });
    expect(out[0]).toMatchObject({ subscriber: '_none_', status: 'skipped' });
  });

  it('standardDispatcher contains mastery-state-writer', () => {
    expect(STANDARD_SUBSCRIBERS.some(s => s.name === 'mastery-state-writer')).toBe(true);
    expect(standardDispatcher.subscribersFor('learner.mastery_changed')).toHaveLength(1);
  });
});

// ── 5. Event listener tick ────────────────────────────────────────────

describe('event-listener tick', () => {
  it('fetches rows since cursor, dispatches each, and advances cursor', async () => {
    const event = makeMasteryEvent({ toMastery: 0.8, chapter: 1 });
    const eventRow = {
      event_id: event.eventId,
      occurred_at: event.occurredAt,
      actor_auth_user_id: event.actorAuthUserId,
      tenant_id: null,
      idempotency_key: event.idempotencyKey,
      kind: event.kind,
      payload: event.payload,
    };
    const sb = makeFakeSb({
      state_events: { rows: [eventRow], upserts: [] },
      learner_mastery: { rows: [], upserts: [] },
    });
    const cursorReads: string[] = [];
    const cursorWrites: string[] = [];
    const result = await tick({
      sb: sb as unknown as Parameters<typeof tick>[0]['sb'],
      cursor: {
        async read() {
          cursorReads.push('read');
          return '1970-01-01T00:00:00Z';
        },
        async write(_sb, v) {
          cursorWrites.push(v);
        },
      },
      now: () => new Date(),
      log: () => {},
    });
    expect(cursorReads).toEqual(['read']);
    expect(cursorWrites).toEqual([event.occurredAt]);
    expect(result.fetched).toBe(1);
    expect(result.dispatched).toBe(1);
    expect(result.outcomes[0].advanced).toBe(true);
  });

  it('does NOT advance the cursor when a subscriber fails', async () => {
    const event = makeMasteryEvent({ toMastery: 0.5, chapter: 1 });
    const eventRow = {
      event_id: event.eventId,
      occurred_at: event.occurredAt,
      actor_auth_user_id: event.actorAuthUserId,
      tenant_id: null,
      idempotency_key: event.idempotencyKey,
      kind: event.kind,
      payload: event.payload,
    };
    const sb = makeFakeSb({
      state_events: { rows: [eventRow], upserts: [] },
    });
    const bad: Subscriber<'learner.mastery_changed'> = {
      name: 'bad',
      kind: 'learner.mastery_changed',
      async handle() {
        throw new Error('disk full');
      },
    };
    const d = createDispatcher([toAnySubscriber(bad)]);
    const cursorWrites: string[] = [];
    const result = await tick({
      sb: sb as unknown as Parameters<typeof tick>[0]['sb'],
      dispatcher: d,
      cursor: {
        async read() {
          return '1970-01-01T00:00:00Z';
        },
        async write(_sb, v) {
          cursorWrites.push(v);
        },
      },
      now: () => new Date(),
      log: () => {},
    });
    expect(cursorWrites).toEqual([]); // never advanced
    expect(result.outcomes[0].advanced).toBe(false);
  });
});

// ── Fixture helpers ──────────────────────────────────────────────────

function makeMasteryEvent(args: {
  toMastery: number;
  chapter: number;
  subjectCode?: string;
}): Extract<DomainEvent, { kind: 'learner.mastery_changed' }> {
  return {
    eventId: '99999999-9999-9999-9999-999999999999',
    occurredAt: '2026-05-11T09:00:00Z',
    actorAuthUserId: AUTH_USER_ID,
    tenantId: null,
    idempotencyKey: `mastery-changed:test:${args.chapter}`,
    kind: 'learner.mastery_changed',
    payload: {
      subjectCode: args.subjectCode ?? 'mathematics',
      chapterNumber: args.chapter,
      fromMastery: null,
      toMastery: args.toMastery,
      trigger: 'quiz',
    },
  };
}

function makeQuizCompletedEvent(): Extract<DomainEvent, { kind: 'learner.quiz_completed' }> {
  return {
    eventId: '88888888-8888-8888-8888-888888888888',
    occurredAt: '2026-05-11T09:00:00Z',
    actorAuthUserId: AUTH_USER_ID,
    tenantId: null,
    idempotencyKey: 'quiz-completed:test',
    kind: 'learner.quiz_completed',
    payload: {
      quizSessionId: '77777777-7777-7777-7777-777777777777',
      subjectCode: 'mathematics',
      chapterNumber: 1,
      questionCount: 5,
      correctCount: 4,
      durationSec: 120,
      xpEarned: 20,
    },
  };
}

// Suppress unused-vi imports when only some tests use them.
void vi;
void SCHOOL_ID;
