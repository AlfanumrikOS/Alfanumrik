/**
 * Phase A Loops B & C — /api/cron/adaptive-remediation worker route tests.
 *
 * Companion to adaptive-remediation.test.ts (Loop A). What is pinned here
 * (spec docs/superpowers/specs/2026-06-13-phase-a-loops-b-c-design.md):
 *
 *   1. PER-SIGNAL INJECT GATING (Decision X2): ff_adaptive_loops_bc_v1 OFF ⇒ the
 *      B/C inject branches are no-ops (no inactive-student scan, no B/C insert);
 *      the mastery_cliff branch still respects its own ff_adaptive_remediation_v1
 *      flag — INDEPENDENT kill switches.
 *
 *   2. PER-STUDENT DAILY CEILING = 1 with precedence A > C > B (Decision X3):
 *      a student tripping A + C + B opens exactly ONE row — the A row. With only
 *      C + B eligible, the C row wins. The arbiter ceiling caps NEW interventions.
 *
 *   3. A↔C COEXISTENCE (C-G3): no Loop C row opens for a subject that already
 *      has an active Loop A (mastery_cliff) row.
 *
 *   4. LOOP B inject: a 'broken'-inactivity student → sentinel triple
 *      ('_inactivity', 0) intervention + engagement_nudged event + nudge
 *      notification, NO queue/card injection, NO teacher row.
 *
 *   5. LOOP C inject: a 'high'-band subject → IMMEDIATE escalation — B2B teacher
 *      assignment (reusing Loop A's resolver + dedupe) OR B2C parent — + the
 *      worst-chapter triple, the concentration_escalated event + audit row.
 *
 *   6. VERIFY DRAIN (gated on active rows, not the flag): B/C rows drain to
 *      terminal even with the flag OFF. inactivity returned → recovered; inactivity
 *      expired → parent escalate (never teacher). concentration resolved →
 *      recovered; concentration expired → re-notify (status escalated, no 2nd row).
 *
 * The pure modules (signals.ts, adaptive-loops-rules.ts, the two evaluators) are
 * NOT mocked — the route must agree with the frozen guardrail math.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// ── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const isFeatureEnabledMock = vi.fn();
vi.mock('@/lib/feature-flags', () => ({
  isFeatureEnabled: (...args: unknown[]) => isFeatureEnabledMock(...args),
  ADAPTIVE_REMEDIATION_FLAGS: { V1: 'ff_adaptive_remediation_v1' },
  ADAPTIVE_LOOPS_BC_FLAGS: { V1: 'ff_adaptive_loops_bc_v1' },
  // Loop D (blocked_prerequisite, Digital Twin Slice 1) reads its own flag via
  // DIGITAL_TWIN_FLAGS.V1 in the route's inject phase. Expose it here or the
  // route throws on `undefined.V1`. These suites never enable it, so Loop D
  // stays OFF and the B/C assertions are unchanged.
  DIGITAL_TWIN_FLAGS: { V1: 'ff_digital_twin_v1' },
}));

const onRemediationAssignedMock = vi.fn().mockResolvedValue(undefined);
const onRemediationRecoveredMock = vi.fn().mockResolvedValue(undefined);
const onRemediationEscalatedMock = vi.fn().mockResolvedValue(undefined);
const onReEngagementNudgeMock = vi.fn().mockResolvedValue(undefined);
const onReEngagementReturnedMock = vi.fn().mockResolvedValue(undefined);
const onInactivityEscalatedMock = vi.fn().mockResolvedValue(undefined);
const onConcentrationEscalatedMock = vi.fn().mockResolvedValue(undefined);
const onConcentrationResolvedMock = vi.fn().mockResolvedValue(undefined);
const onConcentrationReescalatedMock = vi.fn().mockResolvedValue(undefined);
vi.mock('@/lib/notification-triggers', () => ({
  onRemediationAssigned: (...a: unknown[]) => onRemediationAssignedMock(...a),
  onRemediationRecovered: (...a: unknown[]) => onRemediationRecoveredMock(...a),
  onRemediationEscalated: (...a: unknown[]) => onRemediationEscalatedMock(...a),
  onReEngagementNudge: (...a: unknown[]) => onReEngagementNudgeMock(...a),
  onReEngagementReturned: (...a: unknown[]) => onReEngagementReturnedMock(...a),
  onInactivityEscalated: (...a: unknown[]) => onInactivityEscalatedMock(...a),
  onConcentrationEscalated: (...a: unknown[]) => onConcentrationEscalatedMock(...a),
  onConcentrationResolved: (...a: unknown[]) => onConcentrationResolvedMock(...a),
  onConcentrationReescalated: (...a: unknown[]) => onConcentrationReescalatedMock(...a),
}));

const publishEventMock = vi.fn().mockResolvedValue({ published: true });
vi.mock('@/lib/state/events/publish', () => ({
  publishEvent: (...a: unknown[]) => publishEventMock(...a),
}));

const auditLogMock = vi.fn().mockResolvedValue(undefined);
vi.mock('@/lib/audit', () => ({
  auditLog: (...a: unknown[]) => auditLogMock(...a),
}));

// ── Recording supabase-admin chain mock ─────────────────────────────────────

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
  for (const m of ['select', 'eq', 'neq', 'gte', 'lt', 'in', 'is', 'order', 'limit', 'ilike', 'single', 'maybeSingle']) {
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

vi.mock('@/lib/supabase-admin', () => ({
  supabaseAdmin: adminClient,
  getSupabaseAdmin: () => adminClient,
}));

// ── Helpers ──────────────────────────────────────────────────────────────────

const SECRET = 'adaptive-cron-secret-fixture';
const DAY = 86_400_000;
const AUTH_1 = '00000000-0000-0000-0000-0000000000a1';

function req(headers: Record<string, string> = {}, body?: unknown): NextRequest {
  return new NextRequest('http://localhost/api/cron/adaptive-remediation', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function hasOp(call: Call, op: string, firstArg?: unknown): boolean {
  return call.ops.some((o) => o.op === op && (firstArg === undefined || o.args[0] === firstArg));
}

/** Classify a recorded call. Distinguishes the Loop B inactive-student scan
 *  (students + lt last_active) from the by-auth-id resolve query. */
function classify(call: Call): string {
  const t = call.table;
  if (t === 'state_events') {
    if (call.ops.some((o) => o.op === 'in' && o.args[0] === 'kind')) return 'state_events.activity';
    if (call.ops.some((o) => o.op === 'in')) return 'state_events.byUsers';
    return 'state_events.recentScan';
  }
  if (t === 'students') {
    if (call.ops.some((o) => o.op === 'lt' && o.args[0] === 'last_active')) return 'students.inactiveScan';
    return 'students';
  }
  if (t === 'adaptive_interventions') {
    if (call.method === 'insert') return 'interventions.insert';
    if (call.method === 'update') return 'interventions.update';
    if (call.ops.some((o) => o.op === 'neq')) return 'interventions.terminals';
    if (call.ops.some((o) => o.op === 'order')) return 'interventions.verifySweep';
    return 'interventions.actives';
  }
  if (t === 'teacher_remediation_assignments') {
    if (call.method === 'insert') return 'assignments.insert';
    if (call.method === 'update') return 'assignments.update';
    return 'assignments.lookup';
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
  dbHandler = (call) => fixture[classify(call)] ?? defaultHandler();
}

/** Loop A + Loops B/C ON. Loop D (ff_digital_twin_v1, Digital Twin Slice 1) is
 *  INTENTIONALLY left OFF here: this suite models only the A/B/C DB surface and
 *  the admin mock above does not stub the detect_blocked_dependents RPC (Loop D's
 *  only data source). Blanket-enabling every flag would activate Loop D and 500
 *  on the unmocked RPC. Loop D's candidate build + arbiter precedence (A>D>C>B)
 *  are pinned separately by REG-175. */
function allFlagsOn(): void {
  isFeatureEnabledMock.mockImplementation(
    async (flagName: string) =>
      flagName === 'ff_adaptive_remediation_v1' ||
      flagName === 'ff_adaptive_loops_bc_v1',
  );
}
/** Loops B/C ON, Loop A OFF. */
function bcOnly(): void {
  isFeatureEnabledMock.mockImplementation(async (flagName: string) => flagName === 'ff_adaptive_loops_bc_v1');
}

beforeEach(() => {
  vi.clearAllMocks();
  fromCalls.length = 0;
  dbHandler = defaultHandler;
  process.env.CRON_SECRET = SECRET;
  bcOnly();
});

async function loadRoute() {
  return import('@/app/api/cron/adaptive-remediation/route');
}

// ════════════════════════════════════════════════════════════════════════════
// INJECT — per-signal gating
// ════════════════════════════════════════════════════════════════════════════

describe('inject — per-signal flag gating (Decision X2)', () => {
  it('ff_adaptive_loops_bc_v1 OFF ⇒ no inactive scan, no B/C insert (Loop A unaffected)', async () => {
    // Loop A ON, B/C OFF.
    isFeatureEnabledMock.mockImplementation(async (f: string) => f === 'ff_adaptive_remediation_v1');
    installHandler({ 'state_events.recentScan': { data: [] } });
    const { POST } = await loadRoute();
    const res = await POST(req({ 'x-cron-secret': SECRET }, { phase: 'inject' }));
    expect(res.status).toBe(200);
    // No Loop B inactive-student scan ran (B/C gate short-circuited it).
    expect(fromCalls.filter((c) => classify(c) === 'students.inactiveScan')).toHaveLength(0);
  });

  it('both flags OFF ⇒ inject reports skipped: flag_off', async () => {
    isFeatureEnabledMock.mockResolvedValue(false);
    const { POST } = await loadRoute();
    const res = await POST(req({ 'x-cron-secret': SECRET }, { phase: 'inject' }));
    const body = await res.json();
    expect(body.data.inject).toMatchObject({ skipped: 'flag_off', injected: 0 });
  });

  it('B/C ON ⇒ the inactive-student scan runs', async () => {
    installHandler({ 'state_events.recentScan': { data: [] }, 'students.inactiveScan': { data: [] } });
    const { POST } = await loadRoute();
    await POST(req({ 'x-cron-secret': SECRET }, { phase: 'inject' }));
    expect(fromCalls.filter((c) => classify(c) === 'students.inactiveScan')).toHaveLength(1);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// LOOP B inject — re-engagement nudge
// ════════════════════════════════════════════════════════════════════════════

/** A single inactive ('broken') student, onboarded long ago, no ledger rows. */
function inactivityFixture(overrides: Fixture = {}): Fixture {
  const now = Date.now();
  const student = {
    id: 'stu-1',
    auth_user_id: AUTH_1,
    school_id: null,
    grade: '9',
    last_active: new Date(now - 4 * DAY).toISOString(), // 4 UTC days → broken
    created_at: new Date(now - 60 * DAY).toISOString(), // well past onboarding grace
  };
  return {
    'state_events.recentScan': { data: [] },
    'students.inactiveScan': { data: [student] },
    students: { data: [student] },
    'state_events.byUsers': { data: [] },
    learner_mastery: { data: [] },
    'interventions.actives': { data: [] },
    'interventions.terminals': { data: [] },
    'interventions.insert': { error: null },
    'interventions.verifySweep': { data: [] },
    ...overrides,
  };
}

describe('Loop B inject — re-engagement nudge', () => {
  it("'broken' student → sentinel ('_inactivity',0) row + engagement_nudged event + nudge notification, NO teacher row", async () => {
    installHandler(inactivityFixture());
    const { POST } = await loadRoute();
    const res = await POST(req({ 'x-cron-secret': SECRET }, { phase: 'inject' }));
    const body = await res.json();
    expect(body.data.inject).toMatchObject({ injected: 1, injectedInactivity: 1, errors: 0 });

    const insert = fromCalls.find((c) => classify(c) === 'interventions.insert');
    const row = insert!.payload as Record<string, unknown>;
    expect(row.subject_code).toBe('_inactivity');
    expect(row.chapter_number).toBe(0);
    expect(row.trigger_signal).toBe('inactivity');
    expect(row.status).toBe('active');
    // verify_by = createdAt + 3 days (Loop B return window).
    const verifyByMs = Date.parse(String(row.verify_by));
    expect(verifyByMs).toBeGreaterThan(Date.now() + 2.9 * DAY);
    expect(verifyByMs).toBeLessThan(Date.now() + 3.1 * DAY);

    const event = publishEventMock.mock.calls[0][1] as Record<string, unknown>;
    expect(event.kind).toBe('system.engagement_nudged');
    expect(String(event.idempotencyKey)).toBe(`inactivity:${row.id}:nudged`);

    expect(onReEngagementNudgeMock).toHaveBeenCalledWith('stu-1', expect.objectContaining({
      interventionId: row.id,
    }));
    // NO queue/card injection, NO teacher assignment row (Decision B1/B4).
    expect(fromCalls.filter((c) => classify(c) === 'assignments.insert')).toHaveLength(0);
  });

  it('a student active YESTERDAY (grace, not broken) opens NO inactivity row', async () => {
    const now = Date.now();
    installHandler(inactivityFixture({
      'students.inactiveScan': {
        data: [{
          id: 'stu-1', auth_user_id: AUTH_1, school_id: null, grade: '9',
          last_active: new Date(now - 1 * DAY).toISOString(), // yesterday → at_risk, not broken
          created_at: new Date(now - 60 * DAY).toISOString(),
        }],
      },
      students: {
        data: [{
          id: 'stu-1', auth_user_id: AUTH_1, school_id: null, grade: '9',
          last_active: new Date(now - 1 * DAY).toISOString(),
          created_at: new Date(now - 60 * DAY).toISOString(),
        }],
      },
    }));
    const { POST } = await loadRoute();
    const res = await POST(req({ 'x-cron-secret': SECRET }, { phase: 'inject' }));
    const body = await res.json();
    expect(body.data.inject.injected).toBe(0);
    expect(fromCalls.filter((c) => classify(c) === 'interventions.insert')).toHaveLength(0);
  });

  it('an onboarding-grace student (created < 7 days ago) is NOT nudged', async () => {
    const now = Date.now();
    installHandler(inactivityFixture({
      'students.inactiveScan': {
        data: [{
          id: 'stu-1', auth_user_id: AUTH_1, school_id: null, grade: '9',
          last_active: new Date(now - 4 * DAY).toISOString(),
          created_at: new Date(now - 3 * DAY).toISOString(), // within 7-day grace
        }],
      },
      students: {
        data: [{
          id: 'stu-1', auth_user_id: AUTH_1, school_id: null, grade: '9',
          last_active: new Date(now - 4 * DAY).toISOString(),
          created_at: new Date(now - 3 * DAY).toISOString(),
        }],
      },
    }));
    const { POST } = await loadRoute();
    const res = await POST(req({ 'x-cron-secret': SECRET }, { phase: 'inject' }));
    const body = await res.json();
    expect(body.data.inject.injected).toBe(0);
  });

  it('an existing ACTIVE inactivity row blocks a new nudge (one-active-max, B-G1)', async () => {
    installHandler(inactivityFixture({
      'interventions.actives': {
        data: [{ student_id: 'stu-1', subject_code: '_inactivity', chapter_number: 0, trigger_signal: 'inactivity' }],
      },
    }));
    const { POST } = await loadRoute();
    const res = await POST(req({ 'x-cron-secret': SECRET }, { phase: 'inject' }));
    const body = await res.json();
    expect(body.data.inject.injected).toBe(0);
    expect(fromCalls.filter((c) => classify(c) === 'interventions.insert')).toHaveLength(0);
  });

  it('a 23505 on the sentinel insert is a benign dedupe (no event, no notification)', async () => {
    installHandler(inactivityFixture({
      'interventions.insert': { error: { code: '23505', message: 'duplicate key value' } },
    }));
    const { POST } = await loadRoute();
    const res = await POST(req({ 'x-cron-secret': SECRET }, { phase: 'inject' }));
    const body = await res.json();
    expect(body.data.inject).toMatchObject({ injected: 0, deduped: 1, errors: 0 });
    expect(publishEventMock).not.toHaveBeenCalled();
    expect(onReEngagementNudgeMock).not.toHaveBeenCalled();
  });
});

// ════════════════════════════════════════════════════════════════════════════
// LOOP C inject — immediate escalation
// ════════════════════════════════════════════════════════════════════════════

/** One student with a 'high'-band subject (5 at-risk chapters in 'math'). */
function concentrationFixture(overrides: Fixture = {}): Fixture {
  const now = Date.now();
  const student = {
    id: 'stu-1', auth_user_id: AUTH_1, school_id: 'school-1', grade: '9',
    last_active: new Date(now - 1 * 3_600_000).toISOString(), // active (not inactive)
    created_at: new Date(now - 60 * DAY).toISOString(),
  };
  // 5 chapters below 0.4 in math → band 'high'.
  const mastery = [1, 2, 3, 4, 5].map((ch) => ({
    auth_user_id: AUTH_1, subject_code: 'math', chapter_number: ch, mastery: 0.2,
    last_updated_at: new Date(now - 2 * DAY).toISOString(),
  }));
  return {
    'state_events.recentScan': { data: [{ actor_auth_user_id: AUTH_1 }] },
    'students.inactiveScan': { data: [] },
    students: { data: [student] },
    'state_events.byUsers': { data: [] },
    learner_mastery: { data: mastery },
    'interventions.actives': { data: [] },
    'interventions.terminals': { data: [] },
    'interventions.insert': { error: null },
    'interventions.verifySweep': { data: [] },
    ...overrides,
  };
}

describe('Loop C inject — immediate escalation', () => {
  it("'high' band + roster teacher (B2B): teacher assignment + worst-chapter row + escalated_to=teacher + event + audit", async () => {
    installHandler(concentrationFixture({
      class_students: { data: [{ class_id: 'class-1' }] },
      classes: { data: [{ id: 'class-1', subject: 'Mathematics', created_at: '2026-01-01T00:00:00Z' }] },
      class_teachers: { data: [{ teacher_id: 'teach-1', joined_at: '2026-01-02T00:00:00Z' }] },
      subjects: { data: { id: 'subj-1' } },
      curriculum_topics: { data: { id: 'topic-1' } },
      'assignments.insert': { data: { id: 'tra-1' }, error: null },
    }));
    const { POST } = await loadRoute();
    const res = await POST(req({ 'x-cron-secret': SECRET }, { phase: 'inject' }));
    const body = await res.json();
    expect(body.data.inject).toMatchObject({ injected: 1, injectedConcentration: 1, errors: 0 });

    // Teacher assignment created (reuses Loop A's machinery).
    const assignment = fromCalls.find((c) => classify(c) === 'assignments.insert');
    expect(assignment?.payload).toMatchObject({
      teacher_id: 'teach-1', student_id: 'stu-1', class_id: 'class-1', chapter_id: 'topic-1', status: 'assigned',
    });

    // Intervention row: worst chapter (lowest = chapter 1, all mastery equal), escalated_to set AT INJECT.
    const insert = fromCalls.find((c) => classify(c) === 'interventions.insert');
    const row = insert!.payload as Record<string, unknown>;
    expect(row.subject_code).toBe('math');
    expect(row.chapter_number).toBe(1);
    expect(row.trigger_signal).toBe('at_risk_concentration');
    expect(row.status).toBe('active');
    expect(row.escalated_to).toBe('teacher');
    expect(row.teacher_assignment_id).toBe('tra-1');
    // verify_by = createdAt + 14 days.
    const verifyByMs = Date.parse(String(row.verify_by));
    expect(verifyByMs).toBeGreaterThan(Date.now() + 13.9 * DAY);
    expect(verifyByMs).toBeLessThan(Date.now() + 14.1 * DAY);

    const event = publishEventMock.mock.calls[0][1] as Record<string, unknown>;
    expect(event.kind).toBe('system.concentration_escalated');
    expect(event.payload).toMatchObject({ escalatedTo: 'teacher', teacherAssignmentId: 'tra-1', atRiskChapterCount: 5 });

    expect(auditLogMock).toHaveBeenCalledTimes(1);
    const audit = auditLogMock.mock.calls[0][0] as Record<string, unknown>;
    expect(audit).toMatchObject({ action: 'system.concentration_escalated', target_entity: 'adaptive_interventions' });
    expect(JSON.stringify(audit.metadata)).not.toMatch(/name|email|phone/i);

    expect(onConcentrationEscalatedMock).toHaveBeenCalledWith('stu-1', expect.objectContaining({
      escalatedTo: 'teacher', subjectCode: 'math',
    }));
  });

  it("'high' band + no teacher + linked guardian (B2C): escalated_to=parent, no assignment insert", async () => {
    installHandler(concentrationFixture({
      class_students: { data: [] },
      guardian_links: { data: [{ id: 'link-1' }] },
    }));
    const { POST } = await loadRoute();
    const res = await POST(req({ 'x-cron-secret': SECRET }, { phase: 'inject' }));
    const body = await res.json();
    expect(body.data.inject).toMatchObject({ injectedConcentration: 1 });
    expect(fromCalls.filter((c) => classify(c) === 'assignments.insert')).toHaveLength(0);
    const insert = fromCalls.find((c) => classify(c) === 'interventions.insert');
    expect(insert!.payload).toMatchObject({ escalated_to: 'parent', teacher_assignment_id: null });
    expect(onConcentrationEscalatedMock).toHaveBeenCalledWith('stu-1', expect.objectContaining({ escalatedTo: 'parent' }));
  });

  it("'high' band + neither teacher nor guardian: escalated_to=null, still event + audit + student notification", async () => {
    installHandler(concentrationFixture({
      class_students: { data: [] },
      guardian_links: { data: [] },
    }));
    const { POST } = await loadRoute();
    const res = await POST(req({ 'x-cron-secret': SECRET }, { phase: 'inject' }));
    const body = await res.json();
    expect(body.data.inject).toMatchObject({ injectedConcentration: 1 });
    const insert = fromCalls.find((c) => classify(c) === 'interventions.insert');
    expect(insert!.payload).toMatchObject({ escalated_to: null });
    expect(auditLogMock).toHaveBeenCalledTimes(1);
    expect(onConcentrationEscalatedMock).toHaveBeenCalledWith('stu-1', expect.objectContaining({ escalatedTo: null }));
  });

  it('B2B assignment insert failure aborts WITHOUT opening the row (retries next run)', async () => {
    installHandler(concentrationFixture({
      class_students: { data: [{ class_id: 'class-1' }] },
      classes: { data: [{ id: 'class-1', subject: 'Mathematics', created_at: '2026-01-01T00:00:00Z' }] },
      class_teachers: { data: [{ teacher_id: 'teach-1', joined_at: '2026-01-02T00:00:00Z' }] },
      subjects: { data: { id: 'subj-1' } },
      curriculum_topics: { data: { id: 'topic-1' } },
      'assignments.insert': { data: null, error: { message: 'insert failed' } },
    }));
    const { POST } = await loadRoute();
    const res = await POST(req({ 'x-cron-secret': SECRET }, { phase: 'inject' }));
    const body = await res.json();
    expect(body.data.inject.injectedConcentration).toBe(0);
    expect(body.data.inject.errors).toBe(1);
    // No half-escalation: the intervention row was never inserted.
    expect(fromCalls.filter((c) => classify(c) === 'interventions.insert')).toHaveLength(0);
    expect(publishEventMock).not.toHaveBeenCalled();
  });

  it('B2B assignment 23505 dedupe links the EXISTING row and still opens the intervention', async () => {
    installHandler(concentrationFixture({
      class_students: { data: [{ class_id: 'class-1' }] },
      classes: { data: [{ id: 'class-1', subject: 'Mathematics', created_at: '2026-01-01T00:00:00Z' }] },
      class_teachers: { data: [{ teacher_id: 'teach-1', joined_at: '2026-01-02T00:00:00Z' }] },
      subjects: { data: { id: 'subj-1' } },
      curriculum_topics: { data: { id: 'topic-1' } },
      'assignments.insert': { data: null, error: { code: '23505', message: 'duplicate key value' } },
      'assignments.lookup': { data: [{ id: 'tra-existing' }], error: null },
    }));
    const { POST } = await loadRoute();
    const res = await POST(req({ 'x-cron-secret': SECRET }, { phase: 'inject' }));
    const body = await res.json();
    expect(body.data.inject).toMatchObject({ injectedConcentration: 1, errors: 0 });
    const insert = fromCalls.find((c) => classify(c) === 'interventions.insert');
    expect(insert!.payload).toMatchObject({ escalated_to: 'teacher', teacher_assignment_id: 'tra-existing' });
  });
});

// ════════════════════════════════════════════════════════════════════════════
// CROSS-LOOP — per-student daily ceiling + precedence + A↔C coexistence
// ════════════════════════════════════════════════════════════════════════════

describe('cross-loop arbitration (Decision X3, C-G3)', () => {
  it('A + C + B all eligible ⇒ exactly ONE row opens, the Loop A row (precedence A > C > B)', async () => {
    allFlagsOn();
    const now = Date.now();
    const student = {
      id: 'stu-1', auth_user_id: AUTH_1, school_id: null, grade: '9',
      last_active: new Date(now - 4 * DAY).toISOString(), // broken → Loop B eligible
      created_at: new Date(now - 60 * DAY).toISOString(),
    };
    installHandler({
      'state_events.recentScan': { data: [{ actor_auth_user_id: AUTH_1 }] },
      'students.inactiveScan': { data: [student] },
      students: { data: [student] },
      // A flagged cliff in 'science' (0.8 → 0.4 drop) → Loop A eligible.
      'state_events.byUsers': {
        data: [{
          actor_auth_user_id: AUTH_1, kind: 'learner.mastery_changed',
          occurred_at: new Date(now - 2 * 3_600_000).toISOString(),
          payload: { subjectCode: 'science', chapterNumber: 2, fromMastery: 0.8, toMastery: 0.4, trigger: 'quiz' },
        }],
      },
      // 5 at-risk chapters in 'math' → Loop C eligible (different subject, no A↔C clash).
      learner_mastery: {
        data: [1, 2, 3, 4, 5].map((ch) => ({
          auth_user_id: AUTH_1, subject_code: 'math', chapter_number: ch, mastery: 0.2,
          last_updated_at: new Date(now - 2 * DAY).toISOString(),
        })),
      },
      'interventions.actives': { data: [] },
      'interventions.terminals': { data: [] },
      'interventions.insert': { error: null },
      'interventions.verifySweep': { data: [] },
    });
    const { POST } = await loadRoute();
    const res = await POST(req({ 'x-cron-secret': SECRET }, { phase: 'inject' }));
    const body = await res.json();
    // EXACTLY one intervention row opened, and it is the Loop A cliff row.
    expect(body.data.inject.injected).toBe(1);
    expect(body.data.inject.injectedCliff).toBe(1);
    expect(body.data.inject.injectedInactivity).toBe(0);
    expect(body.data.inject.injectedConcentration).toBe(0);
    const inserts = fromCalls.filter((c) => classify(c) === 'interventions.insert');
    expect(inserts).toHaveLength(1);
    expect((inserts[0].payload as Record<string, unknown>).trigger_signal).toBe('mastery_cliff');
  });

  it('C + B eligible (no A) ⇒ the Loop C row wins (C > B)', async () => {
    const now = Date.now();
    const student = {
      id: 'stu-1', auth_user_id: AUTH_1, school_id: null, grade: '9',
      last_active: new Date(now - 4 * DAY).toISOString(), // broken → B eligible
      created_at: new Date(now - 60 * DAY).toISOString(),
    };
    installHandler({
      'state_events.recentScan': { data: [{ actor_auth_user_id: AUTH_1 }] },
      'students.inactiveScan': { data: [student] },
      students: { data: [student] },
      'state_events.byUsers': { data: [] }, // no cliff
      learner_mastery: {
        data: [1, 2, 3, 4, 5].map((ch) => ({
          auth_user_id: AUTH_1, subject_code: 'math', chapter_number: ch, mastery: 0.2,
          last_updated_at: new Date(now - 2 * DAY).toISOString(),
        })),
      },
      'interventions.actives': { data: [] },
      'interventions.terminals': { data: [] },
      'interventions.insert': { error: null },
      'interventions.verifySweep': { data: [] },
      class_students: { data: [] },
      guardian_links: { data: [{ id: 'link-1' }] },
    });
    const { POST } = await loadRoute();
    const res = await POST(req({ 'x-cron-secret': SECRET }, { phase: 'inject' }));
    const body = await res.json();
    expect(body.data.inject.injected).toBe(1);
    expect(body.data.inject.injectedConcentration).toBe(1);
    expect(body.data.inject.injectedInactivity).toBe(0);
    expect(body.data.inject.ceilingDeferred).toBeGreaterThanOrEqual(1); // B deferred
  });

  it('A↔C coexistence (C-G3): no Loop C row opens for a subject with an active Loop A row', async () => {
    const now = Date.now();
    const student = {
      id: 'stu-1', auth_user_id: AUTH_1, school_id: null, grade: '9',
      last_active: new Date(now - 1 * 3_600_000).toISOString(), // active → no Loop B
      created_at: new Date(now - 60 * DAY).toISOString(),
    };
    installHandler({
      'state_events.recentScan': { data: [{ actor_auth_user_id: AUTH_1 }] },
      'students.inactiveScan': { data: [] },
      students: { data: [student] },
      'state_events.byUsers': { data: [] },
      learner_mastery: {
        data: [1, 2, 3, 4, 5].map((ch) => ({
          auth_user_id: AUTH_1, subject_code: 'math', chapter_number: ch, mastery: 0.2,
          last_updated_at: new Date(now - 2 * DAY).toISOString(),
        })),
      },
      // An ACTIVE Loop A cliff row already exists in 'math' → C-G3 skips Loop C.
      'interventions.actives': {
        data: [{ student_id: 'stu-1', subject_code: 'math', chapter_number: 3, trigger_signal: 'mastery_cliff' }],
      },
      'interventions.terminals': { data: [] },
      'interventions.insert': { error: null },
      'interventions.verifySweep': { data: [] },
    });
    const { POST } = await loadRoute();
    const res = await POST(req({ 'x-cron-secret': SECRET }, { phase: 'inject' }));
    const body = await res.json();
    expect(body.data.inject.injectedConcentration).toBe(0);
    expect(fromCalls.filter((c) => classify(c) === 'interventions.insert')).toHaveLength(0);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// VERIFY — drain (gated on active rows, not the flag)
// ════════════════════════════════════════════════════════════════════════════

function verifySweep(rows: Array<Record<string, unknown>>): Fixture {
  return {
    'interventions.verifySweep': { data: rows },
    students: { data: [{ id: 'stu-1', auth_user_id: AUTH_1, school_id: null, grade: '9' }] },
    'interventions.update': { data: [{ id: rows[0]?.id }], error: null },
  };
}

describe('Loop B verify — return-check (drains with flag OFF)', () => {
  beforeEach(() => { isFeatureEnabledMock.mockResolvedValue(false); }); // flag OFF — must still drain

  it('returned: genuine activity in-window → status=recovered + engagement_returned event + notification', async () => {
    const now = Date.now();
    installHandler({
      ...verifySweep([{
        id: 'iv-b1', student_id: 'stu-1', subject_code: '_inactivity', chapter_number: 0,
        trigger_signal: 'inactivity', trigger_snapshot: { daysSinceActive: 2 },
        created_at: new Date(now - 2 * DAY).toISOString(),
        verify_by: new Date(now + 1 * DAY).toISOString(), // window open
        escalated_to: null, teacher_assignment_id: null,
      }]),
      // A genuine quiz_completed event after created_at → qualifying return.
      'state_events.activity': {
        data: [{
          actor_auth_user_id: AUTH_1, kind: 'learner.quiz_completed',
          occurred_at: new Date(now - 1 * DAY).toISOString(), payload: {},
        }],
      },
    });
    const { POST } = await loadRoute();
    const res = await POST(req({ 'x-cron-secret': SECRET }, { phase: 'verify' }));
    const body = await res.json();
    expect(body.data.verify).toMatchObject({ evaluated: 1, recovered: 1, escalated: 0 });
    const upd = fromCalls.find((c) => classify(c) === 'interventions.update');
    expect(upd?.payload).toMatchObject({ status: 'recovered' });
    expect(publishEventMock.mock.calls[0][1].kind).toBe('system.engagement_returned');
    expect(onReEngagementReturnedMock).toHaveBeenCalledWith('stu-1', expect.objectContaining({ interventionId: 'iv-b1' }));
  });

  it('expired + linked guardian → escalate to PARENT (never a teacher row) + event + audit + notification', async () => {
    const now = Date.now();
    installHandler({
      ...verifySweep([{
        id: 'iv-b1', student_id: 'stu-1', subject_code: '_inactivity', chapter_number: 0,
        trigger_signal: 'inactivity', trigger_snapshot: { daysSinceActive: 5 },
        created_at: new Date(now - 5 * DAY).toISOString(),
        verify_by: new Date(now - 2 * DAY).toISOString(), // window elapsed
        escalated_to: null, teacher_assignment_id: null,
      }]),
      'state_events.activity': { data: [] }, // never returned
      guardian_links: { data: [{ id: 'link-1' }] },
    });
    const { POST } = await loadRoute();
    const res = await POST(req({ 'x-cron-secret': SECRET }, { phase: 'verify' }));
    const body = await res.json();
    expect(body.data.verify).toMatchObject({ evaluated: 1, escalated: 1 });
    const upd = fromCalls.find((c) => classify(c) === 'interventions.update');
    expect(upd?.payload).toMatchObject({ status: 'escalated', escalated_to: 'parent' });
    // NEVER a teacher assignment for Loop B (Decision B4).
    expect(fromCalls.filter((c) => classify(c) === 'assignments.insert')).toHaveLength(0);
    expect(publishEventMock.mock.calls[0][1].kind).toBe('system.engagement_escalated');
    expect(auditLogMock).toHaveBeenCalledTimes(1);
    expect(onInactivityEscalatedMock).toHaveBeenCalledWith('stu-1', expect.objectContaining({ escalatedTo: 'parent' }));
  });

  it('expired + no guardian → escalated_to=null (ops-visible), student-only', async () => {
    const now = Date.now();
    installHandler({
      ...verifySweep([{
        id: 'iv-b1', student_id: 'stu-1', subject_code: '_inactivity', chapter_number: 0,
        trigger_signal: 'inactivity', trigger_snapshot: { daysSinceActive: 5 },
        created_at: new Date(now - 5 * DAY).toISOString(),
        verify_by: new Date(now - 2 * DAY).toISOString(),
        escalated_to: null, teacher_assignment_id: null,
      }]),
      'state_events.activity': { data: [] },
      guardian_links: { data: [] },
    });
    const { POST } = await loadRoute();
    const res = await POST(req({ 'x-cron-secret': SECRET }, { phase: 'verify' }));
    const body = await res.json();
    expect(body.data.verify).toMatchObject({ escalated: 1 });
    const upd = fromCalls.find((c) => classify(c) === 'interventions.update');
    expect(upd?.payload).toMatchObject({ status: 'escalated', escalated_to: null });
    expect(onInactivityEscalatedMock).toHaveBeenCalledWith('stu-1', expect.objectContaining({ escalatedTo: null }));
  });

  it('pending: window open, still inactive → no transition', async () => {
    const now = Date.now();
    installHandler({
      ...verifySweep([{
        id: 'iv-b1', student_id: 'stu-1', subject_code: '_inactivity', chapter_number: 0,
        trigger_signal: 'inactivity', trigger_snapshot: { daysSinceActive: 2 },
        created_at: new Date(now - 1 * DAY).toISOString(),
        verify_by: new Date(now + 2 * DAY).toISOString(),
        escalated_to: null, teacher_assignment_id: null,
      }]),
      'state_events.activity': { data: [] },
    });
    const { POST } = await loadRoute();
    const res = await POST(req({ 'x-cron-secret': SECRET }, { phase: 'verify' }));
    const body = await res.json();
    expect(body.data.verify).toMatchObject({ evaluated: 1, pending: 1, recovered: 0, escalated: 0 });
    expect(fromCalls.filter((c) => classify(c) === 'interventions.update')).toHaveLength(0);
  });
});

describe('Loop C verify — band-drop check + re-notify (drains with flag OFF)', () => {
  beforeEach(() => { isFeatureEnabledMock.mockResolvedValue(false); });

  it('resolved: subject back below high → status=recovered + concentration_resolved event', async () => {
    const now = Date.now();
    installHandler({
      ...verifySweep([{
        id: 'iv-c1', student_id: 'stu-1', subject_code: 'math', chapter_number: 1,
        trigger_signal: 'at_risk_concentration', trigger_snapshot: { atRiskChapterCount: 5, bandAtTrigger: 'high' },
        created_at: new Date(now - 5 * DAY).toISOString(),
        verify_by: new Date(now + 9 * DAY).toISOString(), // window open
        escalated_to: 'teacher', teacher_assignment_id: 'tra-1',
      }]),
      // Current projection: only 2 at-risk chapters in math → band 'low' (< high).
      learner_mastery: {
        data: [
          { auth_user_id: AUTH_1, subject_code: 'math', chapter_number: 1, mastery: 0.2, last_updated_at: new Date(now - 1 * DAY).toISOString() },
          { auth_user_id: AUTH_1, subject_code: 'math', chapter_number: 2, mastery: 0.3, last_updated_at: new Date(now - 1 * DAY).toISOString() },
          { auth_user_id: AUTH_1, subject_code: 'math', chapter_number: 3, mastery: 0.9, last_updated_at: new Date(now - 1 * DAY).toISOString() },
        ],
      },
    });
    const { POST } = await loadRoute();
    const res = await POST(req({ 'x-cron-secret': SECRET }, { phase: 'verify' }));
    const body = await res.json();
    expect(body.data.verify).toMatchObject({ evaluated: 1, recovered: 1, reescalated: 0 });
    const upd = fromCalls.find((c) => classify(c) === 'interventions.update');
    expect(upd?.payload).toMatchObject({ status: 'recovered' });
    expect(publishEventMock.mock.calls[0][1].kind).toBe('system.concentration_resolved');
    expect(onConcentrationResolvedMock).toHaveBeenCalledWith('stu-1', expect.objectContaining({ interventionId: 'iv-c1' }));
  });

  it('expired (still high): RE-NOTIFY — status=escalated (no 2nd row), teacher re-flag, reescalated event + audit', async () => {
    const now = Date.now();
    installHandler({
      ...verifySweep([{
        id: 'iv-c1', student_id: 'stu-1', subject_code: 'math', chapter_number: 1,
        trigger_signal: 'at_risk_concentration', trigger_snapshot: { atRiskChapterCount: 5, bandAtTrigger: 'high' },
        created_at: new Date(now - 20 * DAY).toISOString(),
        verify_by: new Date(now - 1 * DAY).toISOString(), // window elapsed
        escalated_to: 'teacher', teacher_assignment_id: 'tra-1',
      }]),
      // Still 5 at-risk chapters → still 'high'.
      learner_mastery: {
        data: [1, 2, 3, 4, 5].map((ch) => ({
          auth_user_id: AUTH_1, subject_code: 'math', chapter_number: ch, mastery: 0.2,
          last_updated_at: new Date(now - 1 * DAY).toISOString(),
        })),
      },
    });
    const { POST } = await loadRoute();
    const res = await POST(req({ 'x-cron-secret': SECRET }, { phase: 'verify' }));
    const body = await res.json();
    expect(body.data.verify).toMatchObject({ evaluated: 1, reescalated: 1, recovered: 0 });
    const upd = fromCalls.find((c) => classify(c) === 'interventions.update');
    expect(upd?.payload).toMatchObject({ status: 'escalated' });
    // NO second intervention row (re-notify, not re-row — Decision C4).
    expect(fromCalls.filter((c) => classify(c) === 'interventions.insert')).toHaveLength(0);
    // Existing teacher assignment re-flagged (bumped to 'assigned').
    const bump = fromCalls.find((c) => classify(c) === 'assignments.update');
    expect(bump?.payload).toMatchObject({ status: 'assigned' });
    expect(publishEventMock.mock.calls[0][1].kind).toBe('system.concentration_reescalated');
    expect(auditLogMock).toHaveBeenCalledTimes(1);
    expect(onConcentrationReescalatedMock).toHaveBeenCalledWith('stu-1', expect.objectContaining({ escalatedTo: 'teacher' }));
  });

  it('expired on a B2C row re-notifies the parent (escalatedTo=parent)', async () => {
    const now = Date.now();
    installHandler({
      ...verifySweep([{
        id: 'iv-c1', student_id: 'stu-1', subject_code: 'math', chapter_number: 1,
        trigger_signal: 'at_risk_concentration', trigger_snapshot: { atRiskChapterCount: 5 },
        created_at: new Date(now - 20 * DAY).toISOString(),
        verify_by: new Date(now - 1 * DAY).toISOString(),
        escalated_to: 'parent', teacher_assignment_id: null,
      }]),
      learner_mastery: {
        data: [1, 2, 3, 4, 5].map((ch) => ({
          auth_user_id: AUTH_1, subject_code: 'math', chapter_number: ch, mastery: 0.2,
          last_updated_at: new Date(now - 1 * DAY).toISOString(),
        })),
      },
    });
    const { POST } = await loadRoute();
    const res = await POST(req({ 'x-cron-secret': SECRET }, { phase: 'verify' }));
    const body = await res.json();
    expect(body.data.verify).toMatchObject({ reescalated: 1 });
    // No teacher assignment bump on the parent path.
    expect(fromCalls.filter((c) => classify(c) === 'assignments.update')).toHaveLength(0);
    expect(onConcentrationReescalatedMock).toHaveBeenCalledWith('stu-1', expect.objectContaining({ escalatedTo: 'parent' }));
  });
});

describe('verify drain — mixed loops in one sweep', () => {
  it('a Loop A, Loop B and Loop C row drain together in a single verify pass', async () => {
    isFeatureEnabledMock.mockResolvedValue(false); // all flags off — drain anyway
    const now = Date.now();
    installHandler({
      'interventions.verifySweep': {
        data: [
          { // Loop B — returned
            id: 'iv-b', student_id: 'stu-1', subject_code: '_inactivity', chapter_number: 0,
            trigger_signal: 'inactivity', trigger_snapshot: { daysSinceActive: 2 },
            created_at: new Date(now - 2 * DAY).toISOString(), verify_by: new Date(now + 1 * DAY).toISOString(),
            escalated_to: null, teacher_assignment_id: null,
          },
          { // Loop C — resolved
            id: 'iv-c', student_id: 'stu-1', subject_code: 'math', chapter_number: 1,
            trigger_signal: 'at_risk_concentration', trigger_snapshot: { atRiskChapterCount: 5 },
            created_at: new Date(now - 5 * DAY).toISOString(), verify_by: new Date(now + 9 * DAY).toISOString(),
            escalated_to: 'parent', teacher_assignment_id: null,
          },
        ],
      },
      students: { data: [{ id: 'stu-1', auth_user_id: AUTH_1, school_id: null, grade: '9' }] },
      'interventions.update': { data: [{ id: 'x' }], error: null },
      'state_events.activity': {
        data: [{ actor_auth_user_id: AUTH_1, kind: 'learner.quiz_completed', occurred_at: new Date(now - 1 * DAY).toISOString(), payload: {} }],
      },
      learner_mastery: {
        data: [
          { auth_user_id: AUTH_1, subject_code: 'math', chapter_number: 1, mastery: 0.2, last_updated_at: new Date(now - 1 * DAY).toISOString() },
          { auth_user_id: AUTH_1, subject_code: 'math', chapter_number: 2, mastery: 0.9, last_updated_at: new Date(now - 1 * DAY).toISOString() },
        ],
      },
    });
    const { POST } = await loadRoute();
    const res = await POST(req({ 'x-cron-secret': SECRET }, { phase: 'verify' }));
    const body = await res.json();
    expect(body.data.verify).toMatchObject({ evaluated: 2, recovered: 2, errors: 0 });
  });
});
