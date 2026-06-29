# PP-1 / PP-3 Consent Remediation — Option B Design

**Status:** Design (implementation-ready). No app code changed by this doc.
**Decision:** CEO-approved **Option B** — the legacy `parent_login` Edge path creates a
**`pending`** guardian↔child link (not immediate `active`) and reuses the existing
**student-approval** flow (`pending` → `approved`, approved by the student/child).
**Owning agent for this doc:** frontend (page/component design) + handoffs noted in §8.
**Must not break:** P15 parent-onboarding funnel.

---

## 0. Executive summary

The consent posture changes from:

> `parent_login` link-code match → link is `active`/`is_verified:true` immediately →
> parent sees child data with **no child consent**.

to:

> `parent_login` link-code match → link is `pending`/`is_verified:false` → **no child data** until
> the **student** approves the request → link becomes `approved` → parent gets access.

Two surfaces must change (backend) + two must be added/wired (frontend):

| # | Change | Agent | Exists today? |
|---|---|---|---|
| A | `handleParentLogin` inserts `status:'pending'` (both branches) + returns a "pending" signal | backend | NO — inserts `active` |
| B | Parent UI shows "waiting for child to approve" instead of routing to dashboard | frontend | NO |
| C | Student approval surface is **discoverable on the live dashboard** | frontend | **Component exists but is NOT wired** (see §1 — CRITICAL) |
| D | Student is notified a parent requested a link | backend (+frontend) | NO parent-link notification type |

No schema migration is required for the link state itself (§7).

---

## 1. CRITICAL — Student approval surface (does it exist?)

**Answer: the component and the API exist, but the live student dashboard does NOT render them.
The approval surface is effectively dead-coded. Option B therefore REQUIRES re-wiring it, or
every `parent_login` request dead-ends with no way for the student to approve.**

What exists:

- **API route (works, tested):** `src/app/api/parent/approve-link/route.ts`.
  - Authenticates the **student** via cookie session (`createSupabaseServerClient`, `getUser()`),
    resolves their `students.id` (route.ts:73-77), fetches the `pending` link via
    `findLinkById(linkId, 'pending')` (route.ts:91), verifies `link.studentId === student.id`
    (route.ts:108) — REG-117 boundary — then flips `pending` → `approved`/`rejected` via the admin
    client (route.ts:115-120). Response `{ success, status }`.
  - Test: `src/__tests__/api/parent/approve-link/route.test.ts`.
- **Student-facing component (bilingual, P7-clean):** `src/components/dashboard/PendingLinkApproval.tsx`.
  - Renders a "Parent Link Request / अभिभावक लिंक अनुरोध" card with Approve/Reject buttons, calls
    `POST /api/parent/approve-link` (PendingLinkApproval.tsx:47-51), shows success/declined states.
  - Props: `{ links: PendingLink[]; onApproved: () => void; isHi }` where
    `PendingLink = { id; parentName; requestedAt }` (PendingLinkApproval.tsx:8-12).
- **A wrapper that mounts it:** `src/components/dashboard/sections/UpcomingSection.tsx:18,182-183`
  renders `<PendingLinkApproval pendingLinks=… />`.
- **A server RPC that supplies the data:** `get_pending_link_requests(p_student_auth_id uuid)` in the
  baseline (`supabase/migrations/00000000000000_baseline_from_prod.sql:4773-4776`). SECURITY DEFINER,
  returns `{ requests: [{ link_id, guardian_id, guardian_name, guardian_email, relationship,
  requested_at }] }` for all `status='pending'` rows on the student. (There is also
  `student_respond_to_link_request(...)` at :7225 — an alternate RPC-based approve path; the route above
  is the one already used by the UI, so reuse it.)

**The gap (why this is CRITICAL):**

- The **live student dashboard is `src/app/dashboard/StudentOSDashboard.tsx`** (loaded by
  `src/app/dashboard/page.tsx:6` via `dynamic(() => import('./StudentOSDashboard'))`).
- `StudentOSDashboard.tsx` renders only `TodaysMission`, `MasterySnapshot`, `BoardScoreWidget`,
  `RevisionRail`, `SubjectRoadmaps` (StudentOSDashboard.tsx:184-215). It does **NOT** import
  `UpcomingSection` or `PendingLinkApproval`, and there is **no `get_pending_link_requests` caller
  anywhere in `src/`** (grep confirms only `src/types/database.types.ts` references it).
- `UpcomingSection.tsx` (the only thing that mounts `PendingLinkApproval`) is **imported by nothing**
  — it is orphaned from the current dashboard.

**Conclusion:** Today a `pending` link is invisible to the student. If we ship the backend change
(§2) without wiring an approval surface, real parents will be permanently stuck at "pending" → P15
break. Re-wiring the approval surface is a **required, non-optional** part of Option B.

### Designed minimal surface (frontend)

Add a pending-request card to the **live dashboard** `StudentOSDashboard.tsx`, reusing the existing
component (no new component needed):

1. **Fetch** pending requests in `StudentOSDashboard` once `student` is resolved. Add a thin client
   helper in `src/lib/supabase.ts` (frontend-owned), e.g. `getPendingParentLinks()` that calls
   `supabase.rpc('get_pending_link_requests', { p_student_auth_id: <auth user id> })` and maps each
   row to `PendingLink { id: link_id, parentName: guardian_name, requestedAt: requested_at }`.
   - Auth user id is available from `useAuth()` (`authUserId`) already destructured in the dashboard.
   - Empty array on error (fail-soft; never block the dashboard — P15).
2. **Render** `<PendingLinkApproval links={pendingLinks} onApproved={refetch} isHi={isHi} />` near the
   top of the content column in `StudentOSDashboard.tsx` (e.g. directly under `headerRail`, before
   `TodaysMission` at :184) so a waiting request is the first actionable thing the child sees. The
   component self-hides when `links.length === 0` (PendingLinkApproval.tsx:141), so there is zero
   cost when nothing is pending.
3. **State:** `const [pendingLinks, setPendingLinks] = useState<PendingLink[]>([])`; load in a
   `useEffect` keyed on `student?.id`; `onApproved` re-runs the fetch.
4. Bilingual is already handled inside `PendingLinkApproval` (P7). No new strings needed for the card
   itself.

> Reuse note: do **not** revive `UpcomingSection` just for this — it carries unrelated board-exam
> markup. Mount `PendingLinkApproval` directly in `StudentOSDashboard` to keep the bundle minimal
> (P10) and the surface above-the-fold.

---

## 2. Backend change — `handleParentLogin`

File: `supabase/functions/parent-portal/index.ts`.

### 2a. Authed-guardian branch (lines 197-207)

Current insert creates an active, verified link:

```ts
if (!existingAuthLink) {
  await supabase.from('guardian_student_links').insert({
    guardian_id: guardianId,
    student_id: student.id,
    status: 'active',          // ← change to 'pending'
    link_code: linkCode,
    is_verified: true,         // ← change to false
    linked_at: new Date().toISOString(),
    initiated_by: 'parent_login',
  })
}
```

Change to:

```ts
if (!existingAuthLink) {
  await supabase.from('guardian_student_links').insert({
    guardian_id: guardianId,
    student_id: student.id,
    status: 'pending',
    link_code: linkCode,
    is_verified: false,        // consent is separate from intent; verified only on approval
    linked_at: new Date().toISOString(),
    initiated_by: 'parent_login',
  })
  // (then create the student notification — see §4)
}
```

### 2b. New-guardian branch (lines 292-300)

Apply the identical change (`status:'pending'`, `is_verified:false`, keep
`initiated_by:'parent_login'`).

### 2c. `is_verified` rationale

Keep `is_verified:false`. The link-code match proves the **parent's intent** (they hold the code) but
**consent is a separate event** performed by the student. `is_verified` should track consent, and the
approve-link route already does not set `is_verified` on approve (route.ts:119 sets only `status` +
`updated_at`). If product wants `is_verified` to flip true on approval, that is an assessment/backend
decision for the approve route — out of scope here; the safe default is `false` at creation.

### 2d. Response must be a "pending" signal, not a data-bearing session

Current both-branch responses (index.ts:209-217, 303-311) return
`{ guardian:{id,name}, student:{id,name,grade} }`, which the parent UI treats as "logged in → go to
dashboard". Change the response to carry an explicit pending flag, e.g.:

```ts
return jsonResponse(
  {
    status: 'pending_approval',
    guardian: { id: guardianId, name: guardianName },
    student: { id: student.id, name: student.name },   // name only (no grade/stats payload)
    message_en: 'Request sent. Ask your child to approve it in their Alfanumrik app.',
    message_hi: 'अनुरोध भेजा गया। अपने बच्चे से उनके Alfanumrik ऐप में इसे स्वीकार करने को कहें।',
  },
  200, {}, origin,
)
```

Notes:
- Do **not** return `grade` or any stat — the parent has no approved access yet (P13). Returning the
  child's first name is acceptable so the UI can say "waiting for <name>".
- If a re-submit hits an **already-approved** link, the handler should detect it and return
  `status:'approved'` so the parent UI can route straight to the dashboard (§5).

### 2e. Confirm `pending` grants NO access

- `ACTIVE_GUARDIAN_LINK_STATUSES = ['approved','active']` (`src/lib/domains/types.ts:630-633`;
  `src/lib/domains/relationship.ts:36,146`). `'pending'` is excluded, so every relationship read
  (`listChildrenForGuardian`, `isGuardianLinkedToStudent`, `listGuardiansForStudent`) returns nothing
  for a pending link.
- The Edge data handlers gate on `.in('status', ['active','approved'])`:
  `handleGetChildren` (index.ts:334), `handleGetAllChildrenDashboard` (:649),
  `handleGetChildDashboard` link check (:713), `handleGetChildAttendance` (:922),
  `handleGetMonthlyReport` (:985). A pending link fails all of them → 403 / empty.
- The DB RLS boundary `is_guardian_of` only counts `status = 'approved'`
  (baseline:8973-8974) — so RLS-scoped reads (e.g. `performance_scores`, `student_lab_streaks`
  queried directly from `parent/page.tsx:419,438`) also return nothing while pending.

Net: a `pending` row opens no data path. ✔

---

## 3. Parent UX change — `src/app/parent/page.tsx`

The submit handler is `LoginScreen.submit` (parent/page.tsx:117-161). Success path today:

```ts
const res = await api('parent_login', {...});       // :144
...
clearLockoutAttempts();                              // :153
await storeParentSession(res.guardian, res.student); // :154
onLogin(res.guardian, res.student);                  // :155 → routes into Dashboard
```

Change: branch on `res.status`.

```ts
const res = await api('parent_login', { link_code: code, parent_name: name || 'Parent', auth_user_id: authUserId || null });
setLoading(false);
if (res.error) { /* unchanged lockout handling */ return; }

if (res.status === 'pending_approval') {
  clearLockoutAttempts();
  setPendingApproval({ childName: res.student?.name });   // new local state → render waiting screen
  return;                                                 // do NOT storeParentSession / onLogin
}

// res.status === 'approved' (already-linked re-submit) OR legacy shape → existing behavior
clearLockoutAttempts();
await storeParentSession(res.guardian, res.student);
onLogin(res.guardian, res.student);
```

Add a bilingual **"waiting for your child to approve"** view (a sibling to the existing
`needsSignIn` block at parent/page.tsx:166-203). Copy (P7):

- EN title: "Request sent to {childName}" / HI: "{childName} को अनुरोध भेजा गया"
- EN body: "Ask your child to open Alfanumrik and approve your request. Once they approve, your
  dashboard unlocks automatically." / HI: "अपने बच्चे से Alfanumrik खोलकर आपके अनुरोध को स्वीकार करने
  को कहें। स्वीकार करते ही आपका डैशबोर्ड अपने आप खुल जाएगा।"
- A "Check again / फिर से जाँचें" button that re-calls `parent_login` (idempotent — §5) and, if the
  link is now `approved`, proceeds to the dashboard.

Do not change the existing `LinkCodeSignInGate` / `needsSignIn` JWT-gating logic
(parent/page.tsx:124-137, 256-295) — that is a separate P15 fix and stays intact. The pending state
sits **after** the JWT check (the parent always has a JWT by the time `parent_login` runs).

---

## 4. Notify the student

**No existing parent-link notification type.** There is a generic notifications stack: a notifications
table read by `getStudentNotifications` (`src/app/notifications/page.tsx:6,102`),
`mark_notification_read` / `mark_all_notifications_read` RPCs (notifications/page.tsx:113,122), and a
`generate_student_notifications(p_student_id)` RPC in the baseline (:4152). The notifications page
renders `type`-driven rows with `data.icon` and `data.*_hi` bilingual fields
(notifications/page.tsx:187-193) — the same "no top-level `*_hi` column" house shape used elsewhere.

**Design (minimal, reuse the table):** when `handleParentLogin` creates a `pending` link (§2a/2b,
inside the `if (!existingAuthLink)` guard and the new-guardian insert), also insert one student
notification via the service-role client:

```ts
await supabase.from('notifications').insert({
  student_id: student.id,
  type: 'parent_link_request',
  title: 'A parent wants to link to your account',
  body: `${guardianName} requested to view your progress. Approve or decline on your dashboard.`,
  data: {
    icon: '🔔',
    link_id: <the inserted link id>,        // select().single() the insert to get the id
    title_hi: 'एक अभिभावक आपके अकाउंट से जुड़ना चाहता है',
    body_hi: `${guardianName} ने आपकी प्रगति देखने का अनुरोध किया है। अपने डैशबोर्ड पर स्वीकार या अस्वीकार करें।`,
  },
});
```

- This makes the request discoverable in **two** places: the in-app notification (with a tap target
  that can deep-link to `/dashboard`) and the dashboard card from §1.
- **Reuse vs new type:** this introduces a new `type` value `parent_link_request`. Confirm the
  notifications table's `type` column is free-text (no CHECK enumerating allowed types). If it is
  CHECK-constrained, an additive migration is needed — flag to architect (§7).
- P13: store only `guardianName` (already non-PII-shaped — a display name the parent typed) and the
  `link_id`. Do **not** store guardian email/phone in the notification.
- Best-effort: wrap the notification insert in try/catch and never let it fail the `parent_login`
  response (P15 — the link request must still succeed even if the notify write hiccups).

---

## 5. RLS / idempotency

- **RLS for the insert:** the Edge function uses the **service-role** client `getServiceClient()`
  (index.ts:29-33, 149) which **bypasses RLS** — confirmed. The `pending` insert is allowed
  regardless of RLS policies. (This is consistent with how the function already inserts `active` rows
  today.)
- **Unique constraint:** `guardian_student_links_guardian_id_student_id_key UNIQUE (guardian_id,
  student_id)` (baseline:15412). There is also a partial unique index
  `idx_gsl_unique_pending_student` on `(student_id) WHERE guardian_id IS NULL AND status='pending'`
  (baseline:17162) — that guards the minor-invite NULL-guardian placeholder and is unaffected here
  (our rows always have a non-null `guardian_id`).
- **Re-submit behavior (no duplicate, no silent re-activate):**
  - Authed branch: the insert is guarded by `if (!existingAuthLink)` where `existingAuthLink` is
    looked up by `(guardian_id, student_id)` **regardless of status** (index.ts:189-196). So a second
    `parent_login` for the same pair — whether the existing row is `pending`, `approved`, or
    `rejected` — performs **no insert** and cannot create a duplicate or downgrade.
  - Defense-in-depth: add `.upsert(..., { onConflict: 'guardian_id,student_id', ignoreDuplicates:
    true })` (or an explicit `ON CONFLICT DO NOTHING`) to the insert so a concurrent double-submit
    race can never 23505-error or overwrite an `approved` row back to `pending`.
- **Re-running for an already-`approved` link must NOT downgrade:** because the insert is skipped when
  any link exists (above), an approved link is never touched → no downgrade. The handler should, in
  that case, **read the existing link's status** and return `status:'approved'` in the response so the
  parent UI routes to the dashboard (this is the "Check again" path from §3). Implementation: after the
  `existingAuthLink` lookup, if it exists, `select('status')` and branch the response on it.

---

## 6. P15 funnel safety — step by step

New funnel (no real parent is hard-blocked):

1. Parent signs in / creates account (mints JWT) — unchanged (parent/page.tsx:124-137, 188-193).
2. Parent enters the child's link code → `parent_login` runs with a valid JWT.
3. Edge creates a `pending` link (`is_verified:false`) + inserts a student notification (§2, §4).
4. Parent sees "Request sent to {child} — waiting for approval" (§3). No dead-end, no opaque error.
5. Student sees the request on their dashboard card (§1) and/or in notifications (§4) and taps
   **Approve** → `/api/parent/approve-link` flips `pending` → `approved`.
6. Parent taps "Check again" (or returns later) → `parent_login` now returns `status:'approved'` →
   dashboard unlocks. (Guardian-mode parents also auto-resolve via `get_children`, which now returns
   the approved child — parent/page.tsx:595-618.)

Edge cases:

- **Student approves on a different device:** fine — approval is server-side state; the parent's
  "Check again"/next load picks it up. No device coupling.
- **Parent with no linked student yet / never approved:** stays `pending` indefinitely; parent sees
  the waiting screen, no data leak. Acceptable (this is the desired consent gate).
- **Self-guardian / student linking themselves:** `parent_login` keys the guardian off the caller's
  JWT; a student account isn't a guardian. The dedicated link RPCs already reject self-linking
  (`link_guardian_via_invite_code`, accept-invite/route.ts:96-98); `parent_login` creates a distinct
  guardian row, so a student can't self-approve a parent link to their own data. No special handling
  needed.
- **Rejected then re-submitted:** existing `rejected` row blocks the insert (lookup is
  status-agnostic) → parent gets no new pending row. If product wants a rejected request to be
  re-requestable, that's a follow-up (would need the lookup to ignore `rejected`/`revoked`). Flag to
  backend; default behavior (one shot) is safe and not a P15 break.
- **Legacy already-`active` rows (pre-change):** untouched; they remain `active` and keep working
  (they're in `ACTIVE_GUARDIAN_LINK_STATUSES`). This change only affects newly created links — no
  backfill, no break for existing linked parents.

---

## 7. Migration?

**No migration required for the link state.**

- `pending` is already a valid status: `chk_link_status CHECK (status = ANY
  ('pending','active','approved','rejected','revoked'))` (baseline:11428) and the column default is
  already `'pending'` (baseline:11420). The TS union `GuardianLinkStatus` already includes `'pending'`
  (types.ts:623-628).
- The student approval surface needs **no schema change** — `get_pending_link_requests` and
  `/api/parent/approve-link` already exist.

**One thing to confirm (flag to architect):** the `notifications` table `type` column. If it is plain
TEXT (no CHECK enumerating notification types), no migration is needed for the new
`parent_link_request` type (§4). If `type` is CHECK-constrained, add an **additive** migration to
include `'parent_link_request'`. Architect to confirm the notifications schema; this is the only
possible migration in scope and it is additive (never a DROP).

---

## 8. Review chain + REG plan

**Implementing agents / handoffs:**

| Agent | Work |
|---|---|
| **backend** | `handleParentLogin` `status:'pending'` + `is_verified:false` (both branches), pending/approved response shape, student notification insert, `ON CONFLICT DO NOTHING` defense, already-approved re-submit branch. |
| **frontend** | Parent "waiting for approval" state in `parent/page.tsx`; wire `PendingLinkApproval` into the live `StudentOSDashboard.tsx` + `getPendingParentLinks()` helper in `src/lib/supabase.ts`; notification-tap deep-link. |
| **architect** | Confirm `notifications.type` accepts `parent_link_request` (additive migration only if CHECK-constrained); confirm no RLS change needed (service-role insert path). Review the consent-boundary change. |
| **testing** | E2E for the full `pending → student approves → parent gains access` flow; negative test that a `pending` link yields 403/empty on every parent data handler; idempotency test (re-submit doesn't downgrade `approved`). |
| **quality** | Final gate (type-check, lint, build, bundle budget for the dashboard card, UX audit of the waiting + approval screens). |

This is a consent-model change touching the parent↔child boundary (P8/P13) and the onboarding funnel
(P15) — it requires the **onboarding/signup flow** review chain (architect → backend, frontend,
testing for all relevant roles) plus assessment is **not** needed (no learner-state/scoring change).

**REG plan (replaces the earlier characterization-tripwire idea):**

The prior PP-1 posture was pinned as "active-without-approval" (a tripwire that would fire if anyone
tried to change it). Since Option B **intentionally changes** that behavior, retire the tripwire and
pin the **new** invariant:

- **REG (new):** `parent_login` creates a `pending` link (never `active`/`is_verified:true`), and
  guardian access to any child data requires a `status='approved'` link produced by the
  **student-driven** approve-link flow. Concretely the regression test asserts:
  1. A fresh `parent_login` inserts `status='pending'`, `is_verified=false`, `initiated_by='parent_login'`.
  2. While `pending`, every parent data handler (`get_children`, `get_child_dashboard`,
     `get_child_attendance`, `get_monthly_report`) returns 403/empty, and `is_guardian_of` is false.
  3. After `/api/parent/approve-link` flips to `approved`, the same handlers return data.
  4. Re-running `parent_login` on an `approved` pair does **not** downgrade it to `pending` (no
     duplicate row; unique `(guardian_id, student_id)` preserved).
  5. The student approval surface is reachable from the live dashboard (guard against the
     §1 orphaning regressing again — e.g. assert `StudentOSDashboard` renders `PendingLinkApproval`
     or that a dashboard render with a pending link shows the approve card).
- This becomes the next free REG id in `.claude/regression-catalog.md` (catalog is authoritative;
  do not hard-code the number here).

---

## Appendix — file:line anchors

- Backend insert (active branch): `supabase/functions/parent-portal/index.ts:197-207`
- Backend insert (new-guardian branch): `supabase/functions/parent-portal/index.ts:292-300`
- Existing-link status lookup: `supabase/functions/parent-portal/index.ts:189-196, 232-238`
- parent_login JWT requirement: `supabase/functions/parent-portal/index.ts:1209-1226`
- Data handlers' `['active','approved']` gate: index.ts:334, 649, 713, 922, 985
- Approve route (student-driven): `src/app/api/parent/approve-link/route.ts:73-77, 91, 108-120`
- Approve route test: `src/__tests__/api/parent/approve-link/route.test.ts`
- Student approval component (exists): `src/components/dashboard/PendingLinkApproval.tsx:8-12, 47-51, 140-141`
- Orphaned wrapper: `src/components/dashboard/sections/UpcomingSection.tsx:18, 182-183`
- Live student dashboard (no approval surface): `src/app/dashboard/StudentOSDashboard.tsx:184-215`
- Dashboard loader: `src/app/dashboard/page.tsx:6`
- Pending-requests RPC: `supabase/migrations/00000000000000_baseline_from_prod.sql:4773-4776`
- Alt approve RPC: baseline:7225 (`student_respond_to_link_request`)
- Parent submit handler: `src/app/parent/page.tsx:117-161` (success at 152-155)
- Parent JWT-gate / sign-in screens: `src/app/parent/page.tsx:124-137, 166-203, 256-295`
- `ACTIVE_GUARDIAN_LINK_STATUSES`: `src/lib/domains/types.ts:630-633`; `src/lib/domains/relationship.ts:36, 146`
- `is_guardian_of` (status='approved' only): baseline:8973-8974
- Table def (default 'pending', chk_link_status, unique key): baseline:11411-11429, 15412
- Partial unique index (NULL-guardian pending): baseline:17162
- Notifications stack: `src/app/notifications/page.tsx:6, 102, 113, 122, 187-193`;
  `generate_student_notifications` baseline:4152
