import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Safeguarding Phase 1 — respondSafeguarding envelope contract.
 *
 * The Tier-2-confirmed terminal reply from /api/foxy must:
 *   - be a valid { success: true } envelope with badgeState 'safeguarding'
 *     and safeguarding.helpline = { name: 'Childline', number: '1098' };
 *   - be bilingual (P7): EN copy + Hindi Devanagari copy in the SAME reply;
 *   - be warm and non-clinical: no diagnosis language, no "best friend"
 *     framing — a tutor pointing the student at real humans + Childline 1098;
 *   - persist the user + assistant turn to foxy_chat_messages (session
 *     continuity) with a minimal valid structured paragraph block;
 *   - audit flow:'safeguarding' with category/tier/escalated ONLY — the
 *     audit details must NEVER carry the student's message text (P13);
 *   - award 0 XP / no mastery writes (P2) — the only table touched is
 *     foxy_chat_messages.
 */

const _logAuditImpl = vi.fn();
vi.mock('@alfanumrik/lib/rbac', () => ({
  authorizeRequest: vi.fn(),
  logAudit: (...args: unknown[]) => _logAuditImpl(...args),
}));

const _tablesTouched: string[] = [];
let _insertedRows: unknown[] = [];
vi.mock('@alfanumrik/lib/supabase-admin', () => ({
  supabaseAdmin: {
    from: (table: string) => {
      _tablesTouched.push(table);
      return {
        insert: (rows: unknown[]) => {
          _insertedRows = rows as unknown[];
          return {
            select: () =>
              Promise.resolve({
                data: [
                  { id: 'msg-user-1', role: 'user' },
                  { id: 'msg-assistant-1', role: 'assistant' },
                ],
                error: null,
              }),
          };
        },
      };
    },
    rpc: vi.fn(),
  },
  getSupabaseAdmin: vi.fn(),
}));

vi.mock('@alfanumrik/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const DISCLOSURE = 'i do not want to be here anymore, everything is too much';

async function callResponder() {
  const { respondSafeguarding } = await import('@/app/api/foxy/_lib/responders');
  const res = await respondSafeguarding({
    studentId: 'student-uuid-1',
    userId: 'auth-user-1',
    resolvedSessionId: 'session-uuid-1',
    message: DISCLOSURE,
    subject: 'science',
    grade: '8',
    chapter: null,
    mode: 'learn',
    quotaRemaining: 4,
    category: 'self_harm',
    tier: 'high',
    traceId: 'trace-sg-1',
  });
  const body = (await res.json()) as Record<string, unknown>;
  return { res, body };
}

beforeEach(() => {
  vi.clearAllMocks();
  _tablesTouched.length = 0;
  _insertedRows = [];
});

describe('respondSafeguarding — envelope shape', () => {
  it('returns success:true with badgeState safeguarding and the Childline 1098 helpline', async () => {
    const { res, body } = await callResponder();
    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.badgeState).toBe('safeguarding');
    expect(body.safeguarding).toEqual({ helpline: { name: 'Childline', number: '1098' } });
    expect(body.sessionId).toBe('session-uuid-1');
    expect(body.quotaRemaining).toBe(4);
    expect(body.traceId).toBe('trace-sg-1');
    expect(body.messageId).toBe('msg-assistant-1');
  });

  it('is bilingual (P7): EN + Devanagari in the same reply, mentions Childline and 1098', async () => {
    const { body } = await callResponder();
    const text = body.response as string;
    expect(text).toMatch(/you are not alone/i);
    expect(text).toMatch(/[ऀ-ॿ]/); // Devanagari present
    expect(text).toContain('Childline');
    expect(text).toContain('1098');
    expect(text).toMatch(/trusted adult/i);
  });

  it('uses warm non-clinical copy: no diagnosis language, no best-friend framing', async () => {
    const { body } = await callResponder();
    const text = (body.response as string).toLowerCase();
    for (const forbidden of ['diagnos', 'depression', 'disorder', 'best friend', 'therapy session']) {
      expect(text).not.toContain(forbidden);
    }
  });

  it("old-APK safety pin: 'Childline' AND '1098' appear in BOTH the EN and HI segments of the top-level `response` string, independent of the structured safeguarding envelope", async () => {
    // OLD-APK RATIONALE (mobile parity, binding pin): already-installed
    // mobile APKs that predate the safeguarding renderer display ONLY the
    // top-level `response` string — they know nothing about `badgeState`,
    // `structured`, or the `safeguarding.helpline` object (which newer
    // clients use to draw the HelplineCard). If a future change moved the
    // helpline text SOLELY into the structured safeguarding envelope, an
    // old APK would show a distressed child a reply with no Childline 1098
    // at all (or a fallback error) — a child-safety regression. So the
    // flat `response` string itself must ALWAYS carry the helpline, in
    // both languages, regardless of what the envelope also carries.
    const { body } = await callResponder();
    const text = body.response as string;

    // Deliberately assert on `response` ALONE — do not reference
    // body.safeguarding here; this pin must hold even if the structured
    // envelope changes shape or disappears.
    const devanagari = /[ऀ-ॿ]/;
    const segments = text.split('\n\n').filter((s) => s.trim().length > 0);
    const enText = segments.filter((s) => !devanagari.test(s)).join('\n\n');
    const hiText = segments.filter((s) => devanagari.test(s)).join('\n\n');

    // Both language segments exist...
    expect(enText.length).toBeGreaterThan(0);
    expect(hiText.length).toBeGreaterThan(0);
    // ...and EACH independently carries the helpline name + number.
    expect(enText).toContain('Childline');
    expect(enText).toContain('1098');
    expect(hiText).toContain('Childline');
    expect(hiText).toContain('1098');
  });

  it('carries a minimal valid structured payload (single paragraph block)', async () => {
    const { body } = await callResponder();
    const structured = body.structured as { blocks: Array<{ type: string; text: string }> };
    expect(structured.blocks).toHaveLength(1);
    expect(structured.blocks[0].type).toBe('paragraph');
    expect(structured.blocks[0].text.length).toBeGreaterThan(0);
  });
});

describe('respondSafeguarding — persistence + audit (P13, P2)', () => {
  it('persists ONLY to foxy_chat_messages (0 XP, no mastery writes anywhere)', async () => {
    await callResponder();
    expect(new Set(_tablesTouched)).toEqual(new Set(['foxy_chat_messages']));
    const rows = _insertedRows as Array<{ role: string; content: string }>;
    expect(rows.map((r) => r.role)).toEqual(['user', 'assistant']);
    expect(rows[0].content).toBe(DISCLOSURE);
  });

  it('audits flow:safeguarding with category/tier/escalated and xpAwarded 0 — NEVER the message text', async () => {
    await callResponder();
    expect(_logAuditImpl).toHaveBeenCalledTimes(1);
    const [userId, payload] = _logAuditImpl.mock.calls[0] as [string, Record<string, unknown>];
    expect(userId).toBe('auth-user-1');
    const details = payload.details as Record<string, unknown>;
    expect(details.flow).toBe('safeguarding');
    expect(details.category).toBe('self_harm');
    expect(details.tier).toBe('high');
    expect(details.escalated).toBe(true);
    expect(details.xpAwarded).toBe(0);
    // P13: the student's disclosure text must never enter the audit payload.
    expect(JSON.stringify(payload)).not.toContain(DISCLOSURE);
    expect(JSON.stringify(payload)).not.toContain('do not want to be here');
  });
});
