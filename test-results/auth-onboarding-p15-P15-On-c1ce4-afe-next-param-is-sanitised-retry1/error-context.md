# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: auth-onboarding-p15.spec.ts >> P15: Onboarding Integrity >> F: /auth/confirm token_hash flow >> /auth/confirm open redirect prevention: unsafe next param is sanitised
- Location: e2e\auth-onboarding-p15.spec.ts:458:9

# Error details

```
Error: expect(received).not.toContain(expected) // indexOf

Expected substring: not "evil.com"
Received string:        "http://localhost:3000/auth/confirm?token_hash=bad&type=signup&next=//evil.com"
```

# Test source

```ts
  363 | 
  364 |       expect(acceptableRedirect).toBe(true);
  365 | 
  366 |       // Body must have content (not a blank page)
  367 |       const bodyText = await page.locator('body').textContent();
  368 |       expect(bodyText).toBeTruthy();
  369 |       expect((bodyText ?? '').length).toBeGreaterThan(0);
  370 |     });
  371 | 
  372 |     test('/auth/callback page itself does not crash on load (no 500)', async ({ request }) => {
  373 |       // The route handler must not return 500 for any input — it should always
  374 |       // redirect. Check via direct HTTP request (no browser needed).
  375 |       const response = await request.get('/auth/callback');
  376 |       // Must redirect (3xx) or succeed (2xx) — never 500
  377 |       expect(response.status()).toBeLessThan(500);
  378 |     });
  379 | 
  380 |     test('/auth/callback with type=signup and no code redirects to login', async ({ page }) => {
  381 |       await page.goto('/auth/callback?type=signup');
  382 |       await page.waitForURL(/\/(login|welcome)/, { timeout: 10_000 });
  383 |       expect(page.url()).toMatch(/\/(login|welcome)/);
  384 |     });
  385 | 
  386 |     test('/auth/callback with type=recovery and no code redirects to login', async ({ page }) => {
  387 |       await page.goto('/auth/callback?type=recovery');
  388 |       await page.waitForURL(/\/(login|welcome)/, { timeout: 10_000 });
  389 |       expect(page.url()).toMatch(/\/(login|welcome)/);
  390 |     });
  391 | 
  392 |     test('/auth/callback open redirect prevention: unsafe next param is ignored', async ({ page }) => {
  393 |       // The route sanitises the `next` param — an open redirect attempt must not
  394 |       // result in the user being redirected to an external domain.
  395 |       await page.goto('/auth/callback?code=invalid-code&next=//evil.com/phish');
  396 |       await page.waitForLoadState('networkidle');
  397 | 
  398 |       const url = page.url();
  399 |       expect(url).not.toContain('evil.com');
  400 |     });
  401 | 
  402 |   });
  403 | 
  404 |   // ── F. /auth/confirm token_hash flow ────────────────────────────────────
  405 | 
  406 |   test.describe('F: /auth/confirm token_hash flow', () => {
  407 | 
  408 |     test('/auth/confirm without token_hash redirects to /login', async ({ page }) => {
  409 |       // No token_hash means there is nothing to verify — must redirect to login.
  410 |       await page.goto('/auth/confirm');
  411 |       await page.waitForURL(/\/(login|welcome)/, { timeout: 10_000 });
  412 |       const url = page.url();
  413 |       expect(url.includes('/login') || url.includes('/welcome')).toBe(true);
  414 |     });
  415 | 
  416 |     test('/auth/confirm without type redirects to /login', async ({ page }) => {
  417 |       // token_hash present but no type — incomplete link, must redirect to login.
  418 |       await page.goto('/auth/confirm?token_hash=some-hash-value');
  419 |       await page.waitForURL(/\/(login|welcome)/, { timeout: 10_000 });
  420 |       const url = page.url();
  421 |       expect(url.includes('/login') || url.includes('/welcome')).toBe(true);
  422 |     });
  423 | 
  424 |     test('/auth/confirm with invalid token_hash redirects to /login with error', async ({ page }) => {
  425 |       // An invalid token_hash fails OTP verification — must redirect to login
  426 |       // with the verification_failed error, never a 500.
  427 |       await page.goto('/auth/confirm?token_hash=invalid-hash-for-testing&type=signup');
  428 |       await page.waitForLoadState('networkidle');
  429 | 
  430 |       const url = page.url();
  431 |       const acceptableRedirect =
  432 |         url.includes('/login') ||
  433 |         url.includes('/welcome') ||
  434 |         url.includes('/dashboard') ||
  435 |         url.includes('/onboarding') ||
  436 |         url.includes('/teacher') ||
  437 |         url.includes('/parent');
  438 | 
  439 |       expect(acceptableRedirect).toBe(true);
  440 | 
  441 |       const bodyText = await page.locator('body').textContent();
  442 |       expect(bodyText).toBeTruthy();
  443 |       expect((bodyText ?? '').length).toBeGreaterThan(0);
  444 |     });
  445 | 
  446 |     test('/auth/confirm page itself does not crash on load (no 500)', async ({ request }) => {
  447 |       // Route must not return 500 for any input.
  448 |       const response = await request.get('/auth/confirm');
  449 |       expect(response.status()).toBeLessThan(500);
  450 |     });
  451 | 
  452 |     test('/auth/confirm with type=recovery and no token_hash redirects to /login', async ({ page }) => {
  453 |       await page.goto('/auth/confirm?type=recovery');
  454 |       await page.waitForURL(/\/(login|welcome)/, { timeout: 10_000 });
  455 |       expect(page.url()).toMatch(/\/(login|welcome)/);
  456 |     });
  457 | 
  458 |     test('/auth/confirm open redirect prevention: unsafe next param is sanitised', async ({ page }) => {
  459 |       await page.goto('/auth/confirm?token_hash=bad&type=signup&next=//evil.com');
  460 |       await page.waitForLoadState('networkidle');
  461 | 
  462 |       const url = page.url();
> 463 |       expect(url).not.toContain('evil.com');
      |                       ^ Error: expect(received).not.toContain(expected) // indexOf
  464 |     });
  465 | 
  466 |     test('/auth/confirm absolute URL in next param is reduced to path only', async ({ page }) => {
  467 |       // The confirm route parses absolute redirect_to URLs and uses only the
  468 |       // path portion — prevents open redirect via absolute URL in next param.
  469 |       await page.goto(
  470 |         '/auth/confirm?token_hash=bad&type=signup&next=' +
  471 |         encodeURIComponent('https://evil.com/steal?data=1')
  472 |       );
  473 |       await page.waitForLoadState('networkidle');
  474 | 
  475 |       const url = page.url();
  476 |       expect(url).not.toContain('evil.com');
  477 |     });
  478 | 
  479 |   });
  480 | 
  481 |   // ── Additional P15 guard: /onboarding access for unauthenticated users ────
  482 | 
  483 |   test.describe('P15: /onboarding access controls', () => {
  484 | 
  485 |     test('/onboarding redirects unauthenticated users away from the page', async ({ page }) => {
  486 |       // Without a session AuthContext calls router.replace('/').
  487 |       // The user must end up somewhere other than stuck on a broken onboarding page.
  488 |       await page.goto('/onboarding');
  489 |       await page.waitForLoadState('networkidle');
  490 | 
  491 |       const url = page.url();
  492 |       // Must not be an empty broken onboarding page
  493 |       const bodyText = await page.locator('body').textContent();
  494 |       expect((bodyText ?? '').trim().length).toBeGreaterThan(0);
  495 | 
  496 |       // Acceptable: redirected to /, /welcome, /login
  497 |       // Also acceptable: the page shows the loading spinner (isLoading=true)
  498 |       // before redirect fires — it will not stay that way.
  499 |       // What is NOT acceptable: a JS error that leaves the page unusable.
  500 |       const hasJsError = await page.locator('text=Application error').isVisible().catch(() => false);
  501 |       expect(hasJsError).toBe(false);
  502 |     });
  503 | 
  504 |     test('/onboarding shows loading state before redirect (not a blank page)', async ({ page }) => {
  505 |       // The component returns <LoadingFoxy /> while isLoading=true.
  506 |       // Even if it transitions quickly, the page must not flash an empty body.
  507 |       let wasEverBlank = false;
  508 |       page.on('load', async () => {
  509 |         const text = await page.locator('body').textContent().catch(() => '');
  510 |         if ((text ?? '').trim().length === 0) wasEverBlank = true;
  511 |       });
  512 | 
  513 |       await page.goto('/onboarding');
  514 |       await page.waitForLoadState('domcontentloaded');
  515 |       // Give React time to hydrate
  516 |       await page.waitForTimeout(500);
  517 | 
  518 |       expect(wasEverBlank).toBe(false);
  519 |     });
  520 | 
  521 |   });
  522 | 
  523 | });
  524 | 
```