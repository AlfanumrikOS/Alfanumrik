/**
 * Foxy resolveSession — Phase 1 continuity-fix unit tests.
 *
 * The function is at src/app/api/foxy/route.ts. It is exported with an
 * "@internal" tag specifically for these tests. App code must NEVER import it.
 *
 * Six cases:
 *   1. Fresh sessionId (none provided)                  → new session
 *   2. Idle <4h, flag OFF                               → reuse via old path
 *   3. Idle >4h, flag OFF                               → new session + silent_reset log
 *   4. Idle >4h, flag ON, context matches               → reuse + reactivated_after_idle log
 *   5. Flag ON, context mismatch (subject change)       → new session + context_changed log
 *   6. Flag ON, sessionId not found                     → new session + silent_reset (session_not_found)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mocks ────────────────────────────────────────────────────────────────

const mockSupabaseFrom = vi.fn();
const mockIsFeatureEnabled = vi.fn();
const mockLoggerInfo = vi.fn();
const mockLoggerWarn = vi.fn();
const mockLoggerError = vi.fn();
const mockPublishEvent = vi.fn();

vi.mock('@/lib/supabase-admin', () => ({
  supabaseAdmin: {
    from: (...args: unknown[]) => mockSupabaseFrom(...args),
  },
}));

vi.mock('@/lib/feature-flags', () => ({
  isFeatureEnabled: (...args: unknown[]) => mockIsFeatureEnabled(...args),
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    info: (...args: unknown[]) => mockLoggerInfo(...args),
    warn: (...args: unknown[]) => mockLoggerWarn(...args),
    error: (...args: unknown[]) => mockLoggerError(...args),
    debug: vi.fn(),
  },
}));

vi.mock('@/lib/state/events/publish', () => ({
  publishEvent: (...args: unknown[]) => mockPublishEvent(...args),
}));

// The route file imports a lot of heavy modules that we don't need for these
// tests. Stub them so the import succeeds without dragging in real network /
// retrieval code paths.
vi.mock('@/lib/rbac', () => ({
  authorizeRequest: vi.fn(),
  logAudit: vi.fn(),
}));
vi.mock('@/lib/subjects', () => ({
  validateSubjectWrite: vi.fn(),
}));
vi.mock('@/lib/ai/grounded-client', () => ({
  callGroundedAnswer: vi.fn(),
  callGroundedAnswerStream: vi.fn(),
}));
vi.mock('@/lib/grounding-config', () => ({
  PER_PLAN_TIMEOUT_MS: { free: 30000, starter: 30000, pro: 30000, unlimited: 30000 },
  SOFT_CONFIDENCE_BANNER_THRESHOLD: 0.5,
}));
vi.mock('@/lib/ai', () => ({
  classifyIntent: vi.fn(),
  routeIntent: vi.fn(),
}));
vi.mock('@/lib/ai/workflows/foxy-router', () => ({
  QUIZ_PATTERNS: [],
}));
vi.mock('@/lib/tenant-config', () => ({
  getAllTenantConfig: vi.fn(),
}));
vi.mock('@/lib/tenant-domain', () => ({
  coerceTenantType: vi.fn(),
}));
vi.mock('@/lib/ai/prompts/tenant-overrides', () => ({
  buildTenantOverrideSection: vi.fn(),
}));
vi.mock('@/lib/foxy/schema', () => ({
  FoxyResponseSchema: { safeParse: vi.fn() },
}));
vi.mock('@/lib/foxy/recover-from-text', () => ({
  recoverFoxyResponseFromText: vi.fn(),
}));
vi.mock('@/lib/foxy/denormalize', () => ({
  denormalizeFoxyResponse: vi.fn(),
}));
vi.mock('@/lib/goals/goal-personas', () => ({
  buildExpandedGoalSection: vi.fn(),
}));
vi.mock('@/lib/foxy/recent-lab-context', () => ({
  fetchRecentLabContext: vi.fn(),
}));
vi.mock('@/lib/foxy/foxy-lab-prompt', () => ({
  buildLabContextSection: vi.fn(),
}));
vi.mock('@/lib/state/context/foxy-context-bridge', () => ({
  maybeBuildFoxyContextBlock: vi.fn(),
}));

// ─── Chain builder for Supabase fluent queries ────────────────────────────

interface ChainResult {
  data: unknown;
  error: unknown;
}

/**
 * Builds a fluent-style chain that resolves to `result` when `.single()` is
 * called (read paths) and resolves to `result` when awaited directly
 * (update/insert chains that don't end in .single()).
 */
function chainMock(result: ChainResult) {
  const chain: Record<string, unknown> = {};
  const methods = ['select', 'eq', 'gte', 'update', 'insert', 'order', 'limit'];
  for (const m of methods) {
    chain[m] = (..._args: unknown[]) => chain;
  }
  // .single() returns a Promise resolving to the result.
  chain.single = () => Promise.resolve(result);
  // Make the chain itself awaitable (for .update().eq() patterns that don't
  // end in .single()).
  chain.then = (resolve: (v: unknown) => void, reject: (e: unknown) => void) =>
    Promise.resolve(result).then(resolve, reject);
  return chain;
}

// ─── Test fixtures ────────────────────────────────────────────────────────

const STUDENT_ID = '11111111-1111-1111-1111-111111111111';
const AUTH_USER_ID = '22222222-2222-2222-2222-222222222222';
const SCHOOL_ID = '33333333-3333-3333-3333-333333333333';
const PROVIDED_SESSION_ID = '44444444-4444-4444-4444-444444444444';
const NEW_SESSION_ID = '55555555-5555-5555-5555-555555555555';

const FIVE_MIN_AGO = new Date(Date.now() - 5 * 60 * 1000).toISOString();
const FIVE_HOURS_AGO = new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString();

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let resolveSession: any;

beforeEach(async () => {
  vi.clearAllMocks();
  mockPublishEvent.mockResolvedValue(undefined);

  // Import (or re-import) the route's public test surface fresh each test so
  // module-level state (none currently) is isolated. resolveSession is
  // re-exported from ./_lib/test-surface (Next.js 16 forbids non-handler
  // exports from route.ts itself).
  const mod = await import('@/app/api/foxy/_lib/test-surface');
  resolveSession = mod.resolveSession;
});

// ─── Cases ────────────────────────────────────────────────────────────────

describe('resolveSession() — Phase 1 continuity fix', () => {
  it('Case 1: no providedSessionId → creates a new session', async () => {
    mockIsFeatureEnabled.mockResolvedValue(false);
    mockSupabaseFrom.mockImplementation((table: string) => {
      if (table === 'foxy_sessions') {
        return chainMock({ data: { id: NEW_SESSION_ID }, error: null });
      }
      return chainMock({ data: null, error: null });
    });

    const result = await resolveSession(
      STUDENT_ID,
      'physics',
      '11',
      'optics',
      'learn',
      null, // no providedSessionId
      AUTH_USER_ID,
      SCHOOL_ID,
    );

    expect(result).toBe(NEW_SESSION_ID);
    expect(mockLoggerWarn).not.toHaveBeenCalledWith(
      'foxy.session.silent_reset',
      expect.anything(),
    );
    // Old idle path is never even invoked when sessionId is null.
    expect(mockIsFeatureEnabled).not.toHaveBeenCalledWith(
      'ff_foxy_session_reactivate_v1',
      expect.anything(),
    );
  });

  it('Case 2: idle <4h, flag OFF → reuses session via old path', async () => {
    mockIsFeatureEnabled.mockResolvedValue(false); // flag OFF
    mockSupabaseFrom.mockImplementation((table: string) => {
      if (table === 'foxy_sessions') {
        // The .gte('last_active_at', cutoff) filter is mocked away — chainMock
        // is shape-agnostic. We return the existing session row to simulate
        // "still within the idle window".
        return chainMock({ data: { id: PROVIDED_SESSION_ID }, error: null });
      }
      return chainMock({ data: null, error: null });
    });

    const result = await resolveSession(
      STUDENT_ID,
      'physics',
      '11',
      'optics',
      'learn',
      PROVIDED_SESSION_ID,
      AUTH_USER_ID,
      SCHOOL_ID,
    );

    expect(result).toBe(PROVIDED_SESSION_ID);
    expect(mockLoggerWarn).not.toHaveBeenCalledWith(
      'foxy.session.silent_reset',
      expect.anything(),
    );
    expect(mockLoggerInfo).not.toHaveBeenCalledWith(
      'foxy.session.reactivated_after_idle',
      expect.anything(),
    );
  });

  it('Case 3: idle >4h, flag OFF → new session + silent_reset(idle_filter_excluded) log', async () => {
    mockIsFeatureEnabled.mockResolvedValue(false); // flag OFF
    let firstFromCall = true;
    mockSupabaseFrom.mockImplementation((table: string) => {
      if (table === 'foxy_sessions') {
        if (firstFromCall) {
          // Old path: .gte('last_active_at', cutoff) filters it out — the
          // .single() call resolves to { data: null }.
          firstFromCall = false;
          return chainMock({ data: null, error: null });
        }
        // Subsequent .from('foxy_sessions').insert(...) returns new row.
        return chainMock({ data: { id: NEW_SESSION_ID }, error: null });
      }
      return chainMock({ data: null, error: null });
    });

    const result = await resolveSession(
      STUDENT_ID,
      'physics',
      '11',
      'optics',
      'learn',
      PROVIDED_SESSION_ID,
      AUTH_USER_ID,
      SCHOOL_ID,
    );

    expect(result).toBe(NEW_SESSION_ID);
    expect(mockLoggerWarn).toHaveBeenCalledWith(
      'foxy.session.silent_reset',
      expect.objectContaining({
        providedSessionId: PROVIDED_SESSION_ID,
        studentId: STUDENT_ID,
        reason: 'idle_filter_excluded',
      }),
    );
  });

  it('Case 4: idle >4h, flag ON, context matches → reuse + reactivated_after_idle log', async () => {
    mockIsFeatureEnabled.mockResolvedValue(true); // flag ON
    mockSupabaseFrom.mockImplementation((table: string) => {
      if (table === 'foxy_sessions') {
        return chainMock({
          data: {
            id: PROVIDED_SESSION_ID,
            subject: 'physics',
            chapter: 'optics',
            mode: 'learn',
            last_active_at: FIVE_HOURS_AGO,
          },
          error: null,
        });
      }
      return chainMock({ data: null, error: null });
    });

    const result = await resolveSession(
      STUDENT_ID,
      'physics',
      '11',
      'optics',
      'learn',
      PROVIDED_SESSION_ID,
      AUTH_USER_ID,
      SCHOOL_ID,
    );

    expect(result).toBe(PROVIDED_SESSION_ID);
    expect(mockLoggerInfo).toHaveBeenCalledWith(
      'foxy.session.reactivated_after_idle',
      expect.objectContaining({
        foxySessionId: PROVIDED_SESSION_ID,
        studentId: STUDENT_ID,
        idleDurationMs: expect.any(Number),
      }),
    );
    // Should NOT log silent_reset on the happy reactivation path.
    expect(mockLoggerWarn).not.toHaveBeenCalledWith(
      'foxy.session.silent_reset',
      expect.anything(),
    );
  });

  it('Case 5: flag ON, context mismatch (subject change) → new session + context_changed log', async () => {
    mockIsFeatureEnabled.mockResolvedValue(true); // flag ON
    let firstFromCall = true;
    mockSupabaseFrom.mockImplementation((table: string) => {
      if (table === 'foxy_sessions') {
        if (firstFromCall) {
          firstFromCall = false;
          // Session exists but subject differs from the requested 'chemistry'.
          return chainMock({
            data: {
              id: PROVIDED_SESSION_ID,
              subject: 'physics',
              chapter: 'optics',
              mode: 'learn',
              last_active_at: FIVE_MIN_AGO,
            },
            error: null,
          });
        }
        return chainMock({ data: { id: NEW_SESSION_ID }, error: null });
      }
      return chainMock({ data: null, error: null });
    });

    const result = await resolveSession(
      STUDENT_ID,
      'chemistry', // different from the existing 'physics'
      '11',
      'optics',
      'learn',
      PROVIDED_SESSION_ID,
      AUTH_USER_ID,
      SCHOOL_ID,
    );

    expect(result).toBe(NEW_SESSION_ID);
    expect(mockLoggerInfo).toHaveBeenCalledWith(
      'foxy.session.context_changed',
      expect.objectContaining({
        foxySessionId: PROVIDED_SESSION_ID,
        studentId: STUDENT_ID,
        oldContext: { subject: 'physics', chapter: 'optics', mode: 'learn' },
        newContext: { subject: 'chemistry', chapter: 'optics', mode: 'learn' },
      }),
    );
    // Context change is a legitimate boundary — should NOT log silent_reset.
    expect(mockLoggerWarn).not.toHaveBeenCalledWith(
      'foxy.session.silent_reset',
      expect.anything(),
    );
  });

  it('Case 6: flag ON, sessionId not found → new session + silent_reset(session_not_found) log', async () => {
    mockIsFeatureEnabled.mockResolvedValue(true); // flag ON
    let firstFromCall = true;
    mockSupabaseFrom.mockImplementation((table: string) => {
      if (table === 'foxy_sessions') {
        if (firstFromCall) {
          firstFromCall = false;
          // Lookup misses (deleted, wrong tenant, etc.)
          return chainMock({ data: null, error: null });
        }
        return chainMock({ data: { id: NEW_SESSION_ID }, error: null });
      }
      return chainMock({ data: null, error: null });
    });

    const result = await resolveSession(
      STUDENT_ID,
      'physics',
      '11',
      'optics',
      'learn',
      PROVIDED_SESSION_ID,
      AUTH_USER_ID,
      SCHOOL_ID,
    );

    expect(result).toBe(NEW_SESSION_ID);
    expect(mockLoggerWarn).toHaveBeenCalledWith(
      'foxy.session.silent_reset',
      expect.objectContaining({
        providedSessionId: PROVIDED_SESSION_ID,
        studentId: STUDENT_ID,
        reason: 'session_not_found',
      }),
    );
  });
});
