/**
 * loadPriorSessionContext — Phase 0.2 pending-row exclusion (2026-07-15).
 *
 * Pins acceptance criterion #2 of the "stop empty/pending assistant rows from
 * poisoning Foxy's conversation context" task, gated behind
 * ff_foxy_answer_continuation_v1 (the caller resolves the flag and threads the
 * boolean in as `excludePending`):
 *
 *   1. excludePending=true  → pending assistant rows are filtered out of the
 *      cross-session context (an empty `[previous · Foxy]` snippet can never
 *      leak into the next prompt).
 *   2. excludePending=false → BYTE-IDENTICAL to today: no pending filter is
 *      applied, so a pending row still flows through (proves the filter is
 *      genuinely gated by the flag, not applied unconditionally).
 *   3. excludePending=true on an env missing the `pending` column → the
 *      predicate errors and we fall back to the legacy unfiltered query (same
 *      defensive fallback loadHistory uses), logging a category-only warn.
 *
 * These run against the real loadPriorSessionContext (imported from session.ts)
 * with a fake supabaseAdmin, so a refactor that drops the filter or the
 * fallback surfaces immediately.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── logger mock (capture the defensive-fallback warn) ───────────────────────
const loggerWarn = vi.fn();
vi.mock('@alfanumrik/lib/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: (...args: unknown[]) => loggerWarn(...args),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// ─── supabaseAdmin stub ──────────────────────────────────────────────────────
interface StubRow {
  role: 'user' | 'assistant';
  content: string;
  created_at: string;
  pending: boolean;
}

const stubConfig: {
  priorSessions: Array<{ id: string }>;
  chatMessages: StubRow[];
  pendingColumnMissing: boolean;
} = {
  priorSessions: [{ id: 'prior-session-1' }],
  chatMessages: [],
  pendingColumnMissing: false,
};

function makeChain(table: string) {
  const eqs: Array<[string, unknown]> = [];
  const chain: Record<string, unknown> = {};
  for (const m of ['select', 'gte', 'neq', 'order', 'limit', 'in']) {
    chain[m] = () => chain;
  }
  chain.eq = (col: string, val: unknown) => {
    eqs.push([col, val]);
    return chain;
  };

  const resolve = (): { data: unknown; error: unknown } => {
    if (table === 'foxy_sessions') {
      return { data: stubConfig.priorSessions, error: null };
    }
    if (table === 'foxy_chat_messages') {
      const hasPendingFilter = eqs.some(([c, v]) => c === 'pending' && v === false);
      if (hasPendingFilter) {
        if (stubConfig.pendingColumnMissing) {
          // Mimic Postgres "column does not exist" so the defensive fallback runs.
          return { data: null, error: { message: 'column "pending" does not exist' } };
        }
        const kept = stubConfig.chatMessages
          .filter((r) => r.pending === false)
          .map(({ role, content, created_at }) => ({ role, content, created_at }));
        return { data: kept, error: null };
      }
      // No pending filter → return every row (OFF path AND the fallback path).
      const all = stubConfig.chatMessages.map(({ role, content, created_at }) => ({
        role,
        content,
        created_at,
      }));
      return { data: all, error: null };
    }
    return { data: [], error: null };
  };

  chain.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
    Promise.resolve(resolve()).then(res, rej);
  return chain;
}

vi.mock('@alfanumrik/lib/supabase-admin', () => ({
  supabaseAdmin: { from: (table: string) => makeChain(table) },
}));

// eslint-disable-next-line import/first
import { loadPriorSessionContext } from '@/app/api/foxy/_lib/session';

const COMPLETED: StubRow = {
  role: 'assistant',
  content: 'Photosynthesis converts sunlight into glucose.',
  created_at: '2026-07-14T10:00:01Z',
};
const COMPLETED_Q: StubRow = {
  role: 'user',
  content: 'What is photosynthesis?',
  created_at: '2026-07-14T10:00:00Z',
};
const ORPHANED_PENDING: StubRow = {
  role: 'assistant',
  content: '', // the empty row a hard-abstain / dead LLM call leaves behind
  created_at: '2026-07-14T10:05:00Z',
};

beforeEach(() => {
  loggerWarn.mockClear();
  stubConfig.priorSessions = [{ id: 'prior-session-1' }];
  stubConfig.chatMessages = [];
  stubConfig.pendingColumnMissing = false;
});

describe('loadPriorSessionContext — Phase 0.2 pending exclusion (ff_foxy_answer_continuation_v1)', () => {
  it('excludePending=true excludes the orphaned pending assistant row', async () => {
    stubConfig.chatMessages = [
      { ...COMPLETED_Q, pending: false },
      { ...COMPLETED, pending: false },
      { ...ORPHANED_PENDING, pending: true },
    ];

    const turns = await loadPriorSessionContext(
      'student-1',
      'science',
      '9',
      'current-session',
      'Chapter 1',
      true, // flag ON
    );

    const contents = turns.map((t) => t.content);
    // The empty pending row must NOT be present.
    expect(contents).not.toContain('');
    expect(contents).toContain('What is photosynthesis?');
    expect(contents).toContain('Photosynthesis converts sunlight into glucose.');
    expect(turns).toHaveLength(2);
  });

  it('excludePending=false (default) is byte-identical to today: the pending row still flows through', async () => {
    stubConfig.chatMessages = [
      { ...COMPLETED_Q, pending: false },
      { ...COMPLETED, pending: false },
      { ...ORPHANED_PENDING, pending: true },
    ];

    // Explicit false AND the defaulted call must both include the pending row,
    // proving the filter is gated (not applied unconditionally).
    const explicitOff = await loadPriorSessionContext(
      'student-1',
      'science',
      '9',
      'current-session',
      'Chapter 1',
      false,
    );
    const defaultedOff = await loadPriorSessionContext(
      'student-1',
      'science',
      '9',
      'current-session',
      'Chapter 1',
    );

    expect(explicitOff.map((t) => t.content)).toContain('');
    expect(explicitOff).toHaveLength(3);
    expect(defaultedOff.map((t) => t.content)).toContain('');
    expect(defaultedOff).toHaveLength(3);
  });

  it('excludePending=true falls back to the unfiltered query when the pending column is absent', async () => {
    stubConfig.pendingColumnMissing = true;
    stubConfig.chatMessages = [
      { ...COMPLETED_Q, pending: false },
      { ...COMPLETED, pending: false },
      { ...ORPHANED_PENDING, pending: true },
    ];

    const turns = await loadPriorSessionContext(
      'student-1',
      'science',
      '9',
      'current-session',
      'Chapter 1',
      true,
    );

    // Fallback returns the legacy unfiltered set (chat keeps working) …
    expect(turns).toHaveLength(3);
    // … and the category-only warn was emitted (P13: no answer text).
    expect(loggerWarn).toHaveBeenCalledWith(
      'foxy_prior_session_pending_filter_failed',
      expect.objectContaining({ studentId: 'student-1', subject: 'science' }),
    );
    const warnPayload = loggerWarn.mock.calls[0][1] as Record<string, unknown>;
    expect(warnPayload).not.toHaveProperty('email');
    expect(warnPayload).not.toHaveProperty('phone');
    expect(warnPayload).not.toHaveProperty('name');
  });

  it('returns [] when there are no prior sessions (no chat query attempted)', async () => {
    stubConfig.priorSessions = [];
    stubConfig.chatMessages = [{ ...COMPLETED, pending: false }];
    const turns = await loadPriorSessionContext(
      'student-1',
      'science',
      '9',
      'current-session',
      'Chapter 1',
      true,
    );
    expect(turns).toEqual([]);
  });
});
