import { redirect } from 'next/navigation';

/**
 * /upgrade — the paywall destination.
 *
 * WHY THIS FILE EXISTS (R7, 2026-08-11): `/upgrade` had no page, no redirect
 * and no rewrite, so every tap on a locked mock-test paper 404'd — on the
 * monetisation path. The repo's own internal-link canary
 * (`apps/host/src/__tests__/internal-href-route-resolution.test.ts`) had it
 * parked in `KNOWN_DEAD_LINKS`, which is why it survived.
 *
 * WHY A ROUTE RATHER THAN REPOINTING THE CALL SITES: `/upgrade` is not only a
 * frontend href. The API emits it as data —
 * `apps/host/src/app/api/exams/papers/[id]/route.ts` and
 * `.../[id]/submit/route.ts` both return `{ error: 'competition_plan_required',
 * upgrade_url: '/upgrade' }`, pinned by `exams-papers.test.ts` /
 * `exams-submit.test.ts` — and the Flutter app consumes the same contract.
 * Rewriting the five web hrefs would have left the server-supplied URL, and any
 * already-published link, still dead. Making the URL real fixes every caller at
 * once and changes no API response shape.
 *
 * Plans, prices and the checkout flow all live on /pricing (backend owns the
 * Razorpay path); this is a redirect, not a second pricing surface, so there is
 * exactly one place where price copy can drift.
 *
 * Server component + `redirect()` — no client JS, no loading/empty/error state
 * to render (it never paints), and no bundle cost on the paywall path.
 */
export default function UpgradePage() {
  redirect('/pricing');
}
