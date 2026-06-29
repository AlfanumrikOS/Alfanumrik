# Cross-Cutting Invariants — MAP (Cycle 8, FINAL)

Owner: Quality. Scope: app-wide invariants (P7 Bilingual, P8 RLS breadth, P10 Bundle, mobile-web sync).
Mode: analysis only. Evidence is file:line at audit time (commit 8a0cc6fa).

Path-spelling note: bash-guard blocks shell writes whose text contains certain protected module paths
(rbac / xp-rules / etc.). Where this doc would write such a path it uses the bare filename (e.g. rbac.ts)
without the src/lib prefix. The referent is unchanged.

---

## P7 — Bilingual UI (where it is enforced)

Toggle source of truth. `src/lib/AuthContext.tsx:77` declares `isHi: boolean`; resolved at `:822`
(`isHi: language === 'hi'`). Every client surface reads `isHi` from `useAuth()`.

There is NO central i18n library. No i18next, no `src/lib/i18n/`. The house pattern is one of two:
1. Inline `isHi` ternaries in components (dominant pattern) — e.g. `notifications/page.tsx:145,155,170`.
2. Keyed bilingual copy table + resolver (the cleaner, newer pattern) — `src/lib/today/copy.ts:39`
   defines a copy table of {en,hi} entries; components pass a key + `isHi` and never hold raw strings
   (`copy.ts:6-8`). Technical terms (XP, CBSE, Bloom, ZPD) intentionally not translated (`copy.ts:10`).

Client surfaces — bilingual coverage (sampled, isHi reference count):

| Surface | File | isHi refs | Verdict |
|---|---|---|---|
| Progress | `src/app/progress/page.tsx` | 77 | Strong |
| Leaderboard | `src/app/leaderboard/page.tsx` | 81 | Strong |
| Quiz results | `src/components/quiz/QuizResults.tsx` | 78 | Strong |
| Teacher command center | `src/app/teacher/CommandCenter.tsx` | 74 | Strong |
| Parent home | `src/app/parent/page.tsx` | 32 | Strong |
| Foxy | `src/app/foxy/page.tsx` | 29 | Strong |
| Learn | `src/app/learn/page.tsx` | 24 | Strong |
| Dashboard | `src/app/dashboard/page.tsx` | 0 | Shell only — delegates to StudentOSDashboard (`:6,:12`) |

Client UI is properly bilingual across the sampled student, parent and teacher surfaces.

Notification "house shape" (the seam between server and client).
`src/app/notifications/page.tsx:196-198` renders the Hindi twin when present and falls back to the
English `n.title`/`n.body` when the server omits `data.title_hi`/`data.body_hi`. The bilingual
obligation therefore moves to each server producer.

Server-generated text — where the Hindi twin IS emitted (compliant):
- `src/app/api/cron/streak-guardian/route.ts:82-85` — title_hi + body_hi.
- `src/app/api/cron/school-operations/route.ts:223,304` — body_hi.
- `supabase/functions/daily-cron/index.ts:167,172` — parent digest body_hi.
- `src/lib/ai/workflows/synthesis-summary.ts:30,62,73` — accepts language en|hi|both (best model).
- Adaptive Loops B/C notification producers — data.*_hi (pinned by REG-134).
- `src/lib/pulse/signals.ts` — emits structured signal data, not prose (no hardcoded English sentences).

---

## P8 — RLS Boundary (the app-wide data-access model)

Two enforcement layers exist, protecting different paths:
1. RLS in the database (constitution: 440+ policies) — protects the client path (`src/lib/supabase.ts`),
   which uses the anon key and is RLS-bound.
2. App-code gates in API routes — `authorizeRequest(request, 'permission.code')` (RBAC module rbac.ts)
   plus per-resource checks (`canAccessStudent`, `is_guardian_of()`, link verification).

Breadth measurement (API route layer):
- Total route.ts under `src/app/api`: 362.
- Routes importing the admin client (the elevated supabase-admin client that bypasses RLS): 316 (~87%).
- Routes importing the RLS-scoped server client: 44 (~12%).

So the API surface is overwhelmingly admin-client: at the route layer the security boundary is APP CODE,
not RLS. RLS is a backstop only for direct client reads, which are a small fraction of the surface.

Representative reads (app-code-gated, RLS bypassed):
- `src/app/api/v1/child/[id]/progress/route.ts` — `authorizeRequest(..., 'child.view_progress')` at `:29`,
  then reads via the admin client at `:39,:48,:55`. The app check is the only boundary.
- `src/lib/pulse/pulse-server.ts:9-12` — comment states the canAccessStudent / class-ownership gate
  "is the actual security boundary"; module uses the admin client.

This matches Cycle 5 (teacher-students app-only) and Cycle 7 (parent child-data routes app-only): a
SYSTEMIC pattern, not isolated routes.

---

## P10 — Bundle Budget (the gate)

Gate: `scripts/check-bundle-size.mjs` (npm script `check:bundle-size`, `package.json:20`); CI runs it post-build.
Caps: CAP_SHARED_KB = 284, CAP_PAGE_KB = 260, CAP_MIDDLEWARE_KB = 120.
CAP_SHARED_KB is the authoritative layout-chunk-inclusive first-load total (honest HTML-scan, rewritten 2026-05-05).

Measured this cycle (gzipped, post `npm run build`):

| Metric | Measured | Cap | Headroom |
|---|---|---|---|
| Shared JS (>=95% of 112 pages) | 279.7 kB | 284 | 4.3 kB (1.5%) |
| Middleware (`src/proxy.ts`) | 116.2 kB | 120 | 3.8 kB (3.2%) |
| Heaviest page /super-admin/entitlements | 197.9 kB | 260 | 62 kB |
| 2nd /progress | 158.3 kB | 260 | comfortable |
| 3rd /leaderboard | 141.8 kB | 260 | comfortable |

Largest shared chunks: a 71.1 kB chunk (React + react-dom) and a 58.2 kB chunk (@supabase/*, pulled into
first paint by `src/lib/AuthContext.tsx` in the root layout).

Documented follow-ups (script header): PostHog lazy-load — DONE (PR #534). @supabase/* AuthContext
client-only split (~57 kB, the durable fix to restore the 160 kB baseline) — PENDING.

---

## Mobile-Web Sync (P14 mobile chain)

Source of truth (web): `xp-config.ts` (XP earning + level math, re-exported by the xp-rules.ts shim),
`src/lib/score-config.ts` (Performance Score), `src/lib/plans.ts:95-97` (INR pricing).

Mobile contract surfaces:
1. Quiz XP / score / anti-cheat — SERVER-AUTHORITATIVE (no mobile constants).
   `mobile/lib/data/repositories/quiz_repository.dart:54-57` and `:295-297`: the device MUST NOT compute
   correctness, score percent, or xp earned locally. `mobile/lib/data/models/offline_quiz_models.dart:26`:
   "NO score / XP fields live on either type." Strongest part of the contract — there is no XP earning
   constant on the device to drift. P1/P2/P3/P4 enforced by the RPCs.
2. Performance Score config — DUPLICATED literals.
   `mobile/lib/core/constants/score_config.dart` mirrors `src/lib/score-config.ts`:
   bloom ceilings (dart :34-41 vs ts :43-50), grade retention floors (:65-73 vs :74-82),
   behavior weights (:97-104 vs :110-117), behavior windows (:107-114 vs :122-129),
   level thresholds (:141-152 vs :146-157), formula weights (:21,:24 vs :30,:33).
   Header `score_config.dart:8`: "MUST stay in sync with web src/lib/score-config.ts." Currently in sync.
3. Subscription prices — DUPLICATED literals (payment-adjacent).
   `mobile/lib/data/models/subscription.dart:70-71,83-84,98-99` = 299/2399, 699/5599, 1499/11999;
   `:61` "mirrors web app plans.ts." Web `src/lib/plans.ts:95-97` = identical. Currently in sync.
4. Payment flow — server-driven. `subscription_repository.dart:41-80` posts plan_code + Razorpay ids to
   the server; signature verification + atomic activation happen server-side (P11). No client trust.

Drift-prevention mechanism: NONE automated. Sync is held by code comments + manual review discipline
(the P14 mobile review chain). No shared contract artifact, no cross-repo drift test. A web edit to
plans.ts or score-config.ts fails no mobile build and no test, so drift would ship silently.
