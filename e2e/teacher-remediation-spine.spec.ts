import { test, expect, type Page } from '@playwright/test';
import { mockStudentSession, hasRealStudentCreds, loginViaUI } from './helpers/auth';
import type { TodayResponse } from '../src/lib/today/types';

/**
 * Phase 3A Wave A / A5 — E2E for the teacher detect→act→verify spine
 * (catalog entry REG-92), flag ON (`ff_teacher_command_center`).
 *
 * THE HEADLINE LOOP being netted at the browser layer:
 *
 *   Teacher Command Center → at-risk alert → "Assign remediation"
 *     → (student session) the task appears at the TOP of Today, tagged
 *       "from your teacher"
 *     → student completes it (runs as a NORMAL quiz)
 *     → the teacher's alert shows resolved.
 *
 * ── What this harness CAN and CANNOT do (honest scope) ────────────────────
 * The existing E2E harness has NO cross-session live DB: it mocks the Supabase
 * REST/Edge/BFF reads per-page (see helpers/auth.ts + today-home.spec.ts). So a
 * single browser context cannot carry a real remediation row from a teacher
 * session into a student session and back. We therefore scope each HALF of the
 * loop to what the harness supports and assert the SEAM each half owns:
 *
 *   1. TEACHER assign action (this file, fully mocked): the Command Center
 *      renders an at-risk alert with remediation_status:'none' → the "Assign
 *      remediation" button POSTs /api/teacher/remediation with the alert's
 *      student_id → we intercept that POST, assert the wire shape, return a
 *      created assignment → the Edge get_alerts re-read now reports
 *      remediation_status:'assigned' → the alert flips to the read-only
 *      "Assigned" pill. This is the detect→act half end-to-end at the UI.
 *
 *   2. ALERT status transition (this file, mocked): after the student resolves,
 *      a teacher re-load whose get_alerts returns remediation_status:'resolved'
 *      renders the ✓ Resolved pill (the verify half's terminal UI state).
 *
 *   3. STUDENT-side surfacing (this file, mocked /api/v2/today): a Today
 *      envelope with a `teacher_remediation` primary renders at the TOP of the
 *      queue, carries the "from your teacher" tag, and its Continue CTA deep-
 *      links to /quiz?...&from=teacher&remediationId=<id> — the deep link the
 *      quiz-page completion seam reads to fire the resolve flip.
 *
 * LEFT TO INTEGRATION (documented gap, NOT covered here): the SINGLE live
 * round-trip where one real assignment row, written by a teacher's POST, is
 * (a) surfaced by the real /api/v2/today resolver to the actual assigned
 * student and (b) flipped to resolved by the real quiz-completion POST, with
 * RLS enforced on a live DB. That needs the shared test-fixture work
 * (TEST_STUDENT_EMAIL/PASSWORD + a seeded teacher+class+roster on a staging
 * Supabase project) tracked alongside REG-45/REG-69. The pieces of that
 * round-trip are unit/route-covered today:
 *   - assign + roster gate + idempotency: src/__tests__/api/teacher/remediation/route.test.ts (A2)
 *   - resolver surfacing (top item, from=teacher, reused /quiz route) +
 *     status-flip helpers: src/__tests__/state/learner-loop/teacher-remediation.test.ts (A3)
 *   - resolve endpoint (internal studentId, idempotent): src/__tests__/api/rhythm/remediation-resolve.test.ts (A3)
 *   - RLS roster boundary (P8): src/__tests__/teacher/remediation-rls-policies.test.ts (A5)
 *
 * Determinism strategy mirrors today-home.spec.ts: flag read + Edge calls +
 * BFF are all Playwright-intercepted; rendered-page assertions are gated with
 * `test.fixme(!hasRealStudentCreds(), …)` because the mocked Supabase session
 * only clears the auth wall against a REAL Supabase URL (the CI placeholder URL
 * bounces protected pages to /login). The mocks make them pass the moment a
 * test-fixture lands.
 *
 * Run: npx playwright test e2e/teacher-remediation-spine.spec.ts
 */

// ── Fixture IDs ────────────────────────────────────────────────────────────
const TEACHER_ID = '22222222-2222-4222-a222-222222222222';
const STUDENT_ID = '33333333-3333-4333-a333-333333333333';
const CLASS_ID = '44444444-4444-4444-a444-444444444444';
const ASSIGNMENT_ID = '77777777-7777-4777-a777-777777777777';

// ── feature_flags payload: command-center ON, today-home ON ────────────────
function featureFlagsPayload(opts: { commandCenterOn: boolean; todayHomeOn?: boolean }) {
  const rows = [
    {
      flag_name: 'ff_teacher_command_center',
      is_enabled: opts.commandCenterOn,
      target_roles: null,
      target_environments: null,
      target_institutions: null,
    },
  ];
  if (opts.todayHomeOn) {
    rows.push({
      flag_name: 'ff_today_home_v1',
      is_enabled: true,
      target_roles: null,
      target_environments: null,
      target_institutions: null,
    });
  }
  return rows;
}

// ── teacher-dashboard Edge envelopes ───────────────────────────────────────
function dashboardEnvelope() {
  return {
    teacher: { name: 'Test Teacher' },
    classes: [{ id: CLASS_ID, name: 'Grade 8 Science', student_count: 24, avg_mastery: 58 }],
    stats: { total_students: 24, active_alerts: 1, critical_alerts: 1, active_assignments: 0 },
  };
}

function heatmapEnvelope() {
  return {
    student_count: 1,
    concept_count: 1,
    concepts: [{ id: 'c1', title: 'Light', chapter: 3 }],
    matrix: [
      {
        student_name: 'Aanya Sharma',
        avg_mastery: 22,
        cells: [{ p_know: 0.18, level: 'low', attempts: 6 }],
      },
    ],
  };
}

/** An at-risk alert. `remediation_status` controls the rail's render state. */
function alertsEnvelope(status: 'none' | 'assigned' | 'in_progress' | 'resolved') {
  return [
    {
      id: 'alert-1',
      student_id: STUDENT_ID,
      severity: 'critical',
      title: 'Aanya is falling behind in Light',
      description: 'Mastery 18% over the last 6 attempts.',
      recommended_action: 'Assign targeted remediation on Light.',
      remediation_status: status,
    },
  ];
}

/**
 * Install the teacher Command Center mocks. `alertStatus` is the status the
 * Edge `get_alerts` reports; `onAssignPost` captures the POST body the
 * "Assign remediation" button sends. After a successful POST the Command Center
 * re-calls loadClassData (get_heatmap + get_alerts) — `afterAssignStatus`
 * lets the harness flip the re-read so the optimistic UI reconciles to the
 * server-authoritative pill.
 */
async function installTeacherMocks(
  page: Page,
  opts: {
    alertStatus: 'none' | 'assigned' | 'in_progress' | 'resolved';
    afterAssignStatus?: 'assigned' | 'in_progress' | 'resolved';
    onAssignPost?: (body: unknown) => void;
  },
): Promise<void> {
  let assigned = false;

  await page.route('**/rest/v1/feature_flags**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(featureFlagsPayload({ commandCenterOn: true })),
    });
  });

  // teacher-dashboard Edge Function — dispatch on the `action` field.
  await page.route('**/functions/v1/teacher-dashboard**', async (route) => {
    const body = JSON.parse(route.request().postData() || '{}');
    const action = body.action as string;
    let payload: unknown = {};
    if (action === 'get_dashboard') payload = dashboardEnvelope();
    else if (action === 'get_heatmap') payload = heatmapEnvelope();
    else if (action === 'get_alerts') {
      // Before assign → alertStatus; after a successful assign → afterAssignStatus.
      const status = assigned ? opts.afterAssignStatus ?? 'assigned' : opts.alertStatus;
      payload = alertsEnvelope(status);
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(payload),
    });
  });

  // The assign-remediation POST (the "act" seam). Capture the body, mark
  // assigned so the next get_alerts re-read reconciles, return a created row.
  await page.route('**/api/teacher/remediation', async (route) => {
    if (route.request().method() === 'POST') {
      const body = JSON.parse(route.request().postData() || '{}');
      opts.onAssignPost?.(body);
      assigned = true;
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: {
            id: ASSIGNMENT_ID,
            teacher_id: TEACHER_ID,
            student_id: STUDENT_ID,
            class_id: CLASS_ID,
            chapter_id: null,
            source_alert_id: null,
            status: 'assigned',
            created_at: '2026-06-08T00:00:00Z',
            resolved_at: null,
          },
        }),
      });
      return;
    }
    await route.continue();
  });
}

// ── A teacher_remediation Today envelope (student-side surfacing) ──────────
const TEACHER_TODAY_RESPONSE: TodayResponse = {
  schemaVersion: 1,
  resolvedAt: '2026-06-08T09:00:00.000Z',
  primary: {
    type: 'teacher_remediation',
    rank: 1,
    labelKey: 'today.item.teacher_remediation.label',
    subtitleKey: 'today.item.teacher_remediation.subtitle',
    estMinutes: 8,
    deepLink: {
      route: '/quiz',
      params: { subject: 'science', chapter: 3, from: 'teacher', remediationId: ASSIGNMENT_ID },
    },
    iconHint: 'teacher-badge',
    reason: 'teacher_assigned',
    meta: { source: 'teacher', assignmentId: ASSIGNMENT_ID, chapterId: null, subjectCode: 'science', chapterNumber: 3 },
  },
  queue: [
    {
      type: 'teacher_remediation',
      rank: 1,
      labelKey: 'today.item.teacher_remediation.label',
      subtitleKey: 'today.item.teacher_remediation.subtitle',
      estMinutes: 8,
      deepLink: {
        route: '/quiz',
        params: { subject: 'science', chapter: 3, from: 'teacher', remediationId: ASSIGNMENT_ID },
      },
      iconHint: 'teacher-badge',
      reason: 'teacher_assigned',
      meta: { source: 'teacher', assignmentId: ASSIGNMENT_ID, chapterId: null, subjectCode: 'science', chapterNumber: 3 },
    },
    {
      type: 'srs_due',
      rank: 2,
      labelKey: 'today.item.srs_due.label',
      subtitleKey: 'today.item.srs_due.subtitle',
      estMinutes: 5,
      deepLink: { route: '/review' },
      iconHint: 'cards-stack',
      reason: 'reviews_due_today',
      meta: { dueCount: 4 },
    },
  ],
  meta: { branch: 'teacher_remediation', masterySubjectCount: 1, dueReviewCount: 4 },
};

async function installStudentTodayMocks(page: Page): Promise<void> {
  await page.route('**/rest/v1/feature_flags**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(featureFlagsPayload({ commandCenterOn: false, todayHomeOn: true })),
    });
  });
  await page.route('**/api/student/subjects**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ subjects: [] }),
    });
  });
  await page.route('**/api/v2/today**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(TEACHER_TODAY_RESPONSE),
    });
  });
}

// ═══ 1. TEACHER: detect → act (assign) → alert flips to Assigned ═══════════
test.describe('Teacher remediation spine — Command Center assign (flag ON)', () => {
  test('at-risk alert → Assign remediation POSTs the student_id → alert shows Assigned', async ({
    page,
  }) => {
    test.fixme(
      !hasRealStudentCreds(),
      'Rendering the Command Center past the teacher auth+flag gate needs an ' +
        'authenticated teacher session. The mocked session clears the auth wall ' +
        'only against a real Supabase URL; the CI placeholder URL bounces /teacher ' +
        'to /login before the gated render. All mocks (flag ON + teacher-dashboard ' +
        'Edge envelopes + the assign POST intercept) are installed so this passes ' +
        'the moment a test-teacher fixture is wired (same fixture family as ' +
        'REG-45/REG-69). The assign wire-shape + roster gate + idempotency are ' +
        'route-covered now in src/__tests__/api/teacher/remediation/route.test.ts.',
    );

    let assignBody: unknown = null;
    await mockStudentSession(page, { xpTotal: 0, streakDays: 0 });
    await installTeacherMocks(page, {
      alertStatus: 'none',
      afterAssignStatus: 'assigned',
      onAssignPost: (b) => {
        assignBody = b;
      },
    });

    if (hasRealStudentCreds()) await loginViaUI(page);

    await page.goto('/teacher');
    await page.waitForLoadState('domcontentloaded');

    // The at-risk rail renders the alert with an "Assign remediation" button.
    const assignBtn = page.getByTestId('assign-remediation-btn');
    await expect(assignBtn).toBeVisible({ timeout: 15_000 });

    await assignBtn.click();

    // The POST carried the alert's student_id (general remediation — no chapter).
    await expect.poll(() => assignBody).not.toBeNull();
    expect((assignBody as { student_id?: string }).student_id).toBe(STUDENT_ID);

    // After the server-authoritative re-read, the alert shows the read-only pill.
    const statusPill = page.getByTestId('remediation-status');
    await expect(statusPill).toBeVisible({ timeout: 15_000 });
    await expect(statusPill).toHaveText(/assigned/i);

    // The assign button is gone (server owns the state; no duplicate assign).
    await expect(page.getByTestId('assign-remediation-btn')).toHaveCount(0);
  });

  // ═══ 2. TEACHER: verify — resolved status renders the ✓ Resolved pill ════
  test('a resolved assignment renders the ✓ Resolved pill (verify half terminal state)', async ({
    page,
  }) => {
    test.fixme(
      !hasRealStudentCreds(),
      'Same teacher auth-gate dependency as the assign test. Mocks return ' +
        'get_alerts with remediation_status:"resolved"; once the test-teacher ' +
        'fixture lands this asserts the verify-half terminal UI. The status-flip ' +
        'helper (assigned/in_progress → resolved, idempotent) is unit-covered in ' +
        'src/__tests__/state/learner-loop/teacher-remediation.test.ts.',
    );

    await mockStudentSession(page, { xpTotal: 0, streakDays: 0 });
    await installTeacherMocks(page, { alertStatus: 'resolved' });

    if (hasRealStudentCreds()) await loginViaUI(page);

    await page.goto('/teacher');
    await page.waitForLoadState('domcontentloaded');

    const statusPill = page.getByTestId('remediation-status');
    await expect(statusPill).toBeVisible({ timeout: 15_000 });
    await expect(statusPill).toHaveText(/resolved/i);
    // No assign button when already resolved.
    await expect(page.getByTestId('assign-remediation-btn')).toHaveCount(0);
  });
});

// ═══ 3. STUDENT: the assigned task surfaces at the TOP of Today ════════════
test.describe('Teacher remediation spine — student-side surfacing (flag ON)', () => {
  test('teacher-assigned remediation is the top Today item, tagged "from your teacher"', async ({
    page,
  }) => {
    test.fixme(
      !hasRealStudentCreds(),
      'Rendering /today past the student auth+flag gate needs an authenticated ' +
        'session (mocked session resolves only against a real Supabase URL). The ' +
        '/api/v2/today envelope (teacher_remediation primary) is stubbed so this ' +
        'passes once the test-student fixture lands. The resolver contract (teacher ' +
        'item wins the queue, reuses /quiz, carries from=teacher+remediationId) is ' +
        'unit-covered in src/__tests__/state/learner-loop/teacher-remediation.test.ts.',
    );

    await mockStudentSession(page, { xpTotal: 120, streakDays: 3 });
    await installStudentTodayMocks(page);

    if (hasRealStudentCreds()) await loginViaUI(page);

    await page.goto('/today');
    await page.waitForLoadState('domcontentloaded');

    await expect(page.getByTestId('today-loaded')).toBeVisible({ timeout: 15_000 });

    // The "from your teacher" tag renders on the surfaced item (the primary
    // focus card AND the queue item both carry it — assert at least one).
    await expect(page.getByTestId('today-from-teacher-tag').first()).toBeVisible();
    await expect(page.getByText(/from your teacher/i).first()).toBeVisible();

    // The teacher-assigned title copy renders (the resolver-tagged primary).
    await expect(page.getByText(/your teacher assigned this/i).first()).toBeVisible();

    // The primary focus card's Continue CTA is present and clickable. It is a
    // <button> that router.push()es the resolver deep link (asserted by the
    // navigation test below), not an <a href>, so we only assert visibility here.
    await expect(page.getByTestId('today-focus-continue')).toBeVisible();
  });

  test('clicking Continue navigates to /quiz with from=teacher + remediationId', async ({
    page,
  }) => {
    test.fixme(
      !hasRealStudentCreds(),
      'Same student auth-gate dependency. The /quiz target is stubbed so the ' +
        'assertion is on the URL the resolver chose. On COMPLETION the quiz page ' +
        'reads from=teacher+remediationId and fires POST ' +
        '/api/rhythm/remediation/[id]/resolve (route-covered in ' +
        'src/__tests__/api/rhythm/remediation-resolve.test.ts) — the verify half. ' +
        'The completion-seam decoupling from scoring/XP/submit is enforced there.',
    );

    await mockStudentSession(page, { xpTotal: 120, streakDays: 3 });
    await installStudentTodayMocks(page);

    // Stub /quiz so we assert the navigation TARGET (the resolver's deep link),
    // independent of the /quiz→/foxy rewrite in next.config.js.
    await page.route('**/quiz**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: '<!doctype html><html><body data-testid="quiz-stub">quiz</body></html>',
      });
    });

    if (hasRealStudentCreds()) await loginViaUI(page);

    await page.goto('/today');
    await page.waitForLoadState('domcontentloaded');

    const continueCta = page.getByTestId('today-focus-continue');
    await expect(continueCta).toBeVisible({ timeout: 15_000 });
    await continueCta.click();

    await page.waitForURL(/\/quiz\?.*from=teacher/, { timeout: 15_000 });
    expect(page.url()).toContain('from=teacher');
    expect(page.url()).toContain(`remediationId=${ASSIGNMENT_ID}`);
  });
});

/* ──────────────────────────────────────────────────────────────────────────
 * TODO (Phase 3A Wave A follow-up — testing): wire the shared teacher+student
 * test-fixture (TEST_TEACHER_EMAIL/PASSWORD + TEST_STUDENT_EMAIL/PASSWORD
 * against a staging Supabase project with a seeded class + roster, same fixture
 * family as REG-45/REG-69) so the five `test.fixme(!hasRealStudentCreds(), …)`
 * blocks above run green AND so the ONE remaining integration gap is closed:
 * a single live round-trip where a real assignment row written by the teacher's
 * POST is surfaced by the real /api/v2/today resolver to the assigned student
 * and flipped to resolved by the real quiz-completion POST, with RLS enforced.
 * Owner: testing. Tracked alongside REG-45/REG-69 fixture work + REG-92.
 * ────────────────────────────────────────────────────────────────────────── */
