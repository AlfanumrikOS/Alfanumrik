/**
 * Phase A Loop A — /api/cron/adaptive-remediation worker route tests.
 *
 * What is pinned here (spec 2026-06-12-phase-a-loop-a-adaptive-remediation):
 *
 *   1. FAIL-CLOSED CRON_SECRET auth gate (REG-118/REG-119 posture): missing or
 *      wrong secret → 401 AND zero DB I/O (the supabase-admin seam is never
 *      touched). Constant-time compare is source-level; the behavioral pin is
 *      the short-circuit.
 *
 *   2. KILL-SWITCH SEMANTICS: ff_adaptive_remediation_v1 OFF ⇒ the INJECT
 *      phase is a no-op (no candidate scan), but the VERIFY phase still
 *      processes already-active rows to terminal state — the kill switch
 *      DRAINS, it does not freeze.
 *
 *   3. INJECT happy path: a flagged mastery cliff (real deriveSignals + real
 *      planRemediationInjection — no threshold re-implementation in the test)
 *      inserts an adaptive_interventions row with the spec'd trigger_snapshot
 *      + verify_by, publishes system.remediation_injected, and notifies the
 *      student.
 *
 *   4. DEDUP: a 23505 from the partial unique index is a benign dedupe (no
 *      event, no notification); an existing active intervention blocks the
 *      candidate before any insert (adapter guardrail 5).
 *
 *   5. VERIFY verdicts: recovered → terminal transition + event +
 *      notification; expired → escalation with all three target branches
 *      (B2B teacher assignment, B2C parent, no-recipient) and the always-on
 *      audit_logs row (REG-68 metadata-only pattern).
 *
 * The pure modules (signals.ts, remediation-queue-adapter.ts,
 * recovery-evaluation.ts) are intentionally NOT mocked — the route must agree
 * with the frozen guardrail math, and these tests would catch a divergence.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// ── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('@alfanumrik/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const isFeatureEnabledMock = vi.fn();
vi.mock('@alfanumrik/lib/feature-flags', () => ({
  isFeatureEnabled: (...args: unknown[]) => isFeatureEnabledMock(...args),
  ADAPTIVE_REMEDIATION_FLAGS: { V1: 'ff_adaptive_remediation_v1' },
  // Loops B/C share ONE flag (spec Decision X1), independent of Loop A's.
  ADAPTIVE_LOOPS_BC_FLAGS: { V1: 'ff_adaptive_loops_bc_v1' },
  // Loop D (blocked_prerequisite, Digital Twin Slice 1) has its OWN flag. The
  // route reads DIGITAL_TWIN_FLAGS.V1; this mock must expose it or the route's
  // inject phase throws on `undefined.V1`. `loopAOnlyFlags` returns false for
  // this flag, so Loop D stays OFF and every existing Loop A/B/C assertion is
  // unchanged (default-OFF identity).
  DIGITAL_TWIN_FLAGS: { V1: 'ff_digital_twin_v1' },
}));

/**
 * Default flag policy for the Loop-A-focused suites below: Loop A ON, Loops
 * B/C OFF — so the existing Loop A assertions are unaffected by the B/C inject
 * branches. The B/C suites at the bottom override this per-test.
 */
function loopAOnlyFlags(flagName: string): boolean {
  return flagName === 'ff_adaptive_remediation_v1';
}

const onRemediationAssignedMock = vi.fn().mockResolvedValue(undefined);
const onRemediationRecoveredMock = vi.fn().mockResolvedValue(undefined);
const onRemediationEscalatedMock = vi.fn().mockResolvedValue(undefined);
vi.mock('@alfanumrik/lib/notification-triggers', () => ({
  onRemediationAssigned: (...a: unknown[]) => onRemediationAssignedMock(...a),
  onRemediationRecovered: (...a: unknown[]) => onRemediationRecoveredMock(...a),
  onRemediationEscalated: (...a: unknown[]) => onRemediationEscalatedMock(...a),
}));

const publishEventMock = vi.fn().mockResolvedValue({ published: true });
vi.mock('@alfanumrik/lib/state/events/publish', () => ({
  publishEvent: (...a: unknown[]) => publishEventMock(...a),
}));

const auditLogMock = vi.fn().mockResolvedValue(undefined);
vi.mock('@alfanumrik/lib/audit', () => ({
  auditLog: (...a: unknown[]) => auditLogMock(...a),
}));

// ── Recording supabase-admin chain mock ─────────────────────────────────────
// Every from(table) records a Call; the per-test dbHandler resolves it. Every
// chain method returns the chain; the chain itself is thenable.

interface Call {
  table: string;
  method: 'select' | 'insert' | 'update';
  payload?: unknown;
  ops: Array<{ op: string; args: unknown[] }>;
}

const fromCalls: Call[] = [];
let dbHandler: (call: Call) => { data?: unknown; error?: unknown };

function defaultHandler(): { data: unknown; error: null } {
  return { data: [], error: null };
}

function makeChain(call: Call) {
  const chain: Record<string, unknown> = {};
  const record = (op: string) => (...args: unknown[]) => {
    call.ops.push({ op, args });
    return chain;
  };
  for (const m of ['select', 'eq', 'neq', 'gte', 'in', 'is', 'order', 'limit', 'ilike', 'single', 'maybeSingle']) {
    chain[m] = record(m);
  }
  chain.insert = (payload: unknown) => {
    call.method = 'insert';
    call.payload = payload;
    call.ops.push({ op: 'insert', args: [payload] });
    return chain;
  };
  chain.update = (payload: unknown) => {
    call.method = 'update';
    call.payload = payload;
    call.ops.push({ op: 'update', args: [payload] });
    return chain;
  };
  chain.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
    Promise.resolve()
      .then(() => dbHandler(call))
      .then(resolve, reject);
  return chain;
}

const adminClient = {
  from: (table: string) => {
    const call: Call = { table, method: 'select', ops: [] };
    fromCalls.push(call);
    return makeChain(call);
  },
};

vi.mock('@alfanumrik/lib/supabase-admin', () => ({
  supabaseAdmin: adminClient,
  getSupabaseAdmin: () => adminClient,
}));

// ── Helpers ──────────────────────────────────────────────────────────────────

const SECRET = 'adaptive-cron-secret-fixture';
const DAY = 86_400_000;
const AUTH_1 = '00000000-0000-0000-0000-0000000000a1';

function req(
  headers: Record<string, string> = {},
  body?: unknown,
  url = 'http://localhost/api/cron/adaptive-remediation',
): NextRequest {
  return new NextRequest(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function hasOp(call: Call, op: string, firstArg?: unknown): boolean {
  return call.ops.some((o) => o.op === op && (firstArg === undefined || o.args[0] === firstArg));
}

/** Dispatch helper: classify a recorded call into a named query. */
function classify(call: Call): string {
  const t = call.table;
  if (t === 'state_events') {
    if (call.ops.some((o) => o.op === 'in')) return 'state_events.byUsers';
    return 'state_events.recentScan';
  }
  if (t === 'students') return 'students';
  if (t === 'adaptive_interventions') {
    if (call.method === 'insert') return 'interventions.insert';
    if (call.method === 'update') return 'interventions.update';
    if (call.ops.some((o) => o.op === 'neq')) return 'interventions.terminals';
    if (call.ops.some((o) => o.op === 'order')) return 'interventions.verifySweep';
    return 'interventions.actives';
  }
  if (t === 'teacher_remediation_assignments') {
    return call.method === 'insert' ? 'assignments.insert' : 'assignments.lookup';
  }
  if (t === 'learner_mastery') return 'learner_mastery';
  if (t === 'class_students') return 'class_students';
  if (t === 'classes') return 'classes';
  if (t === 'class_teachers') return 'class_teachers';
  if (t === 'guardian_student_links') return 'guardian_links';
  if (t === 'subjects') return 'subjects';
  if (t === 'curriculum_topics') return 'curriculum_topics';
  return `${t}.${call.method}`;
}

type Fixture = Record<string, { data?: unknown; error?: unknown } | undefined>;

function installHandler(fixture: Fixture): void {
  dbHandler = (call) => {
    const out = fixture[classify(call)];
    return out ?? defaultHandler();
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  fromCalls.length = 0;
  dbHandler = defaultHandler;
  process.env.CRON_SECRET = SECRET;
  // Default: Loop A ON, Loops B/C OFF (flag-aware). Loop A suites rely on this;
  // B/C suites override with their own mockImplementation.
  isFeatureEnabledMock.mockImplementation(
    async (flagName: string) => loopAOnlyFlags(flagName),
  );
});

async function loadRoute() {
  return import('@/app/api/cron/adaptive-remediation/route');
}

// ════════════════════════════════════════════════════════════════════════════
// 1. Auth gate — fail-closed, deny BEFORE any DB I/O
// ════════════════════════════════════════════════════════════════════════════

describe('POST /api/cron/adaptive-remediation — auth gate (REG-118 pattern)', () => {
  it('returns 401 with no secret and performs ZERO DB reads', async () => {
    const { POST } = await loadRoute();
    const res = await POST(req());
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body).toMatchObject({ success: false, error: 'unauthorized' });
    expect(fromCalls).toHaveLength(0); // deny short-circuits before any I/O
    expect(isFeatureEnabledMock).not.toHaveBeenCalled();
  });

  it('returns 401 with a wrong secret (header) and performs ZERO DB reads', async () => {
    const { POST } = await loadRoute();
    const res = await POST(req({ 'x-cron-secret': 'wrong' }));
    expect(res.status).toBe(401);
    expect(fromCalls).toHaveLength(0);
  });

  it('returns 401 when CRON_SECRET env is unset (fail-closed on misconfig)', async () => {
    delete process.env.CRON_SECRET;
    const { POST } = await loadRoute();
    const res = await POST(req({ 'x-cron-secret': SECRET }));
    expect(res.status).toBe(401);
    expect(fromCalls).toHaveLength(0);
  });

  it('accepts the secret via x-cron-secret (the daily-cron fetch-out header)', async () => {
    const { POST } = await loadRoute();
    const res = await POST(req({ 'x-cron-secret': SECRET }, { phase: 'all' }));
    expect(res.status).toBe(200);
  });

  it('accepts the secret via Authorization: Bearer (Vercel-cron precedent)', async () => {
    const { POST } = await loadRoute();
    const res = await POST(req({ authorization: `Bearer ${SECRET}` }, { phase: 'all' }));
    expect(res.status).toBe(200);
  });

  // ── Round 2, architect cond 3 — the ?token= carrier is PINNED, and carrier
  //    precedence is first-PRESENT-wins (no fall-through): exactly one
  //    candidate (Bearer > x-cron-secret > ?token=) is compared per request.
  it('accepts the secret via ?token= (irt-calibrate Vercel-cron precedent)', async () => {
    const { POST } = await loadRoute();
    const res = await POST(req(
      {},
      { phase: 'all' },
      `http://localhost/api/cron/adaptive-remediation?token=${SECRET}`,
    ));
    expect(res.status).toBe(200);
  });

  it('precedence: a WRONG Bearer with a CORRECT x-cron-secret does NOT fall through → 401', async () => {
    const { POST } = await loadRoute();
    const res = await POST(req(
      { authorization: 'Bearer wrong-value', 'x-cron-secret': SECRET },
      { phase: 'all' },
    ));
    expect(res.status).toBe(401);
    expect(fromCalls).toHaveLength(0); // still denies BEFORE any DB I/O
  });

  it('precedence: a WRONG x-cron-secret with a CORRECT ?token= does NOT fall through → 401', async () => {
    const { POST } = await loadRoute();
    const res = await POST(req(
      { 'x-cron-secret': 'wrong-value' },
      { phase: 'all' },
      `http://localhost/api/cron/adaptive-remediation?token=${SECRET}`,
    ));
    expect(res.status).toBe(401);
    expect(fromCalls).toHaveLength(0);
  });

  it('precedence: a CORRECT Bearer wins regardless of a wrong lower-precedence carrier → 200', async () => {
    const { POST } = await loadRoute();
    const res = await POST(req(
      { authorization: `Bearer ${SECRET}`, 'x-cron-secret': 'wrong-value' },
      { phase: 'all' },
      'http://localhost/api/cron/adaptive-remediation?token=also-wrong',
    ));
    expect(res.status).toBe(200);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 1b. Unhandled-error response — generic constant body (architect cond 1)
// ════════════════════════════════════════════════════════════════════════════

describe('unhandled error → 500 with a GENERIC body (no detail leakage)', () => {
  it('returns exactly { success: false, error: "internal_error" }; detail goes to logger only', async () => {
    const detail = 'supabase exploded: sensitive-internal-detail-xyz';
    // isFeatureEnabled is the first await inside runInjectPhase and is NOT
    // wrapped in a phase-local try — a rejection propagates to the handler's
    // outer catch, exercising the 500 path.
    isFeatureEnabledMock.mockRejectedValue(new Error(detail));
    const { POST } = await loadRoute();
    const res = await POST(req({ 'x-cron-secret': SECRET }, { phase: 'inject' }));
    expect(res.status).toBe(500);

    const body = await res.json();
    expect(body).toEqual({ success: false, error: 'internal_error' }); // exact — no message field
    expect(JSON.stringify(body)).not.toContain('sensitive-internal-detail-xyz');

    const { logger } = await import('@alfanumrik/lib/logger');
    expect(logger.error).toHaveBeenCalledWith(
      'adaptive_remediation: unhandled',
      expect.objectContaining({ message: expect.stringContaining('sensitive-internal-detail-xyz') }),
    );
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 2. Kill-switch semantics — inject gates on flag; verify gates on active rows
// ════════════════════════════════════════════════════════════════════════════

describe('kill switch — drain, not freeze', () => {
  it('flag OFF: inject is a no-op (no scan) but verify still drains active rows', async () => {
    isFeatureEnabledMock.mockResolvedValue(false);
    const now = Date.now();
    installHandler({
      // Verify sweep finds one expired row (window long past).
      'interventions.verifySweep': {
        data: [{
          id: '00000000-0000-0000-0000-00000000aa01',
          student_id: 'stu-1',
          subject_code: 'math',
          chapter_number: 4,
          trigger_snapshot: { baselineMastery: 0.8, postCliffMastery: 0.3, largestDrop: 0.5, declineStreak: 0 },
          created_at: new Date(now - 9 * DAY).toISOString(),
          verify_by: new Date(now - 2 * DAY).toISOString(),
        }],
      },
      students: {
        data: [{ id: 'stu-1', auth_user_id: AUTH_1, school_id: null, grade: '9' }],
      },
      'interventions.update': { data: [{ id: '00000000-0000-0000-0000-00000000aa01' }], error: null },
    });
    const { POST } = await loadRoute();
    const res = await POST(req({ 'x-cron-secret': SECRET }, { phase: 'all' }));
    expect(res.status).toBe(200);
    const body = await res.json();

    // Inject short-circuited on the flag — no candidate scan ran.
    expect(body.data.inject).toMatchObject({ skipped: 'flag_off', injected: 0 });
    expect(fromCalls.filter((c) => classify(c) === 'state_events.recentScan')).toHaveLength(0);

    // Verify ran anyway (drain): the expired row escalated (no teacher, no
    // guardian → escalated_to null) and the audit row was written.
    expect(body.data.verify).toMatchObject({ evaluated: 1, escalated: 1 });
    expect(auditLogMock).toHaveBeenCalledTimes(1);
    expect(onRemediationEscalatedMock).toHaveBeenCalledTimes(1);
  });

  it('verify with zero active rows reports skipped: no_active_rows', async () => {
    isFeatureEnabledMock.mockResolvedValue(false);
    installHandler({ 'interventions.verifySweep': { data: [] } });
    const { POST } = await loadRoute();
    const res = await POST(req({ 'x-cron-secret': SECRET }, { phase: 'verify' }));
    const body = await res.json();
    expect(body.data.verify).toMatchObject({ skipped: 'no_active_rows', evaluated: 0 });
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 3 + 4. Inject phase — happy path, DB dedupe, adapter one-active-max
// ════════════════════════════════════════════════════════════════════════════

function injectFixture(overrides: Fixture = {}): Fixture {
  const now = Date.now();
  return {
    'state_events.recentScan': { data: [{ actor_auth_user_id: AUTH_1 }] },
    students: { data: [{ id: 'stu-1', auth_user_id: AUTH_1, school_id: null, grade: '9' }] },
    'state_events.byUsers': {
      data: [{
        actor_auth_user_id: AUTH_1,
        kind: 'learner.mastery_changed',
        occurred_at: new Date(now - 2 * 3_600_000).toISOString(),
        // 0.8 → 0.4: drop 0.4 ≥ mastery_cliff_drop (0.15) → flagged cliff.
        payload: { subjectCode: 'math', chapterNumber: 4, fromMastery: 0.8, toMastery: 0.4, trigger: 'quiz' },
      }],
    },
    'interventions.actives': { data: [] },
    'interventions.terminals': { data: [] },
    'interventions.insert': { error: null },
    'interventions.verifySweep': { data: [] }, // verify phase: nothing active yet
    ...overrides,
  };
}

describe('inject phase', () => {
  it('flagged cliff → inserts intervention with snapshot + verify_by, event + student notification', async () => {
    installHandler(injectFixture());
    const before = Date.now();
    const { POST } = await loadRoute();
    const res = await POST(req({ 'x-cron-secret': SECRET }, { phase: 'inject' }));
    const after = Date.now();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.inject).toMatchObject({
      scanned: 1, injected: 1, deduped: 0, blocked: 0, errors: 0,
    });

    const insert = fromCalls.find((c) => classify(c) === 'interventions.insert');
    expect(insert).toBeDefined();
    const row = insert!.payload as Record<string, unknown>;
    expect(row.student_id).toBe('stu-1');
    expect(row.subject_code).toBe('math');
    expect(row.chapter_number).toBe(4);
    expect(row.trigger_signal).toBe('mastery_cliff');
    expect(row.status).toBe('active');

    // trigger_snapshot frozen at injection time (spec Decision 6).
    const snap = row.trigger_snapshot as Record<string, unknown>;
    expect(snap.baselineMastery).toBeCloseTo(0.8, 10);
    expect(snap.postCliffMastery).toBeCloseTo(0.4, 10);
    expect(snap.largestDrop).toBeCloseTo(0.4, 10);
    expect(typeof snap.rulesVersion).toBe('string');

    // verify_by = createdAt + 7 days (verificationWindowEndMs boundary math).
    const verifyByMs = Date.parse(String(row.verify_by));
    expect(verifyByMs).toBeGreaterThanOrEqual(before + 7 * DAY - 5_000);
    expect(verifyByMs).toBeLessThanOrEqual(after + 7 * DAY + 5_000);

    // Observability event + student notification.
    expect(publishEventMock).toHaveBeenCalledTimes(1);
    const event = publishEventMock.mock.calls[0][1] as Record<string, unknown>;
    expect(event.kind).toBe('system.remediation_injected');
    expect(event.actorAuthUserId).toBe(AUTH_1);
    expect(String(event.idempotencyKey)).toMatch(/^remediation:.+:injected$/);
    expect(onRemediationAssignedMock).toHaveBeenCalledWith('stu-1', expect.objectContaining({
      subjectCode: 'math',
      chapterNumber: 4,
    }));
  });

  it('23505 from the partial unique index is a benign dedupe — no event, no notification', async () => {
    installHandler(injectFixture({
      'interventions.insert': { error: { code: '23505', message: 'duplicate key value' } },
    }));
    const { POST } = await loadRoute();
    const res = await POST(req({ 'x-cron-secret': SECRET }, { phase: 'inject' }));
    const body = await res.json();
    expect(body.data.inject).toMatchObject({ injected: 0, deduped: 1, errors: 0 });
    expect(publishEventMock).not.toHaveBeenCalled();
    expect(onRemediationAssignedMock).not.toHaveBeenCalled();
  });

  it('existing ACTIVE intervention on the same chapter blocks before any insert (guardrail 5)', async () => {
    installHandler(injectFixture({
      'interventions.actives': {
        data: [{ student_id: 'stu-1', subject_code: 'math', chapter_number: 4 }],
      },
    }));
    const { POST } = await loadRoute();
    const res = await POST(req({ 'x-cron-secret': SECRET }, { phase: 'inject' }));
    const body = await res.json();
    expect(body.data.inject).toMatchObject({ injected: 0, blocked: 1 });
    expect(fromCalls.filter((c) => classify(c) === 'interventions.insert')).toHaveLength(0);
    expect(onRemediationAssignedMock).not.toHaveBeenCalled();
  });

  it('decline-streak-only flags (null worstSubject/worstChapter) are skipped, not injected', async () => {
    installHandler(injectFixture({
      // Only first-attempt events (fromMastery null) → no drop path; the
      // route passes recentQuizScores nowhere, so the cliff cannot name a
      // chapter. Use events that produce verdict !== flagged-with-target.
      'state_events.byUsers': {
        data: [{
          actor_auth_user_id: AUTH_1,
          kind: 'learner.mastery_changed',
          occurred_at: new Date().toISOString(),
          payload: { subjectCode: 'math', chapterNumber: 4, fromMastery: null, toMastery: 0.4, trigger: 'quiz' },
        }],
      },
    }));
    const { POST } = await loadRoute();
    const res = await POST(req({ 'x-cron-secret': SECRET }, { phase: 'inject' }));
    const body = await res.json();
    expect(body.data.inject.injected).toBe(0);
    expect(fromCalls.filter((c) => classify(c) === 'interventions.insert')).toHaveLength(0);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 5. Verify phase — recovered + the three escalation branches
// ════════════════════════════════════════════════════════════════════════════

const INTERVENTION_ID = '00000000-0000-0000-0000-00000000bb01';

function verifyFixture(rowOverrides: Record<string, unknown>, fixture: Fixture = {}): Fixture {
  const now = Date.now();
  return {
    'interventions.verifySweep': {
      data: [{
        id: INTERVENTION_ID,
        student_id: 'stu-1',
        subject_code: 'math',
        chapter_number: 4,
        trigger_snapshot: { baselineMastery: 0.8, postCliffMastery: 0.4, largestDrop: 0.4, declineStreak: 0, rulesVersion: 'loop-a-v1' },
        created_at: new Date(now - 9 * DAY).toISOString(),
        verify_by: new Date(now - 2 * DAY).toISOString(), // window elapsed
        ...rowOverrides,
      }],
    },
    students: { data: [{ id: 'stu-1', auth_user_id: AUTH_1, school_id: null, grade: '9' }] },
    'interventions.update': { data: [{ id: INTERVENTION_ID }], error: null },
    ...fixture,
  };
}

describe('verify phase', () => {
  it('recovered: in-window observation at/above baseline → terminal transition + event + notification', async () => {
    const now = Date.now();
    installHandler(verifyFixture(
      {
        created_at: new Date(now - 2 * DAY).toISOString(),
        verify_by: new Date(now + 5 * DAY).toISOString(), // window still open
      },
      {
        'state_events.byUsers': {
          data: [{
            actor_auth_user_id: AUTH_1,
            kind: 'learner.mastery_changed',
            occurred_at: new Date(now - 1 * DAY).toISOString(),
            payload: { subjectCode: 'math', chapterNumber: 4, fromMastery: 0.6, toMastery: 0.82, trigger: 'quiz' },
          }],
        },
      },
    ));
    const { POST } = await loadRoute();
    const res = await POST(req({ 'x-cron-secret': SECRET }, { phase: 'verify' }));
    const body = await res.json();
    expect(body.data.verify).toMatchObject({ evaluated: 1, recovered: 1, escalated: 0, errors: 0 });

    const upd = fromCalls.find((c) => classify(c) === 'interventions.update');
    expect(upd?.payload).toMatchObject({ status: 'recovered' });
    // Terminal transition is guarded on status='active' (race-safe).
    expect(hasOp(upd!, 'eq', 'status')).toBe(true);

    const event = publishEventMock.mock.calls[0][1] as Record<string, unknown>;
    expect(event.kind).toBe('system.remediation_recovered');
    expect((event.payload as Record<string, unknown>).recoveredMastery).toBeCloseTo(0.82, 10);
    expect(onRemediationRecoveredMock).toHaveBeenCalledWith('stu-1', expect.objectContaining({
      interventionId: INTERVENTION_ID,
    }));
    expect(auditLogMock).not.toHaveBeenCalled(); // audit row is escalation-only
  });

  it('pending: window open, no recovery → no transition, no side-effects', async () => {
    const now = Date.now();
    installHandler(verifyFixture({
      created_at: new Date(now - 2 * DAY).toISOString(),
      verify_by: new Date(now + 5 * DAY).toISOString(),
    }));
    const { POST } = await loadRoute();
    const res = await POST(req({ 'x-cron-secret': SECRET }, { phase: 'verify' }));
    const body = await res.json();
    expect(body.data.verify).toMatchObject({ evaluated: 1, pending: 1, recovered: 0, escalated: 0 });
    expect(fromCalls.filter((c) => classify(c) === 'interventions.update')).toHaveLength(0);
    expect(publishEventMock).not.toHaveBeenCalled();
  });

  it('expired + roster teacher (B2B): creates teacher assignment, links it, escalated_to=teacher', async () => {
    installHandler(verifyFixture({}, {
      class_students: { data: [{ class_id: 'class-1' }] },
      classes: { data: [{ id: 'class-1', subject: 'Mathematics', created_at: '2026-01-01T00:00:00Z' }] },
      class_teachers: { data: [{ teacher_id: 'teach-1', joined_at: '2026-01-02T00:00:00Z' }] },
      subjects: { data: { id: 'subj-1' } },
      curriculum_topics: { data: { id: 'topic-1' } },
      'assignments.insert': { data: { id: 'tra-1' }, error: null },
    }));
    const { POST } = await loadRoute();
    const res = await POST(req({ 'x-cron-secret': SECRET }, { phase: 'verify' }));
    const body = await res.json();
    expect(body.data.verify).toMatchObject({ evaluated: 1, escalated: 1, errors: 0 });

    // Phase 3A assignment row: status 'assigned', mapped chapter uuid.
    const assignment = fromCalls.find((c) => classify(c) === 'assignments.insert');
    expect(assignment?.payload).toMatchObject({
      teacher_id: 'teach-1',
      student_id: 'stu-1',
      class_id: 'class-1',
      chapter_id: 'topic-1',
      status: 'assigned',
    });

    // Intervention terminal transition carries the FK + target.
    const upd = fromCalls.find((c) => classify(c) === 'interventions.update');
    expect(upd?.payload).toMatchObject({
      status: 'escalated',
      escalated_to: 'teacher',
      teacher_assignment_id: 'tra-1',
    });

    // Event + audit row + notification move together (REG-123 posture).
    const event = publishEventMock.mock.calls[0][1] as Record<string, unknown>;
    expect(event.kind).toBe('system.remediation_escalated');
    expect(event.payload).toMatchObject({ escalatedTo: 'teacher', teacherAssignmentId: 'tra-1' });
    expect(auditLogMock).toHaveBeenCalledTimes(1);
    const audit = auditLogMock.mock.calls[0][0] as Record<string, unknown>;
    expect(audit).toMatchObject({
      actor_id: null,
      action: 'system.remediation_escalated',
      target_entity: 'adaptive_interventions',
      target_id: INTERVENTION_ID,
    });
    // REG-68: metadata is UUIDs/codes only — never names/emails/phones.
    const metadataJson = JSON.stringify(audit.metadata);
    expect(metadataJson).not.toMatch(/name|email|phone/i);
    expect(onRemediationEscalatedMock).toHaveBeenCalledWith('stu-1', expect.objectContaining({
      escalatedTo: 'teacher',
    }));
  });

  it('expired + no teacher + linked guardian (B2C): escalated_to=parent, no assignment insert', async () => {
    installHandler(verifyFixture({}, {
      class_students: { data: [] },
      guardian_links: { data: [{ id: 'link-1' }] },
    }));
    const { POST } = await loadRoute();
    const res = await POST(req({ 'x-cron-secret': SECRET }, { phase: 'verify' }));
    const body = await res.json();
    expect(body.data.verify).toMatchObject({ escalated: 1 });

    expect(fromCalls.filter((c) => classify(c) === 'assignments.insert')).toHaveLength(0);
    const upd = fromCalls.find((c) => classify(c) === 'interventions.update');
    expect(upd?.payload).toMatchObject({
      status: 'escalated',
      escalated_to: 'parent',
      teacher_assignment_id: null,
    });
    const event = publishEventMock.mock.calls[0][1] as Record<string, unknown>;
    expect(event.payload).toMatchObject({ escalatedTo: 'parent', teacherAssignmentId: null });
    expect(onRemediationEscalatedMock).toHaveBeenCalledWith('stu-1', expect.objectContaining({
      escalatedTo: 'parent',
    }));
    expect(auditLogMock).toHaveBeenCalledTimes(1);
  });

  it('expired + neither teacher nor guardian: escalated_to=null, still event + audit + student notification', async () => {
    installHandler(verifyFixture({}, {
      class_students: { data: [] },
      guardian_links: { data: [] },
    }));
    const { POST } = await loadRoute();
    const res = await POST(req({ 'x-cron-secret': SECRET }, { phase: 'verify' }));
    const body = await res.json();
    expect(body.data.verify).toMatchObject({ escalated: 1 });

    const upd = fromCalls.find((c) => classify(c) === 'interventions.update');
    expect(upd?.payload).toMatchObject({ status: 'escalated', escalated_to: null });
    const event = publishEventMock.mock.calls[0][1] as Record<string, unknown>;
    expect(event.payload).toMatchObject({ escalatedTo: null }); // ops-visible
    expect(auditLogMock).toHaveBeenCalledTimes(1);
    expect(onRemediationEscalatedMock).toHaveBeenCalledWith('stu-1', expect.objectContaining({
      escalatedTo: null,
    }));
  });

  it('B2B assignment insert failure leaves the row ACTIVE (whole escalation retries next run)', async () => {
    installHandler(verifyFixture({}, {
      class_students: { data: [{ class_id: 'class-1' }] },
      classes: { data: [{ id: 'class-1', subject: 'Mathematics', created_at: '2026-01-01T00:00:00Z' }] },
      class_teachers: { data: [{ teacher_id: 'teach-1', joined_at: '2026-01-02T00:00:00Z' }] },
      subjects: { data: { id: 'subj-1' } },
      curriculum_topics: { data: { id: 'topic-1' } },
      'assignments.insert': { data: null, error: { message: 'insert failed' } },
    }));
    const { POST } = await loadRoute();
    const res = await POST(req({ 'x-cron-secret': SECRET }, { phase: 'verify' }));
    const body = await res.json();
    expect(body.data.verify).toMatchObject({ escalated: 0, errors: 1 });
    // No half-escalated state: the intervention row was never transitioned.
    expect(fromCalls.filter((c) => classify(c) === 'interventions.update')).toHaveLength(0);
    expect(publishEventMock).not.toHaveBeenCalled();
    expect(auditLogMock).not.toHaveBeenCalled();
    expect(onRemediationEscalatedMock).not.toHaveBeenCalled();
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 6. Round 2 condition fixes — verify-phase behavior pins
// ════════════════════════════════════════════════════════════════════════════

describe('verify phase — mixed-case observation matching (assessment cond 3)', () => {
  it('a MIXED-CASE event payload subjectCode still matches the lowercase intervention row', async () => {
    const now = Date.now();
    installHandler(verifyFixture(
      {
        created_at: new Date(now - 2 * DAY).toISOString(),
        verify_by: new Date(now + 5 * DAY).toISOString(), // window still open
      },
      {
        'state_events.byUsers': {
          data: [{
            actor_auth_user_id: AUTH_1,
            kind: 'learner.mastery_changed',
            occurred_at: new Date(now - 1 * DAY).toISOString(),
            // 'Math' (mixed case) vs the row's stored 'math' — without the
            // lowercase normalization this observation is silently dropped
            // and the row would stay 'pending'.
            payload: { subjectCode: 'Math', chapterNumber: 4, fromMastery: 0.6, toMastery: 0.82, trigger: 'quiz' },
          }],
        },
      },
    ));
    const { POST } = await loadRoute();
    const res = await POST(req({ 'x-cron-secret': SECRET }, { phase: 'verify' }));
    const body = await res.json();
    expect(body.data.verify).toMatchObject({ evaluated: 1, recovered: 1, pending: 0, errors: 0 });
  });
});

describe('verify phase — B2B assignment 23505 dedupe (architect cond 2, route half)', () => {
  const B2B_FIXTURE: Fixture = {
    class_students: { data: [{ class_id: 'class-1' }] },
    classes: { data: [{ id: 'class-1', subject: 'Mathematics', created_at: '2026-01-01T00:00:00Z' }] },
    class_teachers: { data: [{ teacher_id: 'teach-1', joined_at: '2026-01-02T00:00:00Z' }] },
    subjects: { data: { id: 'subj-1' } },
    curriculum_topics: { data: { id: 'topic-1' } },
  };

  it('23505 links the EXISTING in-progress row and escalates without a race duplicate', async () => {
    installHandler(verifyFixture({}, {
      ...B2B_FIXTURE,
      'assignments.insert': { data: null, error: { code: '23505', message: 'duplicate key value' } },
      'assignments.lookup': { data: [{ id: 'tra-existing', status: 'in_progress' }], error: null },
    }));
    const { POST } = await loadRoute();
    const res = await POST(req({ 'x-cron-secret': SECRET }, { phase: 'verify' }));
    const body = await res.json();
    expect(body.data.verify).toMatchObject({ evaluated: 1, escalated: 1, errors: 0 });

    // The dedupe lookup is scoped to the conflicting natural key.
    const lookup = fromCalls.find((c) => classify(c) === 'assignments.lookup');
    expect(lookup).toBeDefined();
    expect(hasOp(lookup!, 'eq', 'student_id')).toBe(true);
    expect(hasOp(lookup!, 'eq', 'status')).toBe(false);
    const statusIn = lookup!.ops.find((o) => o.op === 'in' && o.args[0] === 'status');
    expect(statusIn?.args[1]).toEqual(['assigned', 'in_progress']);
    expect(hasOp(lookup!, 'eq', 'chapter_id')).toBe(true); // chapter mapped → eq
    // Round 2 cross-handoff fix: the unique-index key (migration
    // 20260619000400) is (student_id, class_id, chapter-bucket) — the lookup
    // MUST also filter by the escalation-chosen class_id, or it could recover
    // a same-student assigned row from a DIFFERENT class as the FK.
    const classEq = lookup!.ops.find((o) => o.op === 'eq' && o.args[0] === 'class_id');
    expect(classEq?.args[1]).toBe('class-1'); // the class escalation selected

    // The escalated transition carries the EXISTING assignment's id as FK.
    const upd = fromCalls.find((c) => classify(c) === 'interventions.update');
    expect(upd?.payload).toMatchObject({
      status: 'escalated',
      escalated_to: 'teacher',
      teacher_assignment_id: 'tra-existing',
    });
    const event = publishEventMock.mock.calls[0][1] as Record<string, unknown>;
    expect(event.payload).toMatchObject({ escalatedTo: 'teacher', teacherAssignmentId: 'tra-existing' });
    expect(auditLogMock).toHaveBeenCalledTimes(1);
    expect(onRemediationEscalatedMock).toHaveBeenCalledWith('stu-1', expect.objectContaining({
      escalatedTo: 'teacher',
    }));
  });

  it('23505 with an UNMAPPED chapter looks up by chapter_id IS NULL', async () => {
    installHandler(verifyFixture({}, {
      ...B2B_FIXTURE,
      subjects: { data: null }, // no subject row → chapterId null
      curriculum_topics: { data: null },
      'assignments.insert': { data: null, error: { code: '23505', message: 'duplicate key value' } },
      'assignments.lookup': { data: [{ id: 'tra-existing-null-ch' }], error: null },
    }));
    const { POST } = await loadRoute();
    const res = await POST(req({ 'x-cron-secret': SECRET }, { phase: 'verify' }));
    const body = await res.json();
    expect(body.data.verify).toMatchObject({ escalated: 1, errors: 0 });

    const lookup = fromCalls.find((c) => classify(c) === 'assignments.lookup');
    expect(hasOp(lookup!, 'is', 'chapter_id')).toBe(true); // IS NULL, not eq
    // class_id is part of the unique-index key on BOTH chapter branches.
    const classEq = lookup!.ops.find((o) => o.op === 'eq' && o.args[0] === 'class_id');
    expect(classEq?.args[1]).toBe('class-1');
    const upd = fromCalls.find((c) => classify(c) === 'interventions.update');
    expect(upd?.payload).toMatchObject({ teacher_assignment_id: 'tra-existing-null-ch' });
  });

  it('23505 but the surviving row cannot be resolved → row stays ACTIVE for retry (no half-escalation)', async () => {
    installHandler(verifyFixture({}, {
      ...B2B_FIXTURE,
      'assignments.insert': { data: null, error: { code: '23505', message: 'duplicate key value' } },
      'assignments.lookup': { data: [], error: null }, // conflict reported, no row found
    }));
    const { POST } = await loadRoute();
    const res = await POST(req({ 'x-cron-secret': SECRET }, { phase: 'verify' }));
    const body = await res.json();
    expect(body.data.verify).toMatchObject({ escalated: 0, errors: 1 });
    expect(fromCalls.filter((c) => classify(c) === 'interventions.update')).toHaveLength(0);
    expect(publishEventMock).not.toHaveBeenCalled();
    expect(auditLogMock).not.toHaveBeenCalled();
    expect(onRemediationEscalatedMock).not.toHaveBeenCalled();
  });
});

describe('verify phase — B2B class selection uses the tiered subject matcher (assessment cond 2)', () => {
  /** class_teachers responses keyed off the queried class_id. */
  function installPerClassTeachers(fixture: Fixture): void {
    installHandler(fixture);
    const base = dbHandler;
    dbHandler = (call) => {
      if (call.table === 'class_teachers') {
        const classId = call.ops.find(
          (o) => o.op === 'eq' && o.args[0] === 'class_id',
        )?.args[1];
        return {
          data: [{ teacher_id: `teach-${String(classId)}`, joined_at: '2026-01-02T00:00:00Z' }],
          error: null,
        };
      }
      return base(call);
    };
  }

  it("kills the substring false positive: code 'science' picks the Science class over a NEWER 'Social Science' class", async () => {
    installPerClassTeachers(verifyFixture({ subject_code: 'science' }, {
      class_students: { data: [{ class_id: 'class-soc' }, { class_id: 'class-sci' }] },
      classes: {
        data: [
          // Newer, but tier 0 — must NOT win on the old substring logic.
          { id: 'class-soc', subject: 'Social Science', created_at: '2026-03-01T00:00:00Z' },
          // Older, tier 2 exact.
          { id: 'class-sci', subject: 'Science', created_at: '2026-01-01T00:00:00Z' },
        ],
      },
      subjects: { data: { id: 'subj-sci' } },
      curriculum_topics: { data: { id: 'topic-sci' } },
      'assignments.insert': { data: { id: 'tra-sci' }, error: null },
    }));
    const { POST } = await loadRoute();
    const res = await POST(req({ 'x-cron-secret': SECRET }, { phase: 'verify' }));
    const body = await res.json();
    expect(body.data.verify).toMatchObject({ escalated: 1, errors: 0 });

    const assignment = fromCalls.find((c) => classify(c) === 'assignments.insert');
    expect(assignment?.payload).toMatchObject({
      class_id: 'class-sci',
      teacher_id: 'teach-class-sci',
    });
  });

  it("fixes the underscore false negative + exact-beats-partial: code 'social_studies' picks the exact 'Social Studies' class over a NEWER partial match", async () => {
    installPerClassTeachers(verifyFixture({ subject_code: 'social_studies' }, {
      class_students: { data: [{ class_id: 'class-partial' }, { class_id: 'class-exact' }] },
      classes: {
        data: [
          // Newer, tier 1 (leading-token partial match).
          { id: 'class-partial', subject: 'Social Studies & Civics', created_at: '2026-03-01T00:00:00Z' },
          // Older, tier 2 (exact after [_\s]+ normalization — the old code
          // matched NEITHER class, so the newer partial would have won).
          { id: 'class-exact', subject: 'Social Studies', created_at: '2026-01-01T00:00:00Z' },
        ],
      },
      subjects: { data: { id: 'subj-sst' } },
      curriculum_topics: { data: { id: 'topic-sst' } },
      'assignments.insert': { data: { id: 'tra-sst' }, error: null },
    }));
    const { POST } = await loadRoute();
    const res = await POST(req({ 'x-cron-secret': SECRET }, { phase: 'verify' }));
    const body = await res.json();
    expect(body.data.verify).toMatchObject({ escalated: 1, errors: 0 });

    const assignment = fromCalls.find((c) => classify(c) === 'assignments.insert');
    expect(assignment?.payload).toMatchObject({
      class_id: 'class-exact',
      teacher_id: 'teach-class-exact',
    });
  });
});
