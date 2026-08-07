import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { mockStudentSession, hasRealStudentCreds, loginViaUI } from './helpers/auth';
import { installQuizBackend, runQuizToResults, buildQuestions, OPTION_LABELS } from './helpers/quiz-backend';

/**
 * REG-45 — Quiz happy-path E2E (P1 + P2 + P3 enforcement at the browser level).
 *
 * This spec and `payment-checkout.spec.ts` are the ONLY two specs run by the
 * BLOCKING `e2e-critical-paths` CI job. A scoring or Razorpay regression must
 * not ship through CI green.
 *
 * ── 2026-07-28 revival ────────────────────────────────────────────────────
 * Every assertion in this file was previously inert: five tests were disabled
 * by passing a LITERAL boolean to `test.fixme` (unconditional and permanent)
 * and the two smoke tests skipped because the CI workflow sets
 * NEXT_PUBLIC_SUPABASE_URL to a placeholder. The blocking gate ran seven tests
 * and asserted nothing.
 *
 * The stated reason for the fixmes — "the mocked-session fallback cannot click
 * through QuizSetup because Supabase auth state is checked on multiple nested
 * SDK calls" — was FALSE. The real cause was a single bug in
 * `helpers/auth.ts`: the mocked session was seeded under a localStorage key
 * derived from the TEST PROCESS's placeholder Supabase URL, which never
 * matches the key the browser SDK reads when the app under test was built
 * against a different project ref. With that fixed (see
 * `installSessionForAnyProjectRef`), the whole pick-mode → pick-subject →
 * answer → results pipeline drives on mocks alone: no fixture student, no
 * seeded database, no secret, no live Razorpay.
 *
 * What each test proves, and why the mock does not make it vacuous:
 *   - The server-returned score/XP are INVENTED numbers that no client-side
 *     computation over the mocked responses would produce. If QuizResults ever
 *     recomputes score or XP locally (the P1/P2 violation these tests exist to
 *     catch), the rendered value diverges from the mocked value and the
 *     assertion fails.
 *
 * Tests that genuinely need a live backend (server-side P3 enforcement in the
 * `submit_quiz_results_v2` RPC) are gated on `hasRealStudentCreds()` — a real
 * condition that self-enables the moment CI supplies a non-placeholder
 * NEXT_PUBLIC_SUPABASE_URL plus TEST_STUDENT_* secrets.
 *
 * Run: npx playwright test e2e/quiz-happy-path.spec.ts
 */

test.describe('REG-45 smoke: auth path validation', () => {
  test('smoke: real login lands on dashboard or onboarding', async ({ page }) => {
    test.skip(!hasRealStudentCreds(), 'requires TEST_STUDENT_EMAIL + TEST_STUDENT_PASSWORD and a non-placeholder NEXT_PUBLIC_SUPABASE_URL');
    const ok = await loginViaUI(page);
    expect(ok).toBe(true);
    expect(page.url()).toMatch(/\/(dashboard|onboarding|foxy|learn|quiz)/);
  });

  test('smoke: authenticated /quiz route is reachable', async ({ page }) => {
    test.skip(!hasRealStudentCreds(), 'requires TEST_STUDENT_EMAIL + TEST_STUDENT_PASSWORD and a non-placeholder NEXT_PUBLIC_SUPABASE_URL');
    await loginViaUI(page);
    await page.goto('/quiz');
    await page.waitForLoadState('domcontentloaded');
    expect(page.url()).not.toMatch(/\/login/);
  });
});

test.describe('REG-45 Quiz Happy Path', () => {

  // ── Test 1: P1 — the browser renders the SERVER's score, never its own ───
  test('quiz: results screen renders the server-returned score percent verbatim (P1)', async ({ page }) => {
    // The student answers all 10 questions with the SAME option. A client-side
    // recomputation over those responses could only ever yield 0% or 100%.
    // The server says 70%. Rendering 70% proves the component is a pass-through.
    const recorder = await installQuizBackend(page, {
      questions: buildQuestions(10),
      submitResult: {
        success: true,
        session_id: 'e2e-session-0001',
        score_percent: 70,
        xp_earned: 70,
        correct: 7,
        total: 10,
        xp_capped: false,
        new_xp_total: 70,
        level: 1,
      },
    });
    await mockStudentSession(page, { xpTotal: 0, anyProjectRef: true });

    await runQuizToResults(page, { questionCount: 10 });

    // Exact-match locators: the results screen also renders an error-breakdown
    // panel containing strings like "10 (100%)", so a loose regex would match
    // unrelated copy and make the negative assertions meaningless.
    await expect(page.getByText('70%', { exact: true }).first()).toBeVisible({ timeout: 60_000 });
    // The only two values a client-side recomputation could produce here.
    await expect(page.getByText('0%', { exact: true })).toHaveCount(0);
    await expect(page.getByText('100%', { exact: true })).toHaveCount(0);

    // P4: submission went through the atomic server RPC, exactly once.
    const submits = recorder.rpcCalls.filter((n) => n.startsWith('submit_quiz_results'));
    expect(submits).toEqual(['submit_quiz_results_v2']);
  });

  // ── Test 2: P2 — XP shown is the server's XP, not a local formula ────────
  test('quiz: results screen renders the server-returned XP verbatim (P2)', async ({ page }) => {
    // 7 correct at 70% would be 70 XP under the P2 formula. The server returns
    // 63 — a value the client formula can never produce — so any local
    // recomputation of XP is caught here.
    await installQuizBackend(page, {
      questions: buildQuestions(10),
      submitResult: {
        success: true,
        session_id: 'e2e-session-0001',
        score_percent: 70,
        xp_earned: 63,
        correct: 7,
        total: 10,
        xp_capped: false,
        new_xp_total: 63,
      },
    });
    await mockStudentSession(page, { xpTotal: 0, anyProjectRef: true });

    await runQuizToResults(page, { questionCount: 10 });

    await expect(page.getByText('+63', { exact: true }).first()).toBeVisible({ timeout: 60_000 });
    // +70 is what a hardcoded `correct * 10` would render. It must not appear.
    await expect(page.getByText('+70', { exact: true })).toHaveCount(0);
  });

  // ── Test 3: P3 — server anti-cheat verdict is honoured by the UI ─────────
  test('quiz: server anti-cheat flag zeroes XP and surfaces the review notice (P3)', async ({ page }) => {
    // All-same-answer over >3 MCQs. The authoritative RPC returns the REAL
    // score with flagged=true and xp_earned=0 (SLC-5 contract: record the
    // session, award no XP). The UI must show 0 XP AND the non-accusatory
    // review notice — never a fabricated XP award.
    await installQuizBackend(page, {
      questions: buildQuestions(10),
      submitResult: {
        success: true,
        session_id: 'e2e-session-0001',
        score_percent: 25,
        xp_earned: 0,
        correct: 1,
        total: 10,
        xp_capped: false,
        flagged: true,
        flag_reason: 'all_same_answer',
      },
    });
    await mockStudentSession(page, { anyProjectRef: true });

    await runQuizToResults(page, { questionCount: 10, answerLabel: OPTION_LABELS[1] });

    const notice = page.getByText(/flagged for review|समीक्षा के लिए चिह्नित/i);
    await expect(notice.first()).toBeVisible({ timeout: 60_000 });
    // Real score is still shown (the attempt is recorded, not discarded) and
    // the XP award is zero.
    await expect(page.getByText('25%', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('+0', { exact: true }).first()).toBeVisible();
  });

  // ── Test 4: P2 — daily XP cap clamp is surfaced, not silently swallowed ──
  test('quiz: daily XP cap clamp renders the clamped value, never the raw award (P2)', async ({ page }) => {
    // today_earned=180, this quiz is worth 50 → server clamps to 20 (200 cap).
    // The UI must show the CLAMPED 20, never the raw 50.
    //
    // NOTE: `xp_capped` is included below for shape fidelity, but the current
    // submit_quiz_results_v2 definition (migration 20260707010000) does NOT
    // return it — so QuizResults' cap banner (packages/ui/src/quiz/
    // QuizResults.tsx:501) cannot fire on the canonical v2 path. Asserting the
    // banner here would pin behaviour production cannot produce, so this test
    // pins the property that IS real: the clamped VALUE reaches the student.
    await installQuizBackend(page, {
      questions: buildQuestions(10),
      submitResult: {
        success: true,
        session_id: 'e2e-session-0001',
        score_percent: 100,
        xp_earned: 20,
        correct: 10,
        total: 10,
        xp_capped: true,
        new_xp_total: 200,
        today_earned: 200,
        daily_cap: 200,
        remaining_today: 0,
      },
    });
    await mockStudentSession(page, { xpTotal: 180, anyProjectRef: true });

    await runQuizToResults(page, { questionCount: 10 });

    await expect(page.getByText('+20', { exact: true }).first()).toBeVisible({ timeout: 60_000 });
    // +170 = 100 + 20 high-score + 50 perfect: what an unclamped client-side
    // computation over a 10/10 perfect score would render.
    await expect(page.getByText('+170', { exact: true })).toHaveCount(0);
  });

  /** Both authoritative submit RPCs reject (server anti-cheat / count mismatch). */
  const REJECTED_SUBMIT = {
    questions: buildQuestions(10),
    submitResult: {
      code: 'P0001',
      message: 'response_count_mismatch',
      details: 'Number of responses does not match number of questions',
    },
    submitStatus: 400,
  };

  // ── Test 5a: server rejection must not award XP (P2) ─────────────────────
  test('quiz: submit RPC rejection awards no XP (P2)', async ({ page }) => {
    await installQuizBackend(page, REJECTED_SUBMIT);
    await mockStudentSession(page, { anyProjectRef: true });

    await runQuizToResults(page, { questionCount: 10 });

    await expect(page.getByText('+0', { exact: true }).first()).toBeVisible({ timeout: 60_000 });
    // No positive XP may be credited when the authoritative writer refused.
    for (const xp of ['+10', '+20', '+63', '+70', '+100', '+170']) {
      await expect(page.getByText(xp, { exact: true })).toHaveCount(0);
    }
  });

  // ── Test 5b: rejection must not render a fabricated 0% scorecard ──────────
  // P0-1/P0-2 remediation (2026-08-06): the client-side fallback that
  // fabricated a 0% scorecard from is_correct=false responses was removed
  // entirely — the submit path is v2-ONLY, so the recovery/retry UI surfaces
  // and no score is rendered. Formerly a test.fail() known-defect gate (found
  // 2026-07-28); the defect is closed, so this now asserts the fix positively.
  test('quiz: submit RPC rejection must not render a fabricated score (P1)', async ({ page }) => {
    await installQuizBackend(page, REJECTED_SUBMIT);
    await mockStudentSession(page, { anyProjectRef: true });

    await runQuizToResults(page, { questionCount: 10 });

    const recovery = page.getByText(
      /try again|retry|couldn'?t|could not|something went wrong|no results|पुनः प्रयास|कुछ गलत/i,
    );
    await expect(recovery.first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText('0%', { exact: true })).toHaveCount(0);
  });

  // ── Test 6: server-side P3 enforcement (needs a live backend) ────────────
  test('quiz: live backend rejects a speed-hacked submission (P3, server-side)', async ({ page }) => {
    test.skip(
      !hasRealStudentCreds(),
      'Server-side P3 enforcement lives in the submit_quiz_results_v2 RPC and needs a real ' +
        'authenticated session against a real Supabase project. Set TEST_STUDENT_EMAIL, ' +
        'TEST_STUDENT_PASSWORD and a non-placeholder NEXT_PUBLIC_SUPABASE_URL to enable. ' +
        'Client-side advisory checks and the UI contract are covered by test 3 above.',
    );
    await loginViaUI(page);
    await page.goto('/quiz');
    await page.waitForLoadState('domcontentloaded');
    expect(page.url()).not.toMatch(/\/login/);
  });
});

/**
 * ── ANTI-VACUITY GUARD ────────────────────────────────────────────────────
 *
 * The failure mode being fixed is not "a test failed" — it is "the blocking
 * gate exists, is wired into CI, is green, and checks nothing". This guard
 * lives INSIDE the blocking spec (the CI job runs only these two files by
 * name, so a separate spec file would never execute here) and fails the gate
 * if the number of unconditionally-running assertions ever drops.
 *
 * A second, always-on copy runs in the Vitest lane:
 * `apps/host/src/__tests__/e2e/critical-path-gate.test.ts`.
 */
test.describe('REG-45/REG-46 gate integrity', () => {
  const CRITICAL_SPECS = ['quiz-happy-path.spec.ts', 'payment-checkout.spec.ts'];
  /**
   * Floor = number of tests in the two critical specs that carry NO skip/fixme
   * guard at all. Raising this is encouraged; lowering it requires user
   * approval per the regression-catalog rules.
   */
  const ACTIVE_ASSERTION_FLOOR = 9;

  test('gate: critical-path specs still contain unconditionally-active assertions', async () => {
    // `__dirname` (CJS) — this repo has no "type": "module", so import.meta is
    // unavailable in the Playwright transform output.
    const dir = __dirname;
    // Built from fragments so this guard's own source can never match the
    // banned pattern it is looking for.
    const LITERAL_GUARD = new RegExp('test\\.(fixme|skip)\\(\\s*(true|false)\\b');
    const ANY_GUARD = new RegExp('test\\.(fixme|skip)\\(');
    const TEST_SPLIT = /\n\s*test\(/;
    let unconditional = 0;

    for (const file of CRITICAL_SPECS) {
      const src = readFileSync(path.join(dir, file), 'utf8');

      // 1. A LITERAL boolean argument is a permanent lie: the reason can never
      //    stop applying, so the test can never come back.
      expect(
        LITERAL_GUARD.test(src),
        `${file} disables a test with a literal boolean argument. Use a ` +
          'machine-checkable condition (an env-var or capability check) so the ' +
          'test self-enables the moment the prerequisite exists.',
      ).toBe(false);

      // 2. Count tests whose body carries no skip/fixme guard of any kind.
      for (const block of src.split(TEST_SPLIT).slice(1)) {
        if (!ANY_GUARD.test(block)) unconditional++;
      }
    }

    expect(
      unconditional,
      `Only ${unconditional} unconditionally-active tests remain across ` +
        `${CRITICAL_SPECS.join(' + ')} (floor ${ACTIVE_ASSERTION_FLOOR}). ` +
        'The blocking critical-path gate must never regress toward asserting nothing.',
    ).toBeGreaterThanOrEqual(ACTIVE_ASSERTION_FLOOR);
  });
});
