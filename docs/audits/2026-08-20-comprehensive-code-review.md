# Comprehensive Code Review — 2026-08-20

**Scope**: the 126 commits merged to `main` between `0cbecdc` and `4d40a14` (226 files, +61,083 / −2,688) — backend, DB/migrations, middleware/proxy, frontend/UI/UX, hooks, dependencies, RBAC, student/parent/teacher dashboards, admin + super-admin surfaces, feature flags, CI/CD, ingestion pipelines, eval harnesses.
**Important**: at review time this work is **already merged to main**. Every finding below is live on trunk. Severity ordering reflects that — P0s are hotfix candidates, not "request changes".

**Method**: 9 independent review angles run in parallel (A line-by-line, B removed-behavior, C cross-file contract tracer, D language pitfalls, E wrapper correctness, F reuse, G simplification, H efficiency, I altitude/design, J CLAUDE.md-convention conformance), each verifying findings against the working tree; the orchestrator then independently re-verified every headline finding (marked ✓).

**Mechanical gates** (run fresh in this review):
| Gate | Result |
|---|---|
| `npm run type-check` | PASS |
| `npm run lint` | PASS (0 errors, 5 warnings) |
| `npm test` | PASS — 21,101 passed / 125 skipped / 0 failed (1,336 files) |

All gates green **and** ~45 real defects below: none of these failure modes is pinned by a test. See "Regression-catalog gaps" at the end.

---

## P0 — Security, data integrity, and pipeline integrity (hotfix now)

### P0-1 ✓ `learning-sources` signed-URL surface: any authenticated student can mint URLs into the rights-restricted corpus bucket
`apps/host/src/app/api/learning-sources/route.ts:108`, `supabase/migrations/20260816000007_create_get_learning_source_rpc.sql`, `20260816000001_learning_sources_bucket.sql` — [angles D, E, J]
- `authorizeRequest(request)` is called **with no permission code** (route.ts:108). The comment above it claims "the bucket's RLS policies enforce per-resource access" — false: the sibling migration `20260816000001` creates **zero** `storage.objects` policies and itself states "Every read must go through a server-side route that authorises the caller". The URL is minted via `supabaseAdmin` (service role — bypasses RLS entirely).
- `rights_status` from `20260816000002` ("permission_pending and restricted must be treated as unusable by every consumer") is **never checked** → any free-tier student can pull `restricted` copyrighted PDFs.
- **Path traversal**: `board` gets no charset check at all; `grade` is validated with `parseInt` (accepts `'6/../../secret'` → 6) while the **raw string** is spliced into `buildPath` (route.ts:140). Only `filename` is traversal-checked.
- The companion RPC `get_learning_source` (migration `20260816000007`): traversal guard second pattern is `v_path LIKE '%..%/'` — a typo for `'%../%'` (only matches paths *ending* in `/`), so a leading `..` segment passes; it is also the only SECURITY DEFINER in the batch with **no `SET search_path` pin**; and it declares `p_grade integer` — a **P5 violation** (grades are strings, and the sibling migration documents exactly that).
- route.ts:151 logs the full `storagePath` + caller IP, contradicting the file's own P13 header comment at line 26 ("does NOT log the requested path").
**Fix**: require a real permission code (or entitlement check incl. `rights_status`), regex-pin `board` and `grade` (`^[a-z]+$`, `^(6|7|8|9|10|11|12)$` as strings), fix the RPC LIKE pattern + `SET search_path = ''` + `p_grade text`, drop the path from logs.

### P0-2 ✓ Legacy admin audit trail silently loses every attributed action (FK violation swallowed)
`packages/lib/src/admin-auth.ts:725` — [angle A]
`logAdminAuditByUserId` writes `admin_id: userId` where `userId` is an **auth.users id** (its own JSDoc: "authorizeRequest returns only userId"). `admin_audit_log.admin_id` has an FK to `admin_users(id)` (baseline `00000000000000_baseline_from_prod.sql:18657`; `admin_users` keeps the auth uid in a separate `auth_user_id` column). Postgres rejects with 409; the code only `.catch()`es network errors and **never checks `res.ok`** — fetch resolves on 409, so the row is dropped with no log. Every attributed `/api/internal/admin/*` action (suspend, reset_xp, upgrade_plan, ticket replies, flag edits) vanishes from the legacy trail that `/super-admin/logs` reads — a regression from the prior `admin_id: null` insert, which succeeded.
**Fix**: resolve `admin_users.id` from `auth_user_id` before insert (or write null + a separate attributed column), and check `res.ok` on both audit writes.

### P0-3 ✓ PII (guardian email) written into audit logs — P13 / REG-68 violation
`apps/host/src/app/api/internal/admin/users/[id]/route.ts:124` — [angle J]
`logAdminAction({ action: 'force_link_guardian', …, details: { guardian_email } … })` puts a raw email into `details`, which this same diff's rewritten `logAdminAction` now **dual-writes into the canonical `audit_logs` table**. The new JSDoc in `admin-auth.ts` explicitly forbids this ("details must be metadata only — never email/phone/name"); REG-68 pins that `audit_logs.details` never carries email.
**Fix**: log the resolved `guardian_id` (a UUID) instead of the email.

### P0-4 CI now fails **open** pre-merge: full suite, build, bundle gate, and E2E no longer gate PRs
`.github/workflows/ci.yml:1622` (two-tier split), `docs/ci.md` — [angle B]
The PR tier drops the 4-shard unit suite, Production Build + **P10 bundle gates**, edge Deno tests, npm-audit blocking, the Auth & Identity gate, live-DB integration tests, and E2E. Their only pre-merge home is the `merge_group` event — whose enforcement depends on the out-of-repo "Require merge queue" ruleset setting, and GitHub counts a **skipped** ruleset-required check as satisfied. `docs/ci.md:32-45` (added in the same diff) records the observed failure: PR #1572 read "Ready to merge", green, "with no build and no full test run behind it". Additionally, PR-tier "Unit Tests (changed)" uses `vitest --changed --passWithNoTests` — a dynamic-import-only path selects zero tests and passes. E2E now runs **nowhere** (push tier is "minus E2E Critical Paths" per docs/ci.md:20).
**Fix**: confirm "Require merge queue" + ruleset-required "CI Gate" are actually ON in repo settings **today**; until confirmed, restore Production Build + bundle gate + a full-suite job to the `pull_request` event; drop `--passWithNoTests`.

### P0-5 Mobile API-contract break: `completed_lesson_check` missing from openapi + Flutter enum
`packages/lib/src/today/types.ts:55` — [angle J]
The new `'completed_lesson_check'` wire value is served by `/api/v2/today` (via `map-action.ts`), but `openapi/v2.json`'s `TodayItemType` enum (9 values) and the generated Flutter client `mobile/lib/api/v2/lib/src/model/today_item_type.dart` (closed `built_value` EnumClass, no unknown-default) are untouched. A today queue containing this item **fails deserialization in the mobile app**. Violates domain 32 (mobile-web contract sync).
**Fix**: regenerate openapi/v2.json + Flutter client, and give the Dart enum an unknown-default fallback so future additions degrade instead of crash.

### P0-6 The "fixed" deploy gates are dead code while the broken gates keep running
`.github/scripts/verify-migration-ledger.sh`, `.github/scripts/assert-db-security-invariants.sh` — [angles C, F]
- `verify-migration-ledger.sh` correctly re-implements the production migration-parity check whose current inline `awk -F'|' … v=$2` parse its own header proves is a **tautology** ("printed EXACTLY equal counts every time… prints parity forever", already hid 8 missing versions). But **no workflow calls it** — `deploy-production.yml:525-531` still ships the buggy parse verbatim.
- `assert-db-security-invariants.sh` is named by migration `20260816000002:468` as "the hard gate belongs in CI" for the corpus SECURITY DEFINER/RLS posture — and is invoked by **nothing**.
**Fix**: repoint deploy-production.yml's parity step at the script; wire assert-db-security-invariants.sh into ci.yml or the deploy workflows.

### P0-7 ✓ Duplicate, out-of-order migrations
`supabase/migrations/20260813085254_…` ≡ `20260815000006_fix_csr_chapter_universe_ambiguity.sql` — [angles C, F, G, I, J]
Byte-identical (md5 `c4a7fdb3…` both). The backdated 20260813085254 sorts **before** 20260813144550 (documented "ALREADY APPLIED ON PRODUCTION") — out-of-order for `supabase db push` — and before the still-broken 20260815000005 it corrects, so a fresh replay applies fix → re-break → re-fix. Ledger now records one logical change twice.
**Fix**: keep exactly one (20260815000006), reduce/remove the backdated twin per the repair guidance, and teach `scripts/lint-migrations.js` to reject two migrations sharing a basename.

---

## P1 — User-visible functional bugs

### P1-1 ✓ Grade 11–12 students lose all science roadmap cards
`packages/ui/src/dashboard/os/SubjectRoadmaps.tsx:73` — [angles A, C]
`TARGET_SUBJECTS = new Set(['Mathematics', 'Science'])` filters `get_mastery_overview` rows by `subjects.name` — but grades 11–12 have no "Science" subject; theirs are Physics/Chemistry/Biology (baseline:3313-3314, `grade_subject_map` 20260528000010, `mastery-buckets.ts:202-204`). A Class 11 science student sees only the Mathematics card; a bio-stream student without math sees none. Directly contradicts the filter's stated intent of surfacing core math/science.
**Fix**: include `Physics`, `Chemistry`, `Biology` (or filter by canonical subject codes, not display names).

### P1-2 Foxy panel rewrite — 6 defects in `packages/ui/src/foxy-panel/` — [angles A, D, E, G, H]
1. **Stop button is a no-op**: the `AbortController` created at `useFoxyChat.ts:908` is never passed to `callFoxyTutorStream` (:1000) or `callFoxyTutor` (:1123) even though both accept a `signal` param. Aborting hits a controller attached to nothing; the SSE keeps streaming. The "concurrency cap" check at :871 is dead (the preceding line sets `inFlightRef.current = null`), and `scheduleFlush` clears `inFlightRef` on the **first streamed token** (mislabeled "clear on success") — so rapid double-sends race and interleave two streams into the message list.
2. **Retry loop's advertised 502/503/504 retry never happens**: `fetch` resolves (never throws) on HTTP errors, so `err instanceof Response` (:202, :359) is unreachable. Meanwhile the loop **blind-re-POSTs the non-idempotent AI generation up to 3×** on network-level failures (Indian-4G drop after the request reached the server → 2-3 duplicate LLM generations billed, duplicate messages, duplicate quota debits). The ~25-line loop is also copy-pasted verbatim into both call paths.
3. ✓ **Session continuity broken on the blocking path**: `:284` reads `data?.session_id` but `/api/foxy` returns `sessionId` (route.ts:2457/2915/3417; the streaming path reads `sessionId` correctly at :374/:436). `session_id` is always null → `setChatSessionId` never fires → every image-upload / quiz_me / non-streaming turn mints a **new server session**, destroying conversation memory.
4. **"Explain simpler / Quiz me / Show example" break after any long reply**: `FoxyPanel.tsx:132` re-sends the tutor's entire last reply as the outgoing message; `sendMessage`'s 1,000-char guard (:854) then shows the student "Message too long!" instead of re-teaching.
5. **'save' actions double-recorded**: `recordLearningAction` fires unconditionally at FoxyPanel.tsx:115 and again in the save branch (:146) — duplicate rows per tap.
6. **Dead/wasteful code**: `useAllowedSubjects()` fetch + `subjectCodeByName` map never read (an authenticated request per panel mount for nothing); `speakCancelRef` read but never assigned (cancel guard permanently no-op); `effectiveIsHi` fallbacks unreachable (`isHi` is a required prop); all `useCallback`s depend on the unstable `chat` object literal → recreated ~20×/sec during streaming, defeating memoization on the message list.
**Fix**: wire `ctrl.signal` into both calls; drive the transient retry off `res.status` with an idempotency key (or drop it); read `sessionId`; send a short action directive instead of the full reply; delete the duplicate record call and the dead constructs; return a memoized object from `useFoxyChat`.

### P1-3 ✓ Quiz results: false "network issue" message on legitimate zero-XP outcomes, and the legacy branch lost its Retry
`apps/host/src/app/(student)/quiz/page.tsx:2429, 2520, 2511` — [angles A, B, J, G]
- The new banner fires on `results.xp_earned === 0 && !results.flagged` — which is true for a 0-correct quiz and for a **daily-200-XP-cap-clamped** submission (the server signals `xp_capped`, which the banner ignores). Students are told "there may have been a network issue… Try again to earn XP!" — false, contradicts the daily-cap copy pinned by REG-45 on the same screen, and invites cap-grinding. EN + HI, duplicated verbatim in both branches.
- The legacy (ff_quiz_result_v2 off) branch replaced the retry-capable network-error banner with **text only** — `retrySubmit` is unreachable there, so a failed `atomic_quiz_profile_update` submission is permanently lost (XP/progress/SRS writes never happen) where the previous code offered a working Retry button.
**Fix**: gate the banner on `networkError` (and never on cap/0-correct); hoist one `zeroXpBanner` const; restore `retrySubmit` in the legacy branch.

### P1-4 Navigation dead ends in the new Today-centric flow — [angles B, C]
- **`/library` orphaned**: commit 68589fc deleted both nav entry points (MORE_ITEMS row + sidebar Study link, `nav-config.ts:92`, undocumented, Hindi label lost). Zero links to `/library` remain in apps/ or packages/ — the live browse-first NCERT Library is reachable only by typed URL. With `/learn` also removed from every nav list, students have **no** navigation path to any free-browse content surface.
- **Empty-queue recovery loop**: `TodaysMission.tsx:137` repointed the empty/error-card CTA from `/learn` (subject picker — always works) to `/today` — which renders **the same `/api/v2/today` queue** that just failed/returned empty → second dead end. The surviving comment still claims the destination is the subject picker.
- **`mode=comprehension` is a no-op token**: `resolve-next-action.ts:722` deep-links the new "Check what you learned" card to `/quiz?…&mode=comprehension`, but the quiz page's whitelist handles only `cognitive|exam|srs` (page.tsx:465-473); no comprehension mode exists anywhere. The Step-4 "did it work" bridge silently degrades to a default practice quiz.
**Fix**: restore a nav path to `/library` (or consciously retire the page); point the empty-state CTA at a surface that can't be empty for the same reason; implement or drop the `comprehension` mode.

### P1-5 Foxy diagrams: chapter-scoped lookup silently drops previously-served matches
`packages/ui/src/foxy/FoxyStructuredRenderer.tsx:634` — [angle B]
When the exact `(subject, 'Grade N', chapter_number, is_active)` key finds no `topic_diagrams` rows, the code short-circuits to zero diagrams ("Do NOT fall back to a corpus-wide search"). The old corpus-wide textSearch + keyword fallback served near-miss keys (grade-string format, subject code `science` vs `physics`, off-by-one chapter). The scoping props are live on `/foxy` (page.tsx:2156-2161), and `topic_diagrams` extraction is brand-new in this diff — exactly when key mismatches are most likely.
**Fix**: fall back to the keyword search when the scoped query returns empty (keep the scoped result preferred).

### P1-6 Super-admin tickets bridge: expired sessions told the opposite of the truth; permission grants are dead policy
`apps/host/src/app/super-admin/support/tickets/_lib/ticket-api.ts:105` — [angles E, I]
- `ticketFetch` collapses 401 and 403 into one `access_denied` kind, so an expired super_admin session renders "This is not a session expiry — contact an administrator" with no re-login path — the exact inverse of reality.
- proxy.ts Layer 2.1's hardcoded super_admin route-prefix gate 401s every non-super_admin **before** `authorizeRequest('support.view_tickets')` runs — making this PR's own grants of `support.view_tickets` to the support/analyst roles unreachable dead policy on this surface.
**Fix**: distinguish AUTH_REQUIRED (→ AdminShell re-login flow) from FORBIDDEN; decide one gate (permission-driven) for the ticket API before Phase 2 opens the queue to lower tiers.

### P1-7 Migration 20260816000004: demo-marking is a silent no-op that reports success
`supabase/migrations/20260816000004_backfill_students_auth_user_id.sql:82, 94` — [angle D]
The regex `name ~ '^[A-Z]+-[0-9]+'` matches **neither** documented seed shape ('S7A 1781334462880-554959' — digit breaks `[A-Z]+`; 'S-cs-fill-0' — letter follows the hyphen), so 0 of the 171 bulk students are marked `is_demo`. And the audit `GET DIAGNOSTICS ROW_COUNT` runs as the first statement of a **separate DO block**, where it always reads 0 — so even after fixing the regex the log would still report `marked_as_demo=0`.
**Fix**: correct the regex (e.g. `^S[0-9]+[A-Z]?\s|^S-[a-z]+-fill-`), and compute ROW_COUNT inside the same block as the UPDATE.

### P1-8 Feature-flag ramp hazard: everyday-examples reader ignores `rollout_percentage`
`supabase/functions/grounded-answer/_everyday-flag.ts:54` — [angle C]
The seed (`20260815000007`) pins "is_enabled = FALSE, rollout_percentage = 0; ops/CEO own the ramp", but the reader gates only on `is_enabled === true`. An operator running the standard staged ramp (enable + 10%) flips the prompt directive ON for **100% of Foxy traffic** at once — and, because the flag state is folded into every cache tier's gen_ctx key, invalidates the entire flag-ON cache population in one step. (The sibling `_model-rollout-flag.ts` in the same directory honors the percentage.)
**Fix**: honor clamped `rollout_percentage` per caller like the sibling reader.

### P1-9 PDF-ingestion classifier pollutes the curated corpus with prose
`scripts/pdf-ingestion/extractor/taxonomy.py:21` — [angle D, verified by execution]
`QUESTION_RE`'s tail is entirely optional quantifiers, so with IGNORECASE it matches the bare letter "q" at line start: `is_question_start('Quite often, plants absorb water.') → True`; same defect in `EXAMPLE_RE` and `HEADING_RE`. Units fragment at every q-initial prose line and emit mistyped strong-signal `qa_pair` records into the curated corpus.
**Fix**: require the marker to be non-optional (`^q(?:uestion)?\s*\d+\s*[:.)-]` — digit and delimiter mandatory).

### P1-10 P13 leaks in the new student-router
`apps/host/src/app/api/student-router/route.ts:44, 54` — [angles I, J]
Logs `studentId` (a student row identifier) at info on every redirect and warn on every bad target — the pulse-server convention (REG-129) suppresses row identifiers from logs. Also: gates with the raw string `'student.router_access'` instead of the registered `PERMISSIONS.STUDENT_ROUTER_ACCESS` constant, and hardcodes `ALLOWED_TARGETS` (including a stale `parent` entry and unverified targets) instead of deriving from `nav-config.ts`.
**Fix**: drop studentId from log payloads; use the constant; derive the allowlist from the nav/route registry.

### P1-11 Fonts: Hindi hero text silently loses its Devanagari face on /welcome
`apps/host/src/app/welcome/layout.tsx:44` + `packages/ui/src/landing/welcome-v2.module.css:2557/2670/2735` — [angle I, ✓ verified]
The layout dropped the Mukta + JetBrains Mono loaders as a P10 trim, but the shared stylesheet still consumes `var(--font-mukta)` in 5 places — 3 with **no in-var() fallback**, which per CSS makes the whole `font-family` declaration invalid at computed-value time (the `, 'Mukta', serif` list entries never apply). P7-relevant visual regression no gate catches.
**Fix**: either restore the loaders or repoint the 3 fallback-less declarations (and add an in-var() fallback stack), then pin with a test asserting every `var(--font-*)` consumed under /welcome is provided by the layout.

---

## P2 — Structural debt, duplication, efficiency (schedule, don't hotfix)

1. **Admin role = wildcard-minus-deny-list** (`20260816000010`): role.manage/permission.manage removed by one-shot DELETE; nothing prevents re-grant by a future wildcard refresh or defensive grant (`20260816000006` already re-grants new codes to admin). Make "admin never holds role.manage" a mechanism (positive enumeration or DB trigger/conformance test), not a data state. [I]
2. **`authorizeOperator` duplication + latency**: verbatim copy of `authorizeAdmin`'s ~40-line token loop (incl. the 2026-07-20 split-brain fix — now needs dual maintenance); unconditional 3rd sequential round-trip for display-only enrichment; `/api/v1/admin/roles` stacks **two full auth stacks** (~5 sequential round-trips, 2 duplicate identity resolutions). Extract a shared `resolveSessionIdentity`, `Promise.all` the enrichment, and check `perms.permissions.includes('role.manage')` from the already-held result. The 6-entry tier map is written out 4× (TS + 2 SQL CASE blocks + VALUES backfill). [G, H, I]
3. **Migration hygiene** (`20260816000003`): ~60-line no-op re-CREATE of `generate_exam_paper` (only the GRANTs changed — section 9 shows the grants-only form); the corrected ownership-guard predicate pasted into 7 function bodies (this predicate has already been corrected once after a P0) — factor into `assert_student_owner()`/`assert_guardian_owner()` helpers. [G]
4. **Reuse violations** (each a drift time-bomb): ticket types/constants redeclared instead of imported from internal-admin (`ticket-api.ts:28`); **8+ hand-cloned per-flag reader modules** in grounded-answer (`_everyday-flag`, `_mmr-flag`, `_continuation-flag`, `_twin-flag`, `_model-rollout-flag`, `_l2-cache-flags`) — one `makeCachedFlagReader(flagName, {failValue})` factory; pooler-url parser now in 3 places (`supabase-pooler-url.py` added but the 2 workflow heredocs not repointed); `stripFences` at 6 copies across eval harnesses (2 new in this diff, one duplicated within the same harness); `TypedConfirmDialog` is a 3rd confirm-dialog variant (promote to `packages/ui` primitives; flags page has the same pattern inline); 7 near-identical super-admin mutation helpers with reset-password implemented twice (one `runAdminAction` helper); `pr-health-sweep.yml` re-implements pipeline-alert.yml's escalation-issue idiom inline (extract a composite action — its own header says "ONE escalation channel"); `check_what_you_learned` copy/icon declared in both `today/copy.ts` and `action-display.ts` and **already disagreeing** (🔄 vs 📝, two different Hindi strings live simultaneously). [F, G, I]
5. **Efficiency nits**: tickets page refetches the whole list when the language toggle flips (`isHi` in fetch deps — store an error kind, localize at render); `RawUnit.text` uncached property re-runs dehyphenation 3-4× per unit across a whole textbook (cached_property). [H]
6. **Zero-XP banner JSX duplicated** in both quiz result branches with an inline `margin:0 auto` duplicating its own `mx-auto` — hoist like the adjacent `networkErrorBanner` (which the legacy branch already drifted from). [G]

---

## Regression-catalog gaps (all gates were green while all of the above is live)

Candidate REG entries the testing agent should add: (a) learning-sources entitlement + traversal (P0-1); (b) audit-write `res.ok` + FK-resolvable actor (P0-2); (c) audit-details PII scanner extended to `logAdminAction` call sites (P0-3, extends REG-68); (d) openapi/Flutter enum parity with `TodayItemType` (P0-5); (e) deploy-workflow must invoke `verify-migration-ledger.sh` + `assert-db-security-invariants.sh` (P0-6); (f) migration-lint rejects duplicate basenames (P0-7); (g) SubjectRoadmaps covers grade 11-12 subject names (P1-1); (h) Foxy abort-signal wiring + sessionId casing + single learning-action record (P1-2); (i) zero-XP banner never fires on `xp_capped` (P1-3, extends REG-45); (j) every nav-config removal asserts the target page is also retired or re-linked (P1-4); (k) `mode=` URL contract between resolve-next-action and quiz page (P1-4); (l) flag readers honor rollout_percentage when their seed sets one (P1-8); (m) font-token provider/consumer parity on /welcome (P1-11).

## Strategic note — the "intelligence layer" lens

Alfanumrik's thesis is deciding **what to teach next, how, and whether it worked**. The defects that most undermine that thesis are not the AI-chat bugs but the loop bugs: the *what-next* map is blind for all grade 11-12 science (P1-1); the *what-next* fallback loops into its own failure (P1-4); the *did-it-work* check ships as a no-op token (`mode=comprehension`, P1-4); the *did-it-work* signal shown to students is misinformation on legitimate zero-XP outcomes (P1-3); and the self-directed escape hatch (/library, /learn) has no nav path at all (P1-4). Those five, plus P0-1/P0-2 (rights and audit integrity), are the recommended hotfix order.

---
*Review executed 2026-08-20 on branch `claude/comprehensive-code-review-pu7i63` (HEAD `4d40a14` = origin/main at review time). 9 review angles, ~45 verified findings; headline findings independently re-verified by the orchestrator (✓).*
