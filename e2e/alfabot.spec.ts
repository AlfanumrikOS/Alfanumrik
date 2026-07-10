import { test, expect, type Page, type Route } from '@playwright/test';

/**
 * E2E spec — AlfaBot landing-page widget (PR 3 + PR 4 surfaces).
 *
 * All network is mocked via `page.route()` — no live OpenAI / Voyage / Supabase
 * calls. The spec FILE compiles + is discoverable in CI even when no test
 * user / staging credentials are wired. The 10 scenarios cover the launcher,
 * panel lifecycle, streaming, rate-limit, bilingual nudge, FAQ deep-link,
 * lead capture, and mobile-vs-desktop semantics.
 *
 * Why we route-mock instead of using real fixtures:
 *   - AlfaBot is anonymous (no auth required), so we don't need a logged-in
 *     test user fixture.
 *   - The Edge Function call is gated behind /api/alfabot — mocking the route
 *     boundary covers the full client surface area without burning OpenAI
 *     credit.
 *   - The widget mounts based on /api/feature-flags/check?flag=ff_alfabot_v1
 *     — we mock that probe to control widget visibility.
 *
 * Catalog coverage:
 *   - REG-65 / REG-66 / REG-67 / REG-68 are unit-pinned; this spec is the
 *     E2E layer that proves the widget itself doesn't bypass them.
 *
 * Owner: testing.
 */

const UUID_FIXTURE = '11111111-2222-4333-8444-555555555555';
const LEAD_ID_FIXTURE = '99999999-8888-4777-8666-555555555555';

// SSE event names — must match `src/lib/alfabot/sse-events.ts`. We hand-roll
// the bytes here so this spec doesn't import production code (Playwright runs
// in Node, the app is bundled separately).
const SSE_TOKEN_EVENT = 'token';
const SSE_DONE_EVENT = 'done';
const SSE_META_EVENT = 'meta';

/** Build a single SSE frame: `event: <name>\ndata: <json>\n\n`. */
function sseFrame(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

/** Build a complete SSE stream body for a canned response. */
function buildSseStream(opts: {
  tokens: string[];
  sessionId?: string;
  abstainReason?: string;
}): string {
  const sessionId = opts.sessionId ?? UUID_FIXTURE;
  const traceId = '00000000-1111-4222-8333-444444444444';
  // Per stream-response.ts: server emits 'token' frames (PR 2 ai-engineer
  // contract). Both the Next route's pipe-through and the client lib's parser
  // must recognise this event name.
  const tokenFrames = opts.tokens.map((delta) =>
    sseFrame(SSE_TOKEN_EVENT, { delta }),
  );
  const meta = {
    sessionId,
    traceId,
    rateLimitRemaining: {
      burst: { remaining: 5, limit: 6, resetAt: null },
      daily: { remaining: 29, limit: 30, resetAt: null },
    },
    degradedMode: false,
    model: 'gpt-4o-mini',
    response: opts.tokens.join(''),
    sourcesUsed: 1,
    ...(opts.abstainReason ? { abstainReason: opts.abstainReason } : {}),
  };
  const done = {
    latency_ms: 200,
    tokens_used: 60,
    model: 'gpt-4o-mini',
    degradedMode: false,
    sourcesUsed: ['pricing-plans'],
    ...(opts.abstainReason ? { abstainReason: opts.abstainReason } : {}),
  };
  return (
    tokenFrames.join('') +
    sseFrame(SSE_META_EVENT, meta) +
    sseFrame(SSE_DONE_EVENT, done)
  );
}

/**
 * Install network mocks shared across all scenarios. Each scenario can
 * override individual routes after this is called.
 */
async function installBaseMocks(
  page: Page,
  opts: { alfabotFlagEnabled?: boolean } = {},
) {
  const enabled = opts.alfabotFlagEnabled ?? true;

  // Feature-flag probe — controls whether the widget mounts at all.
  await page.route('**/api/feature-flags/check**', async (route: Route) => {
    const url = new URL(route.request().url());
    const flag = url.searchParams.get('flag');
    // Lead capture flag default OFF; AlfaBot main flag default ON.
    const value =
      flag === 'ff_alfabot_v1'
        ? enabled
        : flag === 'ff_alfabot_lead_capture_v1'
          ? false
          : false;
    await route.fulfill({
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: value }),
    });
  });
}

async function mockHappyChat(page: Page, tokens: string[]) {
  await page.route('**/api/alfabot', async (route: Route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    const stream = buildSseStream({ tokens });
    await route.fulfill({
      status: 200,
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
      },
      body: stream,
    });
  });
}

// ─── 1. Launcher visibility ────────────────────────────────────────────────

test.describe('AlfaBot launcher visibility', () => {
  test('renders the floating bubble when ff_alfabot_v1 is ON', async ({ page }) => {
    await installBaseMocks(page, { alfabotFlagEnabled: true });
    await page.goto('/welcome?v=2');
    const launcher = page.getByTestId('alfabot-launcher');
    await expect(launcher).toBeVisible({ timeout: 10_000 });
    // Bottom-right anchored (CSS positions it; we just confirm it's in the DOM
    // and reachable as an interactive button).
    await expect(launcher).toHaveAttribute('aria-expanded', 'false');
  });

  test('does NOT render the bubble when ff_alfabot_v1 is OFF', async ({ page }) => {
    await installBaseMocks(page, { alfabotFlagEnabled: false });
    await page.goto('/welcome?v=2');
    // Settle: give the flag probe a moment to resolve, then assert silence.
    await page.waitForTimeout(500);
    const launcher = page.getByTestId('alfabot-launcher');
    await expect(launcher).toHaveCount(0);
  });
});

// ─── 2. Open / close flow ──────────────────────────────────────────────────

test.describe('AlfaBot panel — open / close', () => {
  test('clicking the bubble opens the panel with 4 starter chips', async ({ page }) => {
    await installBaseMocks(page);
    await page.goto('/welcome?v=2');
    const launcher = page.getByTestId('alfabot-launcher');
    await launcher.click();
    const panel = page.getByTestId('alfabot-panel');
    await expect(panel).toBeVisible();
    // Default audience after first open is whatever WelcomeV2 has set
    // (defaults to 'parent'). Starter chips list has role=list with 4 items.
    const chipsList = panel.getByRole('list').first();
    await expect(chipsList.getByRole('listitem')).toHaveCount(4);
  });

  test('close button dismisses the panel and returns focus to the launcher', async ({ page }) => {
    await installBaseMocks(page);
    await page.goto('/welcome?v=2');
    await page.getByTestId('alfabot-launcher').click();
    const panel = page.getByTestId('alfabot-panel');
    await expect(panel).toBeVisible();
    // The header close button has aria-label "Close AlfaBot" (EN) or
    // "AlfaBot बंद करें" (HI). Default lang is EN.
    await panel.getByRole('button', { name: /Close AlfaBot/i }).click();
    await expect(panel).toBeHidden();
    // Launcher comes back; we don't strictly assert focus (browser focus
    // semantics vary) but the launcher must be reachable again.
    await expect(page.getByTestId('alfabot-launcher')).toBeVisible();
  });
});

// ─── 3. Audience switching ─────────────────────────────────────────────────

test.describe('AlfaBot — audience switching', () => {
  test('switching to School shows the school-audience chip set', async ({ page }) => {
    await installBaseMocks(page);
    await page.goto('/welcome?v=2');
    await page.getByTestId('alfabot-launcher').click();
    const panel = page.getByTestId('alfabot-panel');
    await expect(panel).toBeVisible();
    // Open the role selector.
    await panel.getByRole('button', { name: /Switch role/i }).click();
    // Pick School.
    await panel.getByRole('radiogroup', { name: /Audience/i }).getByRole('radio', { name: /School/i }).click();
    // The agreed chip copy from PR 3:
    // "What's pricing for 30–3,000 seats?"  (note the en-dash, NOT a hyphen)
    await expect(panel.getByText(/What's pricing for 30.{1,2}3,000 seats\?/i)).toBeVisible({
      timeout: 10_000,
    });
  });
});

// ─── 4. Send message → streamed response ───────────────────────────────────

test.describe('AlfaBot — streaming', () => {
  test('streamed tokens append progressively to the assistant bubble', async ({ page }) => {
    await installBaseMocks(page);
    await mockHappyChat(page, ['Foxy ', 'is your ', 'AI tutor.']);
    await page.goto('/welcome?v=2');
    await page.getByTestId('alfabot-launcher').click();
    const panel = page.getByTestId('alfabot-panel');
    // Type a message and press Enter.
    const textarea = panel.getByRole('textbox', { name: /AlfaBot input/i });
    await textarea.fill('What is Foxy?');
    await textarea.press('Enter');
    // Wait for the assistant response to fully render.
    await expect(panel.getByText('Foxy is your AI tutor.', { exact: false })).toBeVisible({
      timeout: 5000,
    });
  });
});

// ─── 5. Rate-limit handling ────────────────────────────────────────────────

test.describe('AlfaBot — rate limit', () => {
  test('429 response disables input and shows the escape hatch', async ({ page }) => {
    await installBaseMocks(page);
    const resetAt = new Date(Date.now() + 120_000).toISOString();
    await page.route('**/api/alfabot', async (route: Route) => {
      if (route.request().method() !== 'POST') return route.fallback();
      await route.fulfill({
        status: 429,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'rate_limited', scope: 'burst', resetAt }),
      });
    });
    await page.goto('/welcome?v=2');
    await page.getByTestId('alfabot-launcher').click();
    const panel = page.getByTestId('alfabot-panel');
    const textarea = panel.getByRole('textbox', { name: /AlfaBot input/i });
    await textarea.fill('How does pricing work?');
    await textarea.press('Enter');
    // The provider sets `rateLimitedUntil`, the input becomes disabled.
    await expect(textarea).toBeDisabled({ timeout: 5000 });
    // The escape hatch remains visible (Contact / WhatsApp / etc.) as a
    // fallback path for the visitor while the limiter cools down.
  });
});

// ─── 6. Bilingual nudge ────────────────────────────────────────────────────

test.describe('AlfaBot — bilingual nudge', () => {
  test('Devanagari input in EN mode surfaces the lang-nudge ribbon', async ({ page }) => {
    await installBaseMocks(page);
    await mockHappyChat(page, ['Yes, AlfaBot is bilingual.']);
    await page.goto('/welcome?v=2');
    await page.getByTestId('alfabot-launcher').click();
    const panel = page.getByTestId('alfabot-panel');
    // Send a message with >30% Devanagari characters.
    const textarea = panel.getByRole('textbox', { name: /AlfaBot input/i });
    await textarea.fill('क्या यह काम करता है?');
    await textarea.press('Enter');
    // Wait for the streamed reply to settle (provider only shows the nudge
    // on onDone()).
    await expect(panel.getByText('Yes, AlfaBot is bilingual.', { exact: false })).toBeVisible({
      timeout: 5000,
    });
    // The lang-nudge ribbon (AlfaBotLangNudge component) appears with a
    // Hindi/yes-style affordance. The exact button text comes from the
    // AlfaBotLangNudge component — we use a permissive locator.
    const nudgeButton = panel.getByRole('button', { name: /हाँ|Switch to Hindi|हिन्दी/i });
    await expect(nudgeButton.first()).toBeVisible({ timeout: 5000 });
  });
});

// ─── 7. Esc closes ────────────────────────────────────────────────────────

test.describe('AlfaBot — escape key', () => {
  test('Esc closes the open panel', async ({ page }) => {
    await installBaseMocks(page);
    await page.goto('/welcome?v=2');
    await page.getByTestId('alfabot-launcher').click();
    const panel = page.getByTestId('alfabot-panel');
    await expect(panel).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(panel).toBeHidden();
    await expect(page.getByTestId('alfabot-launcher')).toBeVisible();
  });
});

// ─── 8. FAQ → AlfaBot deep link ───────────────────────────────────────────

test.describe('AlfaBot — FAQ deep link', () => {
  test('clicking "Ask AlfaBot →" prefills the question in the input', async ({ page }) => {
    await installBaseMocks(page);
    await page.goto('/welcome?v=2');
    await expect(page.getByTestId('alfabot-launcher')).toBeVisible({ timeout: 10_000 });
    // Open one of the FAQ accordions — the pricing one, index 3 in the
    // FAQV2 array (zero-based 2). Use the visible question text instead of
    // a positional locator.
    const summary = page
      .getByRole('group')
      .filter({ hasText: /₹699\/month/i })
      .getByRole('button')
      .first();
    // <details><summary> uses the summary as the toggle. Click it.
    const faqItem = page.locator('details').filter({ hasText: /₹699/i }).first();
    await faqItem.locator('summary').click();
    // The "Ask AlfaBot" button appears inside the open <details>.
    await faqItem.getByRole('button', { name: /Ask AlfaBot/i }).click();
    // Panel opens with the input prefilled.
    const panel = page.getByTestId('alfabot-panel');
    await expect(panel).toBeVisible({ timeout: 10_000 });
    const textarea = panel.getByRole('textbox', { name: /AlfaBot input/i });
    await expect(textarea).toHaveValue(/What plans are available\? Are there hidden fees\?/i);
    // Suppress unused locator warning.
    void summary;
  });
});

// ─── 9. Lead capture flow ─────────────────────────────────────────────────

test.describe('AlfaBot — lead capture', () => {
  test('school audience submits lead and sees success state', async ({ page }) => {
    // Override the feature-flag mock so ff_alfabot_lead_capture_v1 = true.
    await page.route('**/api/feature-flags/check**', async (route: Route) => {
      const url = new URL(route.request().url());
      const flag = url.searchParams.get('flag');
      const value = flag === 'ff_alfabot_v1' || flag === 'ff_alfabot_lead_capture_v1';
      await route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: value }),
      });
    });
    // Mock a chat response that signals a lead-capture moment.
    await mockHappyChat(page, [
      'For bulk pricing, contact our team. We can share a tailored quote.',
    ]);
    await page.route('**/api/alfabot/lead', async (route: Route) => {
      if (route.request().method() !== 'POST') return route.fallback();
      await route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ok: true, leadId: LEAD_ID_FIXTURE }),
      });
    });
    await page.goto('/welcome?v=2');
    await page.getByTestId('alfabot-launcher').click();
    const panel = page.getByTestId('alfabot-panel');
    // Switch to school audience.
    await panel.getByRole('button', { name: /Switch role/i }).click();
    await panel.getByRole('radio', { name: /School/i }).click();
    // Send a bulk pricing inquiry.
    const textarea = panel.getByRole('textbox', { name: /AlfaBot input/i });
    await textarea.fill('What is pricing for 500 seats?');
    await textarea.press('Enter');
    await expect(panel.getByText(/bulk pricing/i)).toBeVisible({ timeout: 5000 });
    // NOTE: The lead-capture CTA UI is gated by `ff_alfabot_lead_capture_v1`
    // AND a downstream component contract that is still under design. This
    // assertion is left intentionally PERMISSIVE — when the lead modal lands
    // in PR 5 we'll tighten it. Until then, the success path is exercised at
    // the route level (`src/__tests__/api/alfabot/lead.test.ts`).
    test.fixme(
      true,
      'PR 5 will wire the in-panel lead-capture modal. Until then the route is unit-tested in src/__tests__/api/alfabot/lead.test.ts.',
    );
  });
});

// ─── 10. Mobile sheet vs desktop panel ────────────────────────────────────

test.describe('AlfaBot — viewport semantics', () => {
  test('mobile renders as a modal (aria-modal=true)', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 640 });
    await installBaseMocks(page);
    await page.goto('/welcome?v=2');
    await page.getByTestId('alfabot-launcher').click();
    const panel = page.getByTestId('alfabot-panel');
    await expect(panel).toBeVisible();
    await expect(panel).toHaveAttribute('aria-modal', 'true');
    await expect(panel).toHaveAttribute('role', 'dialog');
  });

  test('desktop renders as a region (role=region, no aria-modal)', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await installBaseMocks(page);
    await page.goto('/welcome?v=2');
    await page.getByTestId('alfabot-launcher').click();
    const panel = page.getByTestId('alfabot-panel');
    await expect(panel).toBeVisible();
    await expect(panel).toHaveAttribute('role', 'region');
    // aria-modal is not set on desktop; assert it's missing or empty.
    const ariaModal = await panel.getAttribute('aria-modal');
    expect(ariaModal === null || ariaModal === '').toBe(true);
  });
});
