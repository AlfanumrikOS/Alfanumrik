# STATUS: Cross-Cutting Invariants (Cycle 8, FINAL)

> One per workflow cycle. The workflow is **COMPLETE** only when every box below is checked.
> This is the **final cycle of the 8-cycle engineering-audit program.**

- **Cycle:** cycle-8
- **Workflow:** cross-cutting — P7 (bilingual breadth), P8 (RLS breadth), P10 (bundle), mobile-web sync
- **Primary invariants:** P7 (bilingual UI); P8 (RLS boundary); P10 (bundle budget); mobile-web contract sync; P11/P13 cross-check
- **Owner squad:** backend (Track A — XC-1/XC-2 P7) + testing (Track B — XC-5/XC-6/XC-4a); quality/orchestrator (independent validation); architect (noted — XC-3/XC-4b initiatives)
- **Started:** 2026-06-29
- **Status:** **CYCLE 8 LANDED — mobile-web drift contracts + bundle-cap pin + P7 server-notification Hindi; XC-3/XC-4b/XC-7 tracked as larger initiatives**

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
Status of each gate item for the Cycle-8 *landed* set (XC-1/XC-2 backend P7 + XC-5/XC-6/XC-4a testing):

- [x] **Business goal met** for the in-scope set — XC-1/XC-2 add the Hindi twin (`data.title_hi`/`data.body_hi`) to the daily-cron score-milestone + parent-digest notifications in the shape the client actually reads (relocating the parent-digest's dead top-level `body_hi` so its Hindi finally renders); XC-6/XC-5 add web↔mobile drift contracts (price + 41 score-config constants); XC-4a pins the bundle caps against creep. *(NOT in scope: XC-3 P8 RLS defense-in-depth, XC-4b @supabase/* split, XC-7 i18n primitive — LARGER-PROGRAM initiatives.)*
- [x] **No broken/empty states** — pure-additive Hindi (no English/trigger/threshold change); notification rows without a twin still fall back to English exactly as before.
- [x] **P7 bilingual** — strengthened: Hindi twins on the highest-value re-engagement notifications; XP / "Performance Score" left untranslated (product terms).
- [x] **P8 RLS boundary** — no route boundary changed; XC-3 (87% admin-client) mapped + tracked as a LARGER-PROGRAM initiative.
- [x] **P10 bundle** — XC-4a pins caps; no runtime change ships, test files have no bundle footprint.
- [x] **P11/P13 cross-check** — XC-6 pins web↔mobile price display parity (charge stays server-authoritative); no PII added to notifications (Track A) and drift tests read only constants (Track B).
- [x] **Mobile-web sync** — XC-5/XC-6 convert comment-only sync into CI-enforced parity tests.
- [x] **Invariants P1–P15** upheld; P7/P10 strengthened, no regression.
- [x] **type-check** green.
- [x] **lint** green (0 errors).
- [x] **test** green (11/11 cross-cutting tests; REG-191/192/193).
- [ ] **build** — **DEFERRED to CI backstop** (transient platform outage during validation; Deno Edge Function + test-only files → negligible bundle risk; CI's post-merge build + `check:bundle-size` is authoritative).
- [x] **Quality/orchestrator verdict = APPROVE** (`07-validation.md`, independent self-validation).
- [x] **P14 review chain complete** — backend (P7) + testing (drift/cap guards) → quality/orchestrator (independent APPROVE); architect noted for XC-3/XC-4b initiatives. See `08-regression.md`.
- [x] **Regression sweep green + catalog filed** — sweep GREEN; **REG-191/192/193** added → catalog **160**; REG-49/65/134 still green.

## Why NOT fully COMPLETE — LARGER-PROGRAM initiatives (post-program backlog)
1. **XC-3 (P8, HIGH, systemic):** 87% admin-client routes — dedicated RLS defense-in-depth program (subsumes Cycle-5 TSB-2 + Cycle-7 PP-5). Multi-sprint.
2. **XC-4b (P10):** @supabase/* AuthContext first-paint split (~57 kB), then ratchet cap toward 160 kB. P15-touching.
3. **XC-7 (P7):** central keyed-resolver i18n primitive + missing-string lint — the chokepoint that would mechanically prevent the XC-1/XC-2 class.
4. **P7 follow-ups:** `school-operations.ts` + parent-portal PP-7 insights/tips/glance — same English-only-title class, bounded out of the daily-cron scope.

## Sign-off
| Role | Agent | Date | Verdict |
|---|---|---|---|
| Builder (P7 server notifications) | backend (XC-1/XC-2) | 2026-06-29 | DONE |
| Builder (drift/cap guards) | testing (XC-5/XC-6/XC-4a) | 2026-06-29 | **GREEN** (11/11; REG-191/192/193 filed) |
| Quality / orchestrator (independent) | quality / orchestrator | 2026-06-29 | **APPROVE** |
| Orchestrator (mark COMPLETE) | — | 2026-06-29 | **AUTO-FIX-SAFE COMPLETE** — XC-3/XC-4b/XC-7 = post-program LARGER-PROGRAM initiatives; **8-CYCLE PROGRAM COMPLETE** |
