# Cross-Cutting Invariants — SOLUTION DESIGN (Cycle 8, FINAL)

Two auto-fix-safe tracks shipped this cycle:
- **Track A — P7 server-notification bilingual fix** (owner: backend; scope `supabase/functions/daily-cron/index.ts`
  ONLY; XC-1 MEDIUM + XC-2 LOW-MED). Sections 1–5 below.
- **Track B — mobile↔web drift contracts + bundle-cap pin** (owner: testing; test-only, no source change;
  XC-6 + XC-5 + XC-4a). Section 6 below.

XC-3 (P8 RLS defense-in-depth) / XC-4b (@supabase/* first-paint split) / XC-7 (central i18n primitive)
are LARGER-PROGRAM tracked initiatives, NOT touched this cycle (see §5 + the program-summary).

---

## 1. The bilingual house shape (verified, with evidence)

The `notifications` table has **no** top-level `*_hi` columns. Verified against the prod baseline:

- `supabase/migrations/00000000000000_baseline_from_prod.sql:12503-12521` — the `public.notifications`
  table columns are `title`, `message` (NOT NULL), `body`, `data` (jsonb), … **no `title_hi`, no
  `body_hi`.**

Therefore the canonical P7 shape for server-generated notifications is:

- top-level `title` + `message` (NOT NULL) + `body` carry the **English** copy;
- the **Hindi** twin rides inside the `data` jsonb as `data.title_hi` / `data.body_hi`
  (and `data.message_hi` where producers set a message twin).

Evidence this is the contract the client actually reads and the in-file producers already follow:

- Client reader — `src/app/notifications/page.tsx:192-198`:
  > "P7 — Hindi copy rides data.title_hi / data.body_hi (the notifications table has no top-level
  > *_hi columns). Falls back to the En title/body when the row predates this."
  > `displayTitle = isHi && n.data?.title_hi ? n.data.title_hi : n.title`
  > `displayBody  = isHi && n.data?.body_hi  ? n.data.body_hi  : n.body`
  The client reads **only** `data.title_hi` / `data.body_hi`. A top-level `body_hi` is never read.
- Documented contract — `src/lib/notification-triggers.ts:385-393`:
  > "the WORKING notifications-table shape (the one daily-cron's generateParentDigests and the
  > goal-daily-plan-reminder builder use, verified against the prod baseline): top-level `message`
  > (NOT NULL in prod) + `body` carry the English copy; Hindi copy lives in `data.title_hi` /
  > `data.body_hi` / `data.message_hi` (P7 — the notifications table has NO top-level body_hi column;
  > the older triggers above that set a top-level body_hi predate that verification)."
- In-file model already compliant — `daily-cron/index.ts:1582-1586` (the first-quiz nudge) puts
  `title_hi` and `body_hi` inside `data`, with English at top level. This is the correct local pattern.

> NOTE on the audit's framing: 02-gap-analysis cited the first-quiz nudge (`:1579-1581`) as
> English-only and the parent digest as a "compliant producer providing body_hi". The current file
> shows (a) the first-quiz nudge is ALREADY compliant (`data.title_hi`/`data.body_hi`) — the audit
> snapshot predated that, and (b) the parent digest's `body_hi` was at the **top level**, i.e. on a
> column that does not exist and that the client never reads — so its Hindi body was effectively
> dead. The fix below matches the verified `data.*_hi` shape exactly.

---

## 2. Producers fixed

### XC-1 — score-milestone producers (student-facing, `recipient_type:'student'`)
Three producers in `recalcPerformanceScores`, previously English-only (no Hindi at all):
- `:569-579` score-drop (≥5 pt drop)
- `:582-593` crossed-above-80 achievement
- `:596-607` dropped-below-50 warning

Fix: added `data.title_hi` + `data.body_hi` to each, mirroring the **student-facing informal tone**
(तुम / तुम्हारा) of the in-file first-quiz nudge. All numeric interpolations preserved. The product
term "Performance Score" and "XP" are left untranslated per P7 (technical/product terms). English
text, thresholds and trigger conditions are unchanged.

### XC-2 — parent-digest producers (guardian-facing, `recipient_type:'guardian'`)
Two producers in `generateParentDigests`, previously shipping a **top-level `body_hi`** (dead — no
column, not read by the client) and **no title_hi**:
- `:167` parent_digest_no_activity
- `:172` parent_digest

Fix: relocated the existing Hindi body into `data.body_hi` (so it actually renders) and added
`data.title_hi`, mirroring the **formal parent tone** (आपके बच्चे) already used in the in-file
Hindi body and in `notification-triggers.ts`'s parent rows. The `quiz`-count pluralisation Hindi
(`क्विज़ पूरी${n>1?'ं':''}`) mirrors the `parent_daily_report` precedent in
`notification-triggers.ts:341`. English text, thresholds and trigger conditions are unchanged.

No producer's English copy, trigger logic, threshold, idempotency_key, or XP/score value was changed.

---

## 3. P7 rationale
Hindi-mode students/parents hit these re-engagement notifications (score moved, first quiz, daily
digest) — the most behavior-driving surfaces. Because the client silently falls back to English when
the `data.*_hi` twin is absent, the gap was invisible. Adding the twin in the shape the client reads
closes the gap without any schema change.

## 4. P13 rationale
No PII added. The Hindi strings interpolate only the same non-PII values already present in the
English copy (subject string, integer scores, XP totals, quiz counts, streak days). No name, email,
or phone is introduced into any notification or its `data`.

---

## 5. Out of scope / follow-ups (NOT this cycle)

- **school-operations Edge route** — `src/app/api/cron/school-operations/route.ts:221-223,302-304`
  ships top-level `body_hi` with an English-only dynamic `threshold.title` (`:184-186,251-253`) and
  no `title_hi`. Same XC-2 class of gap as the parent digest (and likely the same dead-top-level-
  `body_hi` issue, since the table has no such column). **Follow-up — separate cycle.** Bounded out
  per the task's "daily-cron only" scope.
- **parent-portal Edge function** insights/tips/glance remain English-only (Cycle-7 PP-7;
  `parent-portal/index.ts:498-502,790-826,1041-1107`, `api/v2/parent/glance/route.ts:163-195`).
  Larger server+frontend effort. **Follow-up.**
- **Legacy top-level `body_hi` triggers** in `notification-triggers.ts` (onLevelUp, onChapterComplete,
  onStreakMilestone, the quiz_result/daily_progress/streak_risk/parent_daily_report rows) also set a
  top-level `body_hi` that the client cannot read; they "predate that verification" per the in-file
  note. Migrating those to `data.*_hi` is a broader sweep. **Follow-up.**

### Larger-program (tracked initiatives — not this cycle)
- **XC-3 (P8) systemic-RLS defense-in-depth** — 87% admin-client routes. Multi-sprint.
- **XC-4b (P10) @supabase/* first-paint split** — durable bundle reduction to ratchet CAP_SHARED_KB
  back toward 160 kB. P15-sensitive.
- **XC-7 (P7) central i18n primitive** — adopt the `today/copy.ts` keyed-resolver as the house
  standard + a missing-translation lint so server/client parity becomes mechanically enforceable
  (the single chokepoint RC-1 identifies as absent).

---

## 6. Track B — mobile↔web drift contracts + bundle-cap pin (owner: testing)

RC-3 and RC-4 are "an invariant expressed as a comment, never given a mechanical enforcer." Track B
converts three such comments into CI-enforced tests. All test-only — no runtime/source change, no
bundle footprint, no invariant/pricing/RBAC/AI-model change.

### XC-6 — subscription price web↔mobile parity (P11-adjacent) → REG-191
`mobile/lib/data/models/subscription.dart:70-71,83-84,98-99` hardcodes 299/2399, 699/5599, 1499/11999
("mirrors web app plans.ts" — `:61`); web `src/lib/plans.ts:95-97` is identical today. A web-side
Vitest test parses the Dart literals and asserts equality against `plans.ts`. **Parity-only** — it
pins NO absolute value, it asserts web↔mobile EQUALITY. So it does NOT collide with the PAY-2
USER-gated pricing decision: a legitimate price change passes iff BOTH sides are changed together; a
one-sided web edit fails CI. No drift today.

### XC-5 — score-config web↔Flutter parity (mobile) → REG-192
`mobile/lib/core/constants/score_config.dart` re-declares every Performance-Score constant in
`src/lib/score-config.ts` (bloom ceilings, retention floors, behavior weights/windows, level
thresholds, formula weights). A web-side test extracts all 41 constants from the Dart file and asserts
equality against `score-config.ts`. Parity-only; all 41 identical web↔Flutter today.

### XC-4a — bundle-cap pin (P10, anti cap-creep) → REG-193
`scripts/check-bundle-size.mjs` has had CAP_SHARED_KB raised five times (270→284). A test pins the cap
declarations (CAP_SHARED_KB=284, CAP_PAGE_KB=260, CAP_MIDDLEWARE_KB=120) so any future raise is a
conscious, reviewed code change — RC-3's "single freely-editable number" now has friction. It freezes
the cap NUMBERS; the build-time `check:bundle-size` still does the actual measurement.

### P13
The drift tests read only numeric/string constants from source files on disk — no PII, no DB, no
network. Reading the real Dart files (not fixtures) is what makes a one-sided edit fail.

### Bounded out of Track B (the durable halves — LARGER-PROGRAM)
- **XC-4b** — the @supabase/* AuthContext first-paint split (~57 kB) that would let CAP_SHARED_KB
  ratchet back toward 160 kB is P15-touching and multi-day; the pin (XC-4a) buys time without it.
- Serving score-config/prices from an API (eliminating the duplication entirely) rather than pinning
  the duplicate is the durable RC-4 fix — tracked, not this cycle.
