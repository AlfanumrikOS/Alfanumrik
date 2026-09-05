import { test, expect } from '@playwright/test';
import {
  loginViaDevImpersonate,
  discoverNavTargets,
  walkRoute,
  formatLedger,
  ROLE_DESTINATION,
  type WalkResult,
} from './helpers/surface';

/**
 * Authenticated surface walk — the launch-readiness ledger.
 *
 * Why this exists: `navigation.spec.ts` crawls unauthenticated pages plus a
 * MOCKED student session. Nothing in the suite has ever walked teacher,
 * parent, school-admin or super-admin with a real session, which is why no
 * authenticated journey in this product had been verified by anyone before
 * 2026-09-05.
 *
 * This spec walks every nav-reachable route per role with a REAL Supabase
 * session (via /dev/impersonate) and emits a per-route ledger. It is a
 * reporting harness first and a gate second: one broken route must not hide
 * the other 140, so results are aggregated and asserted at the end.
 *
 * ── Scope limits, deliberate ──────────────────────────────────────────────
 * 1. Runs ONLY against a local dev server. /dev/impersonate 404s whenever
 *    NODE_ENV or VERCEL_ENV is 'production', which includes every Vercel
 *    build (Next sets NODE_ENV=production even for previews). Each block
 *    skips itself if impersonation is unavailable.
 * 2. Ten Edge-Function-backed pages CANNOT pass here and are excluded below.
 *    Deployed functions run ENVIRONMENT=production, so
 *    supabase/functions/_shared/cors.ts excludes http://localhost:3000 and the
 *    browser blocks the preflight. That is correct security posture — these
 *    are production-only tests. See LAUNCH_BLOCKERS.md P2-26.
 *
 * Run: npx playwright test e2e/surface-walk.spec.ts --project=chromium
 */

/**
 * Pages whose primary data comes from a Supabase Edge Function called directly
 * from the browser. Unreachable from localhost by CORS design — excluded here
 * and tracked as production-only verification.
 */
const EDGE_FUNCTION_BACKED = new Set([
  '/teacher/classes',
  '/teacher/students',
  '/teacher/attendance',
  '/teacher/grade-book',
  '/teacher/submissions',
  '/teacher/reports',
  '/parent/children',
  '/parent/attendance',
  '/parent/reports',
]);

/**
 * Explicit per-role route lists, transcribed from the real nav configs:
 *   student            packages/ui/src/navigation/nav-config.ts (CORE_TABS,
 *                      MORE_ITEMS, SIDEBAR_SECTIONS)
 *   parent             apps/host/src/app/parent/_components/ParentShell.tsx
 *   teacher            apps/host/src/app/teacher/_components/TeacherShell.tsx
 *   institution_admin  apps/host/src/app/school-admin/_components/ConsolidatedSchoolNav.tsx
 *
 * DOM discovery is deliberately NOT the source of truth: the student nav
 * renders <button> + router.push, not <a href>, so a link crawl finds only 2
 * anchors on /dashboard. Discovery still runs and is unioned in, so a newly
 * added anchor-based nav item is picked up for free.
 */
const ROLE_ROUTES: Record<string, string[]> = {
  student: [
    '/dashboard', '/today', '/practice', '/quiz', '/foxy', '/progress', '/learn',
    '/library', '/leaderboard', '/memory', '/notifications', '/profile', '/reports',
    '/assignments', '/pyq', '/revision', '/exams', '/exams/mock', '/exam-prep',
    '/refresh', '/challenge', '/stem-centre', '/dive', '/dive/history', '/synthesis',
    '/diagnostic', '/scan', '/settings', '/billing', '/support', '/me', '/tests',
  ],
  parent: [
    '/parent', '/parent/children', '/parent/calendar', '/parent/messages',
    '/parent/notifications', '/parent/reports', '/parent/attendance',
    '/parent/billing', '/parent/support', '/parent/profile', '/parent/consent',
  ],
  teacher: [
    '/teacher', '/teacher/classes', '/teacher/students', '/teacher/attendance',
    '/teacher/assignments', '/teacher/grade-book', '/teacher/submissions',
    '/teacher/worksheets', '/teacher/reports', '/teacher/lab-leaderboard',
    '/teacher/messages', '/teacher/profile',
  ],
  institution_admin: [
    '/school-admin', '/school-admin/students', '/school-admin/teachers',
    '/school-admin/parents', '/school-admin/enroll', '/school-admin/invite-codes',
    '/school-admin/staff', '/school-admin/rbac', '/school-admin/ai-assistant',
    '/school-admin/classes', '/school-admin/exams', '/school-admin/content',
    '/school-admin/reports', '/school-admin/reports-depth',
    '/school-admin/announcements', '/school-admin/escalations',
    '/school-admin/billing', '/school-admin/branding', '/school-admin/modules',
    '/school-admin/ai-config', '/school-admin/api-keys', '/school-admin/audit-log',
    '/school-admin/setup',
    // The six legacy-bookmark redirect stubs — each must 302, never 404.
    '/school-admin/overview', '/school-admin/people', '/school-admin/academics',
    '/school-admin/insights', '/school-admin/governance', '/school-admin/settings',
  ],
};

const PUBLIC_ROUTES = [
  '/welcome',
  '/login',
  '/pricing',
  '/product',
  '/for-schools',
  '/for-parents',
  '/for-teachers',
  '/demo',
  '/contact',
  '/help',
  '/about',
  '/careers',
  '/press',
  '/research',
  '/privacy',
  '/terms',
  '/refunds',
  '/security',
];

const ledger: WalkResult[] = [];

test.afterAll(() => {
  if (ledger.length) console.log(formatLedger(ledger));
});

test.describe('Surface walk — authenticated, per role', () => {
  for (const role of ['student', 'institution_admin', 'teacher', 'parent'] as const) {
    test(`${role}: every nav-reachable route renders content`, async ({ browser }) => {
      test.setTimeout(1_800_000);

      let context = await browser.newContext();
      let page = await context.newPage();
      // Playwright's actionTimeout defaults to 0 (infinite). Without this a
      // single busy page stalls the entire walk instead of failing one route.
      page.setDefaultTimeout(30_000);

      const ok = await loginViaDevImpersonate(page, role);
      test.skip(
        !ok,
        `/dev/impersonate unavailable for ${role} — expected against a deployed build (NODE_ENV=production 404s it); run against a local dev server`,
      );

      await page.goto(ROLE_DESTINATION[role]).catch(() => {});

      // Discovery is a supplement, not the source of truth — see ROLE_ROUTES.
      const discovered = await discoverNavTargets(page).catch(() => [] as string[]);
      const targets = Array.from(new Set([...(ROLE_ROUTES[role] ?? []), ...discovered]))
        .filter((r) => !EDGE_FUNCTION_BACKED.has(r))
        .filter((r) => r === ROLE_DESTINATION[role] || !r.startsWith('/logout'))
        .sort();

      expect(targets.length, `no routes to walk for ${role}`).toBeGreaterThan(0);

      const rows: WalkResult[] = [];
      console.log(`[${role}] walking ${targets.length} routes`);
      for (const path of targets) {
        let row = await walkRoute(page, path, role);

        // A renderer crash poisons the page for every later route, which would
        // report 30 false failures. Rebuild the session once and retry.
        if (row.verdict === 'ERROR' && /crash|Target closed|has been closed/i.test(row.detail)) {
          await context.close().catch(() => {});
          context = await browser.newContext();
          page = await context.newPage();
          page.setDefaultTimeout(30_000);
          if (await loginViaDevImpersonate(page, role)) {
            row = await walkRoute(page, path, role);
          }
        }
        console.log(`[${role}] ${row.verdict.padEnd(9)} ${row.route}${row.detail ? '  :: ' + row.detail.slice(0, 90) : ''}`);
        rows.push(row);
      }
      await context.close().catch(() => {});
      ledger.push(...rows);

      const broken = rows.filter((r) => r.verdict !== 'PASS');
      expect(
        broken,
        `${role}: ${broken.length}/${rows.length} routes failed —\n${broken
          .map((b) => `  ${b.route} [${b.verdict}] ${b.detail}`)
          .join('\n')}`,
      ).toEqual([]);
    });
  }

  test('public: marketing and auth funnel render content', async ({ page }) => {
    test.setTimeout(300_000);
    const rows: WalkResult[] = [];
    for (const path of PUBLIC_ROUTES) {
      rows.push(await walkRoute(page, path, 'public'));
    }
    ledger.push(...rows);

    const broken = rows.filter((r) => r.verdict !== 'PASS');
    expect(
      broken,
      `public: ${broken.length}/${rows.length} routes failed —\n${broken
        .map((b) => `  ${b.route} [${b.verdict}] ${b.detail}`)
        .join('\n')}`,
    ).toEqual([]);
  });
});
