# Priority Backlog — Workflow Domains

Ranked queue of workflow domains for the audit loop. The loop processes top-down. Only
one workflow is "Current" at a time (see `STATE.md`). Severity reflects blast radius if
the workflow fails in production (revenue, acquisition, trust, compliance).

| Rank | Workflow | Primary Invariants | Severity | Status | Owner squad | Rationale |
|---|---|---|---|---|---|---|
| 1 | **Auth & Onboarding** | P15, P8, P9 | Critical | **DONE — partial** (Cycle 1, 2026-06-28/29 — AO-4/8/1/2 + AO-5/7/9 landed; AO-3 user-gated, AO-2 CI fixtures + AO-10 grade-coercion follow-ups) | architect (lead) + backend + frontend + testing | #1 acquisition path; if signup→verify→profile→dashboard breaks for any role, no user ever reaches the product. Spans 3 roles and a 3-layer profile failsafe. |
| 2 | **Payments & Subscriptions** | P11 | Critical | **DONE** (Cycle 2, 2026-06-29 — auto-fix-safe complete; PAY-2 gated to user; mobile-repoint follow-up) | backend (lead) + architect | Direct revenue path. Razorpay webhook signature + atomic subscription writes; split-brain and idempotency risk. Wrong here = lost money or unpaid access. |
| 3 | **Student Learning Core (Quiz / Scoring / XP)** | P1, P2, P3, P4, P5, P6, P12 | Critical | **DONE** (Cycle 3, 2026-06-29 — auto-fix-safe complete; SLC-1 user-gated, SLC-4/5 + SLC-8 cutover gated/cross-agent) | assessment (lead) + frontend + testing | The product's reason to exist. Score formula, XP economy, anti-cheat, atomic submission, question quality — most invariants concentrate here. SLC-7 wired the dead P6 gate; SLC-2/3/6/8-pin added P1/P2/P3 parity + idempotency guards (REG-180/181). |
| 4 | **Foxy AI Tutor & RAG** | P12, P8 | High | **DONE** (Cycle 4, 2026-06-29 — P12 output backstop complete; FOX-4 user-gated provider governance; FOX-7 + streaming-residual + Hindi-tokens follow-ups) | ai-engineer (lead) + assessment | Core differentiator. The live grounded-path lacked the P12 "no unfiltered LLM output" backstop (legacy guard left behind at the grounded-answer cutover); FOX-1 (+ Deno twin) now screens every student-facing exit, FOX-2 neutralizes message injection, FOX-3 restores the dead doubt template, FOX-6 pins the P13 prompt boundary (REG-182/183). |
| 5 | **Teacher / School-Admin B2B** | P8, P9, P13 | High | **DONE** (Cycle 5, 2026-06-29 — auto-fix-safe complete; **critical cross-tenant leak TSB-1 closed** at all 8 grade-fallback sites + TSB-2 RLS backstop; TSB-4 USER-gated table-drop; TSB-3/5 + 3 tracked items follow-ups) | backend (lead) + architect + frontend | B2B revenue + multi-tenant isolation. Class/roster/grade-book/RBAC across institutions; cross-tenant leak is a contract-ending event. **TSB-1: a teacher with `grades_taught` but no class could read/write names/mastery/XP of every student across ALL schools via the teacher-dashboard grade fallback (service-role, RLS-bypassed) — now `school_id`-scoped + fail-closed (REG-184); TSB-2 adds a discoverable teacher RLS backstop on `public.students` (REG-185).** |
| 6 | **Super-Admin & Observability** | P9, P13 | Medium | **DONE** (Cycle 6, 2026-06-29 — auto-fix-safe complete; **SAO-1/SAO-5 PII-export tiering USER-GATED**) | ops (lead) + frontend | Operational control plane. Admin auth, audit logging, analytics without PII, health/observability accuracy. Mechanism layers sound; SAO-3 added observability-CSV egress redaction, SAO-2 dropped gratuitous `top_students.email`, SAO-7 made the P9 gate-before-I/O check a full-surface sweep (134 routes, 207/207), SAO-4 added a bare-name log canary (REG-186/187). **SAO-1: `/api/super-admin/reports` bulk-exports raw student name+email + parent name+email+PHONE + teacher email at the LOWEST `support` tier — the admin ladder gates by action-destructiveness, not read-data-sensitivity; raising the tier is a DPDP-relevant access-model change → USER-GATED.** |
| 7 | **Parent Portal (dual auth + DPDP)** | P8, P13, P15 | Medium | **DONE** (Cycle 7, 2026-06-29 — auto-fix-safe complete; **PP-1-consent + PP-3 link-model USER-GATED**) | backend (lead) + testing + quality; architect (gated/RLS follow-ups) | Parent↔child link boundary, consent, data export/erasure (DPDP). No parameter-tampering IDOR on canonical routes. PP-2 closed link-code PostgREST filter-injection at all 3 `.or()` sites via a shared `isValidLinkCode` (`^[A-Z0-9]{4,12}$`) + byte-identical Deno twin; PP-1 added a per-IP brute-force rate limit (5/hour, 429) to the legacy Edge `parent_login`; PP-4 gated `PATCH /api/parent/profile` on the already-granted `profile.update_own`; PP-5 pinned the unlinked-parent deny across all 9 child-data routes (REG-188/189/190). **PP-1: the legacy Edge `parent_login` grants an `active` guardian link from a link code ALONE — no student approval; the rate limit closes brute-force but the consent-model fix (require approval / deprecate `parent_login`) is a DPDP/child-consent access-model change → USER-GATED.** PP-3 (4 parallel link-creation paths → one choke-point) folds into the same decision; PP-5 client-migration to RLS-scoped reads + PP-6 helper convergence + PP-7 bilingual server strings are follow-ups (PP-5/PP-7 feed Cross-cutting). |
| 8 | **Cross-cutting** | P7, P8, P10, mobile sync | Medium | **DONE** (Cycle 8, 2026-06-29 — auto-fix-safe complete; **FINAL CYCLE — 8-CYCLE PROGRAM COMPLETE**; XC-3/XC-4b/XC-7 = LARGER-PROGRAM initiatives) | quality (lead) + backend + testing + architect | Bilingual (P7) parity breadth, RLS breadth (P8), bundle budget (P10), mobile-web API contract sync — the horizontal sweep after the vertical workflows. XC-1/XC-2 added the P7 Hindi twin (`data.title_hi`/`data.body_hi`) to the daily-cron score-milestone + parent-digest notifications in the shape the client reads (relocating the parent-digest's dead top-level `body_hi`); XC-6 pinned web↔mobile price parity (REG-191); XC-5 pinned the 41 score-config constants web↔Flutter (REG-192); XC-4a pinned the bundle caps against creep (REG-193). **XC-3 (87% admin-client routes — P8 RLS defense-in-depth), XC-4b (@supabase/* first-paint split), XC-7 (central i18n primitive) are LARGER-PROGRAM initiatives** (see post-program backlog below). |

## Program status — COMPLETE (2026-06-29)

**All 8 ranked workflow cycles are DONE (auto-fix-safe).** The 8-cycle engineering-audit program has
audited → hardened → merged every workflow. Regression catalog grew from ~146 to **160** across the
program (REG-177..193 = 17 new entries). Per-cycle CEO close-out + the consolidated decision register live
in `PROGRAM-SUMMARY.md`.

| Cycle | Workflow | Status |
|---|---|---|
| 1 | Auth & Onboarding (P15) | DONE — partial (AO-4/8/1/2 + AO-5/7/9; AO-3/AO-10 follow-ups) |
| 2 | Payments & Subscriptions (P11) | DONE — auto-fix-safe (PAY-1/3/4/5/6/7/8; PAY-2 user-gated) |
| 3 | Student Learning Core (P1-P6,P12) | DONE — auto-fix-safe (SLC-7/2/3/6/8-pin; **SLC-1 de-dup LANDED 2026-06-29, REG-194**; SLC-1-backfill NEW user-gated; SLC-4/5 cross-agent) |
| 4 | Foxy AI Tutor & RAG (P12,P8,P13) | DONE — P12 output backstop (FOX-1/2/3/6; FOX-4 user-gated) |
| 5 | Teacher / School-Admin B2B (P8,P9,P13) | DONE — auto-fix-safe (**TSB-1 critical cross-tenant leak fixed**; TSB-4 user-gated) |
| 6 | Super-Admin & Observability (P9,P13) | DONE — auto-fix-safe (SAO-3/2/7/4; SAO-1/SAO-5 user-gated) |
| 7 | Parent Portal (P8,P13,P15) | DONE — auto-fix-safe (PP-2/PP-1-rate-limit/PP-4/PP-5; PP-1-consent/PP-3 user-gated) |
| 8 | Cross-cutting (P7,P8,P10,mobile) | DONE — auto-fix-safe (XC-1/2/5/6/4a; XC-3/4b/7 larger initiatives) |

## Post-program remediation backlog

The unresolved work that outlived the audit, tiered by how it must be actioned. **Tier-1 needs a CEO
decision; Tier-2 is reversible and pre-approved (engineering may schedule); Tier-3 is a multi-sprint
initiative.** Full rationale per item is in `PROGRAM-SUMMARY.md` and each cycle's STATUS/ledger.

### Tier-1 — USER-GATED (CEO decision required)
| Item | Cycle | Invariant | Decision needed |
|---|---|---|---|
| **PAY-2** | 2 | P11 | `create-order` hardcoded `PRICING` can diverge from DB `subscription_plans` (dead on web, live only on the already-broken mobile path). Any pricing-amount change is user-gated. |
| ~~**SLC-1**~~ → **DONE** (2026-06-29) | 3 | P2 | ~~Legacy `quiz_sessions` trigger re-awards XP with NO daily cap.~~ **LANDED — going-forward de-dup:** migration `20260702020000_slc1_dedupe_quiz_session_xp_trigger.sql` (Option B `CREATE OR REPLACE`, streak KEPT) removed the duplicate uncapped writes; `atomic_quiz_profile_update` is now the SOLE capped XP writer (XP values + 200 cap UNCHANGED). Mobile SAFE; quality APPROVE; P14 complete; **REG-194** (catalog → 161). Live-DB proof DEFERRED to staged rollout. See `remediation/slc-1-xp-trigger/`. |
| **SLC-1-backfill** (NEW — successor to SLC-1) | 3 | P2 | The SLC-1 fix stops the double-award GOING FORWARD; it does NOT correct already-inflated `students.xp_total` / `student_learning_profiles.xp` / levels / leaderboard standings from the period the double-award was live. Reconciling them against the `xp_transactions` ledger changes STORED economy values + visibly REDUCES some students' XP/level/rank → CEO decision + comms plan. Quantify footprint via the read-only reconciliation query first. |
| **FOX-4** | 4 | P12 | OpenAI gpt-4o-mini/gpt-4o present in `grounded-answer` as a MoL SHADOW comparison (telemetry only; not student-facing). Provider PRESENCE is user-gated — govern or remove. |
| **TSB-4** | 5 | P8 | Teacher↔student membership modeled in TWO tables (`class_students` vs `class_enrollments`) reconciled by a sync trigger. Picking a canonical table and DROPPing the other is a schema DROP. |
| **SAO-1 / SAO-5** | 6 | P13 | `/api/super-admin/reports` bulk-exports raw student name+email + parent name+email+PHONE + teacher email (+ audit-log admin PII) at the LOWEST `support` tier. Raising the tier / splitting a PII-export permission is a DPDP-relevant admin access-model change. |
| **PP-1-consent / PP-3** | 7 | P8/P13 | Legacy Edge `parent_login` creates an ACTIVE guardian link from a link code ALONE (no approval). Require approval / deprecate `parent_login`, and consolidate the 4 parallel link-creation paths onto one consent-respecting choke-point — changes the consent/link MODEL. |

### Tier-2 — REVERSIBLE / pre-approved (engineering may schedule; no CEO gate)
| Item | Cycle | Note |
|---|---|---|
| **SLC-4 / SLC-5** | 3 | Two daily-cap implementations + a `score`-vs-`xp_earned` column mismatch (architect/backend align); server "rejects" flagged submissions by zeroing XP yet still records the session (assessment defines canonical reject-semantics → backend implements). |
| **SAO-1 (egress) / SAO-5 cleanups** | 6 | The ops-owned halves already landed (SAO-3/2/7/4); residual = export `message`-column free-form redaction if a future template interpolates PII + periodic manual re-read of highest-PII routes (process). |
| **PP-1 (durable limiter) / PP-3 (cleanup)** | 7 | Move the in-memory `parent_login` rate limiter to an Upstash/DB-backed counter (cross-instance). |
| **SLC-4 / SLC-5 / AO-3 / AO-10** | 1/3 | AO-3 institution_admin provisioning unification (needs architect design — note: AO-3 itself is user-gated for the provisioning model; the read-consolidation is reversible); AO-10 grade-coercion backfill + `normalize_grade` rename/read-time coercion. |

### Tier-3 — LARGER-PROGRAM initiatives (multi-sprint engineering)
| Item | Cycle | Note |
|---|---|---|
| **XC-3** | 8 | Systemic RLS defense-in-depth — 87% of routes use the admin client; inventory by sensitivity → scoped client / RLS backstop → CI rule on new admin-client imports on PII routes. Subsumes TSB-2 + PP-5. |
| **XC-4b** | 8 | Split @supabase/* out of first paint (~57 kB), then ratchet CAP_SHARED_KB back toward the 160 kB baseline (P15-touching). |
| **XC-7** | 8 | Adopt the `today/copy.ts` keyed-resolver as the house i18n standard + a missing-translation lint (the chokepoint absent today). |
| **PP-5 (client migration)** | 7 | Migrate the parent child-data routes to RLS-scoped clients (defense-in-depth) — folds into XC-3. |

## Notes

- Ranking is by **severity × reach**: revenue and acquisition paths first, horizontal
  hygiene last.
- A workflow may surface a gap that belongs to a higher-ranked workflow; file it in the
  current cycle's gap analysis and cross-link — do not jump the queue mid-cycle.
- When rank 1 reaches COMPLETE, set rank 2 to IN PROGRESS, open a new cycle entry in
  `STATE.md`, and update this table.
