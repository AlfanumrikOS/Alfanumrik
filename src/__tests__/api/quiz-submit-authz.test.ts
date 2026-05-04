/**
 * REG-60 — /api/quiz/submit JWT-bound studentId guard (P9 RBAC).
 *
 * Defense-in-depth: even though RLS on `quiz_session_shuffles` would also
 * reject a student-A-submits-as-student-B attack, this route enforces the
 * boundary at the application layer so the contract is auditable in TS
 * and so we get a structured 403 (not an opaque RLS denial).
 *
 * Contract under test:
 *   1. JWT resolves to student A but body says studentId=B → 403 + code STUDENT_ID_MISMATCH.
 *   2. JWT and body match → 200 (mocked RPC).
 *   3. Static-source canary: route file contains the explicit guard
 *      `studentRow.id !== body.studentId`.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';

// ── RBAC mock ───────────────────────────────────────────────────────────────
const _authorizeImpl = vi.fn();
vi.mock('@/lib/rbac', () => ({
  authorizeRequest: (...args: unknown[]) => _authorizeImpl(...args),
}));

function setAuthorized(userId = 'auth-user-1') {
  _authorizeImpl.mockResolvedValue({
    authorized: true,
    userId,
    studentId: null,
    roles: ['student'],
    permissions: ['quiz.attempt'],
  });
}

// ── PostHog mock ───────────────────────────────────────────────────────────
vi.mock('@/lib/posthog/server', () => ({
  capture: vi.fn().mockResolvedValue(undefined),
}));

// ── Logger mock ────────────────────────────────────────────────────────────
const loggerWarn = vi.fn();
vi.mock('@/lib/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: (...args: unknown[]) => loggerWarn(...args),
    error: vi.fn(),
  },
}));

vi.mock('@/lib/ops-events', () => ({
  logOpsEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/feature-flags', () => ({
  isFeatureEnabled: vi.fn().mockResolvedValue(false),
}));

// ── Supabase admin (student lookup) ─────────────────────────────────────────
const STUDENT_A = '11111111-1111-4111-8111-111111111111';
const STUDENT_B = '22222222-2222-4222-8222-222222222222';
const SESSION_ID = '33333333-3333-4333-8333-333333333333';
const QUESTION_ID = '44444444-4444-4444-8444-444444444444';
const IDEMPOTENCY_KEY = '55555555-5555-4555-8555-555555555555';

let _studentLookup: { data: { id: string } | null; error: null } = {
  data: { id: STUDENT_A },
  error: null,
};

function adminFromMock() {
  const chain: any = {};
  for (const m of ['select', 'eq', 'in', 'order', 'limit']) {
    chain[m] = (..._args: unknown[]) => chain;
  }
  chain.maybeSingle = () => Promise.resolve(_studentLookup);
  chain.single = () => Promise.resolve(_studentLookup);
  return chain;
}

vi.mock('@/lib/supabase-admin', () => ({
  getSupabaseAdmin: () => ({ from: () => adminFromMock() }),
}));

// ── Supabase server (RPC) ──────────────────────────────────────────────────
let _rpcResult: { data: any; error: any } = { data: null, error: null };
const rpcSpy = vi.fn();

vi.mock('@/lib/supabase-server', () => ({
  createSupabaseServerClient: vi.fn().mockResolvedValue({
    rpc: (...args: unknown[]) => {
      rpcSpy(...args);
      return Promise.resolve(_rpcResult);
    },
  }),
}));

// ── Helper ─────────────────────────────────────────────────────────────────
function makeRequest(bodyStudentId: string) {
  return new Request('http://localhost/api/quiz/submit', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'idempotency-key': IDEMPOTENCY_KEY,
    },
    body: JSON.stringify({
      sessionId: SESSION_ID,
      studentId: bodyStudentId,
      responses: [{ question_id: QUESTION_ID, selected_option: 0, time_taken_seconds: 5 }],
      totalTimeSeconds: 30,
    }),
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let POST: any;

beforeEach(async () => {
  vi.clearAllMocks();
  setAuthorized();
  _studentLookup = { data: { id: STUDENT_A }, error: null };
  _rpcResult = { data: null, error: null };
  const mod = await import('@/app/api/quiz/submit/route');
  POST = mod.POST;
});

// ── Tests ──────────────────────────────────────────────────────────────────

describe('POST /api/quiz/submit — JWT-bound studentId guard (REG-60)', () => {
  it('returns 403 when JWT resolves to student A but body claims student B', async () => {
    // JWT-resolved student is A; body says B.
    _studentLookup = { data: { id: STUDENT_A }, error: null };

    const res = await POST(makeRequest(STUDENT_B));
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.code).toBe('STUDENT_ID_MISMATCH');

    // The mismatch must be logged for audit / forensic CLI joinability.
    expect(loggerWarn).toHaveBeenCalled();
  });

  it('returns 403 when no student profile is linked to the auth user', async () => {
    _studentLookup = { data: null, error: null };
    const res = await POST(makeRequest(STUDENT_A));
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.code).toBe('NO_STUDENT_PROFILE');
  });

  it('proceeds to scoring when JWT and body studentId match', async () => {
    _studentLookup = { data: { id: STUDENT_A }, error: null };
    _rpcResult = {
      data: {
        session_id: SESSION_ID,
        score_percent: 100,
        xp_earned: 170,
        correct: 1,
        total: 1,
        flagged: false,
        idempotent_replay: false,
      },
      error: null,
    };

    const res = await POST(makeRequest(STUDENT_A));
    expect(res.status).toBe(200);
    expect(rpcSpy).toHaveBeenCalled();
  });
});

// ── Static-source canary ───────────────────────────────────────────────────

describe('REG-60 static canary — route source contains the explicit JWT/body guard', () => {
  it('src/app/api/quiz/submit/route.ts contains the studentRow.id mismatch check', () => {
    const path = resolve(process.cwd(), 'src/app/api/quiz/submit/route.ts');
    expect(existsSync(path)).toBe(true);
    const src = readFileSync(path, 'utf8');
    // Pin the exact comparison so a future refactor that drops the guard
    // (e.g. routing studentId straight from the body without crosscheck)
    // fails this test loudly.
    expect(src).toMatch(/studentRow\.id\s*!==\s*body\.studentId/);
    // Pin the structured response code so callers (mobile, web) can rely on it.
    expect(src).toContain('STUDENT_ID_MISMATCH');
  });
});
