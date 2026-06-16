# Data Access Patterns

Reference for the three coexisting data-access patterns in this codebase, when to use each, and the contract-safety rule that prevents silent drift between Deno Edge Functions and their TypeScript consumers.

Audited 2026-06-16 (Phase 4 hardening). Owning agent: **architect**.

## The three patterns

| # | Pattern | RLS | Runs on | Use when |
|---|---|---|---|---|
| 1 | **Supabase Edge Function** (Deno) | Caller JWT (anon client + `Authorization` header) | Supabase edge | Heavy server-side aggregation / multi-table read rollups that should stay off the Vercel function budget; logic shared by web + mobile; cron/queue work |
| 2 | **Next.js `/api` route** | Caller JWT (`supabase-server`) or service role (`supabase-admin`) when justified | Vercel (bom1) | Mutations and writes; anything needing `authorizeRequest()` RBAC; request shaping / response envelopes; payment + webhook handling; v2 contract endpoints |
| 3 | **Direct `supabase.from()` / `.rpc()`** | Caller JWT (browser client, RLS-enforced) | Client (page/component) | Simple owner-scoped reads/writes a single page needs, where RLS alone is a sufficient boundary and no server secret/RBAC step is required |

### Pattern 1 — Edge Function (Deno)
Examples on disk:
- `supabase/functions/teacher-dashboard/` — read aggregation: `get_dashboard`, `get_heatmap`, `get_alerts`, `get_class_overview`, `get_student_report`, `get_grade_book`, `get_grading_queue`, mastery/Bloom reports, etc. Dispatched by a single `action` field; binds every action to the JWT-derived `teacher_id` (P13).
- `supabase/functions/parent-portal/` — `get_child_dashboard` and related parent read rollups, JWT + guardian-link guarded.

Consumers: `src/app/teacher/*` pages and `src/app/parent/*` pages `fetch()` these directly via `${SUPABASE_URL}/functions/v1/<name>`; the v2 contract route `/api/v2/parent/glance` calls `parent-portal` server-side.

### Pattern 2 — Next.js `/api` route
Examples on disk:
- `src/app/api/teacher/*` — `assignments`, `classes`, `messages`, `modules`, `parent-notify`, `profile`, `remediation`, `students`, `subjects`, `lab-leaderboard`. These are the **write / RBAC** side of the teacher portal.
- `src/app/api/parent/*` — `approve-link`, `billing`, `calendar`, `children`, `consent`, `link-code`, `messages`, `notifications`, `profile`, `report`.
- `src/app/api/v2/parent/glance/route.ts` — v2 contract endpoint that reuses the `parent-portal` EF output (see cautionary example below).

Every `/api` route that touches privileged data uses `authorizeRequest(request, 'permission.code')` (P9) and writes through RPCs / atomic transactions where invariants apply (P4, P11).

### Pattern 3 — Direct client query
Examples on disk: `src/app/parent/page.tsx` and `src/app/parent/AtlasParent.tsx` use `supabase.functions.invoke(...)` for the EF call but also rely on the browser `supabase` client for owner-scoped reads; many student-facing pages read their own rows directly via `supabase.from(...)` under RLS. Acceptable only when RLS is the complete boundary and no service-role step or RBAC permission gate is needed.

## The split that makes the codebase look uneven

The teacher portal **reads via Edge Function** (`teacher-dashboard`) but **writes via Next `/api` routes** (`/api/teacher/*`). That is a defensible division of labor (heavy aggregation on the edge, RBAC-gated mutations on Vercel), but the two halves do **not** share types, and that is the real risk.

## Rule: shared TypeScript contract for every EF ↔ Next/frontend boundary

> Any Supabase Edge Function whose payload is consumed by a Next.js route or the frontend **MUST** have a single authoritative TypeScript type definition for that payload. The TS consumers import it; the Deno function mirrors it (Deno cannot import from `src/`, so it keeps a byte-faithful copy and a contract test asserts parity). A payload change must touch the shared type, which forces the consumers to update — instead of failing silently at runtime.

Why this is not yet true today (cautionary examples from this codebase):

1. **`teacher-dashboard` read / `/api/teacher/*` write split has no shared types.** The Deno function (`supabase/functions/teacher-dashboard/index.ts`) declares its action payload shapes inline; the consumers re-declare partial mirrors in `src/lib/types.ts` (e.g. `RiskAlert`, `BloomLevelRow`) with comments like *"Absent on older Edge deploys; the UI defaults to 'none'"* — i.e. the mirror is already drifting from the source and is being patched defensively. A change to the Deno payload would break the teacher pages with no compile-time signal. **Frontend flagged this in the Phase 4 audit.**

2. **`/api/v2/parent/glance` hand-maps the `parent-portal` EF output.** The route declares a *local* `interface DashboardPayload` (`src/app/api/v2/parent/glance/route.ts:31`), casts the EF JSON to it (`as DashboardPayload`), and then hand-maps every field with defensive guards (`dash.stats ?? {}`, `typeof stats.accuracy === 'number' ? … : null`, `dash.student?.name ?? dash.name`). Those guards exist precisely because there is no shared, enforced contract — the route is coding around a payload it cannot trust the shape of.

Both are working surfaces. The rule above governs **new** EF ↔ Next/frontend boundaries from now on, and the follow-up below governs retrofitting the two existing ones.

## TRACKED FOLLOW-UP (deferred — not done in Phase 4)

> **Extract shared TypeScript contract types for the `teacher-dashboard` Edge Function actions** consumed by the Next `/api/teacher/*` routes and the `src/app/teacher/*` frontend (and, as a second pass, the `parent-portal` `get_child_dashboard` payload consumed by `/api/v2/parent/glance`). The TS consumers import the shared types; the Deno function mirrors them with a contract test asserting parity, so a payload change cannot drift silently.
>
> **Deferred deliberately.** `teacher-dashboard` and `parent-portal` are live, working surfaces with ~25+ actions and existing consumers across web pages and v2 routes. Refactoring them to a shared-contract module is higher-risk than its current marginal benefit, and the present inline/partial-mirror types are functioning. Schedule this as standalone hardening work (own branch, full teacher + parent E2E pass, architect + frontend + backend + testing review chain) rather than riding it on an unrelated change.

## Decision checklist (new data access)

- Is it a **write** or does it need **RBAC** (`authorizeRequest`) or a **server secret / service role**? → Pattern 2 (`/api` route).
- Is it **heavy multi-table read aggregation** shared by web + mobile, or cron/queue work? → Pattern 1 (Edge Function).
- Is it a **simple owner-scoped read/write** fully covered by RLS, with no server step? → Pattern 3 (direct client).
- Does the new EF return a payload consumed by a route or the frontend? → **Define the shared TS contract type first** (the rule above). No new inline/hand-mapped EF payloads.
