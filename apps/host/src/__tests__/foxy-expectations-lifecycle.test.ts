/**
 * Phase 3 of Foxy continuity (2026-05-18) — lifecycle e2e mock test.
 *
 * Walks the full ask→answer→ack and ask→abandon paths through the
 * foxy-expectations helpers with a fake Supabase client. Verifies that:
 *
 *   1. extractExpectation extracts the question from an assistant reply.
 *   2. writeExpectation INSERTs a row with status='open'.
 *   3. loadOpenExpectation returns it on the next turn.
 *   4. markExpectationAnswered UPDATEs to status='answered' when Foxy
 *      acknowledges the answer.
 *   5. markExpectationAbandoned UPDATEs to status='abandoned' when Foxy
 *      moves on without acknowledging.
 *   6. buildExpectationPromptSection renders an ANSWERING_NOW prompt block
 *      that includes the question text and is empty when input is null.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  extractExpectation,
  writeExpectation,
  loadOpenExpectation,
  markExpectationAnswered,
  markExpectationAbandoned,
  buildExpectationPromptSection,
  type OpenExpectation,
} from '@alfanumrik/lib/learn/foxy-expectations';

// ─── In-memory fake Supabase client ──────────────────────────────────────────

type Row = Record<string, unknown> & {
  id: string;
  session_id: string;
  student_id: string;
  expectation_kind: string;
  expectation_text: string;
  expectation_meta: Record<string, unknown>;
  subject: string;
  grade: string;
  chapter: string | null;
  topic_id: string | null;
  bloom_level: string | null;
  difficulty: string | null;
  status: 'open' | 'answered' | 'abandoned' | 'expired';
  answered_at: string | null;
  answered_message_id: string | null;
  asked_message_id: string | null;
  created_at: string;
  expires_at: string;
};

function makeFakeSupabase() {
  const store: Row[] = [];
  let nextId = 1;

  const client = {
    from(_table: string) {
      const tableName = _table;
      // Each call builds a fresh chain.
      const ctx: {
        filters: Array<(r: Row) => boolean>;
        orderBy: { col: keyof Row; desc: boolean } | null;
        limitN: number | null;
        selectCols: string;
      } = {
        filters: [],
        orderBy: null,
        limitN: null,
        selectCols: '*',
      };

      const matched = () => store.filter((r) => ctx.filters.every((f) => f(r)));

      const chain = {
        insert(payload: Partial<Row> | Partial<Row>[]) {
          const rows = Array.isArray(payload) ? payload : [payload];
          const inserted: Row[] = [];
          for (const p of rows) {
            const id = `fake-${nextId++}`;
            const now = new Date().toISOString();
            // Build defaults first, then overlay user fields. Spread order
            // matters: user input wins. Cast to Row at the end so TS isn't
            // tripped by duplicate-key warnings on a literal merge.
            const defaults = {
              id,
              status: 'open' as const,
              answered_at: null,
              answered_message_id: null,
              asked_message_id: null,
              created_at: now,
              expires_at: new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
              expectation_meta: {},
              chapter: null,
              topic_id: null,
              bloom_level: null,
              difficulty: null,
            };
            const merged = { ...defaults, ...(p as Partial<Row>) };
            const row = merged as Row;
            store.push(row);
            inserted.push(row);
          }
          return {
            select(_cols: string) {
              ctx.selectCols = _cols;
              return {
                single: async () => ({ data: inserted[0], error: null }),
              };
            },
          };
        },
        update(patch: Partial<Row>) {
          // Lazy update: don't write until all .eq() filters are applied.
          // The helper does `.update(patch).eq('id', X).eq('status', 'open')`
          // so we must support chained .eq() before applying.
          const updateChain = {
            eq(col: keyof Row, val: unknown) {
              ctx.filters.push((r) => r[col] === val);
              // Apply patch to any rows now matching all filters so far —
              // subsequent .eq() calls further narrow and may revert
              // earlier mismatches by re-checking. In practice every
              // chained .eq() narrows monotonically so we re-apply each
              // time defensively.
              return updateChain;
            },
            // Some callers `await` the chain directly (PostgREST builder is
            // thenable). We resolve once all `.eq()` calls are applied.
            then(resolve: (v: { error: null }) => unknown) {
              const final = matched();
              for (const r of final) Object.assign(r, patch);
              resolve({ error: null });
            },
          };
          return updateChain;
        },
        select(cols: string) {
          ctx.selectCols = cols;
          return chain;
        },
        eq(col: keyof Row, val: unknown) {
          ctx.filters.push((r) => r[col] === val);
          return chain;
        },
        order(col: keyof Row, opts?: { ascending?: boolean }) {
          ctx.orderBy = { col, desc: opts?.ascending === false };
          return chain;
        },
        limit(n: number) {
          ctx.limitN = n;
          return chain;
        },
        maybeSingle: async () => {
          let rows = matched();
          if (ctx.orderBy) {
            const { col, desc } = ctx.orderBy;
            rows = [...rows].sort((a, b) => {
              const av = String(a[col] ?? '');
              const bv = String(b[col] ?? '');
              return desc ? bv.localeCompare(av) : av.localeCompare(bv);
            });
          }
          if (ctx.limitN != null) rows = rows.slice(0, ctx.limitN);
          return { data: rows[0] ?? null, error: null };
        },
      };

      void tableName;  // unused — single table store
      return chain;
    },
  };

  return { client: client as any, store };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('foxy-expectations lifecycle', () => {
  let fake: ReturnType<typeof makeFakeSupabase>;

  beforeEach(() => {
    fake = makeFakeSupabase();
  });

  it('full happy path: ask → load → mark answered', async () => {
    // 1. Foxy asks
    const assistantReply =
      '### Step 1\n\nNewton\'s First Law states an object resists change.\n\n' +
      '-> Can you give one example from your daily life?';

    const extracted = extractExpectation(assistantReply);
    expect(extracted).not.toBeNull();
    expect(extracted!.text).toContain('example');

    // 2. Persist
    const id = await writeExpectation(fake.client, {
      sessionId: 'sess-1',
      studentId: 'stu-1',
      expectation: extracted!,
      subject: 'physics',
      grade: '9',
      chapter: '1',
      askedMessageId: 'msg-asst-1',
    });
    expect(id).toBeTruthy();
    expect(fake.store).toHaveLength(1);
    expect(fake.store[0].status).toBe('open');
    expect(fake.store[0].asked_message_id).toBe('msg-asst-1');

    // 3. Next turn: load it
    const loaded = await loadOpenExpectation(fake.client, 'sess-1');
    expect(loaded).not.toBeNull();
    expect(loaded!.id).toBe(id);
    expect(loaded!.text).toContain('example');

    // 4. Foxy acknowledges student's answer
    await markExpectationAnswered(fake.client, loaded!.id, 'msg-asst-2');
    expect(fake.store[0].status).toBe('answered');
    expect(fake.store[0].answered_message_id).toBe('msg-asst-2');
    expect(fake.store[0].answered_at).toBeTruthy();

    // 5. Subsequent load returns nothing
    const afterAnswered = await loadOpenExpectation(fake.client, 'sess-1');
    expect(afterAnswered).toBeNull();
  });

  it('abandon path: Foxy moves on without acknowledging', async () => {
    // Open an expectation
    await writeExpectation(fake.client, {
      sessionId: 'sess-2',
      studentId: 'stu-2',
      expectation: { kind: 'open', text: 'What is force?', meta: {} },
      subject: 'physics',
      grade: '9',
    });
    expect(fake.store[0].status).toBe('open');

    // Mark abandoned
    await markExpectationAbandoned(fake.client, fake.store[0].id);
    expect(fake.store[0].status).toBe('abandoned');

    // Load returns nothing
    const loaded = await loadOpenExpectation(fake.client, 'sess-2');
    expect(loaded).toBeNull();
  });

  it('loadOpenExpectation returns null when no open rows exist', async () => {
    const loaded = await loadOpenExpectation(fake.client, 'sess-empty');
    expect(loaded).toBeNull();
  });

  it('buildExpectationPromptSection returns empty string for null input', () => {
    expect(buildExpectationPromptSection(null)).toBe('');
  });

  it('buildExpectationPromptSection renders ANSWERING_NOW block with question text', () => {
    const exp: OpenExpectation = {
      id: 'x',
      session_id: 's',
      student_id: 't',
      kind: 'open',
      text: 'What is the SI unit of force?',
      meta: {},
      subject: 'physics',
      grade: '9',
      chapter: null,
      topic_id: null,
      bloom_level: null,
      difficulty: null,
      created_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 86400000).toISOString(),
      asked_message_id: null,
    };
    const section = buildExpectationPromptSection(exp);
    expect(section).toContain('ANSWERING_NOW');
    expect(section).toContain('SI unit of force');
    expect(section).toContain('open');
    expect(section).toContain('Do NOT start a new topic');
  });

  it('buildExpectationPromptSection renders MCQ options when present', () => {
    const exp: OpenExpectation = {
      id: 'x',
      session_id: 's',
      student_id: 't',
      kind: 'mcq',
      text: 'Which is a vector quantity?',
      meta: { options: ['A) Mass', 'B) Velocity', 'C) Time'] },
      subject: 'physics',
      grade: '9',
      chapter: null,
      topic_id: null,
      bloom_level: null,
      difficulty: null,
      created_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 86400000).toISOString(),
      asked_message_id: null,
    };
    const section = buildExpectationPromptSection(exp);
    expect(section).toContain('Options offered');
    expect(section).toContain('A) Mass');
    expect(section).toContain('B) Velocity');
  });

  it('handles DB error in writeExpectation by returning null (best-effort)', async () => {
    const errorClient = {
      from() {
        return {
          insert() {
            return {
              select() {
                return {
                  single: async () => ({ data: null, error: { message: 'db down' } }),
                };
              },
            };
          },
        };
      },
    };
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const id = await writeExpectation(errorClient as any, {
      sessionId: 's',
      studentId: 't',
      expectation: { kind: 'open', text: 'q', meta: {} },
      subject: 'physics',
      grade: '9',
    });
    expect(id).toBeNull();
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('handles DB error in loadOpenExpectation by returning null', async () => {
    const errorClient = {
      from() {
        return {
          select() { return this; },
          eq() { return this; },
          order() { return this; },
          limit() { return this; },
          maybeSingle: async () => ({ data: null, error: { message: 'db down' } }),
        };
      },
    };
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const loaded = await loadOpenExpectation(errorClient as any, 'sess');
    expect(loaded).toBeNull();
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});
