# STATUS: Parent Portal (Cycle 7)

> One per workflow cycle. The workflow is **COMPLETE** only when every box below is checked.

- **Cycle:** cycle-7
- **Workflow:** parent-portal (dual auth + DPDP) — parent signup/link → dashboard → child drill-down → comms; the parent↔child link boundary, consent, and data export/erasure
- **Primary invariants:** P8 (RLS boundary); P13 (data privacy); P15 (onboarding integrity); P9 (cross-check)
- **Owner squad:** backend (lead — PP-2/PP-1-rate-limit/PP-4) + testing (PP-5 deny pins + suite); quality (independent validation); architect (noted — gated/RLS follow-ups)
- **Started:** 2026-06-29
- **Status:** **CYCLE 7 LANDED — parent link-code injection + brute-force + auth-gate hardened; PP-1-consent + PP-3 link-model USER-GATED**

## Phase progress
| Phase | Artifact | Done |
|---|---|---|
| MAP | `01-map.md` | [x] |
| IDENTIFY GAPS | `02-gap-analysis.md` | [x] |
| ROOT CAUSE | `03-root-cause.md` | [x] |
| DESIGN | `04-solution-design.md` | [x] |
| IMPLEMENT | `05-implementation.md` | [x] |
| SELF-REVIEW | `06-self-review.md` | [x] |
| INDEPENDENT VALIDATION | `07-validation.md` | [x] |
| REGRESSION | `08-regression.md` | [x] |

## Completion gate
Status of each gate item for the Cycle-7 *landed* set (PP-2 + PP-1-rate-limit + PP-4 + PP-5-deny-pins):

- [x] **Business goal met** for the in-scope set — PP-2 closes the link-code PostgREST filter-injection class at all 3 `.or()` sites via one shared validator (+ Deno twin); PP-1 adds a server-side per-IP brute-force rate limit to the legacy Edge `parent_login`; PP-4 brings `PATCH /api/parent/profile` onto the house `authorizeRequest` pattern (already-granted permission, self-scope); PP-5 pins unlinked-parent deny across all 9 child-data routes. *(NOT in scope: PP-1 consent posture + PP-3 USER-gated link-model; PP-5 client migration / PP-6 / PP-7 / durable-limiter follow-ups.)*
- [x] **No broken/empty states** on touched paths — valid 6-/8-char codes pass exactly as before; each rejection site keeps its posture (silent-success / 409 / 200 no-match); profile update still self-scoped.
- [x] **Bilingual (P7)** — no new user-facing string introduced. (Existing English-only server insights/tips = PP-7 deferred follow-up.)
- [x] **P8 RLS boundary** — validator can only narrow what `.or()` matches (never broadens); guardian-link boundary unchanged; PP-5 deny pinned.
- [x] **P9 RBAC** — PP-4 reuses `profile.update_own` (already granted to the parent role); no role/permission added or altered.
- [x] **P13 privacy** — 429 + deny paths carry no child/guardian payload; new warn logs limits/counts only (no IP / link code / PII).
- [x] **P15 onboarding** — parent link funnel (A1/A2/A3) unchanged; REG-110/111/117 still green.
- [x] **P10 bundle** — server routes + Edge Function + tiny pure validator + test-only files; no shared-chunk or page-budget impact.
- [x] **Invariants P1–P15** upheld; P8/P9/P13 strengthened, no regression.
- [x] **type-check** green.
- [x] **lint** green (0 errors).
- [x] **test** green (5 new files / 71 new tests; 104/104 target + 404/404 broad parent/guardian PASS).
- [x] **build** green; bundle within P10.
- [x] **Quality verdict = APPROVE** (`07-validation.md`, independent).
- [x] **P14 review chain complete** — backend (impl PP-2 + PP-1 rate-limit + PP-4) + testing (PP-5 deny pins + suite) → quality (independent APPROVE); architect noted for gated/RLS follow-ups. See `08-regression.md`.
- [x] **Regression sweep green + catalog filed** — sweep GREEN; **REG-188 (link-code injection) + REG-189 (rate limit) + REG-190 (authz + deny)** added → catalog **157**; REG-110/111/117 still green.

## Why NOT fully COMPLETE — open gated / follow-up items (resume here next session)
1. **PP-1 consent posture (HIGH, GATED — USER APPROVAL; DPDP/child-consent):** the legacy Edge `parent_login` creates an ACTIVE guardian link from a link code ALONE — no student/approval step. The rate limit closes brute-force; the design fix (require approval, or deprecate `parent_login` in favor of the OTP/approve-link path) changes the consent model → requires CEO approval. **On the program RISK register (parent-link consent model).**
2. **PP-3 (MED, GATED — USER APPROVAL):** four parallel link-creation paths with divergent postures + two terminal statuses (`active` vs `approved`) — consolidate onto one consent-respecting choke-point. Changes the link model. Retiring `parent_login` collapses PP-1 + PP-3.
3. **PP-5 client migration (architect):** migrate parent child-data routes to RLS-scoped clients (defense-in-depth) — only the Foxy-chat route is RLS-backed today (`is_guardian_of`).
4. **PP-6 (LOW, behavior-preserving):** converge `canAccessStudent` vs `isGuardianLinkedToStudent`.
5. **PP-7 (MED, P7):** server-generated parent insights/tips/glance are English-only — candidate for Cycle 8 cross-cutting bilingual work.
6. **PP-1 durable limiter (architect):** the in-memory limiter resets on cold start / isn't cross-instance — track an Upstash/DB-backed counter.
7. **Pre-existing Deno errors** at `parent-portal/index.ts:603/605/629/630` — unrelated; separate cleanup.

## Sign-off
| Role | Agent | Date | Verdict |
|---|---|---|---|
| Builder (input validation + rate limit + authz gate) | backend (PP-2 + PP-1 rate-limit half + PP-4) | 2026-06-29 | DONE |
| Testing | testing (PP-5 deny pins + 5-file/71-test suite) | 2026-06-29 | **GREEN** (104/104 target + 404/404 broad; REG-188/189/190 filed) |
| Quality (independent) | quality | 2026-06-29 | **APPROVE** |
| Orchestrator (mark COMPLETE) | — | — | NOT YET — auto-fix-safe complete; PP-1-consent + PP-3 USER-gated (parent-link consent/link model); PP-5-client / PP-6 / PP-7 / durable-limiter follow-ups |
