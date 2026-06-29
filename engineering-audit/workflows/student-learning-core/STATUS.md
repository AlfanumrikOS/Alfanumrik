# STATUS: Student Learning Core (Cycle 3)

> One per workflow cycle. The workflow is **COMPLETE** only when every box below is checked.

- **Cycle:** cycle-3
- **Workflow:** student-learning-core (Quiz / Scoring / XP / Mastery)
- **Primary invariants:** P1 (score accuracy), P2 (XP economy), P3 (anti-cheat), P4 (atomic submission),
  P5 (grade format), P6 (question quality); P12 (AI safety) workflow-adjacent
- **Owner squad:** assessment (lead/audit) + frontend (impl) + testing (coverage); quality (independent validation)
- **Started:** 2026-06-29
- **Status:** **CYCLE 3 LANDED — auto-fix-safe complete; SLC-1/4/5 + SLC-8-cutover gated/cross-agent**

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
Status of each gate item for the Cycle-3 *landed* set (SLC-7 + SLC-2/3/6/8-pin):

- [x] **Business goal met** for the in-scope set — the dead P6 `isValidQuestion` gate is now live at the
  serve boundary (SLC-7); P1 three-way parity (SLC-3 → REG-180), P2 earning-literal parity (SLC-2 →
  REG-181), the intended P3 flag-vs-reject asymmetry (SLC-6), and the current submit-idempotency contract
  (SLC-8 pin) are all now regression-protected. *(NOT in scope: SLC-1/4/5 gated; SLC-8 cutover pending.)*
- [x] **No broken/empty states** on touched paths — SLC-7 zero-valid renders a clean **bilingual** error
  state; partial removal proceeds normally.
- [x] **Bilingual (P7)** — SLC-7 zero-valid error state is Hi/En via `AuthContext.isHi`.
- [x] **P1 score accuracy** — formula untouched at all three computing sites; SLC-3 now guards identity;
  SLC-7 preserves served-count consistency (one filtered array feeds `mcqIds` + `displayQuestions` +
  submitted set), so the server re-derives the score over exactly the snapshotted set.
- [x] **P2 XP economy** — no 10/20/50 literal or 200 cap changed; SLC-2 now guards the earning literals.
- [x] **P3 anti-cheat** — 3s / >3 / count thresholds unchanged; SLC-6 pins the intended asymmetry.
- [x] **P4 atomic submission** — single in-transaction `atomic_quiz_profile_update` call unchanged; count
  consistency keeps `responses.length === questions.length`.
- [x] **P5 grade format** — `student.grade` flows as a string; untouched.
- [x] **P6 question quality** — strengthened: render-boundary gate now live; server snapshot guarantee
  unchanged.
- [x] **P13 privacy** — SLC-7 drop-log carries question id + reason only; no student identity/answers.
- [x] **Invariants P1–P15** upheld; P1/P2/P6 strengthened, no regression.
- [x] **type-check** green.
- [x] **lint** green (0 errors).
- [x] **test** green (40/40 new + ~1678 broad quiz/xp/scoring tests).
- [x] **build** green; bundle within P10 caps.
- [x] **Quality verdict = APPROVE** (`07-validation.md`, independent) — the one MINOR brace nit now fixed.
- [x] **P14 review chain complete** — assessment (audit) → frontend (impl) + testing (coverage) + quality
  (APPROVE). See `08-regression.md`.
- [x] **Regression sweep green + catalog filed** — sweep GREEN; **REG-180 (P1) + REG-181 (P2)** added →
  catalog **148**; REG-45/48/51/53 still green.

## Why NOT fully COMPLETE — open gated / cross-agent items (resume here next session)
1. **SLC-1 (High, GATED — USER APPROVAL):** legacy `quiz_sessions` AFTER-completion trigger re-awards XP
   (10/20/50) with **no daily cap**, deduped from the RPC only by a fragile 5-second wall-clock window — a
   second uncapped XP writer. DB trigger + P2 economy change → **architect + assessment** joint design to
   consolidate to one capped writer. Do NOT change the cap (200) or the earning literals.
2. **SLC-4 (Medium, GATED):** two daily-cap implementations (7-arg IST ledger vs JSONB 6-arg
   `CURRENT_DATE` fallback) + a `score`-vs-`xp_earned` column mismatch. **architect / backend** alignment.
3. **SLC-5 (Medium, cross-agent):** server "rejects" flagged submissions by zeroing XP but still records
   the session/counters (vs client true-reject) — pollutes mastery analytics; reachable by direct/mobile
   callers. **assessment** defines canonical reject-semantics → **backend** implements.
4. **SLC-8 cutover (backend / architect):** flip `ff_server_only_quiz_submit` to route all submits through
   the idempotency-keyed `/api/quiz/submit`. The SLC-8 pin protects the interim state until then.
5. **SLC-9 (Low-Med, testing backlog):** xp-rules branch + cognitive-engine coverage below aspirational
   target. Non-blocking ratchet.

## Sign-off
| Role | Agent | Date | Verdict |
|---|---|---|---|
| Builder | frontend (SLC-7) + testing (SLC-2/3/6/8-pin) | 2026-06-29 | DONE (in-scope set) |
| Audit / definition (P14 lead) | assessment | 2026-06-29 | **APPROVE** (P1/P2/P3 non-change) |
| Quality (independent) | quality | 2026-06-29 | **APPROVE** |
| Testing | testing | 2026-06-29 | **GREEN** (sweep; REG-180/181 filed) |
| Orchestrator (mark COMPLETE) | — | — | NOT YET — auto-fix-safe complete; SLC-1/4/5 gated + SLC-8 cutover pending |
