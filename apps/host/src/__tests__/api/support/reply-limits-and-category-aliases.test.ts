/**
 * Support reply surface — operator POST, the reply rate limiter, and the
 * category-alias normalisation. All three shipped with no coverage.
 *
 * ── 1. OPERATOR REPLY (P13) ─────────────────────────────────────────────────
 * `POST /api/internal/admin/support` is the ONLY writer of `is_internal: true`.
 * `author_role` is server-pinned to 'operator' so a payload cannot forge one,
 * and the audit row must carry ids + the visibility flag but NEVER the reply
 * text — a support body routinely contains student-identifiable detail.
 *
 * ── 2. RATE LIMITER ─────────────────────────────────────────────────────────
 * 20 replies / hour / user, deliberately more generous than ticket CREATION
 * (5 / 24h) because back-and-forth is the desired behaviour here. The 429 must
 * be MACHINE-READABLE — the UI renders "try again in N minutes" from
 * `retry_after_ms` / the `Retry-After` header, and a 429 without them degrades
 * to a generic failure that tells the user nothing.
 * The limiter is keyed per user, so it must not let one user's traffic
 * rate-limit another.
 *
 * ── 3. CATEGORY ALIASES ─────────────────────────────────────────────────────
 * The unauthenticated intake route shipped its own inline enum
 * ['bug','content','payment','account','feature','other'] before the canonical
 * SUPPORT_TICKET_CATEGORIES existed. 'payment' and 'feature' are absent from the
 * canonical list, so the two intake paths wrote mutually-incompatible strings
 * into the same free-TEXT column and every operator filter keyed on category
 * under-counted. Old wire values must keep being ACCEPTED (old clients, cached
 * marketing pages, installed APKs) while PERSISTING the canonical value.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  SUPPORT_TICKET_CATEGORIES,
  SUPPORT_TICKET_CATEGORY_ALIASES,
  SUPPORT_TICKET_CATEGORY_INPUTS,
  normalizeTicketCategory,
} from '@alfanumrik/lib/support/ticket-categories';

const TICKET_ID = 'ffffffff-1111-4111-8111-111111111111';
const STUDENT_ID = 'aaaaaaaa-1111-4111-8111-111111111111';
const STUDENT_AUTH = 'aaaaaaaa-2222-4222-8222-222222222222';
const OTHER_AUTH = 'eeeeeeee-2222-4222-8222-222222222222';

// ════════════════════════════════════════════════════════════════════════════
// 3. Category aliases — pure, so assert them first and without any harness
// ════════════════════════════════════════════════════════════════════════════
describe('support category alias normalisation', () => {
  it('accepts every canonical category unchanged', () => {
    for (const c of SUPPORT_TICKET_CATEGORIES) {
      expect(normalizeTicketCategory(c)).toBe(c);
    }
  });

  it('maps the two legacy intake values to canonical categories', () => {
    expect(normalizeTicketCategory('payment')).toBe('billing');
    expect(normalizeTicketCategory('feature')).toBe('other');
  });

  it('every alias target is itself a canonical category (no alias chains)', () => {
    for (const target of Object.values(SUPPORT_TICKET_CATEGORY_ALIASES)) {
      expect(SUPPORT_TICKET_CATEGORIES).toContain(target);
      expect(normalizeTicketCategory(target)).toBe(target);
    }
  });

  it('no alias KEY collides with a canonical category (aliasing would be a no-op)', () => {
    for (const key of Object.keys(SUPPORT_TICKET_CATEGORY_ALIASES)) {
      expect(SUPPORT_TICKET_CATEGORIES as readonly string[]).not.toContain(key);
    }
  });

  it('the accepted-input set is exactly canonical ∪ aliases', () => {
    expect([...SUPPORT_TICKET_CATEGORY_INPUTS].sort()).toEqual(
      [...SUPPORT_TICKET_CATEGORIES, ...Object.keys(SUPPORT_TICKET_CATEGORY_ALIASES)].sort(),
    );
  });

  it('normalisation is idempotent and total', () => {
    for (const input of SUPPORT_TICKET_CATEGORY_INPUTS) {
      const once = normalizeTicketCategory(input);
      expect(normalizeTicketCategory(once)).toBe(once);
      expect(SUPPORT_TICKET_CATEGORIES).toContain(once);
    }
  });

  it('an unknown ordinary value degrades to "other" rather than throwing', () => {
    // A mis-categorised ticket is strictly better than a dropped one.
    for (const junk of ['', 'nonsense', 'PAYMENT', 'billing ', 'refund']) {
      expect(SUPPORT_TICKET_CATEGORIES).toContain(normalizeTicketCategory(junk));
    }
    expect(normalizeTicketCategory('nonsense')).toBe('other');
  });

  /**
   * DEFECT FOUND, reported to backend (testing, 2026-08-11) — NOT pinned as
   * correct behaviour.
   *
   * `normalizeTicketCategory` ends with
   *     const alias = SUPPORT_TICKET_CATEGORY_ALIASES[category as Alias];
   *     return alias ?? 'other';
   * `SUPPORT_TICKET_CATEGORY_ALIASES` is a plain object literal, so it inherits
   * Object.prototype: `ALIASES['__proto__']` is an OBJECT, `['toString']` and
   * `['constructor']` are FUNCTIONS. All three are non-nullish, so `?? 'other'`
   * does not fire and the function returns a non-string as a "canonical
   * category". This is the identical prototype-inheritance hole documented at
   * length on FEATURE_PERMISSION in apps/host/src/app/api/usage/daily/route.ts,
   * which was fixed there by switching to a `Map`.
   *
   * NOT currently exploitable: the intake route validates
   * `z.enum(SUPPORT_TICKET_CATEGORY_INPUTS)` BEFORE calling this, so a prototype
   * key is rejected with a 400 and never reaches the function. The assertions
   * below pin that boundary — which is what actually protects production today —
   * rather than the function's own (broken) totality claim.
   *
   * TODO(backend): make the alias table a `Map` (or `Object.create(null)`), then
   * fold the three prototype keys back into the test above.
   */
  it('prototype keys are rejected at the ROUTE boundary, before normalisation', () => {
    const accepted = new Set<string>(SUPPORT_TICKET_CATEGORY_INPUTS);
    for (const key of ['__proto__', 'toString', 'constructor', 'valueOf']) {
      expect(
        accepted.has(key),
        `'${key}' would be accepted by the intake enum and reach ` +
          `normalizeTicketCategory, where the prototype chain returns a non-string`,
      ).toBe(false);
    }
  });

  it('the accepted-input list itself contains only own, well-formed values', () => {
    for (const v of SUPPORT_TICKET_CATEGORY_INPUTS) {
      expect(typeof v).toBe('string');
      expect(v).toMatch(/^[a-z_]+$/);
    }
  });

  it('the two intake routes can no longer disagree on the persisted value', () => {
    // Regression statement: every value EITHER route accepts normalises into the
    // canonical set, so `support_tickets.category` holds one vocabulary.
    const persisted = new Set(SUPPORT_TICKET_CATEGORY_INPUTS.map(normalizeTicketCategory));
    for (const c of persisted) expect(SUPPORT_TICKET_CATEGORIES).toContain(c);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Harness for the two route suites
// ════════════════════════════════════════════════════════════════════════════
// Literals, not the consts above: vi.hoisted() runs before module scope.
const { st } = vi.hoisted(() => ({
  st: {
    ticket: {
      id: 'ffffffff-1111-4111-8111-111111111111',
      status: 'open',
      student_id: 'aaaaaaaa-1111-4111-8111-111111111111',
      user_role: 'student',
    } as unknown,
    inserted: [] as Record<string, unknown>[],
    audits: [] as Record<string, unknown>[],
    authUserId: 'aaaaaaaa-2222-4222-8222-222222222222',
  },
}));

vi.mock('@alfanumrik/lib/supabase-admin', () => {
  function chain() {
    const api: Record<string, unknown> = {
      maybeSingle: async () => ({ data: st.ticket, error: null }),
      single: async () => ({ data: st.ticket, error: null }),
      then: (ok: (v: unknown) => unknown) => Promise.resolve({ data: [st.ticket], error: null }).then(ok),
    };
    for (const m of ['eq', 'in', 'order', 'limit', 'range', 'is']) api[m] = () => api;
    return api;
  }
  const client = {
    from: () => ({
      select: () => chain(),
      update: () => ({ eq: async () => ({ data: null, error: null }) }),
      insert: (row: Record<string, unknown>) => {
        st.inserted.push(row);
        return {
          select: () => ({
            single: async () => ({
              data: {
                id: `r-${st.inserted.length}`,
                author_role: row.author_role,
                body: row.body,
                is_internal: row.is_internal,
                created_at: '2026-08-11T00:00:00Z',
              },
              error: null,
            }),
          }),
        };
      },
    }),
  };
  return { supabaseAdmin: client, getSupabaseAdmin: () => client };
});

vi.mock('@alfanumrik/lib/rbac', () => ({
  authorizeRequest: async () => ({
    authorized: true,
    userId: st.authUserId,
    studentId: STUDENT_ID,
    roles: ['student'],
    permissions: ['foxy.chat', 'support.manage_tickets'],
  }),
}));
vi.mock('@alfanumrik/lib/domains/identity', () => ({
  getGuardianByAuthUserId: async () => ({ ok: true, data: null }),
}));
vi.mock('@alfanumrik/lib/domains/relationship', () => ({
  listChildrenForGuardian: async () => ({ ok: true, data: [] }),
}));
vi.mock('@alfanumrik/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('@alfanumrik/lib/admin-auth', () => ({
  logAdminAction: async (row: Record<string, unknown>) => { st.audits.push(row); },
  authorizeAdmin: async () => ({ authorized: true, userId: 'admin-1' }),
}));

async function requesterReply(body: string): Promise<Response> {
  const { POST } = await import('../../../app/api/support/tickets/[id]/route');
  return POST(
    new Request(`http://localhost/api/support/tickets/${TICKET_ID}`, {
      method: 'POST',
      body: JSON.stringify({ body }),
      headers: { 'Content-Type': 'application/json' },
    }) as never,
    { params: Promise.resolve({ id: TICKET_ID }) },
  );
}

beforeEach(() => {
  st.ticket = { id: TICKET_ID, status: 'open', student_id: STUDENT_ID, user_role: 'student' };
  st.inserted = [];
  st.audits = [];
  st.authUserId = STUDENT_AUTH;
});

// ════════════════════════════════════════════════════════════════════════════
// 2. Rate limiter — machine-readable 429, per-user keying
// ════════════════════════════════════════════════════════════════════════════
describe('POST /api/support/tickets/[id] — reply rate limiter', () => {
  const LIMIT = 20;

  it(`allows ${LIMIT} replies then 429s the ${LIMIT + 1}st`, async () => {
    for (let i = 0; i < LIMIT; i++) {
      const res = await requesterReply(`message ${i}`);
      expect(res.status, `reply ${i + 1} of ${LIMIT} should be allowed`).toBe(200);
    }
    const blocked = await requesterReply('one too many');
    expect(blocked.status).toBe(429);
  });

  it('the 429 is machine-readable (code + retry_after_ms + Retry-After header)', async () => {
    // The limiter store is module-scoped and already exhausted for this user by
    // the test above; a fresh user re-arms it, so exhaust deliberately here.
    st.authUserId = 'cccccccc-2222-4222-8222-222222222222';
    for (let i = 0; i < LIMIT; i++) await requesterReply(`m${i}`);
    const res = await requesterReply('blocked');

    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.code).toBe('RATE_LIMITED');
    expect(typeof body.retry_after_ms).toBe('number');
    expect(body.retry_after_ms).toBeGreaterThan(0);
    // Without this header the UI cannot say HOW LONG, only "something failed".
    expect(Number(res.headers.get('Retry-After'))).toBeGreaterThan(0);
  });

  it('rate-limits BEFORE any DB write (a blocked reply leaves no row)', async () => {
    st.authUserId = 'dddddddd-2222-4222-8222-222222222222';
    for (let i = 0; i < LIMIT; i++) await requesterReply(`m${i}`);
    const before = st.inserted.length;
    const res = await requesterReply('blocked');

    expect(res.status).toBe(429);
    expect(st.inserted.length).toBe(before);
  });

  it('is keyed PER USER — one caller cannot rate-limit another', async () => {
    st.authUserId = OTHER_AUTH;
    const res = await requesterReply('a fresh user, first message');
    expect(res.status).toBe(200);
  });

  it('the 429 body carries no ticket content or student identifier (P13)', async () => {
    st.authUserId = 'ffffffff-2222-4222-8222-222222222222';
    for (let i = 0; i < LIMIT; i++) await requesterReply(`m${i}`);
    const wire = JSON.stringify(await (await requesterReply('blocked')).json());
    expect(wire).not.toContain(STUDENT_ID);
    expect(wire).not.toContain(TICKET_ID);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 1. Operator reply POST
// ════════════════════════════════════════════════════════════════════════════
describe('POST /api/internal/admin/support — operator reply', () => {
  async function operatorReply(payload: Record<string, unknown>): Promise<Response> {
    const { POST } = await import('../../../app/api/internal/admin/support/route');
    return POST(
      new Request('http://localhost/api/internal/admin/support', {
        method: 'POST',
        body: JSON.stringify(payload),
        headers: { 'Content-Type': 'application/json' },
      }) as never,
    );
  }

  it('pins author_role to "operator" — a payload cannot forge authorship', async () => {
    const res = await operatorReply({
      ticket_id: TICKET_ID,
      body: 'We have issued the refund.',
      author_role: 'student',
      author_user_id: 'someone-else',
    });
    expect(res.status).toBe(200);
    expect(st.inserted[0].author_role).toBe('operator');
    expect(st.inserted[0].author_user_id).toBe(st.authUserId);
  });

  it('is_internal defaults to FALSE only on an explicit `true` (strict boolean)', async () => {
    await operatorReply({ ticket_id: TICKET_ID, body: 'public answer' });
    expect(st.inserted[0].is_internal).toBe(false);

    st.inserted = [];
    await operatorReply({ ticket_id: TICKET_ID, body: 'note', is_internal: true });
    expect(st.inserted[0].is_internal).toBe(true);

    // Truthy-but-not-true values must NOT create an internal note by accident —
    // and equally must not silently downgrade one. `=== true` makes the
    // behaviour explicit; this pins which side of the line strings fall on.
    st.inserted = [];
    await operatorReply({ ticket_id: TICKET_ID, body: 'note', is_internal: 'true' });
    expect(st.inserted[0].is_internal).toBe(false);
  });

  it('a student-visible reply moves an OPEN ticket to pending; an internal note does not', async () => {
    const pub = await operatorReply({ ticket_id: TICKET_ID, body: 'answer' });
    expect((await pub.json()).ticket_status).toBe('pending');

    st.inserted = [];
    const note = await operatorReply({ ticket_id: TICKET_ID, body: 'note', is_internal: true });
    expect((await note.json()).ticket_status).toBe('open');
  });

  it('rejects a non-uuid ticket_id and an empty body without writing', async () => {
    expect((await operatorReply({ ticket_id: 'nope', body: 'x' })).status).toBe(400);
    expect((await operatorReply({ ticket_id: TICKET_ID, body: '   ' })).status).toBe(400);
    expect(st.inserted).toHaveLength(0);
  });

  it('404s a ticket that does not exist', async () => {
    st.ticket = null;
    const res = await operatorReply({ ticket_id: TICKET_ID, body: 'answer' });
    expect(res.status).toBe(404);
    expect(st.inserted).toHaveLength(0);
  });

  it('the audit row carries ids and the visibility flag, never the reply text (P13)', async () => {
    const secret = 'Parent threatened legal action; offer goodwill credit.';
    await operatorReply({ ticket_id: TICKET_ID, body: secret, is_internal: true });

    expect(st.audits.length).toBeGreaterThan(0);
    const wire = JSON.stringify(st.audits);
    expect(wire).not.toContain(secret);
    expect(wire).not.toContain('goodwill');
    expect(wire).toContain(TICKET_ID);
  });
});
