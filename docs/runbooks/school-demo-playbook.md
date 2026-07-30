# Runbook — School Demo Playbook

**Purpose:** Take a prospect school from "nothing exists" to "a demo that demonstrates value on first paint," and then tear it down leaving zero unpaid production access. This runbook exists because a live school demo failed: the entitlement grant *looked* applied and was not reachable by the code path that actually gates the product.

**Audience:** ops engineer or CEO with super-admin session + Supabase service-role SQL access.

**Owner:** ops. Comp-grant contract owned jointly with backend (implementation) and architect (P11 review).

**Risk class: P11 EXCEPTION SURFACE.** Everything in Sections 1, 3 and 5 grants paid product access without a verified payment. P11 says *never grant plan access without verified payment*; the demo comp path is the ONE sanctioned exception (`packages/lib/src/demo/is-demo-school.ts`). Treat every step here as money-adjacent. Nothing in this runbook is autonomous — Section 5 requires explicit CEO approval per school.

**Estimated time:** T-48h provisioning 30 min · T-24h seeding 60-90 min · T-2h verification 20 min · T-15m smoke 10 min · teardown 20 min.

**Reversibility:** every grant in this runbook is revocable by a single mutation, and Section 3 gives the queries that *prove* revocation landed.

---

## Section 0 — Why the last demo failed (read this before anything else)

Two independent traps. Both are silent. Both were hit.

### Trap 1 — School coverage does not reach the quota path

There are two different "what plan does this student have" resolvers in this codebase and **they do not agree**:

| Resolver | Reads | Governs |
|---|---|---|
| `resolveEffectiveEntitlement()` — `packages/lib/src/entitlements/effective-plan.ts` | school coverage (`school_subscriptions` + seat occupancy) **OR** personal `student_subscriptions` — highest tier wins | module/subject gating (`plan-gate.ts`), checkout redundancy |
| `get_plan_limit(student_id, feature)` — SQL, `supabase/migrations/00000000000000_baseline_from_prod.sql:4779` | **ONLY** `student_subscriptions` JOIN `subscription_plans` WHERE `status IN ('active','trial')` | daily Foxy chat cap, daily quiz cap, notes cap — via `check_and_record_usage()` |

`get_plan_limit` has **no knowledge of school coverage at all**. Combine that with the `on_student_created` trigger, which auto-inserts a `plan_code='free', status='active'` row on every new `students` row, and you get:

> Provision a school at `plan='trial'` → `normalizeSchoolPlanToConsumerCode('trial') = 'pro'` → subjects unlock, dashboards render, everything *looks* granted. But every student under that school still has a personal `student_subscriptions` row at `plan_code='free'`, so `get_plan_limit(student,'foxy_chat')` returns the **free cap** and Foxy hard-stops after a handful of messages — mid-demo, in front of the room.

`POST /api/super-admin/institutions/provision` → `provision_school` RPC does **not** write any `student_subscriptions` row. `POST /api/super-admin/demo-accounts` **does** (`provisionDemoStudentSubscription()` PATCHes the auto-created free row to `plan_code='unlimited', status='active', is_demo=true`). That difference is the whole failure.

**Operational rule: a school grant alone never proves quota. Only `get_plan_limit()` proves quota. Run assertion B in Section 2.**

### Trap 2 — Demo seeding writes vanity numbers, not history

`PERSONA_PROFILES` (`packages/lib/src/demo/personas.ts:38`) is the entire persona seed:

```ts
high_performer: { xp_total: 2500, streak_days: 45 },
average:        { xp_total: 800,  streak_days: 12 },
weak_student:   { xp_total: 150,  streak_days: 3  },
```

`seedStudentDemoData()` PATCHes exactly those two columns plus `last_active`. It writes **no** `quiz_sessions`, **no** `quiz_responses`, **no** `concept_mastery`. So a freshly created demo student shows an XP pill and a streak flame — and underneath, the dashboard is empty:

| Dashboard surface (`apps/host/src/app/(student)/dashboard/StudentOSDashboard.tsx`) | Data source | Zero-history render |
|---|---|---|
| `TodaysMission` (hero) | `useTodayQueue` → rhythm orchestrator | generic first-run CTA |
| `MasterySnapshot` (rail + inline) | `get_mastery_overview` RPC → `concept_mastery`; `countBuckets` **excludes `not_started`** | **"No quizzes yet" / "अभी तक कोई क्विज़ नहीं"** empty card |
| `BoardScoreWidget` | self-gates on `ff_board_score_v1` | **"Coming Soon" / "जल्द आ रहा है"** — flag is seeded OFF and is *excluded from every bulk flag-enable migration by standing CEO instruction* (`20260720110000`, `20260720130000`). Do not flip it for a demo. |
| `RevisionRail` (aside + inline) | `useReviewCards` → SRS due queue | empty |
| `SubjectRoadmaps` | same `get_mastery_overview` rows via `roadmapStatusForRow` | every node `locked` |
| `StreakBadge` | `students.streak_days` | `shouldShowStreak` threshold is **3**. At `0` the component **returns `null`** (`packages/ui/src/challenge/StreakBadge.tsx:48`) — the badge does not render at all. At 1-2 it renders the text "Start a streak!" / "स्ट्रीक शुरू करो!". |

Vanity XP + empty mastery is worse than empty everything: it reads as a broken product rather than a new account.

**Operational rule: XP and streak are display columns. Only completed quizzes create `concept_mastery` rows. Seed by *playing*, not by stamping.**

---

## Section 1 — Pre-demo checklist

Fill this in before you start. Every later step references these.

```
DEMO_DATE           = <YYYY-MM-DD HH:MM IST>
PROSPECT_SCHOOL     = <name>
DEMO_SCHOOL_UUID    = <filled in at 1.2>
DEMO_STUDENT_COUNT  = <N, recommend 3>
GRADE               = <"6".."12" — STRING, P5>
STREAM              = <science|commerce|humanities — REQUIRED for grade 11/12>
TEARDOWN_DEADLINE   = <DEMO_DATE + 48h, hard>
CEO_APPROVAL_REF    = <required only if Section 5 break-glass is used>
```

### T-48h

#### 1.1 Confirm you are not about to comp a paying customer

```sql
SELECT s.id, s.name, s.is_demo, s.is_active, s.deleted_at,
       ss.plan, ss.status, ss.seats_purchased, ss.razorpay_subscription_id
FROM public.schools s
LEFT JOIN public.school_subscriptions ss ON ss.school_id = s.id
WHERE s.name ILIKE '%<PROSPECT_SCHOOL>%';
```

If any row comes back with a non-null `razorpay_subscription_id`, **STOP**. That school is a paying customer; do not attach a demo grant to it. Provision a separate demo tenant instead.

#### 1.2 Provision the demo school

```
POST /api/super-admin/institutions/provision
Cookie: <super-admin session>          # authorizeAdmin(request, 'super_admin')
Content-Type: application/json

{
  "name": "<PROSPECT_SCHOOL> (Demo)",
  "board": "CBSE",
  "city": "<city>",
  "state": "<state>",
  "plan": "trial",
  "seats": 50,
  "price_per_seat": 0
}
```

Naming rule: the tenant name **must** carry a `(Demo)` suffix. Demo tenants must be distinguishable from real ones on sight in every admin list, not only via a boolean column.

Response `201` carries `{ school_id, slug, subdomain, invite_code }`. Record `school_id` as `DEMO_SCHOOL_UUID`. This route writes an audit row `school.provisioned` (metadata-only) and creates `schools` + `school_subscriptions` + `school_invite_codes` atomically via `provision_school`.

> `provision_school` does **not** set `schools.is_demo`. A trial school subscription is enough for effective-plan module gating; `is_demo` is only needed if you intend to exercise the *school-admin self-service billing* screen live (the comp branch in `apps/host/src/app/api/school-admin/subscription/route.ts`). If the demo script does not open that screen, **do not request the break-glass in Section 5** — you do not need it.

#### 1.3 Create the demo students

One call per student. `super_admin` required.

```
POST /api/super-admin/demo-accounts
Content-Type: application/json

{
  "role": "student",
  "name": "Demo — Aanya S.",
  "email": "demo.aanya.<yyyymmdd>@alfanumrik.demo",
  "persona": "high_performer",     // one of: weak_student | average | high_performer
  "grade": "10",                   // STRING (P5)
  "stream": "science"              // REQUIRED when grade is "11" or "12"
}
```

Rules, non-negotiable:

- **Email domain must be `@alfanumrik.demo`.** Never a real deliverable domain, never a prospect's domain. This is what makes demo accounts distinguishable from real users in exports and analytics (`analytics-v2/b2b` already filters `is_demo=eq.false`).
- **Display name must carry a `Demo —` prefix.** Same reason.
- Use **three different personas** across your N students. A demo that shows only a high performer does not demonstrate the product's actual job.
- The route sets `students.account_status='demo'`, `students.is_demo=true`, `subscription_plan='unlimited'`, and — critically — writes `student_subscriptions{plan_code:'unlimited', status:'active', is_demo:true}`. **That last write is the one that reaches the quota path.**
- The response returns a generated password once. It is not retrievable later; capture it into your password manager immediately, not into a doc or chat.
- Response also carries `login_url` + `login_instructions`. Students log in at `/login`.

Note the caveats already encoded in the route: the auto-created free subscription row is PATCHed, not inserted over; if `subscription_plans.unlimited` is missing the route logs and continues, leaving the student on `free`. Assertion B in Section 2 is what catches that.

#### 1.4 Attach students to the school roster (required for school-side surfaces)

The demo-accounts route sets `students.school_id` only for the `school_admin` bulk path. For students you created directly against `DEMO_SCHOOL_UUID`, effective-plan **school coverage** additionally requires an *active roster row* (`class_students` or `class_enrollments` on an active, non-deleted class of the school) — see `studentOccupiesSeat()`. Without a roster row the student is school-linked but not school-covered, and the School Pulse / Command Center tiles will read zero.

If your demo script includes the school-admin or teacher view, enroll the students through the school-admin UI now. If the demo is student-only, skip this — the personal `unlimited` subscription is doing all the work.

### T-24h

#### 1.5 Seed history by playing (see Section 2 for the floor)

Log in as each demo student and complete real quizzes. Do not stamp tables. Budget 20-30 min per account.

### T-2h

#### 1.6 Run the full verification battery (Section 2). Do not skip.

### T-15m

#### 1.7 Final smoke

- [ ] Log in as each demo student on the actual demo device and network. Not your laptop, the projector machine.
- [ ] Dashboard renders with **zero** empty-state cards other than BoardScore (see 1.8).
- [ ] Send one Foxy message. Confirm it answers and the remaining-quota indicator is not near zero.
- [ ] Toggle EN/हि in the header once — bilingual is a demo asset (P7); confirm it works before you promise it.
- [ ] Log out. Log back in. Confirm the session survives (this is where projector-day auth surprises show up).

#### 1.8 Set expectations on BoardScore before the demo

`ff_board_score_v1` is OFF and is under a standing CEO exclusion from bulk flag enables. The widget will show "Coming Soon". **Do not flip this flag to dress up a demo.** Either script around it or narrate it as roadmap. Flipping a CEO-excluded flag for a sales moment is exactly the class of change this runbook exists to prevent.

---

## Section 2 — Verification battery (the proof gate)

Run all five. A demo is not ready until every one passes. Substitute `<DEMO_SCHOOL_UUID>` throughout.

### A — School and subscription state

```sql
SELECT s.id, s.name, s.slug, s.is_active, s.is_demo, s.deleted_at,
       ss.plan, ss.status, ss.seats_purchased,
       ss.razorpay_subscription_id, ss.current_period_end, ss.is_demo AS sub_is_demo
FROM public.schools s
LEFT JOIN public.school_subscriptions ss ON ss.school_id = s.id
WHERE s.id = '<DEMO_SCHOOL_UUID>';
```

PASS when: `is_active = true`, `deleted_at IS NULL`, `plan = 'trial'`, `status IN ('trial','active')`, `razorpay_subscription_id IS NULL`, name contains `(Demo)`.

### B — THE ONE THAT FAILED LAST TIME: effective quota per student

```sql
SELECT
  st.id                                     AS student_id,
  st.grade,
  st.account_status,
  st.is_demo,
  st.subscription_plan                      AS denormalised_plan,
  ss.plan_code                              AS personal_sub_plan,
  ss.status                                 AS personal_sub_status,
  ss.is_demo                                AS sub_is_demo,
  public.get_plan_limit(st.id, 'foxy_chat') AS foxy_daily_cap,
  public.get_plan_limit(st.id, 'quiz')      AS quiz_daily_cap
FROM public.students st
LEFT JOIN public.student_subscriptions ss ON ss.student_id = st.id
WHERE st.school_id = '<DEMO_SCHOOL_UUID>'
   OR st.email LIKE '%@alfanumrik.demo'
ORDER BY st.created_at DESC;
```

**PASS when `foxy_daily_cap = 999999` for every row.**

`999999` is the sentinel `get_plan_limit` returns when `subscription_plans.foxy_chats_per_day = -1` (set for `starter`/`pro`/`unlimited` by migration `20260714120000`).

| Reading | Meaning | Fix |
|---|---|---|
| `999999` | Grant reached the quota path. | Proceed. |
| A small number (e.g. `5`) | **This is the failure mode.** The student's personal `student_subscriptions` row is still `free` — the school grant never reached `get_plan_limit`. | Re-run the demo-accounts create for that student, or have backend re-stamp the personal subscription. Do NOT proceed on a school grant alone. |
| `personal_sub_plan IS NULL` | No `student_subscriptions` row at all → `get_plan_limit` falls to its hardcoded free default (5). | Same fix. |

`account_status` must read `demo` and `is_demo` must be `true` on every row. A student without those markers is indistinguishable from a real user in exports — that is a P13-adjacent defect, not a cosmetic one.

### C — Quota not already burned today

```sql
SELECT du.student_id, du.feature, du.usage_date, du.usage_count
FROM public.student_daily_usage du
JOIN public.students st ON st.id = du.student_id
WHERE (st.school_id = '<DEMO_SCHOOL_UUID>' OR st.email LIKE '%@alfanumrik.demo')
  AND du.usage_date = (now() AT TIME ZONE 'Asia/Kolkata')::date;
```

PASS when: rows are absent or `usage_count` is far below cap. Seeding on the same calendar day as the demo consumes real quota. If you seeded today and the cap resolved to a finite number, you may already be exhausted. This is why seeding happens at T-24h.

### D — Seeded history depth (per student)

```sql
SELECT
  st.id,
  st.xp_total,
  (st.xp_total / 500) + 1                AS current_level,
  500 - (st.xp_total % 500)              AS xp_to_next_level,
  st.streak_days,
  (SELECT count(*) FROM public.quiz_sessions qs
     WHERE qs.student_id = st.id AND qs.is_completed = true
       AND qs.deleted_at IS NULL)                                   AS completed_quizzes,
  (SELECT count(DISTINCT qs.subject) FROM public.quiz_sessions qs
     WHERE qs.student_id = st.id AND qs.is_completed = true)        AS distinct_subjects,
  (SELECT count(*) FROM public.concept_mastery cm
     WHERE cm.student_id = st.id AND cm.mastery_level = 'mastered') AS mastered_topics,
  (SELECT count(*) FROM public.concept_mastery cm
     WHERE cm.student_id = st.id
       AND cm.mastery_level NOT IN ('not_started','mastered'))      AS learning_topics,
  (SELECT count(*) FROM public.concept_mastery cm
     WHERE cm.student_id = st.id AND cm.next_review_at IS NOT NULL
       AND cm.next_review_at <= now())                              AS due_for_review
FROM public.students st
WHERE st.school_id = '<DEMO_SCHOOL_UUID>' OR st.email LIKE '%@alfanumrik.demo';
```

Compare against the floor table in Section 3. `xp_to_next_level` is the live-level-up dial — see Section 3.3.

### E — Audit trail exists

```sql
SELECT action, resource_type, resource_id, admin_level, details, created_at
FROM public.audit_logs
WHERE resource_id = '<DEMO_SCHOOL_UUID>'
   OR details::text LIKE '%<DEMO_SCHOOL_UUID>%'
ORDER BY created_at DESC
LIMIT 50;
```

PASS when: a `school.provisioned` row exists, and one `create_demo_account` row exists per demo student. If you used Section 5 break-glass, the manual audit row from 5.4 must also be present. **Zero audit rows for a grant that exists in the data is a blocking defect** — investigate before demoing, because it means a privileged grant happened outside the audited path.

---

## Section 3 — Seeded-state requirement

The demo dashboard must demonstrate value on **first paint**, before anyone clicks. That means no empty-state card is acceptable except BoardScore (§1.8).

### 3.1 The minimum floor per demo student

| Signal | Minimum | Why exactly this number |
|---|---|---|
| Completed quizzes (`quiz_sessions.is_completed = true`) | **≥ 6** | Enough distinct `concept_mastery` rows to populate all three MasterySnapshot buckets and un-lock visible SubjectRoadmap nodes. Below ~6 the snapshot renders one lonely bucket. |
| Distinct subjects across those quizzes | **≥ 3** | `groupBySubject()` renders one skill tree per subject. One subject = one tree = looks like a prototype. |
| Topics at `mastery_level = 'mastered'` | **≥ 2** | Fills the green segment + the `StatRing` hero number. A zero mastered count renders a 0% ring, which reads as failure. |
| Topics at beginner/developing/proficient | **≥ 3** | Fills the "Learning" bucket. This is the bucket that makes the product look *in use*. |
| Topics with `next_review_at <= now()` | **≥ 1** | `bucketForRow` gives `due_for_review` precedence → populates "Needs Revision" **and** renders its "Review now → / अभी दोहराओ →" CTA. Also the only way `RevisionRail` is non-empty. |
| `students.streak_days` | **≥ 3** | `shouldShowStreak` threshold is `STREAK_VISIBILITY_THRESHOLD = 3`. At `0` the badge returns `null` — nothing renders. At 1-2 it renders "Start a streak!". Only `>= 3` renders the flame + count. Recommended demo value: **7-21** (believable, and shows milestone badges). |
| `students.xp_total` | **≥ 500** and positioned per §3.3 | Below 500 the student is level 1, which reads as "brand new account". |

Personas map to different floors — that variety is the point:

| Persona | Suggested `xp_total` | `streak_days` | Quizzes | Demo narrative |
|---|---|---|---|---|
| `high_performer` | 2,420 | 21 | 10+ | "here's a student who's been with us a term" |
| `average` | 1,420 | 9 | 7 | "here's the median student — and here's what we do about it" |
| `weak_student` | 420 | 4 | 6 | "here's the intervention story" — **needs the most `due_for_review` rows**, that's the whole point of showing them |

Note these override `PERSONA_PROFILES` (800/12 etc.). The stock persona values are fine as a starting stamp; the numbers above are the *demo-ready* values after seeding.

### 3.2 How to seed — play, don't stamp

Log in as each demo student and complete real quizzes through `/quiz`. This is not fastidiousness; it is the only path that writes `quiz_sessions` **and** `quiz_responses` **and** `concept_mastery` **and** XP **and** streak coherently, through `atomic_quiz_profile_update()` (P4). Any direct table stamp produces a state the projections disagree with — exactly the half-seeded condition described in Trap 2.

Constraints while seeding:

- **Anti-cheat is live (P3).** Minimum 3 s average per question; no all-same-answer if > 3 questions; response count must equal question count. Speed-clicking through seeding will get the session rejected and you will believe you seeded when you did not. Re-run assertion D after seeding.
- **Deliberately get some answers wrong.** A wall of 100% is not a demo of a learning product, and it produces zero "Needs Revision" rows — the exact bucket you most want on screen.
- **Seed at T-24h, not on demo day** (assertion C).
- Streak: `streak_days` accrues from consecutive active days. If you need a streak faster than calendar time allows, the persona stamp path (`PUT /api/super-admin/demo-accounts {action:'reset'}` re-applies `PERSONA_PROFILES`) sets it directly. That is acceptable for `streak_days` and `xp_total` **only** — never for mastery.

### 3.3 Engineering a live level-up during the demo

`XP_PER_LEVEL = 500`; `calculateLevel(xp) = floor(xp/500) + 1` (`packages/lib/src/xp-config.ts:71-74`). `QuizResults` fires `LevelUpModal` when `calculateLevel(xpBefore) < calculateLevel(xpAfter)`, on a 3.2 s delay after the celebration overlay, and skips idempotent replays (`packages/ui/src/quiz/QuizResults.tsx:206-215`).

A standard 10-question quiz at 8/10 yields `8 × 10 + 20 (>=80% bonus) = 100 XP` (P2). So:

> **Park each demo account at `xp_total ≡ 420 (mod 500)`** — i.e. 420, 920, 1420, 1920, 2420. One live 8/10 quiz then crosses the boundary and the level-up modal fires on stage.

Use assertion D's `xp_to_next_level` column: it should read **80** before you walk in. A perfect 10/10 yields `100 + 20 + 50 = 170` XP, which also crosses — so anything with `xp_to_next_level` between ~20 and ~100 is safe.

Two accuracy notes, both verified 2026-07-29:

1. `ff_level_up_celebration_v1` is `is_enabled = true` (migration `20260624100000`). **However, no call site in `apps/` or `packages/` reads that flag** — `QuizResults` renders `LevelUpModal` purely on the level-crossing condition. The live level-up therefore does not depend on the flag either way. Do not flip it, and do not tell anyone the flag is what makes it work. (Flag-with-no-reader is drift; logged in Section 7.)
2. Daily XP cap is 200 (P2). Two level-boundary crossings in one demo day is not reliably achievable. Plan for one.

### 3.4 Bilingual (P7)

Every string quoted above already ships EN + Hindi from the components (`'No quizzes yet' / 'अभी तक कोई क्विज़ नहीं'`, `'Review now →' / 'अभी दोहराओ →'`, `'Start a streak!' / 'स्ट्रीक शुरू करो!'`, `'Coming Soon' / 'जल्द आ रहा है'`). **Any demo-only copy, label, or seeded content you add must ship both languages.** Set one demo account's `preferred_language = 'hi'` so the Hindi surface is demonstrable without a live toggle if the room asks. Technical terms (CBSE, XP, Bloom's) are not translated.

---

## Section 4 — Teardown

**Hard deadline: `TEARDOWN_DEADLINE` = demo + 48 h.** A demo grant that outlives its demo is unpaid production access with no expiry, which is the P11 violation this whole runbook is arranged to prevent.

### 4.1 Decision: keep-warm or purge

| Situation | Action |
|---|---|
| Deal dead, or demo tenant was throwaway | **Purge** (4.3). |
| Prospect converting; the same tenant will become the paid account | **Do not purge.** Revoke the comp (4.2) and let them go through real Razorpay checkout. Converting a comp'd tenant "in place" is how a school ends up permanently free. |
| Follow-up demo scheduled within 14 days | Revoke comp (4.2), keep accounts, re-grant with a fresh expiry before the next session. Never leave the grant standing between sessions. |

### 4.2 Revoke the comp grant (keep the data)

Step 1 — remove `is_demo` from the school, if Section 5 break-glass was used:

```sql
UPDATE public.schools
SET is_demo = false, updated_at = now()
WHERE id = '<DEMO_SCHOOL_UUID>' AND is_demo = true;
```
Confirm `1 row affected` (or `0` if you never set it).

Step 2 — expire the school subscription:

```sql
UPDATE public.school_subscriptions
SET status = 'cancelled', current_period_end = now(), updated_at = now()
WHERE school_id = '<DEMO_SCHOOL_UUID>'
  AND razorpay_subscription_id IS NULL;   -- guard: never touch a real paid row
```

Step 3 — drop the students back to free:

```sql
UPDATE public.student_subscriptions
SET plan_code = 'free', status = 'cancelled', current_period_end = now(), updated_at = now()
WHERE is_demo = true
  AND student_id IN (
    SELECT id FROM public.students
    WHERE school_id = '<DEMO_SCHOOL_UUID>' AND is_demo = true
  );
```

Step 4 — deactivate the demo accounts:

```
PUT /api/super-admin/demo-accounts       # authorizeAdmin(request, 'admin')
{ "id": "<demo_account_id>", "action": "deactivate" }
```
This writes a `deactivate_demo_account` audit row. Do this for each account.

### 4.3 Purge (destroy the tenant)

Preferred path — the guarded RPC:

```sql
SELECT public.purge_certification_tenant('<DEMO_SCHOOL_UUID>');
```

From migration `20260702180000_certification_tenant_teardown.sql`: it purges every `is_demo = true` student/teacher under the tenant in FK-safe order, then deletes the `schools` row, and **hard-fails with an exception if the target school's `is_demo` is not `true`**. That guard means it structurally cannot be pointed at a real tenant. If you never set `is_demo` on the school, this RPC will refuse — set it, purge, done, or use the per-account DELETE below instead.

Per-account path:

```
DELETE /api/super-admin/demo-accounts?id=<demo_account_id>    # super_admin
```
Cascades the profile, demo subscription, seed data, registry row, and the auth user; writes a `delete_demo_account` audit row.

`DELETE /api/super-admin/institutions?id=...&force=true` will **fail** with an FK violation if any student or teacher still references the school — `students.school_id` / `teachers.school_id` deliberately do NOT cascade. That failure is intentional. Purge accounts first.

### 4.4 Prove no unpaid production access persists

Run all four. This is the exit gate; a teardown is not complete until every one is clean.

**P1 — no lingering demo school flag:**
```sql
SELECT id, name, is_demo, is_active, created_at, updated_at
FROM public.schools
WHERE is_demo = true;
```
Expected: only tenants with a *current, in-window* demo engagement. Any row here older than its `TEARDOWN_DEADLINE` is a live P11 exception with nobody watching it. Escalate to architect.

**P2 — no comp'd school subscription still active:**
```sql
SELECT ss.school_id, s.name, s.is_demo, ss.plan, ss.status,
       ss.seats_purchased, ss.current_period_end, ss.razorpay_subscription_id
FROM public.school_subscriptions ss
JOIN public.schools s ON s.id = ss.school_id
WHERE ss.status IN ('active','trial')
  AND ss.razorpay_subscription_id IS NULL
ORDER BY ss.current_period_end NULLS FIRST;
```
Every row is, by definition, paid access with no payment behind it. Each one must be justifiable as an in-window demo or an intentional trial. **This query is the standing comp-grant register until the endpoint in the requirements spec ships.** Run it weekly regardless of demo activity.

**P3 — no student still on a demo unlimited plan:**
```sql
SELECT ss.student_id, st.account_status, st.is_demo, st.email LIKE '%@alfanumrik.demo' AS demo_email,
       ss.plan_code, ss.status, ss.is_demo AS sub_is_demo, ss.current_period_end,
       public.get_plan_limit(ss.student_id, 'foxy_chat') AS foxy_cap
FROM public.student_subscriptions ss
JOIN public.students st ON st.id = ss.student_id
WHERE ss.is_demo = true AND ss.status = 'active';
```
Expected after teardown: zero rows for the torn-down school. `foxy_cap` is the honest check — if it still reads `999999`, they still have paid quota.

**P4 — no demo account still able to log in:**
```sql
SELECT id, role, display_name, is_active, school_id, created_at, last_reset_at
FROM public.demo_accounts
WHERE school_id = '<DEMO_SCHOOL_UUID>';
```
Expected: zero rows (purge) or all `is_active = false` (revoke).

Record the four results in `docs/operator-notes/<date>-demo-teardown.md` with the school UUID and the operator name.

---

## Section 5 — Break-glass: setting `schools.is_demo` before the endpoint exists

**Read Section 5.0 before doing anything in Section 5.**

### 5.0 Gate

There is **no API route anywhere that sets `schools.is_demo = true` on an existing school.** The only code that ever writes `is_demo: true` onto a `schools` row is `provisionDemoSchool()` inside `apps/host/src/app/api/super-admin/demo-accounts/route.ts:302`, and only at INSERT time, for the throwaway "Demo School — <name>" tenant attached to a `school_admin` demo account. `provision_school` does not set it. Nothing flips it later.

That means today the flag is set by hand in the SQL editor: **an unaudited privileged grant with no actor, no reason, and no expiry.** It is the single worst-governed surface in the payment path. The requirements spec at `docs/superpowers/specs/2026-07-29-demo-comp-grant-endpoint-requirements.md` defines the audited replacement; until backend ships it, this section is the *only* sanctioned manual procedure.

**Do not execute Section 5 unless all four hold:**

1. The demo script requires the school-admin **self-service billing screen** to be exercised live. (If it does not — and most demos do not — you do not need `is_demo`. The trial school subscription plus per-student `unlimited` subscriptions already cover every student-facing and teacher-facing surface.)
2. Explicit CEO approval for this specific school, recorded as `CEO_APPROVAL_REF`.
3. The target school has **no** `school_subscriptions` row with a non-null `razorpay_subscription_id` (assertion 1.1).
4. A teardown deadline is written down before the flag is set, not after.

### 5.1 Pre-flip: capture before-state

```sql
SELECT id, name, is_demo, is_active, updated_at
FROM public.schools WHERE id = '<DEMO_SCHOOL_UUID>';
```
Paste the result into your operator note. This is the `before_state` the missing endpoint would have recorded for you.

### 5.2 Blast-radius check

```sql
SELECT count(*) AS currently_comped FROM public.schools WHERE is_demo = true;
```
If this is already **≥ 5**, STOP and revoke a stale grant first. Five concurrent comp'd tenants is the cap this runbook sets, and the cap the endpoint spec makes mechanical.

```sql
SELECT count(*) AS active_students
FROM public.students
WHERE school_id = '<DEMO_SCHOOL_UUID>' AND is_active = true;
```
If this is **> 50**, STOP. A tenant with a real student body is not a demo tenant; comping it is a revenue event, not an ops action.

### 5.3 The flip

```sql
UPDATE public.schools
SET is_demo = true, updated_at = now()
WHERE id = '<DEMO_SCHOOL_UUID>'
  AND is_demo = false
  AND deleted_at IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.school_subscriptions ss
    WHERE ss.school_id = public.schools.id
      AND ss.razorpay_subscription_id IS NOT NULL
  );
```

The `NOT EXISTS` guard is mandatory — it is the hand-executed version of the endpoint's "never comp a paying customer" rule. Confirm `1 row affected`. If `0`, one of the guards fired; find out which before retrying, do not strip the guard.

Effect once set: the school admin's `POST`/`PATCH /api/school-admin/subscription` takes the comp branch — `status='active'`, `razorpay_subscription_id=null`, `is_demo=true`, period end = now + 1 month (monthly) or + 3 months (quarterly) via `compPeriodEnd()` — and returns `{ comp: true }` with a `subscription.comp_granted` school-audit row. No Razorpay call is made.

### 5.4 Write the audit row by hand (mandatory)

A direct SQL flip leaves no trace in `audit_logs`. You must create one. Replace `<YOUR_ADMIN_AUTH_USER_ID>` with your own `admin_users.auth_user_id`.

```sql
INSERT INTO public.audit_logs (
  auth_user_id, actor_type, admin_level, action,
  resource_type, resource_id, details, before_state, after_state, status
) VALUES (
  '<YOUR_ADMIN_AUTH_USER_ID>', 'admin', 'super_admin',
  'school.demo_grant_granted_manual',
  'school', '<DEMO_SCHOOL_UUID>',
  jsonb_build_object(
    'method',            'manual_sql_break_glass',
    'runbook',           'docs/runbooks/school-demo-playbook.md#section-5',
    'reason',            '<why this school needs a live billing-screen demo>',
    'ceo_approval_ref',  '<CEO_APPROVAL_REF>',
    'expires_at',        '<TEARDOWN_DEADLINE ISO8601>',
    'comped_schools_after', (SELECT count(*) FROM public.schools WHERE is_demo = true),
    'active_students_at_grant', (SELECT count(*) FROM public.students
                                 WHERE school_id = '<DEMO_SCHOOL_UUID>' AND is_active = true)
  ),
  jsonb_build_object('is_demo', false),
  jsonb_build_object('is_demo', true),
  'success'
);
```

**P13:** `details` carries counts, UUIDs, and free-text *operational* reason only. No student names, emails, phone numbers, or parent contact details. No school contact email. Write the reason as "prospect requires live billing-screen walkthrough", not "Mr. Sharma at 98xxx asked to see billing".

### 5.5 Revoke (mandatory at `TEARDOWN_DEADLINE`)

Section 4.2 step 1, plus a matching hand-written audit row with `action = 'school.demo_grant_revoked_manual'` and the inverse before/after states. **A grant row with no revoke row is an open P11 exception.** Section 4.4/P1 is the query that finds them.

---

## Section 6 — Audit posture

### 6.1 What must be logged, for every grant

| Event | Where it comes from today | Action name | Actor |
|---|---|---|---|
| School provisioned | `POST /api/super-admin/institutions/provision` → `logAdminAudit` | `school.provisioned` | admin |
| Demo student created | `POST /api/super-admin/demo-accounts` → `logAdminAudit` | `create_demo_account` | admin |
| Demo account reset / regenerated | `PUT /api/super-admin/demo-accounts` | `reset_demo_account` / `regenerate_demo_account` | admin |
| Demo account deactivated | `PUT .. {action:'deactivate'}` | `deactivate_demo_account` | admin |
| Demo account deleted | `DELETE /api/super-admin/demo-accounts` | `delete_demo_account` | admin |
| **School comp entitlement granted** | `POST`/`PATCH /api/school-admin/subscription` comp branch → `logSchoolAudit` | `subscription.comp_granted` | school admin |
| **`schools.is_demo` set** | **nothing — manual, see §5.4** | `school.demo_grant_granted_manual` | admin (hand-written) |
| **`schools.is_demo` cleared** | **nothing — manual, see §5.5** | `school.demo_grant_revoked_manual` | admin (hand-written) |

The two bolded manual rows are the governance hole. They are why the requirements spec exists.

`logAdminAudit` dual-writes to `audit_logs` (canonical, `actor_type='admin'`) and `admin_audit_log` (legacy). Read from `audit_logs`.

### 6.2 P13 — what audit details may and may not contain

**Allowed:** UUIDs (school_id, student_id, subscription id), plan codes, seat counts, billing cycle, period end, boolean flags, counts, operational reason strings, ticket references, admin level, IP address.

**Forbidden in `details`:** student name, student email, parent/guardian name, phone number, address, any free-text field a student wrote, school billing-contact email, any prospect's personal contact details.

Note a known wart to work around, not to copy: `logAdminAudit` itself enriches every row with `admin_name` and `admin_email` (the *operator's* own identity, not a student's), and the demo-accounts route passes `name` and `email` of the created demo account into `details`. Demo emails are synthetic `@alfanumrik.demo` values, so this does not leak student PII today — **but only because the `@alfanumrik.demo` rule in §1.3 is followed.** Create a demo account with a prospect's real email and you have just written a real person's address into the audit log. That is the enforcement reason behind the naming rule, not tidiness.

### 6.3 Standing weekly check (run this even when there is no demo)

Section 4.4 queries P1 and P2 together are the comp-grant register. Run them every Monday. Any `schools.is_demo = true` row, or any `status IN ('active','trial') AND razorpay_subscription_id IS NULL` school subscription, that you cannot tie to an in-window demo is an unexplained comp. Escalate to architect same-day.

---

## Section 7 — Known drift and open items

| Item | Status | Owner |
|---|---|---|
| No audited setter for `schools.is_demo` | **Open.** Spec written: `docs/superpowers/specs/2026-07-29-demo-comp-grant-endpoint-requirements.md`. Break-glass in §5 until it ships. | backend (impl), architect (P11 + schema), ops (contract) |
| No expiry column on the comp grant — `schools.is_demo` is a naked boolean with no `demo_expires_at` | **Open.** Schema change required. Until then, expiry lives only in the hand-written audit row and this runbook's deadline. | architect |
| `get_plan_limit` ignores school coverage while `effective-plan.ts` honours it — two disagreeing entitlement resolvers | **Open, by far the highest-impact item here.** This is the actual root cause of the failed demo, and it affects real B2B customers too, not just demos: a genuinely school-covered student gets free-tier Foxy quota. Not an ops fix. | architect + backend (assessment to validate any learner-facing limit change) |
| `ff_level_up_celebration_v1` is ON in the DB with **no reader** in `apps/` or `packages/` | **Open (drift).** Harmless today (the modal fires on level-crossing regardless), but a flag nobody reads is a flag nobody can turn off. | ops (registry), frontend (reader or removal) |
| `PERSONA_PROFILES` seeds only `xp_total` + `streak_days`, producing the half-seeded dashboard in Trap 2 | **Open.** A "seed realistic history" action on the demo-accounts route would remove 60-90 min of manual quiz-playing per demo. | ops (spec), backend (impl) |

---

## Related runbooks

- [`b2b-school-activation-playbook.md`](./b2b-school-activation-playbook.md) — flag activation for a **real** pilot school. Read it for the flag-scoping semantics; do not confuse a pilot with a demo.
- [`school-onboarding.md`](./school-onboarding.md) — the paid onboarding path.
- [`feature-flag-governance.md`](./feature-flag-governance.md) — before touching any flag for a demo (short version: don't).
- [`projector-failure.md`](./projector-failure.md) — unrelated by name (projector = event projector), but the escalation shape is the house pattern.
- [`payment-dispute-response.md`](./payment-dispute-response.md) — if a comp grant is ever mistaken for a paid subscription downstream.
- `docs/superpowers/specs/2026-07-29-demo-comp-grant-endpoint-requirements.md` — the endpoint that replaces Section 5.
