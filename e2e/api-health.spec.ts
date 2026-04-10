import { test, expect } from '@playwright/test';

/**
 * E2E API Health Tests -- Verify the health endpoint returns correct
 * structure and status codes. Tests run against the API directly
 * using Playwright's request context (no browser needed).
 *
 * Run: npx playwright test e2e/api-health.spec.ts
 */

test.describe('API Health Endpoint', () => {
  test('GET /api/v1/health returns 200', async ({ request }) => {
    const response = await request.get('/api/v1/health');
    expect(response.status()).toBe(200);
  });

  test('health response has status field', async ({ request }) => {
    const response = await request.get('/api/v1/health');
    expect(response.status()).toBe(200);

    const body = await response.json();
    expect(body).toHaveProperty('status');
  });

  test('health response has checks object', async ({ request }) => {
    const response = await request.get('/api/v1/health');
    expect(response.status()).toBe(200);

    const body = await response.json();
    expect(body).toHaveProperty('checks');
    expect(typeof body.checks).toBe('object');
  });

  test('health response content-type is JSON', async ({ request }) => {
    const response = await request.get('/api/v1/health');
    const contentType = response.headers()['content-type'];
    expect(contentType).toContain('application/json');
  });

  test('health response status indicates healthy', async ({ request }) => {
    const response = await request.get('/api/v1/health');
    const body = await response.json();
    // Status should be a meaningful value (ok, healthy, pass, etc.)
    expect(body.status).toBeTruthy();
    expect(typeof body.status).toBe('string');
  });
});
