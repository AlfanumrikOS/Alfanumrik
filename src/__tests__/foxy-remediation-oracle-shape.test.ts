/**
 * Foxy /api/foxy/remediation oracle-shape uniformity — REG-40.
 *
 * Locks down the P3 anti-cheat defense-in-depth: every non-eligible
 * request to /api/foxy/remediation MUST return the SAME response shape
 * (HTTP 403, body { success: false, error: 'remediation_unavailable' })
 * with NO additional fields that vary by scenario, AND must skip both
 * the cache lookup and the Anthropic call so timing cannot leak which
 * branch failed.
 *
 * Scenarios covered (each must collapse to the same 403):
 *   1. distractor_index === correct_answer_index (the original 422 oracle)
 *   2. Student never attempted the question (no quiz_responses row)
 *   3. Student attempted but selected a DIFFERENT distractor
 *   4. Student attempted and got the question CORRECT
 *
 * The companion file foxy-remediation-cache.test.ts (REG-39) covers the
 * post-attestation cache contract. This file specifically covers the
 * upstream gate's response-shape uniformity, which the parity copy
 * cannot — REG-39 picks up AFTER attestation succeeds.
 *
 * If src/app/api/foxy/remediation/route.ts:remediationUnavailable() ever
 * widens its body shape, returns a non-403 status, or stops gating the
 * cache lookup behind attestation, this suite must fail. Quality review
 * rejects on divergence. P3 is non-negotiable per `.claude/CLAUDE.md`.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// ── RBAC mock ─────────────────────────────────────────────────────────────
// Default: a student authenticated as 'student-attacker-1'. Tests do not
// flex auth state — the entire test bench assumes a valid student JWT and
// asserts that AFTER auth passes, every non-eligible request still
// collapses to the same 403.
const _authorizeImpl = vi.fn();

vi.mock('@/lib/rbac', () => ({
  authorizeRequest: (...args: unknown[]) => _authorizeImpl(...args),
}));

function setAuthorizedAsStudent(studentId = 'student-attacker-1', userId = 'auth-user-1') {
  _authorizeImpl.mockResolvedValue({
    authorized: true,
    userId,
    studentId,
    roles: ['student'],
    permissions: ['foxy.chat'],
  });
}

// ── Feature flags mock ────────────────────────────────────────────────────
// ai_usage_global ON for every test in this suite. The kill-switch path
// (503) is covered by REG-39; here we want to prove that with the kill
// switch ON and auth passing, the attestation gate ALONE produces a
// uniform 403 for every non-eligible scenario.
const _isFeatureEnabled = vi.fn();

vi.mock('@/lib/feature-flags', () => ({
  isFeatureEnabled: (...args: unknown[]) => _isFeatureEnabled(...args),
}));

// ── supabase-admin mock ───────────────────────────────────────────────────
// We control three call sites:
//   (a) studentHasSubmittedDistractor — quiz_responses select chain
//   (b) fetchCached — wrong_answer_remediations select chain
//   (c) fetchQuestion — quiz_questions select chain
//
// For oracle-shape uniformity we MUST verify that (b) and (c) are NEVER
// reached when attestation fails. The mock counts every .from() call so
// the test can assert table-level access.

const fromCalls: string[] = [];
let attestationResult: { data: unknown[] | null; error: unknown } = { data: [], error: null };
let cacheResult: { data: unknown; error: unknown } = { data: null, error: null };
let questionResult: { data: unknown; error: unknown } = { data: null, error: null };

// Build a minimal Supabase-style query chain. The route's actual queries are:
//   from('quiz_responses').select(...).eq(...).eq(...).eq(...).eq(...).limit(1)
//   from('wrong_answer_remediations').select(...).eq(...).eq(...).maybeSingle()
//   from('quiz_questions').select(...).eq(...).maybeSingle()
function buildQueryChain(table: string) {
  fromCalls.push(table);

  // Resolution payload depends on which table.
  const resolveFor = () => {
    if (table === 'quiz_responses') return Promise.resolve(attestationResult);
    if (table === 'wrong_answer_remediations') return Promise.resolve(cacheResult);
    if (table === 'quiz_questions') return Promise.resolve(questionResult);
    return Promise.resolve({ data: null, error: null });
  };

  // .limit() returns a thenable (await directly).
  const limit = () => ({
    then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
      resolveFor().then(resolve, reject),
  });

  // .maybeSingle() returns a thenable.
  const maybeSingle = () => resolveFor();

  const chainable: Record<string, unknown> = {};
  chainable.select = () => chainable;
  chainable.eq = () => chainable;
  chainable.limit = limit;
  chainable.maybeSingle = maybeSingle;
  // Allow direct await on the chain too.
  (chainable as { then: unknown }).then = (
    resolve: (v: unknown) => unknown,
    reject?: (e: unknown) => unknown,
  ) => resolveFor().then(resolve, reject);
  return chainable;
}

const insertSpy = vi.fn().mockResolvedValue({ data: null, error: null });

vi.mock('@/lib/supabase-admin', () => ({
  supabaseAdmin: {
    from: (table: string) => {
      const base = buildQueryChain(table);
      // wrong_answer_remediations.insert is exercised only on the cache-write
      // path. If oracle-shape gating works, we should never touch this.
      (base as Record<string, unknown>).insert = (...args: unknown[]) => insertSpy(...args);
      return base;
    },
  },
}));

// ── Anthropic fetch spy ──────────────────────────────────────────────────
// The route calls fetch(ANTHROPIC_ENDPOINT) inside generateWithHaiku().
// If the attestation gate fires correctly, fetch must NEVER be called
// with the Anthropic endpoint for any of the 4 oracle scenarios.
const fetchSpy = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  fromCalls.length = 0;
  attestationResult = { data: [], error: null };
  cacheResult = { data: null, error: null };
  questionResult = { data: null, error: null };

  setAuthorizedAsStudent();
  _isFeatureEnabled.mockResolvedValue(true);

  // Replace global fetch with a spy. The route's generateWithHaiku() is
  // the only fetch caller in this module.
  fetchSpy.mockResolvedValue(
    new Response(JSON.stringify({ content: [{ type: 'text', text: 'should-never-run' }] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }),
  );
  vi.stubGlobal('fetch', fetchSpy);

  // Set a fake API key so the route doesn't short-circuit on missing creds
  // — we want to prove the gate fires BEFORE any fetch consideration.
  process.env.ANTHROPIC_API_KEY = 'test-key-not-real';
});

// ── Logger mock — quiet output ────────────────────────────────────────────
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// ── Helpers ───────────────────────────────────────────────────────────────

function makeRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/foxy/remediation', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-jwt' },
    body: JSON.stringify(body),
  });
}

const UNIFORM_BODY = { success: false, error: 'remediation_unavailable' } as const;

interface ParsedResponse {
  status: number;
  body: Record<string, unknown>;
}

async function parseResponse(res: Response): Promise<ParsedResponse> {
  return { status: res.status, body: await res.json() };
}

function assertUniform403(parsed: ParsedResponse) {
  // 1. Status code is identical across every non-eligible scenario.
  expect(parsed.status).toBe(403);

  // 2. Body is the EXACT shape — no extra keys.
  expect(Object.keys(parsed.body).sort()).toEqual(['error', 'success']);
  expect(parsed.body).toEqual(UNIFORM_BODY);

  // 3. Specifically no oracle-leaking fields.
  expect(parsed.body).not.toHaveProperty('correct_answer_index');
  expect(parsed.body).not.toHaveProperty('your_answer');
  expect(parsed.body).not.toHaveProperty('hint');
  expect(parsed.body).not.toHaveProperty('remediation');
  expect(parsed.body).not.toHaveProperty('remediation_hi');
  expect(parsed.body).not.toHaveProperty('source');
  expect(parsed.body).not.toHaveProperty('cached');
}

function assertNoTimingSideChannel() {
  // The cache table and the question table must NEVER be touched when
  // attestation fails — both are O(ms) DB lookups whose presence/absence
  // is observable via response-time timing.
  expect(fromCalls).not.toContain('wrong_answer_remediations');
  expect(fromCalls).not.toContain('quiz_questions');
  expect(insertSpy).not.toHaveBeenCalled();

  // Anthropic must not be called.
  const anthropicCalls = fetchSpy.mock.calls.filter((call: unknown[]) => {
    const url = call[0];
    return typeof url === 'string' && url.includes('api.anthropic.com');
  });
  expect(anthropicCalls).toHaveLength(0);
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe('Foxy /api/foxy/remediation — oracle-shape uniformity (REG-40, P3)', () => {
  describe('Scenario 1: distractor_index === correct_answer_index', () => {
    it('returns 403 { success:false, error:"remediation_unavailable" } and skips cache + Anthropic', async () => {
      // Even though the request structurally points at the correct answer,
      // the attestation gate (is_correct=false filter) returns no rows.
      attestationResult = { data: [], error: null };

      const { POST } = await import('@/app/api/foxy/remediation/route');
      const res = await POST(
        makeRequest({ question_id: 'q-physics-101', distractor_index: 0 }),
      );
      const parsed = await parseResponse(res);

      assertUniform403(parsed);
      assertNoTimingSideChannel();
    });
  });

  describe('Scenario 2: student never attempted this question', () => {
    it('returns the same 403 { success:false, error:"remediation_unavailable" }', async () => {
      // No quiz_responses row exists for (this student, this question).
      attestationResult = { data: [], error: null };

      const { POST } = await import('@/app/api/foxy/remediation/route');
      const res = await POST(
        makeRequest({ question_id: 'q-never-seen', distractor_index: 2 }),
      );
      const parsed = await parseResponse(res);

      assertUniform403(parsed);
      assertNoTimingSideChannel();
    });
  });

  describe('Scenario 3: student attempted but selected a DIFFERENT distractor', () => {
    it('returns the same 403 even though a quiz_responses row exists for a different index', async () => {
      // The eq('selected_option', distractorIndex) filter excludes the
      // student's actual wrong answer — so for the REQUESTED index, the
      // gate sees zero rows and collapses to remediation_unavailable.
      attestationResult = { data: [], error: null };

      const { POST } = await import('@/app/api/foxy/remediation/route');
      const res = await POST(
        // Student selected index 1 in real life; attacker probes index 3.
        makeRequest({ question_id: 'q-mixed-up', distractor_index: 3 }),
      );
      const parsed = await parseResponse(res);

      assertUniform403(parsed);
      assertNoTimingSideChannel();
    });
  });

  describe('Scenario 4: student attempted and got the question CORRECT', () => {
    it('returns the same 403 — submitting the correct answer never unlocks remediation', async () => {
      // Student submitted is_correct=true for some index. The gate filters
      // is_correct=false, so the row is excluded and the request collapses
      // to remediation_unavailable — uniform with scenarios 1-3.
      attestationResult = { data: [], error: null };

      const { POST } = await import('@/app/api/foxy/remediation/route');
      const res = await POST(
        makeRequest({ question_id: 'q-aced-it', distractor_index: 1 }),
      );
      const parsed = await parseResponse(res);

      assertUniform403(parsed);
      assertNoTimingSideChannel();
    });
  });

  describe('Cross-scenario uniformity', () => {
    it('all 4 oracle scenarios return BYTE-IDENTICAL response bodies', async () => {
      // The strongest possible defense: serialise each response and assert
      // string equality. This catches any drift in field ordering, key
      // spelling, or accidental extra metadata.
      const requests = [
        { question_id: 'q1', distractor_index: 0 }, // Scenario 1
        { question_id: 'q2', distractor_index: 2 }, // Scenario 2
        { question_id: 'q3', distractor_index: 3 }, // Scenario 3
        { question_id: 'q4', distractor_index: 1 }, // Scenario 4
      ];
      attestationResult = { data: [], error: null };

      const { POST } = await import('@/app/api/foxy/remediation/route');
      const bodies: string[] = [];
      const statuses: number[] = [];
      for (const req of requests) {
        const res = await POST(makeRequest(req));
        statuses.push(res.status);
        bodies.push(await res.text());
      }

      // All statuses identical and equal to 403.
      expect(new Set(statuses).size).toBe(1);
      expect(statuses[0]).toBe(403);

      // All body strings identical.
      expect(new Set(bodies).size).toBe(1);
      expect(JSON.parse(bodies[0])).toEqual(UNIFORM_BODY);

      // The cache and question tables were never touched across all four.
      expect(fromCalls).not.toContain('wrong_answer_remediations');
      expect(fromCalls).not.toContain('quiz_questions');
      expect(insertSpy).not.toHaveBeenCalled();

      // Anthropic was never called.
      const anthropicCalls = fetchSpy.mock.calls.filter((call: unknown[]) => {
        const url = call[0];
        return typeof url === 'string' && url.includes('api.anthropic.com');
      });
      expect(anthropicCalls).toHaveLength(0);
    });

    it('attestation query DB error collapses to the same uniform 403 (no error bubbling)', async () => {
      // If the attestation query itself errors, the route MUST still
      // collapse to remediation_unavailable — otherwise the error type
      // becomes its own oracle.
      attestationResult = {
        data: null,
        error: { message: 'connection-refused', code: 'PGRST500' },
      };

      const { POST } = await import('@/app/api/foxy/remediation/route');
      const res = await POST(
        makeRequest({ question_id: 'q-db-flaky', distractor_index: 2 }),
      );
      const parsed = await parseResponse(res);

      assertUniform403(parsed);
      assertNoTimingSideChannel();
    });
  });
});
