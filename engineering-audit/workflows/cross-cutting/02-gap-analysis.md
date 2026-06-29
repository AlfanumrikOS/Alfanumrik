# Cross-Cutting Invariants — GAP ANALYSIS (Cycle 8, FINAL)

Owner: Quality. Mode: analysis only. Each gap tagged P7 / P8 / P10 / mobile.
Classification key: AUTO-FIX-SAFE (lands this cycle) / LARGER-PROGRAM (tracked initiative) / USER-APPROVAL.

| Gap | Tag | Title | Sev | Likelihood | Class |
|---|---|---|---|---|---|
| XC-1 | P7 | Student/parent server notifications English-only | Medium | High | AUTO-FIX-SAFE |
| XC-2 | P7 | Notification title field universally English-only | Low-Med | High | AUTO-FIX-SAFE |
| XC-3 | P8 | 87% of API routes use admin client; no RLS backstop at route layer | High | Low-Med | LARGER-PROGRAM |
| XC-4 | P10 | Shared JS + middleware within ~1.5-3.2% of cap; cap bumped 5x | Medium | Medium | AUTO-FIX pin + LARGER split |
| XC-5 | mobile | score_config.dart duplicates score-config.ts, no drift detection | Medium | Medium | AUTO-FIX-SAFE |
| XC-6 | mobile | subscription.dart prices duplicate plans.ts, no drift detection | Med-High | Medium | AUTO-FIX-SAFE |
| XC-7 | P7 | No central i18n mechanism; inline-ternary sprawl | Low | High | LARGER-PROGRAM |

---

## XC-1 [P7] — Student/parent server-generated notifications are English-only

- Evidence: `supabase/functions/daily-cron/index.ts:573,587,601` (score_milestone titles) and `:574,588,602`
  (bodies) are dynamic English with NO title_hi/body_hi; `:1579-1581` (first-quiz nudge) English-only.
  Parent insights/tips/glance remain English-only per Cycle-7 PP-7 (`supabase/functions/parent-portal/index.ts:498-502,790-826,1041-1107`;
  `src/app/api/v2/parent/glance/route.ts:163-195`). The client (`src/app/notifications/page.tsx:196-198`)
  silently falls back to English when the Hindi twin is absent, so these render English to Hindi-mode users.
- Business impact: Hindi-preferring students/parents receive the most motivational, behavior-driving
  messages (score moved, streak, first-quiz, weekly tips) only in English — weakens the bilingual promise
  on exactly the re-engagement surfaces that drive retention.
- Technical impact: free-form English strings, not i18n keys, so the client cannot translate
  deterministically. The parity contract already exists (title_hi/body_hi); these producers omit it. The
  good model is synthesis-summary.ts (accepts a language param).
- Severity: Medium. Likelihood: High for Hindi-mode users hitting these notifications.
- Recommendation: add title_hi/body_hi (or data.*_hi) to the score_milestone + first-quiz producers,
  mirroring streak-guardian (`:82-85`). For parent insights/tips/glance, emit keyed strings or pre-render
  both languages (server already accepts language on the AI report path, report/route.ts:34).
- Est. effort: 0.5 day for the daily-cron producers (AUTO-FIX-SAFE; owned by backend/assessment — quality
  recommends). Parent insights/tips: 1 day server + frontend render review.

## XC-2 [P7] — Notification title is English-only even when the body is bilingual

- Evidence: `supabase/functions/daily-cron/index.ts:167,172` provide body_hi but the title is English with
  no title_hi; `src/app/api/cron/school-operations/route.ts:221-223,302-304` ship body_hi but the title is
  the dynamic English threshold.title (`:184-186,251-253`) with no Hindi twin. The client renders
  data.title_hi else n.title (`notifications/page.tsx:196`), so the title is always English.
- Business impact: notification headers (the first thing a Hindi-mode user reads) are English even on
  otherwise-bilingual notifications — an inconsistent, half-translated surface.
- Technical impact: partial adoption of the house shape — body_hi added, title_hi not. Low effort to close.
- Severity: Low-Medium. Likelihood: High (every digest/renewal notification).
- Recommendation: add title_hi alongside the existing body_hi for parent-digest and school-operations
  producers. The only producer already doing this is streak-guardian (`:83`).
- Est. effort: 0.5 day. AUTO-FIX-SAFE.

## XC-3 [P8] — 87% of API routes use the admin client; RLS is not the route-layer boundary

- Evidence: 316/362 route.ts import the admin (elevated) client that bypasses RLS; only 44 use the
  RLS-scoped server client. Representative: `src/app/api/v1/child/[id]/progress/route.ts:29,39,48,55`
  (RBAC check, then admin reads); `src/lib/pulse/pulse-server.ts:9-12` (canAccessStudent is the actual
  security boundary). Cycle 5 (teacher-students) and Cycle 7 (parent child-data) found the same shape.
- Business impact: student-data confidentiality (DPDP child data, P13) rests on app-code correctness in
  ~316 routes. A single missing/wrong authorizeRequest or canAccessStudent or link check = full cross-tenant
  read with NO database backstop. High blast radius if any one route regresses.
- Technical impact: defense-in-depth is absent at the dominant access path. RLS protects only the ~12% on
  the scoped client plus direct browser reads. Partly by design (admin client for cross-cutting reads), but
  the breadth exceeds the intent.
- Severity: High (systemic exposure ceiling). Likelihood: Low-Medium per-route today, but the count makes a
  future regression near-certain over time.
- Recommendation: stand up a tracked RLS defense-in-depth initiative: (a) inventory the 316 admin-client
  routes by data sensitivity; (b) for student/parent/teacher reads, move to the scoped client where feasible
  OR add RLS policies that also catch an app-code bypass; (c) add a CI rule flagging NEW admin-client imports
  in routes touching student PII without an explicit allow-comment. NOT a one-cycle fix.
- Est. effort: multi-sprint. LARGER-PROGRAM (dedicated future initiative).

## XC-4 [P10] — Shared JS and middleware within ~1.5-3.2% of cap; cap raised 5x

- Evidence: this cycle Shared JS = 279.7 kB / 284 (4.3 kB headroom); Middleware = 116.2 kB / 120 (3.8 kB).
  `scripts/check-bundle-size.mjs` header documents CAP_SHARED_KB raised 270 to 275 to 280 to 282 to 284.
  The two largest shared chunks are React/react-dom (71.1 kB) and @supabase/* (58.2 kB, pulled into first
  paint by `src/lib/AuthContext.tsx`).
- Business impact: P10 targets Indian 4G (2-5 Mbps). The guardrail keeps being relaxed instead of the bundle
  reduced (cap creep); the next routine framework bump breaches CI and forces a 6th bump, eroding the budget
  that protects low-bandwidth users.
- Technical impact: the honest fix (split @supabase/* out of first paint, ~57 kB) is identified and PENDING;
  PostHog lazy-load is already spent. Until the split lands, headroom is razor-thin.
- Severity: Medium. Likelihood: Medium.
- Recommendation: (a) AUTO-FIX-SAFE now — add a regression-catalog pin asserting CAP_SHARED_KB / measured
  headroom so any future raise is a conscious reviewed event. (b) LARGER-PROGRAM — execute the @supabase/*
  AuthContext client-only split (P15-touching), then ratchet CAP_SHARED_KB back toward 160 kB.
- Est. effort: (a) 0.5 day. (b) 2-4 days (architect/frontend, P15-sensitive).

## XC-5 [mobile] — score_config.dart duplicates score-config.ts with no automated drift detection

- Evidence: `mobile/lib/core/constants/score_config.dart` re-declares every constant in
  `src/lib/score-config.ts` (bloom ceilings :34-41, retention floors :65-73, behavior weights :97-104,
  windows :107-114, level thresholds :141-152, weights :21/:24). Header `:8` asserts manual sync. Currently
  in sync, enforced only by comment + the P14 mobile review chain.
- Business impact: a web change to the Performance Score model (a bloom ceiling, a retention floor) that is
  not hand-mirrored makes the mobile app show a DIFFERENT score/level than web for the same student — a
  correctness/trust defect that no test would catch.
- Technical impact: two sources of truth in different languages, zero mechanical linkage.
- Severity: Medium. Likelihood: Medium.
- Recommendation: add a web-side Vitest drift-detection test that reads the Dart file, extracts the numeric
  literals, and asserts equality against `score-config.ts`. Fails CI on any unsynced web edit.
- Est. effort: 0.5-1 day. AUTO-FIX-SAFE.

## XC-6 [mobile] — subscription.dart prices duplicate plans.ts with no drift detection (payment-adjacent)

- Evidence: `mobile/lib/data/models/subscription.dart:70-71,83-84,98-99` hardcode 299/2399, 699/5599,
  1499/11999; `:61` mirrors web app plans.ts. Web `src/lib/plans.ts:95-97` identical today. No test links them.
- Business impact: prices are the highest-stakes drift surface. If web pricing changes and mobile does not,
  the app shows a price that does not match what the server charges via Razorpay — a billing-trust and
  potentially consumer-law issue (same spirit as REG-65 pricing-verbatim). Server is authoritative for the
  actual charge, so this is a DISPLAY mismatch not a charge bypass, but still user-facing and reputational.
- Technical impact: same root cause as XC-5 (duplicated literals, no linkage) on a payment surface.
- Severity: Medium-High (payment-adjacent display integrity). Likelihood: Medium.
- Recommendation: add a web-side Vitest drift-detection test that parses the Dart price literals and asserts
  equality against `plans.ts`. Pair with a regression-catalog entry. Highest-value single AUTO-FIX this cycle.
- Est. effort: 0.5 day. AUTO-FIX-SAFE.

## XC-7 [P7] — No central i18n mechanism; inline-ternary sprawl makes parity unenforceable

- Evidence: bilingual text is overwhelmingly inline isHi ternaries across hundreds of components
  (CommandCenter 74, leaderboard 81, QuizResults 78 refs). The only keyed/resolver pattern is
  `src/lib/today/copy.ts`. No i18next, no key catalog, no missing-translation lint.
- Business impact: client surfaces ARE bilingual today (discipline is high), but there is no mechanical way
  to prove parity or catch a new English-only string at review/CI — every new feature re-litigates P7 by
  hand, and server/client parity (XC-1/XC-2) has no single chokepoint.
- Technical impact: scaling debt, not a present defect. Wholesale migration is large.
- Severity: Low (architectural). Likelihood: High that English-only strings keep slipping in piecemeal.
- Recommendation: adopt the today/copy.ts keyed-resolver pattern as the house standard for NEW user-facing
  text; add a lint rule flagging JSX string literals without an isHi/key path. Do not retrofit the whole app
  in one cycle.
- Est. effort: ongoing. LARGER-PROGRAM.

---

## Compliant / strong (explicitly noted)

- P7 client UI: student, parent and teacher surfaces are thoroughly bilingual (sampled isHi counts 24-81).
- P7 server: streak-guardian, school-operations bodies, parent digest body, adaptive Loops B/C, and the
  synthesis AI summary already emit Hindi (synthesis via a language param — the model to copy).
- Mobile quiz path: XP/score/anti-cheat are server-authoritative; the device holds NO earning constant to
  drift (quiz_repository.dart:54-57, offline_quiz_models.dart:26). Strongest mobile contract.
- P10: all 179 measured pages are within the 260 kB cap; heaviest is /super-admin/entitlements at 197.9 kB
  (62 kB headroom). No page near the cap.
