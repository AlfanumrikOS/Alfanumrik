# Synthetic Monitor — Eval Set as Product Spec

**Started:** 2026-05-11 (audit §0 closed-loop plan)
**Owner:** ops + quality (no single agent — this is a forcing function)
**Schedule:** every 15 min via [.github/workflows/synthetic-monitor.yml](../../.github/workflows/synthetic-monitor.yml)
**Spec:** [e2e/synthetic/prod-health.spec.ts](../../e2e/synthetic/prod-health.spec.ts)

## What this is

The closest thing Alfanumrik has to a continuously-running quality agent. A
small Playwright spec runs against `https://alfanumrik.com` every 15 minutes
and asserts a list of facts that **must remain true** for the app to be
considered healthy. When any assertion fails:

1. The GitHub Actions run goes red.
2. Trace + screenshot artefacts are uploaded for inspection (14-day retention).
3. If `SYNTHETIC_MONITOR_SLACK_WEBHOOK` is configured, an alert posts to Slack.
4. (Phase 2) The watchdog agent will eventually triage the failure — classify
   it (theme / RBAC / dead-route / contrast / Hindi-leak / handler), grep
   `git log` over recent changes, and open a tagged issue with the suspect
   commit.

## The eval set is the spec

Each test in `prod-health.spec.ts` is an **eval row**. The fixture file is
the product spec: if there's no row, there's no spec, and there's nothing
to detect.

> **Convention:** every closed bug ticket adds a new row here.

This makes the spec grow with experience. Bugs caught by users become
permanent rows that lock the fix in place. The spec ratchets: green stays
green. This is Karpathy's "data > code" applied to product reliability —
the fixture is the product contract, and the codebase is just one
implementation of it.

## Anatomy of a row

Each row is one Playwright `test()` block with:

| Field | What |
|---|---|
| **URL** | The path under test (`/welcome`, `/dashboard`, etc.) |
| **Viewport** | desktop 1366×768, Android mid 412×915, Pixel 5 (device emulation), etc. |
| **Theme** | `page.emulateMedia({ colorScheme: 'light' \| 'dark' })` |
| **Language** | `en` default; future: pre-set `localStorage.alfanumrik_language='hi'` for Hindi rows |
| **Auth** | Public by default; authenticated rows skip unless `SYNTHETIC_AUTH_EMAIL`+`SYNTHETIC_AUTH_PASSWORD` are set |
| **Assertion** | One or more `expect(...)` calls that encode the user-visible contract |
| **Audit ref** | A comment pointing back to the finding in `docs/superpowers/specs/2026-05-11-improvement-audit-roadmap-design.md` §0 if the row is anchored to an audit finding |

## Adding a new row when a bug ships

1. The bug is fixed in code.
2. Before closing the issue, add a Playwright row in `prod-health.spec.ts`
   that would have caught the bug **before deploy**.
3. Run the row locally against your fix — it should pass.
4. Run it against the previous production HEAD — it should fail (this proves
   the row actually detects the regression class, not just the symptom).
5. Commit the row alongside the fix.
6. The 15-min monitor now permanently guards against this regression class.

## Row 1–9 (initial seed, 2026-05-11)

| # | Anchor | Surface | Asserts |
|---|---|---|---|
| 1 | smoke | /welcome desktop light | No console / page errors on load |
| 2 | §0 F2 | /welcome desktop dark | body[data-theme] never leaks `"dark"` outside acceptable owner |
| 3 | §0 F3 | /welcome | `<html lang>` matches expected default ("en" unauthenticated) |
| 4 | smoke | /welcome Android mid | Primary CTA renders above the fold |
| 5 | smoke | /login | Email + password inputs visible; no 5xx |
| 6 | §0 F1 | /welcome | `<meta name="color-scheme" content="light">` present |
| 7 | §0 F4 | /dashboard (auth) | Quick Actions accordion has `open` attribute on first paint |
| 8 | §0 F4 | /dashboard (auth) | Clicking Quiz tile navigates to `/quiz` |
| 9 | smoke | /welcome Pixel 5 | No horizontal overflow; primary CTA above fold |

## What's NOT covered yet (Phase 1+ rows to add)

- **Hindi parity.** Every row should have a sibling row with `isHi=true` set
  in `localStorage('alfanumrik_language', 'hi')` before navigation. P7
  invariant is `no-coverage` per the constitution; rows here close that gap.
- **Slow-3G network throttle.** Tier II/III network reality. Per row that
  asserts above-the-fold visibility, add a Slow-3G variant.
- **Visual regression.** Pixel-diff against committed baselines. The
  artefact directory `e2e/synthetic/baselines/` will hold first-paint
  screenshots committed alongside their row.
- **Contrast assertions.** For `/dashboard` Quick Actions tiles, compute
  the contrast ratio of tile background vs page background and assert
  ≥ 3:1 (WCAG AA non-text). Stops the F4 contrast regression from sliding.
- **RBAC.** Log in as teacher / parent / admin in turn; assert each sees
  the buttons their role should see, and does NOT see buttons gated to
  other roles.
- **Lighthouse a11y per page.** Run Lighthouse against the top 10 user
  surfaces; alert when score drops below a per-surface threshold.

## Cost guard

GitHub Actions on a private repo gives 2,000 minutes/month free on the
Pro plan. At ~2 min per run × 4 runs/hour × 24 hours × 30 days = ~5,760
minutes/month. **Above free tier.** Either:

- Move to a self-hosted runner (free of GH minute caps).
- Drop the cadence to every 30 min (~2,880 min/month — comfortably free).
- Pay overage (~$0.008/min) — about $30/month for the full 15-min cadence.

Recommended at audit time: drop to **every 30 min** until the watchdog
classifier proves itself, then re-evaluate.
