# Performance Tuning Guide

# Alfanumrik AI Engineering Operating System (AEOS)

**Document Version:** 1.0
**AEOS Release:** v1.1
**Classification:** Operational Guide
**Priority:** High
**Applies To:** Concrete performance tuning of the live Alfanumrik web stack — Next.js 16 App Router on Vercel (bom1), SWR server state, Supabase Postgres + Edge Functions — covering bundle budgets, code-splitting, caching, asset optimization, query indexing, runtime choice, and CI performance gates.

---

# Purpose

The companion guide `optimization.md` teaches the measure -> profile -> change -> verify loop in the abstract. This guide is the stack-specific field manual: the exact levers an engineer pulls on the real Alfanumrik infrastructure, and the exact numbers and tools that govern them.

Core doc 18 (Performance Engineering) sets the principle — every surface declares a budget, and a breach is a defect. This guide names the budgets that already exist in this repo, the tools that measure them, and the concrete techniques that keep changes within them.

Every technique here is subordinate to the loop: never apply a tuning below without a baseline first and a re-measurement after. Tuning blind is not tuning.

---

# Next.js Bundle Budgets

The platform ships to users on Indian 4G (2-5 Mbps). Bundle weight is the dominant factor in time-to-interactive, so it is governed by hard, CI-enforced budgets (product invariant P10).

The authoritative gate is `scripts/check-bundle-size.mjs`. It measures **gzipped** sizes honestly — it scans the rendered HTML under `.next/server/app/*.html`, counts how many pages reference each chunk, and treats any chunk loaded by at least 95% of pages as first-paint shared cost. This catches root-layout chunks (notably `@supabase/*` pulled in via AuthContext) that the build manifest's `rootMainFiles` field omits.

The three caps the script enforces:

- **Shared first-load JS** — `CAP_SHARED_KB`, currently **282 kB** (interim). This is the honest layout-chunk-inclusive total. The P10 baseline target is 160 kB; the gap is almost entirely framework + `@supabase/*` first-load weight, tracked for reduction. Do not conflate this with the separate single-largest-shared-chunk metric (~160 kB), which is a different number in the same standard.
- **Per-page JS** — `CAP_PAGE_KB`, **260 kB**, measured as page-specific cost excluding shared chunks.
- **Middleware** — `CAP_MIDDLEWARE_KB`, **120 kB**, measured from the real chunks the Turbopack middleware stub references, not the ~221-byte stub itself.

A breach exits non-zero and fails the build. The author must bring the change within budget or obtain a recorded, justified cap revision — exactly as the script's own history of cap bumps documents (each with a dated, attributed reason). Treat a cap raise as a last resort, reserved for proven framework drift, never as a way to absorb application bloat.

To measure locally: run `npm run build`, then the bundle-size check. To find what is heavy: `npm run analyze` (ANALYZE=true build) produces the composition view.

---

# Code-Splitting and Lazy-Loading

The single most effective bundle lever is keeping weight off the first-paint path. A chunk that only some routes need must not be loaded by all of them.

Concrete techniques:

- **Dynamic import for heavy, non-critical components.** Use `next/dynamic` for anything large that is below the fold, behind an interaction, or route-specific — charting, rich editors, the Razorpay checkout SDK, simulation canvases. Verify after splitting that the chunk no longer appears in the shared set reported by the bundle script.
- **Keep third-party SDKs off first paint.** PostHog is already lazy-loaded; the Razorpay checkout SDK should load only on the billing and pricing routes, never globally. A vendor SDK in a shared chunk is a recurring source of P10 breaches.
- **Watch the root layout.** Anything imported into the App Router root layout becomes shared first-paint cost on every page. The largest standing example is `@supabase/*` (~57 kB) pulled in through AuthContext; splitting it behind a client-only boundary used only by authenticated routes is the highest-impact reduction target on record. Do not add new heavy imports to the layout without measuring the shared-total delta.
- **Server Components by default.** Code that does not need interactivity stays on the server and ships zero client JS. Reach for a client component only when the UI genuinely needs browser state or event handlers.

After any split, re-run the bundle check. A split that does not move the measured shared or page number did not actually split anything.

---

# SWR Caching Strategy

SWR is the platform's server-state layer. Used well, it eliminates the redundant requests and over-fetching that core 18 names as primary network anti-patterns; used carelessly, it serves stale or cross-user data.

Tuning levers:

- **Deduplication.** SWR coalesces identical concurrent requests within its dedup interval. Stable, consistent keys are what make this work — two components requesting the same data under the same key share one network call. Inconsistent keys defeat dedup and double the requests.
- **Explicit revalidation policy.** Decide per resource how fresh it must be. Frequently changing data (a live quiz queue) tolerates short intervals or focus revalidation; rarely changing reference data (subject lists, grade metadata) should use a long interval or revalidate-on-mount-only to avoid needless refetch churn.
- **Invalidation on mutation.** After a write, invalidate or mutate the affected key so the UI reflects truth without a blind refetch of everything. Every cache must declare how it is invalidated — an SWR key with no invalidation path is a future stale-data defect.
- **No private-data leakage.** A cache key must be scoped so one user's data can never be served to another. Per-user data belongs under a per-user key; never cache student-identifiable data under a shared key. This is both a performance rule and a P13 privacy boundary.
- **Select only what the screen renders.** Pair SWR with API responses and queries that return only the needed fields. Caching an over-fetched payload caches the waste.

---

# Image and Font Optimization

Assets are pure download weight on the critical path and a frequent, easily-fixed cost.

- **Images** use the Next.js `Image` component so they are served in modern formats at the rendered size, with lazy-loading below the fold and explicit dimensions to prevent layout shift. Never ship an oversized source asset to be scaled down in the browser — that pays full bytes for a fraction of the pixels.
- **Fonts** load through the framework's font pipeline so they are self-hosted, subset, and preloaded with a stable fallback to control layout shift. The brand fonts (Plus Jakarta Sans, Sora) should be subset to the glyph ranges actually used — including the Devanagari range required for the bilingual UI (P7) — rather than loading full families.
- **Respect cumulative layout shift.** Reserve space for images, fonts, and async content so the page does not jump as it loads. Layout shift is a measured budget in core 18, not a cosmetic concern.

---

# Supabase Query Tuning

Database time is frequently the dominant cost in a request and the least elastic resource, so it earns proportionate scrutiny.

**Indexing.** Every hot-path query is backed by an index. Index foreign-key columns and any column used in `WHERE`, `JOIN`, or `ORDER BY`. Ship the index in the same migration as the query pattern that needs it, with a measurable justification — an unjustified index is write-cost with no read benefit. Confirm the index is actually used by reading the query plan; an index the planner ignores is dead weight.

**N+1 avoidance.** The N+1 pattern — one query for a list, then one query per row — is the most common database performance failure. It is invisible on ten rows and catastrophic at production scale. Resolve it with a single batched query: use Supabase's nested selects / embedded resources to fetch related rows in one round trip, or a set-based query, never a query issued inside a loop over a result set. Monitor query counts during testing so an N+1 is caught before it ships.

**Over-fetching.** Select only the columns the consumer uses; avoid `SELECT *`. Return identifiers instead of full nested objects when that is all the caller needs. Compute aggregates (counts, sums) in the database rather than loading a whole collection to count it. Bound every list result with pagination or an explicit limit so a growing table cannot blow up a response.

**Transactions and RPCs.** Keep transactions short, deterministic, and isolated. The sanctioned home for transaction-atomic logic is the platform's documented RPCs (`atomic_quiz_profile_update`, `activate_subscription`, and peers) — these keep integrity invariants enforceable in a single round trip, which is also a latency win over multiple sequential statements. This is the exception that proves the rule; it is not license to push general business logic into SQL.

---

# Edge and Runtime Choices

Where code runs is a performance decision with real latency consequences.

- **Region.** The Vercel deployment is pinned to `bom1` (Mumbai) to keep compute close to Indian users and to the Supabase ap-south-1 region. Never remove `bom1` without an architecture review — it underpins both the P10 latency budget and DPDP data-locality alignment. Cross-region database round trips from a mislocated function are a silent, severe latency tax.
- **Function timeouts.** The deploy config sets deliberate `maxDuration` ceilings — 300 s for the long cron workers (`daily-cron`, `irt-calibrate`), 60 s for other cron, 30 s for general and auth API routes, 15 s for SSR pages. A synchronous call into a Supabase Edge Function from a Next.js route must respect the ~30 s route ceiling; the admin client deliberately fails fast at 10 s for the same reason. Work that cannot fit the budget belongs in a background worker, not on the request path.
- **Off-request heavy work.** AI generation, report building, embeddings, and notifications run as background jobs (cron workers, the queue consumer), not inline in a user request. Keeping heavy, variable-latency work off the request path is what protects the tail latency that users actually experience.
- **Server vs client execution.** Push computation and data access to the server where it ships no client JS and runs close to the database; reserve the client for genuine interactivity. This shrinks the bundle and shortens the data round trip at once.

---

# CI Performance-Regression Gates

Performance, once achieved, decays silently unless a gate defends it. Prevention is mechanical, not manual.

The CI pipeline runs the bundle-size check (`scripts/check-bundle-size.mjs`) after the build, and a breach of any cap — shared, per-page, or middleware — fails the build exactly like a failed test. There is no "warning to be ignored": a budget breach is a blocking gate.

Operating discipline around the gate:

- **The build must pass the gate before merge.** Bringing a change within budget is the author's responsibility, not a reviewer's afterthought.
- **A cap change is a documented decision.** The script's cap constants carry dated, attributed comments explaining every raise. Follow that pattern: a cap may only move with a recorded justification distinguishing proven framework drift from application bloat, and only with the required approval. Never quietly bump a cap to make a red build green.
- **CI measures differently than your laptop.** The script's own comments record a ~2.7 kB OS/gzip environment delta between local and CI runs. Leave honest headroom below the cap so a change that passes locally does not fail in CI on environment variance alone.
- **A regression caught in CI is the system working.** Treat a bundle-gate failure as the guardrail doing its job — investigate the composition with `npm run analyze`, find the chunk that grew, and address it. Do not route around the gate.

---

# Performance Tuning Checklist

Before a performance-sensitive change to this stack is considered complete, verify:

- [ ] `npm run build` plus the bundle-size check pass: shared, per-page, and middleware all within their caps.
- [ ] No heavy or vendor SDK was added to a shared/root-layout chunk; route-specific weight is behind `next/dynamic`.
- [ ] SWR keys are stable and per-user-scoped; every cached resource has a revalidation/invalidation policy and leaks no private data.
- [ ] Images use the `Image` component at rendered size; fonts are subset (including Devanagari) and preloaded; layout shift is reserved against.
- [ ] Every new hot-path query has a justified index confirmed used by the query plan; no `SELECT *`; results are bounded.
- [ ] No N+1: related data is fetched in a single batched/embedded query, never inside a loop.
- [ ] Runtime placement is correct: region intact, function within its `maxDuration`, heavy work off the request path, computation on the server where possible.
- [ ] The change was measured before and after under the same conditions, and the delta exceeds noise.
- [ ] Any cap change is documented, justified, and approved; CI enforces the budget.

If any answer is No, address it before completion.

---

# References

This guide operates within the AEOS hierarchy and must be read together with:

- 06_API_ENGINEERING — endpoint contracts, pagination, and the latency expectations that backend tuning is measured against.
- 07_DATABASE_ENGINEERING — indexing, query design, N+1 prevention, and transaction discipline that the Supabase tuning section binds to.
- 13_FRONTEND_ENGINEERING — bundle, rendering, hydration, image, font, and request practices realized here on Next.js + SWR.
- 14_BACKEND_ENGINEERING — service latency, throughput, connection-pool, and off-request-path discipline.
- 18_PERFORMANCE_ENGINEERING — the governing standard: budgets as defects, profiling methodology, anti-patterns, caching discipline, and CI regression prevention.
- Extension `extensions/vercel.md` — region, function timeouts, deploy/health pipeline, and env/secret boundaries for the live web tier.
- Extension `extensions/supabase.md` — the three-client model, RLS-everywhere, migration/index conventions, and the sanctioned RPC pattern.
- Companion guide: `guides/optimization.md` — the measure -> profile -> change -> verify loop these techniques are applied within.

Where this guide and a higher-authority document conflict, the higher-authority document prevails. The authority order is the project-root constitution, then AEOS/MASTER_SYSTEM_PROMPT.md, then AEOS/EXECUTION_ENGINE.md, then the numbered AEOS documents (00-29), then extensions, then the task.

---

# Final Directive

Tune against the real stack with the real numbers: the bundle caps in `check-bundle-size.mjs`, the region and function timeouts in the deploy config, the indexes and embedded selects in Supabase. Keep weight off first paint, keep work off the request path, keep queries indexed and N+1-free, and let CI defend every win.

Never raise a cap to hide bloat. Never ship a tuning without a before-and-after number. The fast path is the one that was measured, proven, and gated — not the one that was assumed.

**End of Document**
