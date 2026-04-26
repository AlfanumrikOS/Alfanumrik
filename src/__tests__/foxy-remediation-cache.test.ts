/**
 * Foxy /api/foxy/remediation cache contract — REG-39.
 *
 * Phase 2.3 of the Foxy moat plan: a misconception remediation endpoint
 * that, given (question_id, distractor_index), returns a 2-sentence
 * remediation. To keep cost flat and latency low, generated text is
 * cached in `wrong_answer_remediations` keyed by
 * (question_id, distractor_index).
 *
 * This file is a parity / contract test. It mirrors the decision sequence
 * implemented in src/app/api/foxy/remediation/route.ts (Phase 2.3 land).
 * The route does multiple things this test does NOT mount (RBAC,
 * P3 attestation gate, Anthropic prompt construction); those are covered
 * by other tests / integration. Here we lock down the core contract that
 * REG-39 promises:
 *
 *   1. Cache HIT  → return cached row, source='cache', do NOT call LLM.
 *   2. Cache MISS → call LLM exactly once, persist row, return generated.
 *   3. distractor_index outside 0..3 → 400 (P6 — exactly 4 options).
 *   4. ai_usage_global feature flag OFF → 503, do NOT call LLM.
 *
 * If the route in src/app/api/foxy/remediation/route.ts changes its
 * decision shape, this parity copy must be re-synced. Quality review
 * rejects on divergence.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Test harness — boundaries the real route uses ─────────────────────

interface RemediationRow {
  remediation_text: string;
  remediation_text_hi: string | null;
}

interface RemediationRequest {
  question_id: string;
  distractor_index: number;
}

interface RouteResponse {
  status: number;
  body: {
    success: boolean;
    error?: string;
    remediation?: string;
    remediation_hi?: string | null;
    source?: 'cache' | 'llm';
    cached?: boolean;
  };
}

interface Boundaries {
  isAiUsageGloballyEnabled: () => Promise<boolean>;
  fetchCached: (req: RemediationRequest) => Promise<RemediationRow | null>;
  generateWithHaiku: (req: RemediationRequest) => Promise<{
    english: string;
    hindi: string | null;
  } | null>;
  persistGenerated: (
    req: RemediationRequest,
    generated: { english: string; hindi: string | null },
  ) => Promise<void>;
}

// ─── Replicated route logic (parity copy of the post-attestation path) ──
//
// The real route also runs RBAC, JSON parsing, and the P3 attestation
// gate (studentHasSubmittedDistractor) — those are out of scope here and
// are tested by other suites. This harness picks up AFTER attestation
// succeeds, where REG-39 lives. Decision order matches the route exactly:
//   1. ai_usage_global flag → 503 if OFF
//   2. distractor_index in 0..3 (integer) → 400 if not
//   3. cache lookup → 200 + source='cache' on hit
//   4. LLM generate → 503 if generator returns null
//   5. persist (upsert) + 200 with source='llm'

async function handlePostAttestation(
  req: RemediationRequest,
  b: Boundaries,
): Promise<RouteResponse> {
  if (!(await b.isAiUsageGloballyEnabled())) {
    return {
      status: 503,
      body: { success: false, error: 'Remediation is temporarily unavailable.' },
    };
  }

  if (
    !Number.isInteger(req.distractor_index) ||
    req.distractor_index < 0 ||
    req.distractor_index > 3
  ) {
    return {
      status: 400,
      body: { success: false, error: 'distractor_index must be 0..3.' },
    };
  }

  // 1. Cache lookup
  const cached = await b.fetchCached(req);
  if (cached) {
    return {
      status: 200,
      body: {
        success: true,
        remediation: cached.remediation_text,
        remediation_hi: cached.remediation_text_hi,
        source: 'cache',
        cached: true,
      },
    };
  }

  // 2. Generate
  const generated = await b.generateWithHaiku(req);
  if (!generated) {
    return {
      status: 503,
      body: { success: false, error: 'Could not generate remediation. Please try again.' },
    };
  }

  // 3. Persist (best-effort — failure here doesn't fail the response).
  try {
    await b.persistGenerated(req, generated);
  } catch {
    /* swallowed */
  }

  return {
    status: 200,
    body: {
      success: true,
      remediation: generated.english,
      remediation_hi: generated.hindi,
      source: 'llm',
      cached: false,
    },
  };
}

// ─── Boundary builder ───────────────────────────────────────────────────

interface HarnessOpts {
  cached?: RemediationRow | null;
  generated?: { english: string; hindi: string | null } | null;
  aiEnabled?: boolean;
  persistShouldThrow?: boolean;
}

function buildHarness(opts: HarnessOpts = {}) {
  const fetchCached = vi
    .fn<(req: RemediationRequest) => Promise<RemediationRow | null>>()
    .mockResolvedValue(opts.cached ?? null);

  const generateWithHaiku = vi
    .fn<(req: RemediationRequest) => Promise<{ english: string; hindi: string | null } | null>>()
    .mockResolvedValue(
      opts.generated === undefined
        ? { english: 'You confused force with mass. Force = m·a.', hindi: 'बल और द्रव्यमान को मत मिलाओ।' }
        : opts.generated,
    );

  const persistGenerated = vi
    .fn<
      (
        req: RemediationRequest,
        generated: { english: string; hindi: string | null },
      ) => Promise<void>
    >()
    .mockImplementation(async () => {
      if (opts.persistShouldThrow) throw new Error('write-conflict');
    });

  const isAiUsageGloballyEnabled = vi
    .fn<() => Promise<boolean>>()
    .mockResolvedValue(opts.aiEnabled ?? true);

  return {
    isAiUsageGloballyEnabled,
    fetchCached,
    generateWithHaiku,
    persistGenerated,
  } satisfies Boundaries;
}

// ─── Tests ──────────────────────────────────────────────────────────────

describe('Foxy /api/foxy/remediation — cache contract (REG-39)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('cache HIT', () => {
    const cached: RemediationRow = {
      remediation_text: 'You confused force with mass. Force = m·a.',
      remediation_text_hi: 'बल और द्रव्यमान भिन्न हैं।',
    };

    it('returns cached text with source=cache, does NOT call generator', async () => {
      const h = buildHarness({ cached });
      const res = await handlePostAttestation(
        { question_id: 'q-physics-101', distractor_index: 2 },
        h,
      );
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.remediation).toBe(cached.remediation_text);
      expect(res.body.remediation_hi).toBe(cached.remediation_text_hi);
      expect(res.body.source).toBe('cache');
      expect(res.body.cached).toBe(true);
      expect(h.generateWithHaiku).not.toHaveBeenCalled();
      expect(h.persistGenerated).not.toHaveBeenCalled();
    });

    it('cache hit does not write a duplicate row', async () => {
      const h = buildHarness({ cached });
      await handlePostAttestation(
        { question_id: 'q-physics-101', distractor_index: 2 },
        h,
      );
      expect(h.persistGenerated).toHaveBeenCalledTimes(0);
    });

    it('cache row with null Hindi is forwarded as null (not coerced to string)', async () => {
      const h = buildHarness({
        cached: { remediation_text: 'English only.', remediation_text_hi: null },
      });
      const res = await handlePostAttestation(
        { question_id: 'q-1', distractor_index: 0 },
        h,
      );
      expect(res.body.remediation_hi).toBeNull();
    });
  });

  describe('cache MISS', () => {
    it('calls Haiku exactly once and persists the row', async () => {
      const generated = {
        english: 'Selecting "blue" suggests a wavelength confusion. Red has the longest visible wavelength.',
        hindi: 'नीला रंग गलत है। लाल रंग की तरंगदैर्ध्य सबसे अधिक होती है।',
      };
      const h = buildHarness({ cached: null, generated });

      const res = await handlePostAttestation(
        { question_id: 'q-physics-202', distractor_index: 1 },
        h,
      );

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.remediation).toBe(generated.english);
      expect(res.body.remediation_hi).toBe(generated.hindi);
      expect(res.body.source).toBe('llm');
      expect(res.body.cached).toBe(false);
      expect(h.generateWithHaiku).toHaveBeenCalledTimes(1);
      expect(h.persistGenerated).toHaveBeenCalledTimes(1);

      // Verify the persisted row carries the request key + generated text.
      const [persistedReq, persistedGen] = h.persistGenerated.mock.calls[0];
      expect(persistedReq.question_id).toBe('q-physics-202');
      expect(persistedReq.distractor_index).toBe(1);
      expect(persistedGen.english).toBe(generated.english);
    });

    it('LLM returning null → 503, no persist', async () => {
      const h = buildHarness({ cached: null, generated: null });
      const res = await handlePostAttestation(
        { question_id: 'q-1', distractor_index: 0 },
        h,
      );
      expect(res.status).toBe(503);
      expect(res.body.success).toBe(false);
      expect(h.persistGenerated).not.toHaveBeenCalled();
    });

    it('persist throw is non-fatal (response still 200)', async () => {
      const h = buildHarness({ cached: null, persistShouldThrow: true });
      const res = await handlePostAttestation(
        { question_id: 'q-1', distractor_index: 0 },
        h,
      );
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.source).toBe('llm');
    });
  });

  describe('distractor_index validation', () => {
    it('rejects index = -1 with 400, no LLM/cache calls', async () => {
      const h = buildHarness();
      const res = await handlePostAttestation(
        { question_id: 'q-1', distractor_index: -1 },
        h,
      );
      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(h.fetchCached).not.toHaveBeenCalled();
      expect(h.generateWithHaiku).not.toHaveBeenCalled();
    });

    it('rejects index = 4 with 400 (P6 — only 0..3 valid)', async () => {
      const h = buildHarness();
      const res = await handlePostAttestation(
        { question_id: 'q-1', distractor_index: 4 },
        h,
      );
      expect(res.status).toBe(400);
      expect(h.generateWithHaiku).not.toHaveBeenCalled();
    });

    it('rejects index = 99 with 400', async () => {
      const h = buildHarness();
      const res = await handlePostAttestation(
        { question_id: 'q-1', distractor_index: 99 },
        h,
      );
      expect(res.status).toBe(400);
    });

    it('rejects non-integer indices (1.5) with 400', async () => {
      const h = buildHarness();
      const res = await handlePostAttestation(
        { question_id: 'q-1', distractor_index: 1.5 },
        h,
      );
      expect(res.status).toBe(400);
      expect(h.generateWithHaiku).not.toHaveBeenCalled();
    });

    it('accepts each of 0, 1, 2, 3', async () => {
      for (const idx of [0, 1, 2, 3]) {
        const h = buildHarness({ cached: null });
        const res = await handlePostAttestation(
          { question_id: `q-${idx}`, distractor_index: idx },
          h,
        );
        expect(res.status).toBe(200);
      }
    });
  });

  describe('ai_usage_global kill switch', () => {
    it('returns 503 when flag is OFF and skips ALL downstream calls', async () => {
      const h = buildHarness({ aiEnabled: false });
      const res = await handlePostAttestation(
        { question_id: 'q-1', distractor_index: 0 },
        h,
      );
      expect(res.status).toBe(503);
      expect(res.body.success).toBe(false);
      // Kill switch is the OUTER-most gate (matches route order).
      expect(h.fetchCached).not.toHaveBeenCalled();
      expect(h.generateWithHaiku).not.toHaveBeenCalled();
      expect(h.persistGenerated).not.toHaveBeenCalled();
    });

    it('kill switch is evaluated BEFORE input validation', async () => {
      // Per the route, ai_usage_global runs before distractor_index range
      // check. So a malformed request with the flag OFF surfaces the 503
      // (infra) rather than the 400 (shape).
      const h = buildHarness({ aiEnabled: false });
      const res = await handlePostAttestation(
        { question_id: 'q-1', distractor_index: 7 },
        h,
      );
      expect(res.status).toBe(503);
    });

    it('flag re-enabled serves traffic on the next call', async () => {
      const h = buildHarness({ aiEnabled: true, cached: null });
      const res = await handlePostAttestation(
        { question_id: 'q-1', distractor_index: 0 },
        h,
      );
      expect(res.status).toBe(200);
      expect(h.generateWithHaiku).toHaveBeenCalledTimes(1);
    });
  });
});
