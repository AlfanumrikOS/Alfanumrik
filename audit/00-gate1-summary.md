# Gate 1 — Executive Summary (2026-09-03)

Scope: Alfanumrik frontend, `AlfanumrikOS/Alfanumrik@2cfd6348`, live Supabase `shktyoxqhundlvkiwguu`, Vercel `alfanumrik`. No product code was changed. Deliverables (all in this repo):

1. `audit/01-inventory.md` — routes, shells, design tokens, components, hooks, APIs, Edge Functions, live schema
2. `audit/02-connections.md` (+ `audit/evidence/connections-table.md`, 407 rows) — WORKING/BROKEN/DISCONNECTED/ORPHAN/DUPLICATE with proof
3. `audit/03-journeys.md` — per-role journeys, 67 captures, 29 severity-ranked defects
4. `audit/04-capability-matrix.md` + `audit/04-gaps.md` — 18 entities × 5 actors, 22 prioritised gaps
5. `design/05-research.md` — 10 portals, own captures, 10 synthesised principles
6. `design/06-design-system.md` — tokens, kit, one shell + nav config, IA ≤7, four states, a11y, perf budget, vernacular, 6 wireframes
7. `design/07-seo-plan.md` — measured baseline, keyword map, page architecture, pass/fail checklist, targets
8. `plan/08-build-plan.md` — 18 sequenced steps, ~85 engineer-days, cleanup manifest with zero-caller proof

**Two facts that change the brief:** the AWS Fargate host was decommissioned 2026-08-03 (single host: Vercel), and production returns HTTP 429 "Security Checkpoint" to every non-browser client including a Googlebot user-agent.

## Totals

| Measure | Count |
|---|---|
| Duplicate surface groups | 16 (routes) + 14 (connections) |
| Broken connections (live errors / dead targets) | 9 |
| Disconnected controls | 6 dead API literals + 35 orphan pages + 8 nav rows to flag-off destinations |
| Orphans | 62 product API routes, 19 hooks, 13 deployed tombstone functions, 3 sourceless deployed functions, 5 dead mastery tables, 17 RPCs missing from types |
| Defects | **P0 6 · P1 12 · P2 10 · P3 1** |
| Capability cells | EXISTS 129 · PARTIAL 58 · **MISSING 31** · DUPLICATED 21 |
| Design | 6 token systems · 6 shells · 12 Button / 77 Card / 42 Modal / 47 nav / 72 Skeleton impls · 9,000+ hex literals · 0 pagination · 0 global search |
| Performance (throttled mid-range Android) | LCP 5.1–13.1 s, JS 327–510 KB on every public page |

## The six P0s

1. "Tutor" is the live brand line (title, hero, login tagline, pricing copy, OG alt) plus a shipped `/tutor` page and API.
2. Foxy, Quiz and Learn read three different chapter taxonomies; Foxy's pipeline uses two of them.
3. Teacher and parent message threads fail in production (RPC EXECUTE grant).
4. Parent report generation fails 401; no weekly digest has ever been produced.
5. Razorpay webhook has never been received on the live host (0 events); reconciliation is inert.
6. Crawlers are challenged with 429; Googlebot exemption cannot be proven from outside.

## Decisions needed (with recommendation)

| # | Decision | Recommendation |
|---|---|---|
| D-1 | **Logged-in journey verification.** I cannot enter passwords, and your Chrome held no session. Options: (a) you log in as each of the five roles in the Chrome profile connected to this session and I walk the surfaces read-only; (b) approve generating one-time magic links for the 6 existing `demo_accounts` (is_demo=true) via the service role. | (a) first, (b) for repeatable QA in CI. Until then 03-journeys is code-derived. |
| D-2 | **Canonical chapter taxonomy.** `curriculum_topics` (542, richest columns, used by Today/Exams/Foxy transfer) vs `chapters` (551, used by Learn/Quiz RPCs) vs `cbse_syllabus` (1,148, readiness). | `curriculum_topics` via a `curriculum_chapters_v` view (plan A2); `cbse_syllabus` keeps readiness; `chapters` retired after a 30-day zero-read soak. |
| D-3 | **Razorpay webhook.** Confirm in the Razorpay dashboard whether a webhook is registered for `https://alfanumrik.com/api/payments/webhook` and its secret matches `RAZORPAY_WEBHOOK_SECRET`. | Register/repair now; add the 7-day zero-event alert (plan A5). |
| D-4 | **Vercel Firewall.** Check whether Attack Challenge Mode / Bot Protection is on and whether verified bots are allowed; verify with Search Console URL Inspection. | Allow verified bots; keep the challenge for the app paths only. |
| D-5 | **Consolidation targets that need your explicit approval under CLAUDE.md:** (i) DROP of dead tables/functions listed in the cleanup manifest (5 mastery tables, 3 backups, `chapters` after soak, 20 RPC variants); (ii) deleting `/internal/admin` and its 12 routes in favour of the single super-admin console; (iii) collapsing the 5 money pages into one and the 8 health pages into one; (iv) `/today` as the single student home with `/dashboard` 301. | Approve all four; each is executed one step at a time with the verification and rollback in 08-build-plan. |

## Absolute-Rule conflicts (CLAUDE.md "User Approval Required")

- **Migrations that drop tables/columns** — cleanup manifest (D-5 i). Not executed without approval.
- **RBAC role/permission additions** — none proposed; A3 restores EXECUTE grants on existing RPCs (a fix, not a new permission). The `/api/search` endpoint reuses existing permission codes.
- **Pricing changes** — none; the `price_display` data fix aligns a stale string with the already-charged ₹1,099.
- **AI model/provider changes** — none.
- The brief's "End-of-Change Report from CLAUDE.md §11" does not exist under that name; the repo's mandated shape is the "Compact Report Format" in `.claude/CLAUDE.md`, which every Gate-2 step will emit.

## What I could not verify (stated, not hidden)

Real-order payment parity (no test order placed), live form submissions (validation assessed from code), logged-in end-to-end requests (D-1), Lighthouse scores (PSI quota; Playwright vitals used instead), and whether verified Googlebot is exempt from the Vercel challenge (D-4).

**Waiting for your approval or change requests before any Gate-2 implementation.**
