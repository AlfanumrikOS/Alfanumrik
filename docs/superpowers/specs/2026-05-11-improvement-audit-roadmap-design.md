# Alfanumrik Improvement Audit + Roadmap

**Date:** 2026-05-11
**Author:** Audit run via orchestrator (Claude Opus 4.7, 1M context)
**Audit canonical:** `C:\Users\Bharangpur Primary\Alfanumrik\` (per memory note: OneDrive copy is stale)
**Scope:** 5 axes — accuracy, performance + cost, scalability, code quality, UX (Tier II/III)
**Depth:** Standard (sampled ~30 files; full inventory of weak spots with file-and-line evidence)

> **AMENDMENT 2026-05-11 (post user feedback):** Original audit was long-arc. User reported broken UI shipping past the 10-agent system. New §0 ("Production QA findings + closed-loop monitor") added below the original TL;DR; original priorities pushed down. Karpathy framing: **the loop isn't closed because nothing runs between user prompts.** Phase 0 = synthetic monitor + 6 root-cause fixes that unblock most "visibility issues across application" complaints.

---

## §0 — Production QA Findings (AMENDED 2026-05-11)

### TL;DR

The user reports: landing page visibility broken in dark mode; broken buttons across the app; quick-action shortcuts don't work; 10 existing agents catch none of it. The root cause is not 10 separate bugs — it's **one architectural truth** with several downstream symptoms.

**Root cause: Alfanumrik does not have a dark mode.** Only `src/components/landing-v2/welcome-v2.module.css` implements dark theme tokens. The rest of the app's design tokens (`--bg`, `--surface-*`, `--text-*`, `--border` in `src/app/globals.css`) are light-only. `tailwind.config.js` has no `darkMode:` setting. `grep -rc "dark:" src --include="*.tsx"` returns **zero** files using dark variants. But — `WelcomeV2.tsx:33` runs a bootstrap script that sets `document.body.setAttribute('data-theme', t)` from `prefers-color-scheme`, which leaks globally and persists across navigation. Users on system dark mode see: welcome page renders dark correctly → navigate to dashboard → app content stays light but body still carries `data-theme="dark"`, native form controls render dark, scrollbars render dark → broken hybrid. This is the "visibility issues across application" report.

**Why agents didn't catch it:** The 10 canonical agents are offline. They run only when prompted in a Claude Code session. They don't poll prod. They don't open a browser. `review-chain.sh` fires on file writes — not on rendered behaviour at a viewport × theme × language combination.

### P0 findings (root cause + immediate downstream)

**F1. Dark mode is missing from globals.css and Tailwind.**
- `src/app/globals.css` (798 lines): zero `prefers-color-scheme` blocks; `:root` defines a light-only Alfanumrik theme (`--bg: #FBF8F4`, `--surface-1: #FFFFFF`, etc.).
- `tailwind.config.js`: no `darkMode:` key; zero `dark:` variant usages in `.tsx` files (verified by grep).
- Only file with dark theme tokens: `src/components/landing-v2/welcome-v2.module.css` (~50+ dark selectors).
- `src/components/SimulationViewer.tsx:43` has its own one-off `@media (prefers-color-scheme: dark)` block.
- **Symptom:** App content stays light regardless of system theme. Welcome v2 renders dark — everything else stays light.

**F2. Welcome v2 leaks `data-theme` globally and never resets.**
- `src/components/landing-v2/WelcomeV2.tsx:33`: bootstrap script sets `document.body.setAttribute('data-theme', t)`. Body attribute persists across SPA navigation. No cleanup effect.
- **Symptom:** Body carries `data-theme="dark"` on every page after welcome — but only welcome's CSS module knows how to respond. Native controls and scrollbars (which respond to `prefers-color-scheme: dark` directly) render dark; app content stays light; visual mismatch.

**F3. Root layout hard-codes light values.**
- `src/app/layout.tsx:60`: `themeColor: '#FBF8F4'` — PWA/mobile browser status-bar colour permanently cream. Dark-mode users get a light status bar on a light or hybrid app.
- `src/app/layout.tsx:69`: `<html lang="en">` — fixed English regardless of `isHi`. P7 invariant violation. Screen readers, hreflang SEO, and browser-translate tools all misclassify Hindi content as English.
- `src/app/page.tsx:59`: spinner background `background: 'var(--bg, #FBF8F4)'` — fallback hex forces light even if the CSS var ever becomes dark-aware.
- No `<meta name="color-scheme">` tag → browsers activate dark for native chrome whenever `prefers-color-scheme: dark` is true.

**F4. Quick-Actions visibility + contrast issues.**
- `src/components/dashboard/sections/QuickActionsSection.tsx`: the 3 utility shortcuts (Scan / Profile / Billing) live inside the "Quick actions" accordion which is in the *below-the-fold* collapsed group on dashboard. Default-collapsed → users may never see them.
- Same file, lines 60–64: shortcut buttons use inline-style `background: ${s.color}10` (6% colour-alpha hex append) and `border: 1px solid ${s.color}25` (14%). On `--bg: #FBF8F4` cream, a green/blue/purple at 6% opacity is barely visible.
- Touch target `px-2 py-3`: ~24px horizontal × ~36px vertical. Apple HIG minimum is 44px; Material is 48px. Touch reliability is poor on low-end Android.
- Same colour scheme used by the 6 main `QuickActions.tsx` tiles via `<ActionTile>` (need to read `@/components/ui/ActionTile` to confirm but inline colours are passed through).
- **Symptom matches user report exactly:** "shortcuts in quick actions [not working]" — root cause is likely (a) accordion collapsed → invisible, and (b) low-contrast tiles → looks broken even when expanded.

### P1 findings (downstream / secondary)

**F5. RBAC permission cache is keyed by `userId` only, not `(userId, activeRole)`.**
- `src/lib/usePermissions.ts`: cache TTL 5 min, key by userId. Multi-role users switching role via `AuthContext.setActiveRole()` see stale permissions for up to 5 minutes — no `notifyPermissionsChanged()` invalidation in the role-swap path. Symptom: features appear/disappear inconsistently across tabs.
- Same file, lines ~124–129: on RPC fetch failure, falls back to `[activeRole || 'student']`. Transient network blip → teachers and admins silently see student-only UI until refresh.

**F6. `LEVEL_NAMES` is English-only — P7 violation.**
- `src/lib/xp-config.ts:88-99`: 10 level names (`Curious Cub` → `Grand Master`) hardcoded English. No Hindi twin. Used on dashboard, profile, level-up animations. Pattern is wrong-by-design vs. neighbouring `XP_REWARDS` (lines 110-161) which correctly does `name` + `nameHi`.
- Suggested translations (validated for register & grade-appropriateness): `जिज्ञासु शावक / तेज़ सीखने वाला / उदीयमान तारा / ज्ञान साधक / स्मार्ट लोमड़ी / प्रश्नोत्तरी चैंपियन / अध्ययन महारथी / दिमाग़ी निंजा / विद्वान लोमड़ी / महान मास्टर`.

**F7. Welcome A/B has v1 + v2 with divergent dark behaviour.**
- `src/app/welcome/page.tsx` selects between `WelcomeV1` (`page-v1.tsx`) and `WelcomeV2` based on `ff_welcome_v2` + per-anon rollout %. v1 unaudited for dark mode. Likely no dark handling at all. Bucket of users sees one version, bucket sees the other — symptoms differ.

### P2 findings (capability gaps that hide the above)

**F8. Two of four background audit agents crashed (autocompact thrashing) when given a broad-scope read across user-facing pages.** The agents themselves run out of context. Lesson for the agent system: each agent must have **narrow scope** (one file family, ≤200 file reads) or it will OOM mid-run and return nothing. The "10-agent auto-delegation system" doesn't enforce this — orchestrator currently delegates broad work that exceeds agent context.

**F9. The watchdog gap is the meta-bug.** Nothing renders the app and asserts assertions on the result every 15 min. No synthetic monitor. No visual regression. No Lighthouse a11y gate. Bugs F1–F4 should have been detectable on day one of dark mode being expected to work; they weren't because no robot ever opened the page.

---

## Phase 0 — Closed-Loop Plan (THIS WEEK, supersedes original Week 1)

Goal: **stop bleeding before refactoring.** Six small fixes ship today/tomorrow; the synthetic monitor ships by end-of-week and ensures no regression goes undetected longer than 15 min from this point forward.

### 0.1 — Six 1-line / 1-hour fixes (in priority order)

| # | File | Fix |
|---|---|---|
| 1 | `src/app/layout.tsx` (head) | Add `<meta name="color-scheme" content="light" />` until F1 is properly resolved. Stops the browser from dark-ifying native chrome / form controls on a light-only app. **Immediate user-visible improvement.** |
| 2 | `src/components/landing-v2/WelcomeV2.tsx:33` | Stop writing `data-theme` to `document.body`. Write only to the component's own root element. Removes the global theme leak. (Welcome v2 own dark mode keeps working; rest of app stops seeing residual `data-theme="dark"`.) |
| 3 | `src/app/layout.tsx:69` | Switch `<html lang="en">` to a client-set `lang` driven by `isHi` (`<html lang={isHi ? 'hi' : 'en'}>`). Requires moving `<html>` attribute setting into a client component or using `useEffect` on document.documentElement. |
| 4 | `src/app/layout.tsx:60` | `themeColor` to read from CSS var via Next 16's array form (per-theme entries) once real dark mode lands; **for now**, leave light. (Don't fix until F1 is fixed — would be misleading.) |
| 5 | `src/components/dashboard/page.tsx` Quick-Actions accordion | Set default-open OR move the shortcut tiles row OUT of the accordion (keep the bigger 6-tile grid inside). User-visible immediately. |
| 6 | `src/components/dashboard/sections/QuickActionsSection.tsx:60-72` | Replace inline-style `${s.color}10` / `${s.color}25` opacity hex with stronger values (`${s.color}25` for bg, `${s.color}55` for border) AND bump `text-[11px]` → `text-[13px]` AND increase padding `px-2 py-3` → `px-3 py-3.5` for a 44px min touch target. Tile becomes visible and tappable. |

**Total effort:** ~2 solo-founder hours for the code; ~0.5 day including test pass + manual verification across viewports.

### 0.2 — Synthetic monitor scaffold (Day 1–4)

**Day 1** — Playwright spec + GitHub Actions workflow. Creates:
- `e2e/synthetic/prod-health.spec.ts` — seeded with the 6 fixes above as initial eval rows. Each row tests a specific URL × viewport × language. (PROPOSAL ONLY; will not create until user OK.)
- `.github/workflows/synthetic-monitor.yml` — runs the spec every 15 min via `schedule: "*/15 * * * *"`; targets `https://alfanumrik.com`. On red, opens a GitHub issue + posts to Slack via webhook env var.
- `eval/synthetic/README.md` — documents the row schema and the convention: **every closed bug ticket must add a new row here.** The fixture file is the product spec.

**Initial eval rows (Day 1):**
1. `/welcome` at desktop 1366×768 dark-mode emulation → no console errors; key CTAs visible; body does NOT have `data-theme="dark"` lingering after navigation. (Tests F2 fix.)
2. `/welcome` at Android mid 412×915 → main CTA above the fold; no overflow-x.
3. `/dashboard` at desktop 1366×768 light + Hindi → all 6 quick-action tiles visible AND have computed contrast ≥ 3:1 vs. background. (Tests F4 fix.)
4. `/dashboard` at Android mid → shortcut row visible without expanding any accordion. (Tests F4 accordion fix.)
5. `/dashboard` at Android mid → tapping each of 6 quick-action tiles navigates to a real page (not 404, not stays on dashboard). (Tests handler integrity.)
6. `/dashboard` → after page render, level name shown in Hindi when `isHi=true` is set in localStorage. (Tests F6 fix.)
7. `/quiz`, `/foxy`, `/learn`, `/scan`, `/exams`, `/review` → each renders without 500 / client error in console. (Smoke baseline.)
8. HTML `<html lang>` attribute matches the active language. (Tests F3 fix.)

**Day 2** — Screenshot artefact on every failure. First baselines committed to `e2e/synthetic/baselines/`.

**Day 3** — Hindi parity rows + Tier-II/III network throttle (Slow 3G profile) for at least 3 rows.

**Day 4** — `eval/synthetic/README.md` documents the row-add convention. Every closed bug → new row. Memory of incidents becomes runnable.

### 0.3 — Phase 1 (Weeks 2–3): real dark mode

1. Add dark CSS variables to `src/app/globals.css` under both `[data-theme="dark"]` and `@media (prefers-color-scheme: dark)`. Define dark counterparts for `--bg`, `--surface-1..3`, `--text-1..3`, `--border*`. Contrast-check each against text token.
2. Set `darkMode: 'class'` in `tailwind.config.js`. Switch from media-based default to explicit class so we control toggling.
3. Add a `ThemeProvider` (or extend `AuthContext`) that writes `data-theme` to `document.documentElement` (not body — body is where welcome leaked it).
4. Sweep components for inline-style hex colours; replace with CSS-var tokens (`var(--text-2)` not `#4A3F2E`).
5. Per-page audit in both themes, both languages, three viewports. Eval rows added for each surface visited.
6. Remove the Phase 0 `<meta color-scheme="light">` once dark mode passes the eval.

### 0.4 — Phase 2 (Week 4): watchdog agent

Build the 11th agent — narrow scope: when synthetic monitor goes red, agent fetches the failing screenshot, runs `git log` over files changed in the last 24h, classifies failure category (theme / RBAC / dead-route / contrast / Hindi-leak / handler), opens a triage GitHub issue tagged with suspect commit. Not a fixer — a triager. Auto-fix waits until 30+ days of clean classifier data.

---

## Honest Limits of This Audit

- I read 30 files in canonical; total source files is 753. Sampling bias possible.
- Two of four background audit agents crashed on autocompact — partial coverage for RBAC UI gates and bilingual page-by-page. Findings F5 and F6 are evidenced; broader sweeps deferred to the synthetic monitor + Phase 1 audit pass.
- I did NOT open a browser. All findings are static-analysis. Visual issues like contrast ratios are computed mentally from hex values, not measured. The synthetic monitor's first job is to validate or falsify each finding empirically.
- I did NOT audit super-admin, internal-admin, parent portal, or teacher portal in detail — same depth concession as the original audit's "What I Did NOT Audit" section.

---

3. **Bundle: lazy-init Supabase auth.** `scripts/check-bundle-size.mjs` comments flag `@supabase/*` (~55 kB gzipped) as the highest-impact target — loaded by every page because root-layout `AuthContext` pulls it. Splitting `AuthContext` into a client-only boundary used only by `/(authed)` group saves ~55 kB on public marketing pages AND ~55 kB from shared first-paint. Already scoped in script TODO, not yet implemented. **~1 day.**

---

## Updated Ground Truth (vs constitution at 2026-04-27)

Differences observed while auditing canonical on 2026-05-11. Constitution should be updated as the first action.

| Area | Constitution says | Reality 2026-05-11 |
|---|---|---|
| Edge functions | 29 | 40 (`account-purge`, `alert-deliverer`, `bulk-non-mcq-gen`, `bulk-question-gen`, `coverage-audit`, `grade-experiment-conclusion`, `grounded-answer`, `identity`, `invoice-generator`, `monthly-synthesis-builder`, `nep-compliance`, `verify-question-bank`, `whatsapp-notify`, `send-pre-debit-notice`, `send-renewal-reminder` newly present) |
| `foxy-tutor/` edge fn | Active prod | DEPRECATED header in file; replaced by `src/app/api/foxy/route.ts` using new orchestration layer. "API route is primary, Edge Function is fallback." |
| AI orchestration | Not described | `src/lib/ai/` with `agents/`, `clients/`, `prompts/`, `retrieval/`, `tools/`, `tracing/`, `validation/`, `workflows/` (7 workflow modules) |
| Planner-loop agents | Not described | Substrate landed PR #683; first agent (`qb_fixer`) landed PR #686 |
| Bundle "shared JS" | < 175 kB temporary, baseline 160 kB | Real first-paint shared is ~225 kB (Supabase auth ~55 kB pulled by every page); interim cap raised to 270 kB in script |
| `src/middleware.ts` | "Middleware < 120 kB" (P10) | **Not found at canonical.** Bundle script parses `.next/server/middleware.js` for chunk refs; the file existence at source level is unverified. P10 gate may be silently passing. |
| Tests | "2,511 tests, 84 files" | Matches |
| Regression catalog | 35/35 target | Matches |

---

## Per-Axis Findings

### 1. Accuracy

**Strong:**
- `eval/rag/` harness with proper fixtures (`grade-6-science.json`, `grade-9-math.json`, `grade-10-science.json`, `out-of-scope.json`) — 8 query-type taxonomy (recall, conceptual, application, compare-contrast, chapter-specific, multi-step, ambiguous, boundary), `forbidden_phrases` and `abstain_phrase` checks, in-scope vs out-of-scope pass-rate split, p95 latency tracked, CI workflow at `.github/workflows/rag-eval.yml`, gate at 0.80 threshold (tightenable via `RAG_EVAL_THRESHOLD`).
- Quiz oracle live in prod (migration `20260504100000_enable_quiz_oracle_in_prod.sql`); REG-54 catalog entry; deterministic + LLM-grader gate before `question_bank` insert.
- Marking-authenticity forensic view (`marking_audit_last_30d`) shipped 2026-05-04; REG-56..REG-64 batch shipped same day.
- 35/35 regression catalog target reached.
- `_shared/quiz-oracle.ts` + `_shared/quiz-oracle-prompts.ts` give edge functions a shared validation surface.

**Gaps (in priority order):**
- **Foxy pedagogy not evaluated.** Only retrieval is graded. No measurement of Socratic patterns, hint pacing, step-back in homework mode, "never change factual answer under pressure" rule from `foxy-tutor/index.ts` changelog. Foxy is also the **highest-churn area in the repo right now** — 6 of the last 10 commits are Foxy grounding/mode/intent fixes (PRs #688, #690, #691, #692, #693, #694, plus #4ae25a84). Active churn without eval coverage = bug regressions waiting to happen.
- **ncert-solver has no eval harness.** Step-correctness of generated solutions is not measured.
- **quiz-generator drift is invisible.** Oracle gates at insert-time only. No continuous eval against a frozen gold-set means slow distribution drift goes undetected until students complain.
- **cme-engine recommendations not evaluated.** Quality of personalised practice picks is not measured.
- **P12 "age-appropriate" + "CBSE scope" have no rubric.** Constitution says it's enforced; nothing measures it.

**Solo-founder fix shape (~5 days):**
- Clone `eval/rag/` to `eval/foxy/` with fixture for doubt-solve mode first (~2 days). Same JSON schema. Add CI workflow.
- `eval/ncert-solver/` with step-by-step solution fixtures (~1 day).
- Weekly `eval/quiz-generator/` against frozen gold-set (~1 day) — wire into `daily-cron` or new weekly cron.
- `eval/cme-engine/` recommendation eval (~1 day) — define "good rec" rubric first.

### 2. Performance + Cost

**Strong:**
- `scripts/check-bundle-size.mjs` honest about real first-paint cost. Comments identify exact highest-leverage targets (`@supabase/*` at chunk `0umrmss-c34-s.js`, ~55 kB; Razorpay/PostHog bootstrap at `006tc66tmcr_-.js`).
- `next.config.js` `experimental.optimizePackageImports` for 13 heavy packages (`@sentry/nextjs`, `@supabase/supabase-js`, `@supabase/ssr`, `react-markdown`, `remark-*`, `rehype-katex`, `swr`, `zod`, `clsx`, `tailwind-merge`, etc.).
- Foxy circuit breaker (5-failure threshold, 60s reset) in `supabase/functions/foxy-tutor/index.ts:111-`.
- Cache headers per page family: 60s + 5min SWR on `/(dashboard|foxy|quiz|progress|review|study-plan|leaderboard|simulations|profile|notifications|reports|scan|exams|help)`.
- Sentry tunnel `/monitoring` + PostHog reverse-proxy `/ingest/*` for ad-blocker resilience.
- AVIF/WebP image formats.

**Gaps (in priority order):**
- **No Anthropic prompt caching markers visible.** System prompts in `src/lib/ai/prompts/` (`foxy-system.ts`, `ncert-solver.ts`, `parent-report.ts`, `quiz-gen.ts`, etc.) are static and reusable — prime candidates for `cache_control: { type: 'ephemeral' }`. Could cut input tokens 60-90% per turn at scale. Confirm in `src/lib/ai/clients/` before assuming gap.
- **@supabase auth on every page** (~55 kB gzipped). Already in bundle-script TODO. Highest leverage of any single change.
- **No model routing.** ARCHITECTURE.md says all AI edge functions use Claude Haiku. For complex doubts (multi-step derivations, ≥grade-10 physics), Sonnet quality is materially better; for simple lookups Haiku is correct. No router visible. Cost + quality joint optimization unrealised.
- **No per-turn token + cost telemetry.** Sentry transactions could carry input/output token counts and estimated cost as tags. Not visible. Without this, cost-by-feature and cost-per-active-student are unknown.

**Solo-founder fix shape (~1 week):**
- ~1 day: lazy-init `@supabase/*` via AuthContext split (overlaps with §4 cognitive-engine work).
- ~0.5 day: audit `src/lib/ai/clients/` for prompt caching; add `cache_control` markers; measure cache hit rate via response headers.
- ~1 day: add token + cost tags to Sentry transactions; emit PostHog event per AI turn.
- ~2 days: model router prototype — gate on `ff_model_router_v1` flag, route by (subject, grade, mode) tuple; run head-to-head eval (Haiku vs Sonnet on doubt-solve fixtures) before flipping flag.

### 3. Scalability

**Strong:**
- 440+ RLS policies (per constitution; reasonable assumption given migration density).
- Atomic RPCs: `atomic_quiz_profile_update`, `activate_subscription`, `atomic_subscription_activation`, `atomic_plan_change`.
- `pg_advisory_xact_lock` keyed by student_id in payment-critical paths.
- Quiz idempotency key migration shipped 2026-05-04 (`20260504100200_quiz_idempotency_key.sql`).
- Server-only quiz submit flag migration (`20260504100300_server_only_quiz_submit_flag.sql`) — locks down client-side manipulation.
- Connection pool plan: 200 pooled (Supavisor) × 50ms avg query → 4K queries/sec theoretical capacity; ARCHITECTURE target is 5K students.

**Gaps (in priority order):**
- **`src/middleware.ts` not located at canonical** despite P10 "Middleware < 120 kB" budget. Bundle script (`scripts/check-bundle-size.mjs`) parses `.next/server/middleware.js` for `R.c("...")` chunk refs — meaning the build emits a middleware, but the source-level file is unverified. Either (a) it lives at non-default path, (b) it's been removed and budget is stale, or (c) my search missed it. Either way the P10 gate state is unknown. **Verify first action.**
- **Supabase advisors not on a schedule.** Index drift, unused indexes, RLS-with-no-policy, security definer mismatches accumulate silently. No automation visible in `daily-cron` or as separate scheduled function.
- **Load test artifacts not found.** ARCHITECTURE says "load testing scripts" — not located in `scripts/` or repo root sample. May exist but un-versioned.
- **Rate limiter multi-instance behavior unverified.** OneDrive CLAUDE.md mentions "in-memory fallback" when Upstash Redis is unreachable. Multiple Vercel instances split traffic; in-memory rate limiting per-instance = effective rate × N instances. At low scale fine; at 5K concurrent on Pro plan with auto-scaling, becomes a hole.

**Solo-founder fix shape (~3-4 days):**
- ~0.5 day: locate / recreate `src/middleware.ts` or update P10 to reflect reality.
- ~0.5 day: schedule `supabase advisors` query weekly via existing `daily-cron` Edge Function; post results to `super-admin/health` page or email.
- ~1 day: k6 or artillery load test against staging — 1000 virtual users for 10 min on quiz submit / foxy chat / dashboard / login funnel.
- ~1 day: verify rate-limit semantics under simulated multi-instance (just run two `next dev` instances pointed at same Upstash); document fallback risk in `docs/runbooks/`.

### 4. Code Quality

**Strong:**
- ESLint with custom `eslint-plugin-alfanumrik` + AI-boundary config (`.eslintrc.ai-boundary.json`) + config-parity script (`scripts/check-config-parity.sh`). `npm run lint:ai-boundary` enforces edge-function-vs-app-code separation.
- Coverage thresholds enforced per critical file: `xp-rules` 90%, `cognitive-engine` 80%, `exam-engine` 80%, global 60%.
- 84 test files, 2511 tests, 35/35 regression catalog target reached.
- 4 enforcement hooks (`guard.sh` 9 blocking rules, `bash-guard.sh`, `review-chain.sh` for 20 file patterns, `post-edit-check.sh`).
- `xp-rules.ts → xp-config.ts` migration done cleanly via thin re-export shim with documented rationale.
- `vitest.config.ts` separates integration tests (live-DB) from PR-CI tests cleanly via `RUN_INTEGRATION_TESTS=1` env flag.

**Gaps (in priority order):**
- **`src/lib/cognitive-engine.ts` is 1,644 lines.** Too large for one file. Hard to hold in context, harder to test edge cases, slow review chain. P14 mandates that several agents review every change to it — decomposition would speed every future change. Target: split into ~4 modules (mastery-calc / BKT-update / IRT-update / gap-detection or similar), each < 500 lines.
- **`src/lib/AuthContext.tsx` is 567 lines.** Borderline. Bundle work (§2) needs it split anyway into client-only boundary — combine the two.
- **P7 (Bilingual UI) is no-coverage** per constitution regression table. No test enforces Hi/En parity on critical surfaces (quiz, foxy, dashboard, signup). 174+ `isHi`/`nameHi`/`descriptionHi` usages exist in components — coverage is broad in code but ungated.
- **P15 (Onboarding Integrity) is tested-only.** `auth-callback-role-redirect.test.ts` exists; no 3-role E2E covering full signup→verify→profile→dashboard funnel for student / teacher / parent. P15 is "the #1 user acquisition path" per constitution — gate gap.

**Solo-founder fix shape (~1 week):**
- ~3 days: decompose `cognitive-engine.ts`. Tests updated. Per-module coverage threshold ≥ 80%.
- ~1 day: split `AuthContext.tsx` into `AuthProvider` (state) and `/(authed)/AuthClientBoundary` (Supabase auth-client lazy load) — same change unlocks bundle drop from §2.
- ~1 day: P7 parity Playwright spec — visits 5 critical surfaces with `isHi=true`, asserts no English-only strings on first paint or after first interaction.
- ~1 day: 3-role onboarding E2E covering P15 funnel.

### 5. UX (Tier II/III learners)

**Strong:**
- Bilingual support broad in component layer (≥174 `isHi`/`nameHi`/`descriptionHi` hits in just 15 sampled files).
- Hindi names + descriptions in XP rewards catalog (`xp-config.ts:115-160`) — strong model: bilingual at the data layer, not just translation lookup.
- Service worker + SWR + offline queue + PWA manifest, all targeting flaky Indian 4G networks.
- Foxy `language: "en" | "hi" | "hinglish"` parameter wired through (`supabase/functions/foxy-tutor/index.ts:32`). Hinglish (mixed script) is a known Tier III usage pattern.
- Image optimization (AVIF/WebP) for bandwidth.
- Cache headers tuned for repeat visits.

**Gaps (in priority order):**
- **P7 no-coverage** (covered in §4).
- **Hinglish quality unmeasured.** Foxy supports `language: "hinglish"`. No fixture in `eval/rag/` covers mixed-script queries. Is the AI consistent on Devanagari/Latin mix? Does the output match the input register? Unknown.
- **No accessibility audit on record.** Lighthouse a11y score per page unknown.
- **No low-end device telemetry.** PostHog SDK present (`posthog-js`) — device class / RAM tier / network type not visibly captured as event properties.
- **Cultural fit of level names unverified.** "Curious Cub" / "Quick Learner" / "Smart Fox" / "Brain Ninja" are translated where rewards-catalog descriptions are bilingual, but level names in `xp-config.ts:88-99` are English-only. Tier II/III students may not parse them.

**Solo-founder fix shape (~1 week):**
- (P7 parity covered in §4)
- ~1 day: add 10 Hinglish fixtures to `eval/rag/fixtures/hinglish.json`. Score for register consistency.
- ~1 day: Lighthouse a11y audit on top 10 student-facing pages (`/dashboard`, `/foxy`, `/quiz`, `/learn`, `/progress`, `/leaderboard`, `/exams`, `/simulations`, `/onboarding`, `/login`). Fix top 3 issues per page.
- ~1 day: instrument PostHog event for `language_toggle_used` + per-event property `region` (from IP geo); after 2 weeks, quantify Hindi adoption by tier.
- ~1 day: bilingual level names — add `LEVEL_NAMES_HI` to `xp-config.ts`, wire to UI. Trivial change, real UX win for Hindi users.
- ~0.5 day: low-end Android pass — borrow / use a real <4GB Android device, navigate the 5 critical surfaces, file findings.

---

## 8-Week Solo-Founder Roadmap

Sized in solo-founder days per memory note. Each week is ~3-4 net working days assuming context-switching, ops triage, and customer support overhead. Items within a week are sequenced; weeks are sequenced.

### Week 1 — Foundations (P0 alignment)
- **Day 1**: Reconcile `.claude/CLAUDE.md` with current state (29 → 40 edge fns, `src/lib/ai/` orchestration, planner-loop, deprecated `foxy-tutor` edge fn, bundle reality).
- **Day 2**: Locate / recreate `src/middleware.ts`; if removed, update P10 budget; confirm bundle gate enforcement.
- **Day 3**: Decision call — continue Foxy active churn or freeze + harden? If freeze: schedule Foxy red-team eval pass (week 2). If continue: add regression coverage as each fix lands.

### Week 2-3 — AI eval expansion (highest leverage)
- **Week 2 Day 1-2**: Clone `eval/rag/` to `eval/foxy/`; build doubt-solve mode fixtures (10-15 queries spanning recall/conceptual/multi-step/homework-mode-Socratic).
- **Week 2 Day 3**: `eval/foxy/` CI workflow; threshold 0.75 to start.
- **Week 2 Day 4**: `eval/ncert-solver/` — step-by-step correctness fixtures.
- **Week 3 Day 1**: Continuous quiz-generator eval — frozen gold-set, weekly via cron, drift alert.
- **Week 3 Day 2**: cme-engine eval — define "good rec" rubric, build fixtures.
- **Week 3 Day 3-4**: Buffer for findings from above. Likely surfaces 1-2 regressions that need same-day fix.

### Week 4 — Performance + cost
- **Day 1**: Split `AuthContext.tsx` into provider + client-only boundary; lazy-init Supabase auth-client; measure bundle drop.
- **Day 2**: Add Anthropic `cache_control: { type: 'ephemeral' }` markers to system prompts in `src/lib/ai/prompts/`; measure cache hit rate.
- **Day 3**: Token + cost telemetry → Sentry transaction tags + PostHog events; build cost-per-active-student rollup.
- **Day 4**: Model router prototype + head-to-head eval (Haiku vs Sonnet on doubt-solve fixtures); flag-gated.

### Week 5 — Code quality
- **Day 1-3**: Decompose `src/lib/cognitive-engine.ts` (1644 → ~4 × <500-line modules). Update tests. Per-module coverage ≥ 80%.
- **Day 4**: Buffer + post-decomposition test pass.

### Week 6 — Regression coverage
- **Day 1-2**: P7 bilingual parity Playwright spec covering 5 critical surfaces.
- **Day 3-4**: 3-role onboarding E2E (student / teacher / parent) covering P15.

### Week 7 — Scalability hardening
- **Day 1**: Weekly Supabase advisors automation; results to super-admin/health page or email.
- **Day 2-3**: k6 load test against staging — 1000 VU × 10 min on quiz-submit, foxy-chat, dashboard, login. Document findings.
- **Day 4**: Rate-limit multi-instance verification; runbook entry.

### Week 8 — UX Tier II/III
- **Day 1**: Hinglish fixture set added to `eval/rag/`.
- **Day 2**: Lighthouse a11y audit + top fixes on 10 student-facing pages.
- **Day 3**: PostHog `language_toggle_used` + region tagging.
- **Day 4**: Bilingual level names. Low-end Android device pass.

---

## What I Did NOT Audit

These were out of scope for "standard depth" and could change the priority order if surfaced. They are explicit follow-ups for a future deeper audit.

- **Mobile app (`mobile/`)** — read no Flutter files. Mobile-web API contract sync (domain #32) is its own audit. The mobile app's view of XP / quiz / scoring should be reconciled against current canonical.
- **Migration SQL bodies** — sampled 20 recent migration filenames; did not read SQL. RLS coverage % is asserted by constitution at 440+, not independently verified.
- **Test bodies** — counted 84 test files; did not assess test quality, mock vs real coverage, or whether assertions actually fail when invariants break.
- **Edge function cold-start latency** — would need Supabase logs access.
- **Razorpay webhook actual replay behavior** — read the architecture, did not exercise.
- **CI workflow run history** — did not check flake rate, retry frequency, or longest-running jobs.
- **Connection pool actual usage** — 4K queries/sec capacity is theoretical; no prod telemetry observed.
- **`src/lib/ai/agents/agents/` (double-nested) and `src/lib/ai/tracing/`** — exist; not read. Planner-loop substrate (PR #683) is likely high-impact; should be a follow-up audit pass after the qb-fixer (PR #686) has been in prod 2-3 weeks.
- **Super-admin pages** — 43 pages, 75 routes; surface grew ~80% since prior reconciliation; un-sampled.
- **Historical question bank quality drift** — REG-54 oracle gates new entries; pre-oracle bank not audited for drift.
- **Parent / teacher portals** — sampled neither.
- **PostHog event taxonomy** — SDK is present; event names and properties not catalogued.

---

## Implementation Notes

This is an audit, not a feature spec. The next step after user review is **not** to invoke `writing-plans` for the whole roadmap — that would produce an unwieldy 8-week mega-plan. The right move:

1. User reviews this audit and confirms / re-orders priorities.
2. Pick **one sub-project** from Week 1 or Week 2.
3. Invoke `writing-plans` to spec that sub-project's implementation in detail.
4. Execute. Ship. Re-prioritise.
5. Repeat.

Auditing again at week 4 with this same doc as baseline is a reasonable cadence — re-measure each axis, compare deltas, surface new gaps.
