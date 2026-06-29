# STATUS: Teacher / School-Admin B2B (Cycle 5)

> One per workflow cycle. The workflow is **COMPLETE** only when every box below is checked.

- **Cycle:** cycle-5
- **Workflow:** teacher-school-b2b (teacher portal + school-admin tenant surface + teacher-dashboard Edge Function + Pulse cross-role boundary)
- **Primary invariants:** P8 (RLS boundary); P9 (RBAC enforcement); P13 (data privacy / multi-tenant isolation)
- **Owner squad:** architect (RLS/boundary + TSB-2 migration) + backend (lead/impl — TSB-1 Edge Function fix) + testing (coverage); quality (independent validation)
- **Started:** 2026-06-29
- **Status:** **CYCLE 5 LANDED — critical cross-tenant leak (TSB-1) closed + TSB-2 defense-in-depth; TSB-4 user-gated, TSB-3/5 + tracked items follow-ups**

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
Status of each gate item for the Cycle-5 *landed* set (TSB-1 + TSB-2 + TSB-3-partial + TSB-6):

- [x] **Business goal met** for the in-scope set — the **CRITICAL** P8/P13 cross-tenant student-PII leak (TSB-1) is closed at all **8** grade-fallback sites (the audit named 2; backend found 8, incl. a cross-tenant WRITE). A teacher can no longer read or write names/mastery/XP of students at other schools. TSB-2 adds a discoverable teacher RLS backstop on `public.students` (defense-in-depth). *(NOT in scope: TSB-4 USER-gated; TSB-3-full + TSB-5 + the 3 pre-existing tracked items.)*
- [x] **No broken/empty states** on touched paths — fail-closed yields the existing empty/403/zero responses; a legitimate school teacher with `grades_taught` still sees their OWN school's grade students; class-roster (Path A) access is untouched.
- [x] **Bilingual (P7)** — no new user-facing string introduced; `students/page.tsx` remains bilingual (broader teacher-page parity is a low frontend follow-up).
- [x] **P8 RLS boundary** — TSB-2 named teacher SELECT policy on `students`, predicate-identical to the already-active `is_teacher_of(id)` branch → provably no over-grant; additive + idempotent.
- [x] **P9 RBAC** — no role/permission/grant change; existing JWT-bind + `authorizeRequest`/`assertTeacherOwnsClass` gates unchanged (TSB-1 scopes *within* the gate).
- [x] **P13 privacy** — cross-tenant leak closed; fail-closed on null `school_id`; no PII added to any log (IDs/counts only).
- [x] **Invariants P1–P15** upheld; P8/P13 strengthened, no regression.
- [x] **type-check** green.
- [x] **lint** green (0 errors).
- [x] **test** green (527/527 vitest; incl. 15 TSB-1 + 10 TSB-2 new).
- [x] **build** green; **no bundle impact** (Edge Function + migration only).
- [x] **Quality verdict = APPROVE WITH CONDITIONS** (`07-validation.md`, independent) — the single condition (TSB-2 migration ordering) is **RESOLVED**.
- [x] **P14 review chain complete** — architect (RLS/boundary + migration) + backend (Edge Function fix) → testing (coverage GREEN) + quality (independent APPROVE WITH CONDITIONS, condition resolved). See `08-regression.md`.
- [x] **Regression sweep green + catalog filed** — sweep GREEN; **REG-184 (P8/P13 tenant scoping) + REG-185 (P8 teacher RLS backstop)** added → catalog **152**; REG-120/121/122/124/128 still green.

## Quality condition — RESOLVED
- **Condition:** the TSB-2 migration was timestamped `20260629000000` (out-of-order — before the true latest root migration `20260702000800`).
- **Resolution:** architect RENAMED it to `20260702010000` (sorts last; content **byte-identical**); testing updated the test reference; re-verified. Condition closed.

## Why NOT fully COMPLETE — open gated / follow-up items (resume here next session)
1. **TSB-4 (Medium, GATED — USER APPROVAL for the DROP):** dual `class_students` vs `class_enrollments` join tables (incomplete migration; sync trigger papers over it). Read-consolidation is auto-fix-safe; any table DROP requires USER approval. **Surface to CEO.**
2. **TSB-3 full convergence (ai/architect):** shared cross-runtime authz module so `teacher-dashboard` reuses `canAccessStudent` (removing Path B is a product-behavior change). Path B is tenant-scoped + fail-closed as the safe interim.
3. **TSB-5 (ops/frontend, LOW):** `ff_school_pulse_v1` is a render guard not a data-access guard — one-line clarifying comment on the (separate) pulse routes.
4. **Pre-existing TS2352** at `teacher-dashboard/index.ts:2704` (untouched join-cast; surfaces under `deno check`, not `tsc`) — separate cleanup PR (architect).
5. **Vacuously-green walker** in the OLD `teacher-dashboard-roster-join.test.ts` — harden separately (testing).
6. **CI-resilience:** Deno dependency pre-warm step has no retry — candidate retry-with-backoff on `deno cache` (ops/architect).

## Sign-off
| Role | Agent | Date | Verdict |
|---|---|---|---|
| Builder (RLS / boundary) | architect (TSB-2 migration + boundary map) | 2026-06-29 | DONE |
| Builder (impl) | backend (TSB-1 / TSB-3-partial / TSB-6) | 2026-06-29 | DONE |
| Testing | testing | 2026-06-29 | **GREEN** (527/527; REG-184/185 filed) |
| Quality (independent) | quality | 2026-06-29 | **APPROVE WITH CONDITIONS** — condition (migration ordering) **RESOLVED** |
| Orchestrator (mark COMPLETE) | — | — | NOT YET — auto-fix-safe complete; TSB-4 USER-gated + TSB-3-full / TSB-5 + 3 pre-existing tracked items follow-ups |
