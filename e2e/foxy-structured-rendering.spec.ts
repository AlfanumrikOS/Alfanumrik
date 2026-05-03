import { test, expect, type Page } from '@playwright/test';
import { mockStudentSession, hasRealStudentCreds, loginViaUI } from './helpers/auth';

/**
 * REG-55 (candidate) — Foxy structured rendering round-trip E2E.
 *
 * Smoke-test agent flagged this gap on 2026-05-02:
 *   "Verification gap: nothing in this read-only run actually exercises the
 *   structured payload path — that requires an authenticated student session…
 *   Recommend adding a Playwright E2E that signs in as a fixture student and
 *   asserts a `structured` block is rendered (catalog gap; would also harden
 *   REG-50 single-retrieval contract)."
 *
 * What this spec covers (per testing agent's edge-case catalog):
 *   1. Live POST → renderer round-trip: a /api/foxy POST response carrying a
 *      schema-valid `structured` payload must paint via FoxyStructuredRenderer
 *      (NOT raw JSON, NOT markdown of the JSON).
 *   2. DB round-trip: history reload (GET /api/foxy?sessionId=…) must surface
 *      the persisted `structured` JSONB column so a resumed session paints
 *      identically without a re-POST. This validates the chain
 *      route-persist → DB write → DB read → renderer.
 *   3. Bilingual chrome: when language flips to Hindi, FoxyStructuredRenderer
 *      chrome strings (Answer → उत्तर, Definition → परिभाषा, etc.) must flip,
 *      while block text content stays verbatim (P7).
 *   4. Negative path: when /api/foxy returns NO `structured` field (legacy /
 *      kill-switch / abstain), the legacy `RichContent` markdown renderer
 *      must take over — the structured renderer must NOT mount.
 *   5. Defense-in-depth: a malformed `structured` field must NOT mount the
 *      renderer (the route's `extractValidatedStructured` helper drops it,
 *      and `isFoxyResponse` in the page guards a second time). The user
 *      sees the legacy markdown content instead of a crashed bubble.
 *
 * Strategy:
 *   - Tests follow the same hybrid pattern as REG-45 (quiz-happy-path.spec.ts)
 *     and REG-46 (payment-checkout.spec.ts):
 *       a. The smoke describe-block uses real creds when present, mocks
 *          otherwise. It only asserts the auth path is wired.
 *       b. The renderer-round-trip describe-block uses page.route() to
 *          intercept /api/foxy (POST + GET) so we control the structured
 *          payload deterministically. The test does NOT depend on Claude or
 *          on the grounded-answer service's live output.
 *       c. Tests that genuinely need real DB writes (true round-trip via
 *          `foxy_chat_messages` table) are registered with `test.fixme(…)`
 *          for catalog completeness, with TODO at bottom of file. The mocked
 *          GET fulfils the same renderer contract: GET response shape MUST
 *          carry the `structured` JSONB column verbatim.
 *
 * Run:
 *   npx playwright test e2e/foxy-structured-rendering.spec.ts
 *
 * Catalog target: promote to REG-55 once `test.fixme` blocks are unblocked
 * by the test-student fixture (see TODO at bottom).
 */

// ── Fixtures ─────────────────────────────────────────────────────────────────
// Deterministic structured payloads. Each one exercises a different renderer
// branch (definition/step/answer/exam_tip + math) and is small enough to
// stay well below FOXY_MAX_PAYLOAD_BYTES (16 KB) and FOXY_MAX_BLOCKS (50).

const STRUCTURED_FIXTURE = {
  title: 'Photosynthesis',
  subject: 'science' as const,
  blocks: [
    {
      type: 'definition' as const,
      label: 'Definition',
      text: 'Photosynthesis is the process by which green plants convert sunlight into chemical energy stored in glucose.',
    },
    {
      type: 'step' as const,
      label: 'Step 1',
      text: 'Sunlight strikes the chloroplast and excites chlorophyll molecules.',
    },
    {
      type: 'step' as const,
      label: 'Step 2',
      text: 'Water molecules split, releasing oxygen as a byproduct.',
    },
    {
      type: 'answer' as const,
      text: 'Photosynthesis produces glucose and oxygen using carbon dioxide, water, and sunlight.',
    },
    {
      type: 'exam_tip' as const,
      text: 'In CBSE exams, write the balanced equation: 6CO2 + 6H2O -> C6H12O6 + 6O2.',
    },
  ],
};

const STRUCTURED_PAYLOAD_TEXT_MARKERS = {
  definitionText: /green plants convert sunlight/i,
  step1Text: /chlorophyll molecules/i,
  answerText: /produces glucose and oxygen/i,
  examTipText: /6CO2 \+ 6H2O/i,
};

// Bilingual fixture: same shape, Hindi text content. Tests that chrome
// (block headings) flips with `isHi`, while text content stays verbatim.
const STRUCTURED_FIXTURE_HI = {
  title: 'प्रकाश संश्लेषण',
  subject: 'science' as const,
  blocks: [
    {
      type: 'definition' as const,
      text: 'प्रकाश संश्लेषण वह प्रक्रिया है जिसके द्वारा हरे पौधे सूर्य के प्रकाश को रासायनिक ऊर्जा में बदलते हैं।',
    },
    {
      type: 'answer' as const,
      text: 'पौधे ग्लूकोज और ऑक्सीजन उत्पन्न करते हैं।',
    },
  ],
};

// Helper: produce the JSON payload our route emits when upstream gave us a
// validated FoxyResponse. Mirrors the shape in src/app/api/foxy/route.ts
// around line 1859 (`...(structured ? { structured } : {})`).
function makeFoxyJsonResponse(opts: {
  structured?: unknown;
  response?: string;
  sessionId?: string;
}) {
  return {
    success: true,
    response: opts.response ?? 'Photosynthesis is plants making food from sunlight.',
    sources: [],
    sessionId: opts.sessionId ?? 'test-session-structured-1',
    quotaRemaining: 10,
    tokensUsed: 320,
    groundingStatus: 'grounded',
    confidence: 0.92,
    traceId: 'trace-structured-1',
    groundedFromChunks: true,
    citationsCount: 0,
    ...(opts.structured ? { structured: opts.structured } : {}),
  };
}

// Helper: install the structured-payload mocks (POST + GET round-trip) on a
// page. The POST returns the supplied structured payload; the subsequent
// GET (history reload) returns the same payload as a persisted assistant
// row. We force JSON (no SSE) by asserting `Content-Type: application/json`
// — the page's stream handler falls back to the JSON path when the response
// is not `text/event-stream`, so the renderer-swap logic still fires.
async function installFoxyMocks(
  page: Page,
  opts: {
    structuredOnPost?: unknown;
    structuredOnGet?: unknown;
    plainResponse?: string;
    sessionId?: string;
  } = {},
): Promise<void> {
  const sessionId = opts.sessionId ?? 'test-session-structured-1';

  // POST /api/foxy — returns a single tutor turn.
  await page.route('**/api/foxy', async (route) => {
    if (route.request().method() === 'POST') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(
          makeFoxyJsonResponse({
            structured: opts.structuredOnPost,
            response: opts.plainResponse,
            sessionId,
          }),
        ),
      });
      return;
    }
    // GET /api/foxy?sessionId=… — returns history including a persisted
    // structured row. The page reads `structured` JSONB straight from the
    // foxy_chat_messages select; we mirror that shape exactly.
    if (route.request().method() === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          session: {
            id: sessionId,
            subject: 'science',
            grade: '9',
            chapter: null,
            mode: 'learn',
            created_at: new Date().toISOString(),
          },
          messages: [
            {
              id: 'msg-user-1',
              role: 'user',
              content: 'What is photosynthesis?',
              structured: null,
              tokens_used: null,
              created_at: new Date(Date.now() - 1000).toISOString(),
            },
            {
              id: 'msg-tutor-1',
              role: 'assistant',
              content:
                opts.plainResponse ??
                'Photosynthesis is plants making food from sunlight.',
              structured: opts.structuredOnGet ?? opts.structuredOnPost ?? null,
              tokens_used: 320,
              created_at: new Date().toISOString(),
            },
          ],
        }),
      });
      return;
    }
    await route.continue();
  });

  // The page also reads `foxy_sessions` and `foxy_chat_messages` directly via
  // the supabase client (fetchRecentSession / fetchConversationById). To make
  // the round-trip assertion DB-independent in the mocked path, we short-
  // circuit those reads to "no recent session" so the page treats the POST
  // as a fresh turn. The GET-driven reload is then satisfied by the
  // /api/foxy GET route above.
  await page.route('**/rest/v1/foxy_sessions**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([]),
    });
  });
  await page.route('**/rest/v1/foxy_chat_messages**', async (route) => {
    // Empty history on the direct DB read; the POST drives the live render,
    // and the GET-route mock drives the reload assertion.
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([]),
    });
  });
}

// ── Smoke: auth path ─────────────────────────────────────────────────────────

test.describe('REG-55 smoke: foxy auth path', () => {
  test('smoke: real login lands on a post-auth route', async ({ page }) => {
    test.skip(
      !hasRealStudentCreds(),
      'requires TEST_STUDENT_EMAIL + TEST_STUDENT_PASSWORD secrets',
    );
    const ok = await loginViaUI(page);
    expect(ok).toBe(true);
    expect(page.url()).toMatch(/\/(dashboard|onboarding|foxy|learn|quiz)/);
  });

  test('smoke: authenticated /foxy is reachable', async ({ page }) => {
    test.skip(
      !hasRealStudentCreds(),
      'requires TEST_STUDENT_EMAIL + TEST_STUDENT_PASSWORD secrets',
    );
    await loginViaUI(page);
    await page.goto('/foxy');
    await page.waitForLoadState('domcontentloaded');
    expect(page.url()).not.toMatch(/\/login/);
  });
});

// ── Renderer round-trip ──────────────────────────────────────────────────────

test.describe('REG-55 Foxy Structured Rendering Round-Trip', () => {
  // ── Test 1: POST → structured renderer paints visual blocks ──────────────
  test('renderer: POST with structured payload mounts FoxyStructuredRenderer', async ({
    page,
  }) => {
    test.fixme(
      true, // gated behind real creds (cannot drive ChatInput without authenticated session)
      'requires TEST_STUDENT_EMAIL/PASSWORD in CI to send a message via ChatInput. ' +
        'Mocked-session fallback cannot drive the foxy chat composer because ' +
        'AuthContext checks several nested SDK calls (allowed-subjects service, ' +
        'topic mastery, chat usage) that the mocks do not fully cover. ' +
        'See TODO at bottom of file for fixture wiring.',
    );

    await mockStudentSession(page, { onboardingCompleted: true });
    await installFoxyMocks(page, { structuredOnPost: STRUCTURED_FIXTURE });

    if (hasRealStudentCreds()) await loginViaUI(page);

    await page.goto('/foxy?subject=science&grade=9');
    await page.waitForLoadState('domcontentloaded');

    // Drive the chat composer.
    const input = page.locator('textarea, input[placeholder*="ask" i]').first();
    await input.fill('What is photosynthesis?');
    await page.keyboard.press('Enter');

    // Renderer assertion: the structured-renderer wrapper must mount.
    // FoxyStructuredRenderer.tsx sets `data-testid="foxy-structured-renderer"`.
    await expect(
      page.getByTestId('foxy-structured-renderer').first(),
    ).toBeVisible({ timeout: 15_000 });

    // Each block's text content must paint as a real DOM node, not as raw JSON.
    await expect(
      page.getByText(STRUCTURED_PAYLOAD_TEXT_MARKERS.definitionText).first(),
    ).toBeVisible();
    await expect(
      page.getByText(STRUCTURED_PAYLOAD_TEXT_MARKERS.answerText).first(),
    ).toBeVisible();
    await expect(
      page.getByText(STRUCTURED_PAYLOAD_TEXT_MARKERS.examTipText).first(),
    ).toBeVisible();

    // Negative: the bubble must NOT contain the literal JSON serialisation.
    // If the structured renderer never mounted and the page fell through to
    // the legacy markdown path (rendering the JSON-as-text), the assertion
    // below would surface that regression.
    const rawJsonNeedle = '"type":"definition"';
    await expect(page.getByText(rawJsonNeedle)).toHaveCount(0);
  });

  // ── Test 2: DB round-trip — history reload paints the same structured ────
  test('renderer: history reload paints structured payload from persisted JSONB', async ({
    page,
  }) => {
    test.fixme(
      true,
      'requires TEST_STUDENT_EMAIL/PASSWORD + a stable foxy_sessions/foxy_chat_messages ' +
        'row to do a true DB round-trip. The mocked GET path here exercises the renderer ' +
        'contract (GET response shape carries `structured` field), but a real DB row is ' +
        'needed to validate the persistence column itself.',
    );

    await mockStudentSession(page, { onboardingCompleted: true });
    await installFoxyMocks(page, {
      structuredOnPost: STRUCTURED_FIXTURE,
      structuredOnGet: STRUCTURED_FIXTURE,
      sessionId: 'test-session-roundtrip-1',
    });

    if (hasRealStudentCreds()) await loginViaUI(page);

    // First visit: render via POST.
    await page.goto('/foxy?subject=science&grade=9');
    await page.waitForLoadState('domcontentloaded');

    const input = page.locator('textarea, input[placeholder*="ask" i]').first();
    await input.fill('What is photosynthesis?');
    await page.keyboard.press('Enter');

    await expect(
      page.getByTestId('foxy-structured-renderer').first(),
    ).toBeVisible({ timeout: 15_000 });

    // Reload — this clears the in-memory message list and forces the page
    // to load history from the GET endpoint. The mocked GET returns the
    // same structured payload as a persisted assistant row.
    await page.reload();
    await page.waitForLoadState('domcontentloaded');

    // Renderer must mount AGAIN, this time driven by the GET history load.
    // The text content must be identical to the POST-driven render — proving
    // the persistence column → renderer chain is intact.
    await expect(
      page.getByTestId('foxy-structured-renderer').first(),
    ).toBeVisible({ timeout: 15_000 });
    await expect(
      page.getByText(STRUCTURED_PAYLOAD_TEXT_MARKERS.answerText).first(),
    ).toBeVisible();
  });

  // ── Test 3: Bilingual chrome flip (P7) ───────────────────────────────────
  test('renderer: chrome flips to Hindi when language=hi', async ({ page }) => {
    test.fixme(
      true,
      'requires real auth + ability to drive ChatInput. Same fixture-wiring blocker ' +
        'as test 1. Pre-seeds localStorage with alfanumrik_language=hi so AuthContext ' +
        'picks up the Hindi setting on hydrate.',
    );

    // Pre-seed Hindi BEFORE the page loads — AuthContext reads
    // localStorage.getItem('alfanumrik_language') in its hydrate effect.
    await page.addInitScript(() => {
      try {
        window.localStorage.setItem('alfanumrik_language', 'hi');
      } catch {
        /* noop */
      }
    });

    await mockStudentSession(page, { onboardingCompleted: true });
    await installFoxyMocks(page, { structuredOnPost: STRUCTURED_FIXTURE_HI });

    if (hasRealStudentCreds()) await loginViaUI(page);

    await page.goto('/foxy?subject=science&grade=9');
    await page.waitForLoadState('domcontentloaded');

    const input = page.locator('textarea, input[placeholder*="ask" i]').first();
    await input.fill('प्रकाश संश्लेषण क्या है?');
    await page.keyboard.press('Enter');

    await expect(
      page.getByTestId('foxy-structured-renderer').first(),
    ).toBeVisible({ timeout: 15_000 });

    // Chrome strings flip: AnswerBlock heading is "उत्तर" (not "Answer"),
    // DefinitionBlock heading is "परिभाषा" (not "Definition").
    // We accept *either* heading appearing — the structured fixture has a
    // definition block (rendered with chrome.definition) and an answer block
    // (rendered with chrome.answer). One of these MUST surface; if both are
    // English, the bilingual contract is broken.
    const hindiAnswer = page.getByText('उत्तर', { exact: true });
    const hindiDefinition = page.getByText('परिभाषा', { exact: true });
    const hindiVisible = await Promise.race([
      hindiAnswer
        .first()
        .waitFor({ state: 'visible', timeout: 5000 })
        .then(() => 'answer'),
      hindiDefinition
        .first()
        .waitFor({ state: 'visible', timeout: 5000 })
        .then(() => 'definition'),
    ]).catch(() => null);
    expect(hindiVisible).not.toBeNull();

    // Negative: English chrome must NOT appear. We assert exact match so we
    // don't catch the word "Answer" appearing inside a block.text body.
    await expect(page.getByText('Answer', { exact: true })).toHaveCount(0);
    await expect(page.getByText('Definition', { exact: true })).toHaveCount(0);
  });

  // ── Test 4: Negative — no structured field falls back to RichContent ─────
  test('renderer: missing structured field falls back to legacy markdown', async ({
    page,
  }) => {
    test.fixme(
      true,
      'requires real auth to drive ChatInput. Asserts the renderer-swap discriminator ' +
        '(`isFoxyResponse`) returns false for legacy responses and the bubble routes ' +
        'through RichContent / markdown. This is the kill-switch / pre-migration / ' +
        'abstain path — must remain functional during gradual rollout.',
    );

    await mockStudentSession(page, { onboardingCompleted: true });
    await installFoxyMocks(page, {
      // No structuredOnPost / structuredOnGet → response carries only `response`.
      plainResponse:
        'Photosynthesis is the process where plants make their own food using sunlight, water, and carbon dioxide. The output is glucose plus oxygen.',
    });

    if (hasRealStudentCreds()) await loginViaUI(page);

    await page.goto('/foxy?subject=science&grade=9');
    await page.waitForLoadState('domcontentloaded');

    const input = page.locator('textarea, input[placeholder*="ask" i]').first();
    await input.fill('What is photosynthesis?');
    await page.keyboard.press('Enter');

    // The legacy markdown text must paint.
    await expect(
      page.getByText(/Photosynthesis is the process/i).first(),
    ).toBeVisible({ timeout: 15_000 });

    // The structured renderer wrapper must NOT mount (no structured payload
    // means the discriminator returns false and the bubble keeps RichContent).
    await expect(page.getByTestId('foxy-structured-renderer')).toHaveCount(0);
  });

  // ── Test 5: Defense-in-depth — malformed structured drops to legacy ──────
  test('renderer: malformed structured payload does NOT mount the structured renderer', async ({
    page,
  }) => {
    test.fixme(
      true,
      'requires real auth to drive ChatInput. Defends against a malformed payload ' +
        'slipping past `extractValidatedStructured` on the server (defense-in-depth, ' +
        'see route.ts:225-235). The page-side `isFoxyResponse` predicate must drop ' +
        'the bad payload and route through the legacy markdown renderer.',
    );

    await mockStudentSession(page, { onboardingCompleted: true });

    // Malformed: missing required `blocks` array. Should fail isFoxyResponse
    // shape check on the page even if the server somehow forwarded it.
    const malformed = {
      title: 'Photosynthesis',
      subject: 'science',
      // blocks: missing
    };
    await installFoxyMocks(page, {
      structuredOnPost: malformed,
      plainResponse: 'Photosynthesis explanation falls through to legacy markdown.',
    });

    if (hasRealStudentCreds()) await loginViaUI(page);

    await page.goto('/foxy?subject=science&grade=9');
    await page.waitForLoadState('domcontentloaded');

    const input = page.locator('textarea, input[placeholder*="ask" i]').first();
    await input.fill('What is photosynthesis?');
    await page.keyboard.press('Enter');

    // Legacy markdown takes over.
    await expect(
      page.getByText(/falls through to legacy markdown/i).first(),
    ).toBeVisible({ timeout: 15_000 });

    // Structured renderer must NOT mount — malformed payload fails the
    // isFoxyResponse discriminator on the client.
    await expect(page.getByTestId('foxy-structured-renderer')).toHaveCount(0);
  });

  /* ────────────────────────────────────────────────────────────────────────
   * TODO: wire a real test-student fixture so the test.fixme blocks above
   * can be removed. Required pieces (matches REG-45 TODO):
   *   1. CI secrets: TEST_STUDENT_EMAIL, TEST_STUDENT_PASSWORD pointing to
   *      a stable account in the staging Supabase project.
   *   2. Account state: onboarding_completed=true, grade='9', board='CBSE',
   *      preferred_subject='science', preferred_language toggleable per
   *      test (or use the language toggle UI).
   *   3. Daily Foxy quota reset nightly so test 1 doesn't hit the rate
   *      limit on repeat CI runs. Alternatively, gate the FAQ rate limiter
   *      behind a NODE_ENV=test bypass.
   *   4. Optional: a debug query param `?reset_foxy_session=1` (gated to
   *      staging env only) so test 2 starts each run with a clean session
   *      table for the fixture user.
   *   5. The DB round-trip in test 2 currently mocks the GET endpoint. Once
   *      the fixture is wired, replace `installFoxyMocks(...)` for that
   *      test with a true write-then-read against staging foxy_chat_messages
   *      and assert on the persisted `structured` JSONB column directly.
   * Owner: testing agent. Tracked as REG-55 candidate.
   * Hardens: REG-50 (single-retrieval contract for Foxy) by extending its
   *          assertion surface to include the structured payload shape.
   * ──────────────────────────────────────────────────────────────────────── */
});
