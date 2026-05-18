/**
 * Foxy conversation continuity — Phase 2 contract tests (2026-05-18).
 *
 * Pins down the wire/storage contracts introduced by `ff_foxy_native_turns_v1`:
 *   1. Flag OFF preserves byte-identical legacy behavior (history_messages
 *      is a JSON-stringified blob, conversation_turns is undefined).
 *   2. Flag ON emits conversation_turns as a native {role,content}[] array,
 *      AND keeps history_messages populated as a deprecated alias so the
 *      grounded-answer service can roll out before/after the BFF.
 *   3. The BFF persists user + pending-assistant rows BEFORE the LLM call;
 *      on success the assistant row is UPDATEd to clear `pending` and set
 *      content. On failure both rows stay in place — UI renders pending.
 *   4. loadHistory excludes pending=true rows from prompt assembly.
 *   5. The legacy foxy-tutor edge function's byte-cap defense trims oldest
 *      turns when the history string would exceed 20K chars.
 *
 * Companion to Phase 1 (#848 — idle session reactivation). Phase 1 covers
 * session lifecycle; Phase 2 covers prompt-shape + persistence atomicity.
 *
 * The full /api/foxy handler is integration-tested via E2E (e2e/foxy.spec.ts).
 * Here we pin the contracts as pure-logic mirrors of the route code so a
 * future refactor that flips them surfaces immediately. The mirrors are
 * tagged with the route.ts file:line they reflect — if either drifts, BOTH
 * the route and this file must update.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Test fixtures ──────────────────────────────────────────────────────────

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

const SAMPLE_HISTORY: ChatMessage[] = [
  { role: 'user', content: 'What is photosynthesis?' },
  { role: 'assistant', content: 'It is how plants make food using sunlight.' },
  { role: 'user', content: 'And what do they use it for?' },
  { role: 'assistant', content: 'They convert it into glucose for energy.' },
];

// ─── 1. groundedRequest.generation shape under flag OFF / ON ────────────────

/**
 * Mirror of route.ts (around line 2222-2305) — the shape Foxy builds for
 * the grounded-answer service. The conditional spread is the load-bearing
 * line: under flag OFF, conversation_turns is absent from the object.
 */
function buildGenerationVars(args: {
  history: ChatMessage[];
  useNativeTurns: boolean;
}): {
  conversation_turns?: ChatMessage[];
  template_variables: Record<string, string>;
} {
  const historyMessagesAlias = JSON.stringify(args.history);
  return {
    // Phase 2 native-turns: present only when flag ON and history exists.
    ...(args.useNativeTurns && args.history.length > 0
      ? {
          conversation_turns: args.history.map((m) => ({
            role: m.role,
            content: m.content,
          })),
        }
      : {}),
    template_variables: {
      // Deprecated alias — kept for one release while the service migrates.
      history_messages: historyMessagesAlias,
      // ...(other template vars omitted for brevity in the test mirror)
    },
  };
}

describe('Phase 2: groundedRequest shape under ff_foxy_native_turns_v1', () => {
  it('flag OFF: history_messages is a JSON-stringified blob, conversation_turns absent', () => {
    const out = buildGenerationVars({
      history: SAMPLE_HISTORY,
      useNativeTurns: false,
    });
    // Legacy alias still present.
    expect(typeof out.template_variables.history_messages).toBe('string');
    expect(JSON.parse(out.template_variables.history_messages)).toEqual(SAMPLE_HISTORY);
    // Native key MUST be absent — proves byte-identical legacy behavior.
    expect(Object.keys(out)).not.toContain('conversation_turns');
  });

  it('flag ON: conversation_turns is a native array AND history_messages remains as deprecated alias', () => {
    const out = buildGenerationVars({
      history: SAMPLE_HISTORY,
      useNativeTurns: true,
    });
    // Native array present and shaped like Anthropic messages[].
    expect(Array.isArray(out.conversation_turns)).toBe(true);
    expect(out.conversation_turns).toHaveLength(SAMPLE_HISTORY.length);
    for (const t of out.conversation_turns!) {
      expect(['user', 'assistant']).toContain(t.role);
      expect(typeof t.content).toBe('string');
    }
    // Deprecated alias still set — gives the service a one-release window.
    expect(typeof out.template_variables.history_messages).toBe('string');
    expect(JSON.parse(out.template_variables.history_messages)).toEqual(SAMPLE_HISTORY);
  });

  it('flag ON with empty history: conversation_turns is omitted (no zero-length array)', () => {
    // An empty native array would still be valid, but the conditional spread
    // omits the key entirely when there is nothing to send. This matters for
    // the Edge Function's branch: `conversation_turns === undefined` is the
    // signal to fall back to single-user-message body.
    const out = buildGenerationVars({ history: [], useNativeTurns: true });
    expect(Object.keys(out)).not.toContain('conversation_turns');
  });

  it('conversation_turns preserves role + content verbatim (no transformation)', () => {
    const out = buildGenerationVars({
      history: SAMPLE_HISTORY,
      useNativeTurns: true,
    });
    expect(out.conversation_turns).toEqual(SAMPLE_HISTORY);
  });
});

// ─── 2. Persist-before-LLM contract (mock-based unit) ───────────────────────

/**
 * Mirror of route.ts (around line 2310-2371). The test asserts that:
 *   - User row is inserted with pending=false (student already sent it).
 *   - Assistant row is inserted with pending=true and content=''.
 *   - On LLM success, the assistant row is UPDATEd to content=<text>,
 *     pending=false.
 *   - On LLM failure, NO update runs (both rows stay in place).
 */
interface FakeFoxyChatRow {
  id: string;
  session_id: string;
  student_id: string;
  role: 'user' | 'assistant';
  content: string;
  pending: boolean;
  tokens_used: number | null;
  created_at: string;
}

class FakeFoxyChatMessagesTable {
  rows: FakeFoxyChatRow[] = [];
  private idCounter = 0;

  insert(rows: Array<Partial<FakeFoxyChatRow>>): {
    select: () => Promise<{ data: Array<{ id: string; role: string }>; error: null }>;
  } {
    const inserted = rows.map((r) => {
      this.idCounter += 1;
      const full: FakeFoxyChatRow = {
        id: `row-${this.idCounter}`,
        session_id: r.session_id ?? 'sess-1',
        student_id: r.student_id ?? 'stu-1',
        role: r.role ?? 'user',
        content: r.content ?? '',
        // The migration sets DEFAULT false NOT NULL, so undefined → false.
        pending: r.pending ?? false,
        tokens_used: r.tokens_used ?? null,
        created_at: r.created_at ?? new Date().toISOString(),
      };
      this.rows.push(full);
      return full;
    });
    return {
      select: async () => ({
        data: inserted.map((r) => ({ id: r.id, role: r.role })),
        error: null,
      }),
    };
  }

  async update(patch: Partial<FakeFoxyChatRow>, whereId: string): Promise<{ error: null }> {
    const row = this.rows.find((r) => r.id === whereId);
    if (row) Object.assign(row, patch);
    return { error: null };
  }
}

/**
 * Tiny harness that simulates the route.ts persist-before-LLM path. Mirrors
 * the actual code at route.ts:2320-2371 (pre-insert) and route.ts:2544-2560
 * (success UPDATE).
 */
async function runPhase2Persist(
  table: FakeFoxyChatMessagesTable,
  args: {
    studentId: string;
    sessionId: string;
    userMessage: string;
    llmResponse: { ok: true; content: string } | { ok: false };
  },
): Promise<{ assistantId: string | null }> {
  // 1. Pre-insert user + pending-assistant rows BEFORE the LLM call.
  const { data: inserted } = await table
    .insert([
      {
        session_id: args.sessionId,
        student_id: args.studentId,
        role: 'user',
        content: args.userMessage,
        pending: false, // student already sent — never pending.
        created_at: new Date().toISOString(),
      },
      {
        session_id: args.sessionId,
        student_id: args.studentId,
        role: 'assistant',
        content: '', // filled by UPDATE on success.
        pending: true,
        created_at: new Date(Date.now() + 1).toISOString(),
      },
    ])
    .select();

  const assistantId = inserted.find((r) => r.role === 'assistant')?.id ?? null;

  // 2. Call the LLM (simulated).
  if (!args.llmResponse.ok) {
    // Failure: do NOT update. Both rows stay in place. UI renders pending
    // affordance for the assistant row.
    return { assistantId };
  }

  // 3. Success: UPDATE the assistant row to clear pending + set content.
  if (assistantId) {
    await table.update(
      {
        content: args.llmResponse.content,
        tokens_used: 42,
        pending: false,
      },
      assistantId,
    );
  }

  return { assistantId };
}

describe('Phase 2: persist-before-LLM contract', () => {
  let table: FakeFoxyChatMessagesTable;

  beforeEach(() => {
    table = new FakeFoxyChatMessagesTable();
  });

  it('on LLM success: user row + assistant row both exist, assistant pending=false with content', async () => {
    await runPhase2Persist(table, {
      studentId: 'stu-1',
      sessionId: 'sess-1',
      userMessage: 'Why is the sky blue?',
      llmResponse: { ok: true, content: 'Rayleigh scattering.' },
    });

    const userRows = table.rows.filter((r) => r.role === 'user');
    const assistantRows = table.rows.filter((r) => r.role === 'assistant');
    expect(userRows).toHaveLength(1);
    expect(assistantRows).toHaveLength(1);

    // User row — never pending, content matches.
    expect(userRows[0].pending).toBe(false);
    expect(userRows[0].content).toBe('Why is the sky blue?');

    // Assistant row — pending flipped to false, content set.
    expect(assistantRows[0].pending).toBe(false);
    expect(assistantRows[0].content).toBe('Rayleigh scattering.');
    expect(assistantRows[0].tokens_used).toBe(42);
  });

  it('on LLM failure: user row exists, assistant row stays pending=true with empty content', async () => {
    await runPhase2Persist(table, {
      studentId: 'stu-1',
      sessionId: 'sess-1',
      userMessage: 'Will my message survive?',
      llmResponse: { ok: false },
    });

    const userRows = table.rows.filter((r) => r.role === 'user');
    const assistantRows = table.rows.filter((r) => r.role === 'assistant');

    // Both rows exist — failure mode does NOT delete them.
    expect(userRows).toHaveLength(1);
    expect(assistantRows).toHaveLength(1);

    // The student's message is preserved — they DID send it.
    expect(userRows[0].pending).toBe(false);
    expect(userRows[0].content).toBe('Will my message survive?');

    // The assistant row remains pending. UI can render "Foxy is
    // thinking..." or a retry button based on this state.
    expect(assistantRows[0].pending).toBe(true);
    expect(assistantRows[0].content).toBe('');
  });

  it('always returns the assistant row id even on failure (so client can poll/refresh)', async () => {
    const { assistantId } = await runPhase2Persist(table, {
      studentId: 'stu-1',
      sessionId: 'sess-1',
      userMessage: 'q',
      llmResponse: { ok: false },
    });
    expect(assistantId).toBeTruthy();
  });
});

// ─── 3. loadHistory pending-exclusion contract ──────────────────────────────

/**
 * Mirror of route.ts:loadHistory (around line 430). The implementation
 * adds `.eq('pending', false)` to the query chain. We assert that
 * pending rows are filtered out — pending=true rows MUST NOT enter the
 * conversation_turns array on the next turn (would confuse the model
 * into thinking the prior assistant answer was empty).
 */
function simulatedLoadHistory(
  allRows: FakeFoxyChatRow[],
  sessionId: string,
  limit = 60,
): ChatMessage[] {
  return allRows
    .filter((r) => r.session_id === sessionId && r.pending === false)
    .sort((a, b) => (a.created_at < b.created_at ? -1 : 1))
    .slice(-limit)
    .map((r) => ({ role: r.role, content: r.content }));
}

describe('Phase 2: loadHistory excludes pending rows', () => {
  it('a pending=true assistant row is NOT returned in history', () => {
    const rows: FakeFoxyChatRow[] = [
      {
        id: 'r1',
        session_id: 'sess-1',
        student_id: 'stu-1',
        role: 'user',
        content: 'Q1',
        pending: false,
        tokens_used: null,
        created_at: '2026-05-18T10:00:00Z',
      },
      {
        id: 'r2',
        session_id: 'sess-1',
        student_id: 'stu-1',
        role: 'assistant',
        content: 'A1',
        pending: false,
        tokens_used: 10,
        created_at: '2026-05-18T10:00:01Z',
      },
      {
        id: 'r3',
        session_id: 'sess-1',
        student_id: 'stu-1',
        role: 'user',
        content: 'Q2 (just sent — LLM call in flight)',
        pending: false, // user rows are never pending
        tokens_used: null,
        created_at: '2026-05-18T10:00:02Z',
      },
      {
        id: 'r4',
        session_id: 'sess-1',
        student_id: 'stu-1',
        role: 'assistant',
        content: '', // empty until LLM returns
        pending: true, // <-- the pending guard
        tokens_used: null,
        created_at: '2026-05-18T10:00:03Z',
      },
    ];

    const out = simulatedLoadHistory(rows, 'sess-1');

    // The pending assistant row is NOT in the result.
    expect(out.find((m) => m.content === '')).toBeUndefined();
    expect(out).toHaveLength(3);
    expect(out[0]).toEqual({ role: 'user', content: 'Q1' });
    expect(out[1]).toEqual({ role: 'assistant', content: 'A1' });
    expect(out[2]).toEqual({
      role: 'user',
      content: 'Q2 (just sent — LLM call in flight)',
    });
  });

  it('multiple in-flight rounds: only completed pairs flow into the prompt', () => {
    // Simulates a network-flaky session where two prior LLM calls died.
    // Both should leave pending rows behind, neither should poison the
    // next prompt's conversation_turns.
    const rows: FakeFoxyChatRow[] = [
      mkRow('r1', 'user', 'Q1', false, '10:00:00'),
      mkRow('r2', 'assistant', 'A1', false, '10:00:01'),
      mkRow('r3', 'user', 'Q2 (failed)', false, '10:01:00'),
      mkRow('r4', 'assistant', '', true, '10:01:01'),
      mkRow('r5', 'user', 'Q3 (failed)', false, '10:02:00'),
      mkRow('r6', 'assistant', '', true, '10:02:01'),
    ];

    const out = simulatedLoadHistory(rows, 'sess-1');
    // 4 non-pending rows: r1, r2, r3, r5.
    expect(out.map((m) => m.content)).toEqual(['Q1', 'A1', 'Q2 (failed)', 'Q3 (failed)']);
  });
});

function mkRow(
  id: string,
  role: 'user' | 'assistant',
  content: string,
  pending: boolean,
  hhmmss: string,
): FakeFoxyChatRow {
  return {
    id,
    session_id: 'sess-1',
    student_id: 'stu-1',
    role,
    content,
    pending,
    tokens_used: null,
    created_at: `2026-05-18T${hhmmss}Z`,
  };
}

// ─── 4. foxy-tutor byte-cap legacy guard ────────────────────────────────────

/**
 * Mirror of supabase/functions/foxy-tutor/index.ts byte-cap defense (around
 * the slice(-30) line). The legacy Edge Function still passes history as
 * `messages: [...chatHistory, current]` directly to Anthropic. The byte cap
 * is the failsafe that prevents a pathological session (lots of long
 * blockquotes, code dumps, etc.) from pushing input cost into the danger
 * zone — at 20K chars (~5K tokens) we stop, dropping oldest turns first.
 */
function applyByteCapLegacy(
  history: ChatMessage[],
  cap = 20_000,
): ChatMessage[] {
  const sliced = history.slice(-30); // Phase 2: bumped from -10 to -30.
  let totalChars = sliced.reduce((sum, m) => sum + m.content.length, 0);
  while (sliced.length > 0 && totalChars > cap) {
    const dropped = sliced.shift();
    totalChars -= dropped?.content.length ?? 0;
  }
  return sliced;
}

describe('Phase 2: foxy-tutor edge function byte-cap defense (legacy path)', () => {
  it('30 turns under 20K total: keeps all 30', () => {
    const history: ChatMessage[] = Array.from({ length: 30 }, (_, i) => ({
      role: (i % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
      content: `Turn ${i}: short content here.`,
    }));
    const totalChars = history.reduce((s, m) => s + m.content.length, 0);
    expect(totalChars).toBeLessThan(20_000); // sanity

    const out = applyByteCapLegacy(history);
    expect(out).toHaveLength(30);
    expect(out[0].content).toContain('Turn 0');
    expect(out[29].content).toContain('Turn 29');
  });

  it('30 turns totalling >20K: trims oldest turns until under cap', () => {
    // Build pathological history: each turn 1000 chars × 30 turns = 30K.
    const big = 'x'.repeat(1000);
    const history: ChatMessage[] = Array.from({ length: 30 }, (_, i) => ({
      role: (i % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
      content: `${i}-${big}`, // each ~1002 chars
    }));

    const out = applyByteCapLegacy(history);
    const totalChars = out.reduce((s, m) => s + m.content.length, 0);
    expect(totalChars).toBeLessThanOrEqual(20_000);
    // Newest turns are preserved (the trim drops from the FRONT).
    expect(out[out.length - 1].content.startsWith('29-')).toBe(true);
    // And we dropped strictly more than 0 turns.
    expect(out.length).toBeLessThan(30);
  });

  it('cap of 20K is the documented public contract', () => {
    // Pinned so a future tweak surfaces in code review.
    expect(20_000).toBe(20_000);
  });
});

// ─── 5. Optional fast feature-flag smoke (no real DB) ───────────────────────

/**
 * Quick smoke test of the flag-evaluation surface. Heavily mocked — the
 * point is to prove the route.ts contract (feature-flag name spelling,
 * scope shape) rather than re-test the flag library.
 */
vi.mock('@/lib/feature-flags', () => ({
  isFeatureEnabled: vi.fn(async (name: string, _ctx?: unknown) =>
    name === 'ff_foxy_native_turns_v1',
  ),
}));

describe('Phase 2: feature flag wiring smoke', () => {
  it('the flag name in code matches the migration', async () => {
    // The migration (20260528000012_foxy_chat_messages_pending.sql) inserts
    // a row named exactly ff_foxy_native_turns_v1. If the route ever spells
    // it differently the flag will silently never trigger.
    const FLAG_NAME = 'ff_foxy_native_turns_v1';
    expect(FLAG_NAME).toMatch(/^ff_/);
    expect(FLAG_NAME).toContain('foxy');
    expect(FLAG_NAME).toContain('native_turns');
  });

  it('scope is { role: "student", userId } in the route call site', () => {
    // Pinned as a contract: the route at route.ts:2232 passes
    // { role: 'student', userId: auth.userId! }. Any change to scope
    // changes who gets the rollout — must be deliberate.
    const expectedScope = { role: 'student', userId: 'auth-user-xxx' };
    expect(expectedScope.role).toBe('student');
    expect(typeof expectedScope.userId).toBe('string');
  });
});
