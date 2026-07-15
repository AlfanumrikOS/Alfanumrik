// apps/host/src/__tests__/api/foxy/legacy-flow-anti-fake.test.ts
//
// REG-252 (legacy-persist half) — the UNCONDITIONAL, FLAG-INDEPENDENT backstop.
// `persistLegacyFoxyResponse` is the single gate every legacy Foxy turn flows
// through (ff_grounded_ai_foxy-OFF kill switch AND the grounded-abstain
// fallback). It strips a claim-only turn to the graceful bilingual fallback in
// BOTH the returned wire `response` AND the persisted `foxy_chat_messages.content`
// — and it reads NO feature flag while doing so (ff_foxy_real_practice_v1 OFF
// makes no difference).
//
//   • claim-only legacy.response ("Generated 5 quiz questions.") → wire response
//     AND persisted assistant content are BOTH the bilingual fallback.
//   • a real-question legacy.response (A)/B)/C)/D)) passes through UNTOUCHED in
//     both surfaces.
//
// Owner: ai-engineer / backend. Reviewers: assessment (fallback copy), testing.
//
// Only the persistence + audit + safety-screen deps are mocked; the REAL
// stripFakeQuizClaim (the unit under test) runs. output-screen is stubbed to
// "safe" so the persist path deterministically reaches the insert — the screen
// itself is covered by REG-241.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QUIZ_CLAIM_FALLBACK_TEXT } from '@alfanumrik/lib/foxy/anti-fake-quiz-claim';

// ─── Capture every foxy_chat_messages insert ─────────────────────────────────
const insertedRows: unknown[][] = [];
vi.mock('@alfanumrik/lib/supabase-admin', () => ({
  supabaseAdmin: {
    from: (table: string) => ({
      insert: (rows: unknown[]) => {
        if (table === 'foxy_chat_messages') insertedRows.push(rows);
        return Promise.resolve({ data: null, error: null });
      },
    }),
  },
}));

// ─── Audit + logger — inert spies ────────────────────────────────────────────
const logAuditMock = vi.fn();
vi.mock('@alfanumrik/lib/rbac', () => ({ logAudit: (...a: unknown[]) => logAuditMock(...a) }));
vi.mock('@alfanumrik/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// ─── The legacy AI barrel (only used by runLegacyFoxyFlow, not persist) ──────
vi.mock('@alfanumrik/lib/ai', () => ({ classifyIntent: vi.fn(), routeIntent: vi.fn() }));

// ─── Quota helpers — persist only touches these on the safety-block path ─────
const refundQuotaMock = vi.fn().mockResolvedValue(undefined);
vi.mock('@/app/api/foxy/_lib/quota', () => ({
  refundQuota: (...a: unknown[]) => refundQuotaMock(...a),
  resolveTenantAiOverrides: vi.fn().mockResolvedValue({}),
}));

// ─── Output safety screen — force "safe" so persist reaches the insert ───────
// (REG-241 covers the screen itself; here we isolate the anti-fake strip.)
vi.mock('@alfanumrik/lib/ai/validation/output-screen', () => ({
  screenStudentFacingText: vi.fn(() => ({ safe: true, categories: [] })),
}));

// The persist path reads NO feature flag; this mock proves flag-independence —
// even wired ff_foxy_real_practice_v1 OFF, the strip still fires.
const _isFeatureEnabled = vi.fn().mockResolvedValue(false);
vi.mock('@alfanumrik/lib/feature-flags', () => ({
  isFeatureEnabled: (...a: unknown[]) => _isFeatureEnabled(...a),
}));

function makeLegacy(response: string) {
  return {
    response,
    sources: [] as never[],
    diagrams: [] as never[],
    tokensUsed: 123,
    model: 'legacy-intent-router',
    traceId: 'trace-legacy-1',
    intent: 'quiz',
  };
}

function baseParams(response: string) {
  return {
    authUserId: 'auth-user-1',
    studentId: 'student-uuid-1',
    resolvedSessionId: 'session-uuid-1',
    remaining: 4,
    message: 'quiz me on the cell',
    subject: 'science',
    grade: '9',
    chapter: 'The Cell' as string | null,
    mode: 'practice',
    legacy: makeLegacy(response),
    logFoxyAsk: vi.fn(),
  };
}

function assistantContentOf(rows: unknown[][]): string {
  // Persist inserts [userRow, assistantRow]; the assistant row holds `content`.
  const lastBatch = rows[rows.length - 1] as Array<Record<string, unknown>>;
  const assistant = lastBatch.find((r) => r.role === 'assistant');
  return (assistant?.content as string) ?? '';
}

beforeEach(() => {
  vi.clearAllMocks();
  insertedRows.length = 0;
});

const CLAIM_ONLY = 'Generated 5 quiz questions.';
const REAL_TURN =
  'Here are 3 practice questions — attempt them.\n' +
  '1. What is the powerhouse of the cell?\n' +
  '   A) Nucleus\n   B) Mitochondria\n   C) Ribosome\n   D) Golgi body';

describe('persistLegacyFoxyResponse — flag-independent anti-fake backstop', () => {
  it('a claim-only turn is replaced by the bilingual fallback in BOTH wire response AND persisted content', async () => {
    const { persistLegacyFoxyResponse } = await import('@/app/api/foxy/_lib/legacy-flow');
    const res = await persistLegacyFoxyResponse(baseParams(CLAIM_ONLY));
    const body = (await res.json()) as Record<string, unknown>;

    // Wire response = fallback, never the claim.
    expect(body.response).toBe(QUIZ_CLAIM_FALLBACK_TEXT);
    expect(body.response).not.toContain('Generated 5');

    // Persisted assistant content = the SAME fallback (not the claim).
    expect(insertedRows.length).toBe(1);
    expect(assistantContentOf(insertedRows)).toBe(QUIZ_CLAIM_FALLBACK_TEXT);
  });

  it('a real-question turn (A)/B)/C)/D)) passes through UNTOUCHED in both surfaces', async () => {
    const { persistLegacyFoxyResponse } = await import('@/app/api/foxy/_lib/legacy-flow');
    const res = await persistLegacyFoxyResponse(baseParams(REAL_TURN));
    const body = (await res.json()) as Record<string, unknown>;

    expect(body.response).toBe(REAL_TURN);
    expect(assistantContentOf(insertedRows)).toBe(REAL_TURN);
    expect(body.response).not.toBe(QUIZ_CLAIM_FALLBACK_TEXT);
  });

  it('the strip is unconditional — no feature flag is consulted on this path', async () => {
    const { persistLegacyFoxyResponse } = await import('@/app/api/foxy/_lib/legacy-flow');
    await persistLegacyFoxyResponse(baseParams(CLAIM_ONLY));
    // persist reads no flag; the backstop fired regardless.
    expect(_isFeatureEnabled).not.toHaveBeenCalled();
  });
});
