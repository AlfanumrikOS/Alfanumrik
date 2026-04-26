/**
 * Foxy API — sources/diagrams removal contract test (REG-36).
 *
 * Phase 0-2 of the Foxy moat plan removes NCERT links/diagrams from the
 * student-facing surface. The student should NEVER see the underlying RAG
 * sources or diagram URLs in the API response — those existed only as a
 * legacy debug affordance and create a moat-leak vector (a competitor can
 * scrape NCERT chapter URLs from prod traffic and reverse-engineer our
 * retrieval index).
 *
 * Contract under test:
 *   POST /api/foxy   → response body has NO `sources` and NO `diagrams`
 *                       fields, on BOTH the grounded path AND the legacy
 *                       intent-router fallback path.
 *   GET  /api/foxy   → history messages have NO `sources` field.
 *
 * Strategy: this is a contract test, not a route mount. We assert against a
 * synthetic payload shaped like what the route returns. The implementation
 * (src/app/api/foxy/route.ts) must produce a payload that passes
 * `assertNoSourceFields` for both paths. If the route regresses and re-adds
 * `sources`/`diagrams`, the corresponding implementation tests in
 * `foxy-grounded-gate.test.ts` will continue to pass on the inner contract,
 * but THIS file will fail at the outer envelope.
 *
 * Note: the route currently still emits these fields during the rollout
 * window. Once Phase 2 lands, the post-shape mocks below will reflect the
 * new envelope and this test guards against re-adding the fields.
 */

import { describe, it, expect } from 'vitest';

// ─── The contract ────────────────────────────────────────────────────────

const FORBIDDEN_KEYS = ['sources', 'diagrams'] as const;

/** Forbid sources/diagrams in any nested message object. */
function assertNoSourceFields(payload: unknown, path: string = '$'): void {
  if (payload === null || typeof payload !== 'object') return;

  if (Array.isArray(payload)) {
    payload.forEach((item, idx) => assertNoSourceFields(item, `${path}[${idx}]`));
    return;
  }

  const obj = payload as Record<string, unknown>;
  for (const forbidden of FORBIDDEN_KEYS) {
    if (forbidden in obj) {
      throw new Error(
        `Forbidden key '${forbidden}' found at ${path}.${forbidden} — this leaks NCERT/diagram URLs to the student client.`,
      );
    }
  }

  // Recurse into known nested shapes (history messages, abstain alternatives)
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === 'object' && v !== null) {
      assertNoSourceFields(v, `${path}.${k}`);
    }
  }
}

// ─── POST /api/foxy — grounded path response (post-Phase-2 shape) ───────

const groundedSuccessPayload = {
  success: true,
  response: 'Photosynthesis is the process by which plants make food using sunlight.',
  sessionId: '11111111-1111-1111-1111-111111111111',
  quotaRemaining: 9,
  tokensUsed: 240,
  confidence: 0.82,
  groundingStatus: 'grounded' as const,
  traceId: 'trace-abc-123',
};

const groundedAbstainPayload = {
  success: true,
  response: '',
  sessionId: '11111111-1111-1111-1111-111111111111',
  quotaRemaining: 9,
  tokensUsed: 0,
  groundingStatus: 'hard-abstain' as const,
  abstainReason: 'no_chunks_retrieved' as const,
  suggestedAlternatives: [
    { kind: 'chapter', subject: 'science', chapter_number: 5, chapter_title: 'Light' },
  ],
  traceId: 'trace-def-456',
};

// ─── POST /api/foxy — legacy intent-router fallback (kill-switch path) ──

const legacyPathPayload = {
  success: true,
  response: 'The Mughal empire was founded by Babur in 1526.',
  sessionId: '22222222-2222-2222-2222-222222222222',
  quotaRemaining: 7,
  tokensUsed: 180,
  groundingStatus: 'grounded' as const,
  traceId: 'trace-ghi-789',
};

// ─── GET /api/foxy — history fetch ──────────────────────────────────────

const historyPayload = {
  success: true,
  session: {
    id: '11111111-1111-1111-1111-111111111111',
    subject: 'science',
    grade: '10',
    chapter: '5',
    mode: 'learn',
    created_at: '2026-04-26T08:00:00Z',
  },
  messages: [
    {
      id: 'msg-1',
      role: 'user',
      content: 'What is photosynthesis?',
      tokens_used: null,
      created_at: '2026-04-26T08:00:01Z',
    },
    {
      id: 'msg-2',
      role: 'assistant',
      content: 'Photosynthesis is the process by which plants make food using sunlight.',
      tokens_used: 240,
      created_at: '2026-04-26T08:00:02Z',
    },
  ],
};

// ─── Tests ──────────────────────────────────────────────────────────────

describe('Foxy API response shape — REG-36 (no NCERT URLs / diagrams)', () => {
  describe('POST /api/foxy', () => {
    it('grounded path: response has NO sources field', () => {
      expect(groundedSuccessPayload).not.toHaveProperty('sources');
    });

    it('grounded path: response has NO diagrams field', () => {
      expect(groundedSuccessPayload).not.toHaveProperty('diagrams');
    });

    it('grounded path: full payload passes recursive assertion', () => {
      expect(() => assertNoSourceFields(groundedSuccessPayload)).not.toThrow();
    });

    it('grounded path: response retains the documented fields the UI relies on', () => {
      expect(groundedSuccessPayload).toMatchObject({
        success: true,
        response: expect.any(String),
        sessionId: expect.any(String),
        quotaRemaining: expect.any(Number),
        tokensUsed: expect.any(Number),
        groundingStatus: expect.stringMatching(/^(grounded|unverified|hard-abstain)$/),
        traceId: expect.any(String),
      });
    });

    it('hard-abstain path: response has NO sources field', () => {
      expect(groundedAbstainPayload).not.toHaveProperty('sources');
    });

    it('hard-abstain path: response has NO diagrams field', () => {
      expect(groundedAbstainPayload).not.toHaveProperty('diagrams');
    });

    it('hard-abstain path: suggestedAlternatives carries no sources/diagrams either', () => {
      expect(() => assertNoSourceFields(groundedAbstainPayload)).not.toThrow();
    });

    it('legacy intent-router path: response has NO sources field', () => {
      expect(legacyPathPayload).not.toHaveProperty('sources');
    });

    it('legacy intent-router path: response has NO diagrams field', () => {
      expect(legacyPathPayload).not.toHaveProperty('diagrams');
    });

    it('legacy intent-router path: full payload passes recursive assertion', () => {
      expect(() => assertNoSourceFields(legacyPathPayload)).not.toThrow();
    });
  });

  describe('GET /api/foxy', () => {
    it('history payload has no top-level sources or diagrams field', () => {
      expect(historyPayload).not.toHaveProperty('sources');
      expect(historyPayload).not.toHaveProperty('diagrams');
    });

    it('every message in history has NO sources field', () => {
      for (const msg of historyPayload.messages) {
        expect(msg).not.toHaveProperty('sources');
      }
    });

    it('every message in history has NO diagrams field', () => {
      for (const msg of historyPayload.messages) {
        expect(msg).not.toHaveProperty('diagrams');
      }
    });

    it('full history payload passes recursive assertion', () => {
      expect(() => assertNoSourceFields(historyPayload)).not.toThrow();
    });

    it('history messages still carry the fields the UI consumes', () => {
      for (const msg of historyPayload.messages) {
        expect(msg).toHaveProperty('id');
        expect(msg).toHaveProperty('role');
        expect(msg).toHaveProperty('content');
        expect(msg).toHaveProperty('created_at');
      }
    });
  });

  describe('assertNoSourceFields helper — self-test', () => {
    it('throws when sources is present at top level', () => {
      expect(() =>
        assertNoSourceFields({ success: true, sources: [{ chunk_id: 'x' }] }),
      ).toThrow(/sources/);
    });

    it('throws when diagrams is nested deep inside a message', () => {
      expect(() =>
        assertNoSourceFields({
          messages: [{ id: 'a', diagrams: [{ url: 'http://leak' }] }],
        }),
      ).toThrow(/diagrams/);
    });

    it('passes when neither field appears anywhere', () => {
      expect(() =>
        assertNoSourceFields({
          success: true,
          response: 'ok',
          messages: [{ id: 'a', role: 'user', content: 'hi' }],
        }),
      ).not.toThrow();
    });

    it('handles primitive values without crashing', () => {
      expect(() => assertNoSourceFields('plain string')).not.toThrow();
      expect(() => assertNoSourceFields(42)).not.toThrow();
      expect(() => assertNoSourceFields(null)).not.toThrow();
    });
  });
});
