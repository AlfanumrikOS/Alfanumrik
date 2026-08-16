# Phase 2 (Console Merge) — Support Ticket Queue Capability-Parity Spec

**Status:** SPEC — research only, no application code changed by this document or its authoring task.
**Date:** 2026-08-16
**Owner:** ops (this spec). Implementation to follow the standing review chain: backend (if `/api/super-admin/support` needs a new action or a new route is preferred) — likely N/A, since this reuses the existing `/api/internal/admin/support` API verbatim — frontend (new page/component), testing (capability-parity tests, the Phase-2 release blocker), quality.
**Parent doc:** `docs/superpowers/specs/2026-08-16-super-admin-mission-control-design.md` §4 Phase 2 ("Console merge... support queue first... Capability-parity tests (testing-owned) required green before any legacy `/internal/admin` route/page deletion.")
**Scope:** The support-ticket queue only (D2's stated first slice). Does not cover the other 9 `/internal/admin` tabs, Access Studio (Phase 3), Users 360 (Phase 4), or Report Center (Phase 5).

---

## 1. Capability inventory — `SupportTab.tsx` vs `super-admin/support/page.tsx`

Source files read in full for this table:
- `apps/host/src/app/internal/admin/_components/SupportTab.tsx` (457 lines)
- `apps/host/src/app/api/internal/admin/support/route.ts` (339 lines — GET/PATCH/POST)
- `apps/host/src/app/api/internal/admin/support/metrics/route.ts` (355 lines — adjacent, NOT called by SupportTab, see §1.3)
- `apps/host/src/app/super-admin/support/page.tsx` (843 lines)
- `apps/host/src/app/api/super-admin/support/route.ts` (285 lines — GET/POST)
- `apps/host/src/app/internal/admin/_hooks/useAdminFetch.ts`
- `apps/host/src/app/super-admin/_components/AdminShell.tsx` (`useAdmin()` / `apiFetch` / `apiFetchJson`)
- `apps/host/src/app/internal/admin/_lib/internal-admin-types.ts` (`SupportTicket` shape)
- `apps/host/src/proxy.ts` (Layer 2.1 gate, lines ~1251-1324)

### 1.1 Capability-by-capability table

| # | Capability (in `SupportTab.tsx`) | Exact API call | Response fields consumed | Equivalent on `/super-admin` side today? |
|---|---|---|---|---|
| 1 | Ticket list, filtered by status tabs (`open`/`pending`/`resolved`/`all`) | `GET /api/internal/admin/support?status=<s>&page=<n>&limit=25` | `{ data: SupportTicket[], total }` | **No.** `GET /api/super-admin/support` has no `status`/ticket-list mode at all — its only actions are `user_activity`, `failed_jobs`, `parent_links`, `class_mappings` (verified: no reference to `support_tickets` anywhere in the file). |
| 2 | Pagination (Prev/Next, fixed page size 25, page count derived from `total`) | Same GET, `page` param (client always sends `limit=25`; server clamps to `min(100, limit)`) | `total`, `data.length` (for "Next" disabled state) | No. |
| 3 | Manual refresh (`↻` button) | Re-invokes the same GET | — | No. |
| 4 | Ticket count display (`{ticketTotal} tickets`) | Same GET | `total` | No. |
| 5 | List loading / error / empty — three distinct states (error is NOT silently rendered as empty) | Client-side only, driven by GET success/throw | — | Partial pattern exists elsewhere on `/super-admin` (e.g. failed-jobs table in the current page swallows errors silently — see §1.2 note) but no ticket-specific version. |
| 6 | Ticket card: subject, message (full body, `whiteSpace: pre-wrap`), created_at, status badge (red=open/yellow=pending/green=resolved), `admin_notes` shown inline if present | Same GET (list mode) | `SupportTicket { id, student_id, subject, message, status, admin_notes, created_at }` (per `internal-admin-types.ts:39-47`) | No. |
| 7 | Thread & reply toggle — expand exactly one ticket at a time, collapsing on re-click | `GET /api/internal/admin/support?ticket_id=<uuid>` | `{ ticket, replies }` | No. |
| 8 | Thread rendering — operator vs. requester attribution, internal-vs-visible badge (🔒 INTERNAL / 👁 Visible to student), distinct border styling (dashed amber vs. solid), per-reply timestamp | Same GET (thread mode) | `replies[]: { id, author_role, author_user_id?, body, is_internal, created_at }` (operator sees the WHOLE thread incl. internal notes — the student-facing route filters `is_internal=false`, this one does not) | No. |
| 9 | Thread loading / error (retry button) / empty ("No replies yet") — three distinct states | Client-side, same GET | — | No. |
| 10 | Resolve ticket (button hidden once `status === 'resolved'`) | `PATCH /api/internal/admin/support` body `{ id, status: 'resolved' }` | `{ success: true }`; local state optimistically updates ticket status | No. (`/api/super-admin/support` has no PATCH handler at all — only GET and POST.) |
| 11 | Reply composer with a radiogroup toggle: **Internal note** (default, safe) vs. **Reply to student**; resets to internal after every send; audience banner names the recipient in plain language every time | `POST /api/internal/admin/support` body `{ ticket_id, body, is_internal }` | `{ success, reply, ticket_status }` — `reply` appended to thread; `ticket_status` (server may auto-flip `open`→`pending` on a public reply) syncs the list row | No. |
| 12 | Client-side length guard, 5000 chars (`REPLY_MAX_LENGTH`), live counter, send button disabled over-limit | Mirrors server's `support_ticket_replies` body CHECK | — | N/A (no reply capability exists to guard) |
| 13 | Distinct error copy for internal-note-save-failure vs. reply-send-failure (explicitly reassures "the student did NOT receive it" on POST failure) | Same POST, catch branch | — | No. |
| 14 | Toast callback on resolve/reply success or failure (`onToast` prop, wired by the parent internal-admin page's toast host) | — (client only) | — | No toast host wired into `/super-admin/support` today for this purpose. |
| 15 | **Bulk actions** | — | — | **None exist in `SupportTab.tsx`** — every operation (resolve, reply) is single-ticket. Nothing to replicate. |
| 16 | **Category filter/display** | — | — | **Not present in `SupportTab.tsx` or its GET**, even though `support_tickets.category` exists in the DB and is read by the sibling metrics route (§1.3). List-mode GET only accepts `status`/`page`/`limit` — no `category` query param today. If the new page wants category filtering it is new scope beyond parity, not a gap to "fix." |
| 17 | **Metrics / SLA counts** | — | — | Not shown in `SupportTab.tsx`. A separate, unused-by-this-tab endpoint exists (§1.3) — flagged for awareness, out of scope for this parity pass. |

### 1.2 Backend API — exact contract to replicate

`apps/host/src/app/api/internal/admin/support/route.ts`:

- **`GET ?status=open|pending|resolved|all&page=<n>&limit=<n>`** (list mode; `ticket_id` param absent)
  - Auth: `authorizeRequest(request, 'support.view_tickets')`
  - Defaults: `status` → `'open'`, `page` → `1`, `limit` → `25` (server clamps to `min(100, limit)`)
  - No `category` param supported (confirmed by reading the full query-parsing block, lines 169-186)
  - Query: `support_tickets` ordered `created_at desc`, `range(offset, offset+limit-1)`, `count: 'exact'`
  - Response: `{ data: SupportTicket[], total, page, limit }`
- **`GET ?ticket_id=<uuid>`** (thread mode; overrides list mode when present)
  - Same auth (`support.view_tickets`)
  - UUID-validated (400 on malformed), 404 if ticket not found
  - Returns the **full** ticket row (`select('*')`) + up to `MAX_REPLIES = 500` replies, ascending by `created_at`, **including internal notes** (operator console — deliberate, contrasted against the student-facing route which filters `is_internal=false`)
  - Response: `{ ticket, replies }`
- **`PATCH { id, status?, admin_note? }`**
  - Auth: `authorizeRequest(request, 'support.manage_tickets')`
  - Sets `resolved_at` when `status === 'resolved'`; fires a best-effort student notification (`notifyTicketOwner`, only for `user_role === 'student'` tickets, never for parent/teacher-filed tickets — P13 anchor-scope note in source)
  - Audits via `logAdminAction` — **actor-attributed** (`actorUserId: auth.userId`) — status + `admin_note_length` only, never note text (P13)
- **`POST { ticket_id, body, is_internal? }`**
  - Auth: `authorizeRequest(request, 'support.manage_tickets')`
  - `body` validated non-empty, ≤5000 chars; `author_role` is **server-pinned to `'operator'`**, never client-supplied (forgery guard)
  - Auto-transitions `open` → `pending` on a non-internal (`is_internal=false`) reply
  - Fires the same best-effort student notification for non-internal replies only
  - Audits via `logAdminAction` — actor-attributed, `{ reply_id, is_internal, body_length }` only, never reply text (P13)
  - Response: `{ success, reply, ticket_status }`

**Already migrated to `authorizeRequest()` (RBAC), per the header comment and Phase-1 status note** — this route does not need an authz-model migration for Phase 2; it already speaks the D1 target model (`support.view_tickets` / `support.manage_tickets`), unlike most of `/api/internal/admin/*` which is still mid-migration per §5 of the parent design doc.

`apps/host/src/app/api/super-admin/support/route.ts` (current, unrelated capability):
- Auth: `authorizeAdmin(request, 'support')` — the **lowest** admin tier (`support` rank 0; any of `support/analyst/content_manager/finance/admin/super_admin` passes)
- GET actions: `user_activity` (quiz/chat/daily-usage lookup by `user_id`), `failed_jobs` (task_queue), `parent_links`, `class_mappings`
- POST actions: `resend_invite`, `fix_relationship`, `reset_password`
- **Zero overlap** with `support_tickets` — confirmed by reading the full file; the string `support_tickets` does not appear in it.

### 1.3 Adjacent-but-unused capability (flagged, not in scope)

`apps/host/src/app/api/internal/admin/support/metrics/route.ts` — `GET ?days=<1..365>&queue_limit=<1..500>`, same auth (`support.view_tickets`), returns first-response-time / SLA-breach aggregates (`summary`, `verdict`, `by_category`, `no_first_response_queue`). It is **not called by `SupportTab.tsx`** — it exists for a not-yet-built SLA dashboard (per its own header, tied to `docs/runbooks/support-reply-channel-and-sla.md`). Noting its existence so a future pass doesn't rediscover it from scratch, but it is **not part of this parity slice** — parity is defined against what `SupportTab.tsx` actually renders today, not against everything the API namespace happens to expose.

---

## 2. Access-scope decision — (a), pure UI consolidation, no authz-scope change

**Decision: (a).** The new `/super-admin` ticket-queue surface will call `/api/internal/admin/support` as-is. `apps/host/src/proxy.ts`'s Layer 2.1 gate (lines ~1251-1324) is left untouched by this phase. No broadening of who can reach ticket content happens in this pass.

### 2.1 Why this is safe — the gate is path-matched, not caller-matched

Layer 2.1 in `proxy.ts` runs as Next.js middleware **before** any route handler, and its condition is:

```
if (path.startsWith('/internal/admin') || path.startsWith('/api/internal/admin')) { ... }
```

It does not inspect `Referer`, the calling page, or which frontend origin issued the request — it matches purely on the request path. Inside the block, the check is a **literal, fail-closed session check**:

```
let sessionAuthenticated = false;
if (authUserId && !authDegraded) {
  const adminSessionRole = await getUserRoleFromCache(authUserId);
  sessionAuthenticated = adminSessionRole === 'super_admin';
}
```

Anything other than a definitive `'super_admin'` result (including `ROLE_UNKNOWN` from a transient probe failure, `null` from env misconfig, `'analyst'`, `'admin'`, or no session) leaves `sessionAuthenticated = false`, and for any path starting with `/api/` the response is a hard `401 { error: 'Unauthorized' }` JSON body returned by the middleware itself — the request never reaches `apps/host/src/app/api/internal/admin/support/route.ts`, so that route's own `authorizeRequest('support.view_tickets')` check is never even evaluated for a non-`super_admin` session.

Consequently: a new `/super-admin/support` (or `/super-admin/support/tickets`) page's fetch to `/api/internal/admin/support` gets **exactly the same 401 treatment** as a fetch from `/internal/admin` today, regardless of which page issued it. Moving the *caller* to a new URL under `/super-admin/*` does not move the *gate*, because the gate is keyed on the callee's path (`/api/internal/admin/*`), not the caller's.

### 2.2 The nuance worth stating explicitly: mixed tiers on one page

`/super-admin/support`'s own diagnostics API (`/api/super-admin/support`) is gated at `authorizeAdmin(request, 'support')` — the **lowest** tier, so today any of the 6 admin tiers can already reach the existing diagnostics/User-Actions content on that page (subject to `proxy.ts` Layer 0.65, which is fail-open UX-only, not a security boundary, per its own header comment). If the ticket-queue section is added to *that same page*, the page becomes tier-heterogeneous: most of it works at the `support` floor, but the new ticket section requires a literal `super_admin` session and will 401 for every other tier. This is not a security problem (the boundary still holds correctly) — it is a **UX/frontend design problem** to flag:

- `AdminShell`'s shared `apiFetch`/`apiFetchJson` (`apps/host/src/app/super-admin/_components/AdminShell.tsx`) currently treats **any** 401 as `session_expired` and shows a "session expired, sign in again" banner with an auto-redirect timer. That is the *correct* message for an actually-expired super_admin session, but it would be the *wrong* message for a logged-in `analyst` or `support`-tier operator whose session is perfectly valid but simply isn't `super_admin` — they would be told to "sign in again" when re-authenticating as themselves would produce the identical 401 forever.
- Frontend will need either (a) a tier-aware distinction on this one section (e.g. probe-and-render an explicit "Ticket queue requires a Super Admin session" state instead of routing through the shared session-expiry handler), or (b) — see §3 recommendation — avoid the problem structurally by not mixing tiers on one page at all.

This is called out here so it is not silently assumed away; it is the concrete reason §3 recommends a dedicated route rather than folding into the existing page.

### 2.3 Open decision, explicitly deferred (not resolved by this pass)

Phase 1 granted the RBAC `analyst` role `support.view_tickets` (read-only, migration `20260816000008_analyst_role_and_admin_tier_rbac_sync.sql`), which is currently **inert** because Layer 2.1 requires a literal `super_admin` session independent of RBAC permissions. Whether `analyst`-tier operators *should* be able to reach ticket content (read-only) is a real, live question — but broadening Layer 2.1 is an authorization-boundary change (architect review required per the RBAC/auth review-chain row in `.claude/CLAUDE.md`) and is explicitly **out of scope for this pass**. Flagging for a later phase (plausibly bundled with Phase 3 Access Studio's dual-control work, since "who besides super_admin can see ticket content" is exactly the kind of privilege question that phase is meant to formalize) rather than deciding it here.

---

## 3. UI placement recommendation — dedicated route, not a section on the existing page

**Recommendation: a new dedicated route**, `apps/host/src/app/super-admin/support/tickets/page.tsx`, not an added section on the existing `apps/host/src/app/super-admin/support/page.tsx`.

### Reasoning

1. **The existing page is already large and does a different job.** `super-admin/support/page.tsx` is 843 lines with 4.5 sections (Operations Summary stat cards, Failed Jobs table, User Lookup with a 3-column activity grid, User Actions with 3 independent POST-action sub-forms and 3 confirm dialogs, Relationship Integrity with 2 cross-linked tables) — all **investigative/single-user diagnostic** tooling: an operator pastes in one student ID or email and drills down. The ticket queue is a **different interaction mode**: browse a paginated list of many tickets, expand threads, compose replies with a visibility toggle. Folding a ~460-line component (`SupportTab.tsx`, itself already the size of a full page) with its own nested loading/error/empty state machine into a page that already juggles ~9 independent async loaders would produce a genuinely hard-to-review, hard-to-reason-about mega-page.
2. **Bundle budget (P10).** `CAP_PAGE_KB` is a real, enforced per-page gate (`scripts/check-bundle-size.mjs`). A merged page carries both component trees' JS on every visit to `/super-admin/support`, even for an operator who only wants diagnostics (or only wants tickets). A dedicated route code-splits the ticket-queue bundle so it loads only when an operator actually navigates there.
3. **The access-scope split (§2.2) is structurally cleaner as two pages.** A dedicated `/super-admin/support/tickets` page can render one unambiguous state for a non-`super_admin` session ("this page requires Super Admin access") instead of one page having to gate a sub-section differently from the rest of its own content and route 401s through two different UX paths depending on which fetch failed.
4. **Matches the repo's existing IA precedent.** `AdminShell.tsx`'s Phase-3 "7-section task-ordered IA" already splits by *task*, not by *topic*, even for closely related surfaces — e.g. Grounding Health / Grounding Coverage / Verification Queue / AI Issues / Traces are five separate routes under one topic rather than one mega-page. A `support/tickets` sibling route under `support/` (diagnostics stays at `support/`, ticket queue at `support/tickets/`) is consistent with that pattern and with Next.js App Router nesting.
5. **Nav wiring becomes a clean 1:1 mapping** instead of a mid-page anchor scroll — see §4.

This does **not** preclude a later, lighter cross-reference between the two pages (e.g. a ticket count badge or "N open tickets" link from the diagnostics page into the tickets page) — that is a small addition, not a reason to merge the pages outright.

---

## 4. Nav wiring — note for frontend, not edited here

`apps/host/src/app/super-admin/_components/AdminShell.tsx`, `NAV_ITEMS` (lines ~150-157):

```
{
  href: '/internal/admin',
  label: 'Support Tickets',
  labelHi: 'सहायता टिकट',
  icon: '🎫',
  hint: 'opens legacy console',
  hintHi: 'पुराना कंसोल खुलता है',
},
```

Once the new in-console page exists (per §3, `apps/host/src/app/super-admin/support/tickets/page.tsx`), this entry's `href` should be repointed to `/super-admin/support/tickets` and the `hint`/`hintHi` ("opens legacy console") removed, since it will no longer be true. The adjacent "Ops Diagnostics" entry (`href: '/super-admin/support'`, line 131) is correct as-is and needs no change — it already accurately describes what that page does (per the 2026-08-11 nav-truth-fix comment already in the file).

Also for frontend: the reciprocal cross-link banner currently on `super-admin/support/page.tsx` (lines ~306-333, "Looking for support tickets? ... Open the ticket console →" pointing at `/internal/admin`) should be repointed to the new in-console route once it exists, per the same Phase-0-stopgap note already in that file's own comment block ("remove the hint + banner once /super-admin hosts ticket content natively").

Not edited in this task — flagged for the frontend agent building the actual page.

---

## 5. Summary for testing (capability-parity tests, the Phase-2 release blocker)

Per the parent design doc, "Capability-parity tests (testing-owned) required green before any legacy `/internal/admin` route/page deletion." Based on §1's table, a parity test suite for the new page should assert, at minimum:
- List: default status filter is `open`; all four status tabs (`open`/`pending`/`resolved`/`all`) produce the request `SupportTab.tsx` sends today; pagination page size stays 25; `total` count renders.
- Thread: opening a ticket fetches by `ticket_id`; internal notes ARE visible to the operator (this is deliberate — do not regress to the student-filtered view); only one ticket's thread is open at a time.
- Resolve: PATCH `{ id, status: 'resolved' }`; button hidden once resolved.
- Reply: POST defaults to `is_internal: true`; resets to `true` after every successful send; 5000-char guard enforced client-side; `author_role` is never client-supplied (nothing in the new UI should attempt to set it).
- Access boundary: a non-`super_admin` session hitting the new page's ticket section receives a 401 from `/api/internal/admin/support` (via the unchanged Layer 2.1 gate) and the page shows a distinguishable "insufficient access" state rather than routing through the generic session-expired banner (§2.2).
- No regression on the existing `/super-admin/support` diagnostics/User-Actions content, which is untouched by this phase.

This spec does not itself add or modify any test — it is the input contract for testing's Phase-2 parity suite and frontend's Phase-2 page build.
